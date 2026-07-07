import { resolveRealModelId } from '@/lib/rag/model-map.server';
import { STACK_PRIVACY_GUARDRAIL } from '@/lib/rag/stack-privacy';
import { auth } from '@clerk/nextjs/server';
import { longFetch } from '@/lib/rag/long-fetch';
import { runUtilityLLM } from '@/lib/rag/utility-llm';
import { fetchSummaries, wantsSummary } from '@/lib/rag/summary-core';
import { nsForUser } from '@/lib/rag/namespace';
import { retrieveExpandedContext, type ContextChunk } from '@/lib/rag/expand';
import {
  extractMentionTerms,
  mentionScan,
  RARE_TERM_MAX_MATCHES,
  type MentionScanResult
} from '@/lib/rag/mention-scan';
import { scopeOf, getOrgOpenrouterKey } from '@/lib/org-settings';
import { resolvePlan, BYOK_QUESTION_MULTIPLIER } from '@/lib/rag/plans';
import { gateUsage, monthPeriod } from '@/lib/rag/metering';
import { getAnswerKey } from '@/lib/rag/openrouter-provision';
import { doctrineFor, injectDoctrine } from '@/lib/rag/doctrines';

// Proxies the Board's brain queries to the Make.com Query scenario.
//
// ARCHITECTURE (2026-06-22): this route is a PURE RELAY. ALL "thinking" (the
// follow-up rewrite/contextualize, multi-query expansion, corrective-retry,
// answer-validation, and summary answering) lives in the Make scenario, where
// it is visible and editable. The route only: auth-gates, gathers the request
// (question + conversation + sources + filter), POSTs to Make, and does the
// DETERMINISTIC response shaping the client footer needs (dedup/sort citations,
// parse suggestedQuestions, read Make's validator verdict). No server-side LLM.
//
// Make owns conversation handling: it receives `conversation` (recent turns,
// preformatted) + `summary` (rolling fold of older turns). Make's EXPANDER
// resolves follow-up references for RETRIEVAL; Make's ANSWER model resolves them
// for GENERATION (modern models do this natively given the history).
//
// Webhook contract (request): { question, query_text, conversation, summary,
//   profile, source_ids[], filter_json, scope, answer_mode, guides, namespace,
//   model, speed }
// (response): { answer, citations[], raw_citations?, used_sources?,
//   suggestedQuestions?, validation?, resolvedQuestion? }
// Webhook URL stays server-side — this repo is public.

export const runtime = 'nodejs';
// Wait for Make's actual response (it returns its own errors) — don't cut a slow
// research query off mid-flight. An observed Make run took exactly 5min (300s) —
// the old 180s ceiling caused a Vercel 504 → false "unreachable". 800s is the
// Fluid Compute ceiling for this project — max headroom available; if a run
// ever exceeds THIS, the fix is the async job+poll redesign, not a bigger number.
export const maxDuration = 800;

const NOMATCH_THRESHOLD = Number(process.env.RAG_NOMATCH_THRESHOLD ?? 0.6);

// Escalating "small-to-big" retrieval (OFF until the Make answer module is wired
// to use `injected_context`). On a no-match, widen the context by neighbor
// expansion (in code) and re-answer through Make with that context injected, up
// to N tiers of growing radius. See ESCALATING_RETRIEVAL_DRAFT.md.
const ESCALATE = (process.env.RAG_ESCALATE ?? 'on') !== 'off';
const ESCALATE_RADII = (process.env.RAG_ESCALATE_RADII ?? '1,3,6')
  .split(',')
  .map((n) => parseInt(n.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const ESCALATE_TOPK = Number(process.env.RAG_ESCALATE_TOPK ?? 12);

// The answer LLM is told to say so plainly when the answer isn't in the sources;
// that admission is our reliable "could not find" signal (there's no validator).
const NOT_FOUND_RE =
  /\b(not (?:in|found|available|present|mentioned|contained|included)|could ?n[o']?t (?:find|locate)|could not (?:find|locate)|no (?:information|mention|reference|record|details?|data)\b.{0,30}\b(?:in|on|about)|does(?:n['o]?t| not) (?:appear|contain|mention|include)|unable to (?:find|locate|answer)|i (?:don['o]?t|do not) have)\b/i;
function answerSaysNotFound(a: string | undefined): boolean {
  if (!a) return false;
  return NOT_FOUND_RE.test(a.replace(/<[^>]+>/g, ' ').slice(0, 1500));
}
// Last 30 turns (≈15 Q + 15 A) sent verbatim, in FULL (no per-message
// truncation); everything older is folded into the entity-preserving rolling
// summary by the client. Wider window = "his house" resolves to the subject
// named up to ~15 exchanges ago without leaning on the summary. MUST stay in
// sync with brain-node HISTORY_WINDOW + research-overlay slice (the fold
// boundary) or the verbatim window and summary gap/overlap.
const HISTORY_MAX_MESSAGES = 30;

interface RawCitation {
  source_id?: string | null;
  score?: number;
  snippet?: string;
}
interface MakeResult {
  answer: string;
  citations: RawCitation[];
  raw_citations: string | null;
  used_sources: string | number[] | null;
  topScore: number | null;
  noMatch: boolean;
  suggestedQuestions: string[];
  /** Verdict from the Make-side validator module (LLM in the Query scenario,
   *  model + prompt editable in the Make UI). "positive" | "negative" | null.
   *  AUTHORITATIVE — the route runs NO validator of its own; Make sees the FULL
   *  retrieved context. */
  validation: string | null;
  /** If Make's expander resolved a follow-up into a standalone query, it may
   *  echo it back for an optional "interpreted as …" UI hint. */
  resolvedQuestion: string | null;
}

function modeDirective(mode: 'cited' | 'hybrid'): string {
  return mode === 'hybrid'
    ? 'Answer primarily from the provided sources and cite them. If the sources do not fully cover the question, you MAY add helpful general knowledge — clearly prefix any such part with "Beyond your sources:".'
    : 'Answer ONLY from the provided sources and cite them. If the sources do not contain the answer, say so plainly rather than guessing.';
}

/** Deterministic wrap of the raw user question with the mode directive, guides,
 *  and any wired context. No LLM — pure string assembly. */
function buildPrompt(
  question: string,
  mode: 'cited' | 'hybrid',
  guides: string[],
  contextTexts: string[]
): string {
  const parts = [`Instruction: ${modeDirective(mode)}`, STACK_PRIVACY_GUARDRAIL];
  if (guides.length)
    parts.push(
      'Additional instructions (follow all of these):\n' +
        guides.map((g) => `- ${g}`).join('\n')
    );
  if (contextTexts.length)
    parts.push(
      `Context from the user (not a source, do not cite): ${contextTexts.join(' | ')}`
    );
  parts.push(`Question: ${question}`);
  return parts.join('\n\n');
}

/**
 * Make's WebhookRespond sometimes wraps the payload as `[{ json: "<stringified>" }]`
 * or `{ json: "<stringified>" }` (a TransformToJSON bundle) instead of the raw
 * `{ answer, citations, raw_citations, ... }` object — a blueprint re-import can
 * flip this, which silently empties citations (and the answer). Unwrap to the
 * real object. No-op when the response is already the flat object.
 */
function unwrapMakeJson(d: any): any {
  let cur: any = d;
  for (let i = 0; i < 4 && cur != null; i++) {
    if (Array.isArray(cur)) {
      cur = cur[0];
      continue;
    }
    if (
      typeof cur === 'object' &&
      cur.answer === undefined &&
      typeof cur.json === 'string'
    ) {
      try {
        cur = JSON.parse(cur.json);
        continue;
      } catch {
        break;
      }
    }
    break;
  }
  return cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : d;
}

/** One call to the Make Query scenario; computes the no-match signal and shapes
 *  the response. This is the only network hop. */
async function callMake(
  url: string,
  promptedQuestion: string,
  queryText: string,
  sourceIds: string[],
  mode: 'cited' | 'hybrid',
  guides: string[],
  model: string,
  profile: string,
  speed: 'fast' | 'detailed' | 'research',
  conversation: string,
  summary: string,
  namespace: string,
  injectedContext = '',
  openrouterKey = ''
): Promise<MakeResult> {
  // longFetch: matched undici set w/ 780s window — Node's global fetch dies at
  // ~300s regardless of maxDuration (a real Make run measured 5min).
  const res = await longFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: promptedQuestion,
      // Subject profile / context for the faceted query expander to bias
      // terminology toward the subject's domain. Maps to {{2.profile}}.
      profile,
      // Raw question for the RETRIEVAL embedding + multi-query expander (the
      // wrapped prompt would dilute the search vector with instruction
      // boilerplate). Generation uses `question`.
      query_text: queryText,
      // Conversation context for Make to resolve follow-up references — in the
      // EXPANDER (retrieval) and the ANSWER model (generation). Preformatted so
      // Make just drops in {{2.conversation}} / {{2.summary}}.
      conversation,
      summary,
      source_ids: sourceIds,
      // Pre-built Pinecone metadata filter. Make's Simple Filter UI only carries
      // scalar values (multi-id arrays get string-coerced -> zero matches), so
      // the scenario maps this verbatim instead.
      filter_json: JSON.stringify({ source_id: { $in: sourceIds } }),
      scope: 'selected',
      answer_mode: mode,
      guides,
      namespace,
      // Escalation: when non-empty, the Make answer module should use THIS as the
      // context (aggregator-shaped JSON) instead of re-retrieving. Empty on the
      // normal first pass. One small scenario edit — no new routers.
      injected_context: injectedContext,
      // BYOK: the org's OpenRouter key (empty = use the Make connection's key).
      // The answer module(s) use this as the OpenRouter Bearer when present.
      openrouter_key: openrouterKey,
      model,
      // Lets the Make scenario branch its pipeline (fast skips the expander;
      // research uses the heavier answer model).
      speed
    })
  });
  if (!res.ok) {
    // Make's error-handler Webhook-response module (if wired) returns a JSON
    // body like { error, stage, detail } on a non-2xx status — surface it
    // instead of just the status code, so the board shows what actually broke.
    const text = await res.text().catch(() => '');
    let msg = `Query webhook returned ${res.status}`;
    try {
      const body = JSON.parse(text);
      if (body?.error) msg = body.stage ? `${body.error} (${body.stage})` : body.error;
      if (body?.detail) msg += `: ${body.detail}`;
    } catch { /* not JSON — keep the status-code message */ }
    throw new Error(msg);
  }

  const data = unwrapMakeJson(await res.json());

  // Prefer the full aggregator array (raw_citations: ALL N retrieved chunks);
  // fall back to data.citations for backward compatibility.
  let allRaw: RawCitation[] = [];
  if (data.raw_citations) {
    try {
      const parsed =
        typeof data.raw_citations === 'string'
          ? JSON.parse(data.raw_citations)
          : data.raw_citations;
      if (Array.isArray(parsed)) {
        allRaw = (parsed as Array<Record<string, unknown>>).map((item) => {
          if (item.source_id) return item as unknown as RawCitation;
          const meta = (item.metadata ?? {}) as Record<string, unknown>;
          return {
            score: item.score as number,
            source_id: meta.source_id as string,
            source_name: meta.source_name as string,
            snippet: (meta.text ?? meta.snippet ?? '') as string,
          } as RawCitation;
        });
      }
    } catch { /* fall through */ }
  }
  if (allRaw.length === 0) {
    allRaw = data.citations ?? [];
  }

  // Dedup (same chunk from multiple query expansions) + sort by score.
  const seen = new Set<string>();
  const citations: RawCitation[] = allRaw
    .filter((c: RawCitation) => {
      if (!c || !c.source_id) return false;
      const key = `${c.source_id}::${(c.snippet ?? '').trim().slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  const scores = citations
    .map((c) => (typeof c.score === 'number' ? c.score : 0))
    .filter((s) => Number.isFinite(s));
  const topScore = scores.length ? Math.max(...scores) : null;

  // Follow-ups: Make often hands these back as a JSON-encoded STRING (a
  // Bedrock/OpenRouter prompt module emits the array as text) — parse it.
  let rawSuggested: unknown =
    data.suggestedQuestions ?? data.suggested_questions ?? [];
  if (typeof rawSuggested === 'string') {
    try {
      rawSuggested = JSON.parse(rawSuggested);
    } catch {
      rawSuggested = [];
    }
  }
  const suggestedQuestions: string[] = (
    Array.isArray(rawSuggested) ? rawSuggested : []
  )
    .map((s: unknown) =>
      typeof s === 'string' ? s : ((s as { question?: string })?.question ?? '')
    )
    .filter((s: string) => typeof s === 'string' && s.trim())
    .slice(0, 6);

  const rawValidation = data.validation ?? data.valid ?? data.verdict ?? null;
  const validation =
    typeof rawValidation === 'string' ? rawValidation : null;

  const rawResolved = data.resolvedQuestion ?? data.resolved_question ?? null;
  const resolvedQuestion =
    typeof rawResolved === 'string' && rawResolved.trim() ? rawResolved : null;

  return {
    answer: data.answer ?? '',
    citations,
    raw_citations: data.raw_citations ?? null,
    used_sources: data.used_sources ?? null,
    topScore,
    noMatch: topScore === null || topScore < NOMATCH_THRESHOLD,
    suggestedQuestions,
    validation,
    resolvedQuestion
  };
}

export async function POST(req: Request) {
  const { userId, orgId, has } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.MAKE_QUERY_WEBHOOK_URL;
  if (!url) {
    return Response.json(
      { error: 'MAKE_QUERY_WEBHOOK_URL is not configured' },
      { status: 503 }
    );
  }

  const body = await req.json();

  // METERING (3.17/3.24): questions are CREDITS gated by plan — a normal ask
  // costs 1, research costs 3 (heavier models + more Make ops). BYOK doubles
  // the monthly allowance (the LLM bill moves to the customer's key). Owners
  // are uncapped (not even counted). Fail-open on any counting error.
  const plan = await resolvePlan(userId, has);
  if (Number.isFinite(plan.caps.questionsPerMonth)) {
    const byok = !!(await getOrgOpenrouterKey(scopeOf(orgId, userId)));
    const credits =
      plan.caps.questionsPerMonth * (byok ? BYOK_QUESTION_MULTIPLIER : 1);
    const cost = body.speed === 'research' ? 3 : 1;
    const gate = await gateUsage(
      scopeOf(orgId, userId),
      'questions',
      monthPeriod(),
      credits,
      cost
    );
    if (!gate.ok) {
      return Response.json(
        {
          error: `Monthly question credits used up (${credits}). They reset at the start of next month${byok ? '' : ' — or add your own AI key in Settings to double your allowance'}.`
        },
        { status: 429 }
      );
    }
  }
  const sourceIds: string[] = body.source_ids ?? [];
  const contextTexts: string[] = body.context_texts ?? [];
  let guides: string[] = (body.guides ?? []).filter(
    (g: unknown) => typeof g === 'string' && g.trim()
  );
  // DOCTRINE-ON-BANK (Boardroom item 1): the Bank's stored doctrine rides
  // EVERY call to it, injected server-side — the client only identifies the
  // Bank (bank_node_id). Best-effort; a lookup hiccup never fails the answer.
  guides = injectDoctrine(
    guides,
    await doctrineFor(scopeOf(orgId, userId), body.project_id, body.bank_node_id)
  );

  if (!body.question || sourceIds.length === 0) {
    return Response.json(
      { error: 'question and source_ids are required' },
      { status: 400 }
    );
  }

  const mode: 'cited' | 'hybrid' =
    body.answer_mode === 'hybrid' ? 'hybrid' : 'cited';
  const model = resolveRealModelId(body.model);
  const userQuestion: string = body.question;
  const fast = body.speed === 'fast';
  const research = body.speed === 'research';
  const speedParam: 'fast' | 'detailed' | 'research' = fast
    ? 'fast'
    : research
      ? 'research'
      : 'detailed';

  // ── Summary route ────────────────────────────────────────────────────────
  // "Summarize this / what is this about" is a GLOBAL question that top-k
  // retrieval under-covers (and the no-match gate can refuse). Answer it from
  // the PRECOMPUTED per-source summaries instead (built once at ingest). This is
  // NOT a phantom LLM: wantsSummary is a regex, fetchSummaries is a storage read,
  // and the synthesis runs through runUtilityLLM → the Make utility webhook (the
  // model lives in Make). Falls through to normal retrieval if no summaries exist.
  if (wantsSummary(userQuestion)) {
    const clusterIds: string[] = Array.isArray(body.cluster_ids)
      ? body.cluster_ids.filter((s: unknown) => typeof s === 'string' && s)
      : [];
    const rollupIds =
      body.everything === true && typeof body.project_id === 'string'
        ? [body.project_id]
        : clusterIds;
    let summaries = rollupIds.length
      ? await fetchSummaries(rollupIds, nsForUser(userId))
      : [];
    if (!summaries.length)
      summaries = await fetchSummaries(sourceIds, nsForUser(userId));
    if (summaries.length) {
      const ctx = summaries
        .map((s, i) => `[${i + 1}] ${s.name}\n${s.text}`)
        .join('\n\n');
      const ans = await runUtilityLLM(
        `${modeDirective(mode)}\n\nThe SUMMARIES below are pre-made overviews of the user's wired sources. Answer the QUESTION from them; if several are given, synthesize across them. Write in clean HTML (<p>, <strong>, <ul>/<li>). After a claim, cite the 1-based source number(s) like [1] or [2] where useful.\n\nSUMMARIES:\n${ctx}\n\nQUESTION: ${userQuestion}`,
        { maxOutputTokens: 1400, temperature: 0.3 }
      );
      if (ans && ans.trim()) {
        return Response.json({
          answer: ans,
          citations: [],
          // Aggregator-shaped so the client's footnote pipeline links [n] → source.
          raw_citations: JSON.stringify(
            summaries.map((s) => ({
              score: 1,
              metadata: {
                source_id: s.source_id,
                source_name: s.name,
                text: s.text
              }
            }))
          ),
          used_sources: null,
          topScore: 1,
          noMatch: false,
          suggestedQuestions: []
        });
      }
    }
    // else: no summary indexed yet → fall through to normal retrieval.
  }

  // Recent conversation, preformatted (deterministic — no LLM). Forwarded to
  // Make so its expander/answer modules can resolve follow-up references. Older
  // turns are folded into `summary` by the client.
  const conversation = (Array.isArray(body.history) ? body.history : [])
    .filter(
      (h: unknown): h is { role: string; content: string } =>
        !!h &&
        typeof (h as { content?: unknown }).content === 'string' &&
        (h as { content: string }).content.trim().length > 0
    )
    .slice(-HISTORY_MAX_MESSAGES)
    .map(
      (h: { role: string; content: string }) =>
        `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`
    )
    .join('\n');
  const summary = typeof body.summary === 'string' ? body.summary : '';

  // Subject profile/context for the faceted expander (deterministic string).
  const profile = [...contextTexts, ...guides]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 1200);

  const ns = nsForUser(userId);
  const prompted = buildPrompt(userQuestion, mode, guides, contextTexts);
  // The OpenRouter key this answer rides (3.17): BYOK if the org set one, else
  // the scope's spend-capped managed sub-key (minted on first use when
  // provisioning is configured), else '' = Make's house connection key.
  const orKey = await getAnswerKey(scopeOf(orgId, userId), plan.caps.managedLlmUsdPerMonth);

  // EXACT-MENTION LANE (3.16): if the question names an exact term (quoted
  // phrase / proper noun / "is X mentioned"), lexically scan the wired sources
  // IN PARALLEL with the semantic pass — embeddings cluster meaning and miss
  // rare tokens by construction (the Kathy incident, journal 2026-07-06).
  const mentionTerms = extractMentionTerms(userQuestion);
  const mentionPromise: Promise<MentionScanResult> = mentionTerms.length
    ? mentionScan(mentionTerms, sourceIds, ns).catch(() => ({
        hits: [] as ContextChunk[],
        scanned: 0,
        truncated: false
      }))
    : Promise.resolve({ hits: [], scanned: 0, truncated: false });

  // First retrieval pass (T1) through Make.
  let result: MakeResult;
  try {
    result = await callMake(
      url, prompted, userQuestion, sourceIds, mode, guides,
      model, profile, speedParam, conversation, summary, ns, '', orKey
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Query failed' },
      { status: 502 }
    );
  }

  // Exact-mention merge: re-answer ONCE with the literal hits injected when the
  // scan found a RARE term in chunks the T1 answer never saw. Common terms
  // (> RARE_TERM_MAX_MATCHES chunks) are left to semantic retrieval — an
  // exhaustive injection of a book's main subject can't fit a context window.
  const mention = await mentionPromise;
  if (mention.hits.length > 0 && mention.hits.length <= RARE_TERM_MAX_MATCHES) {
    const seenSnippets = new Set(
      (result.citations ?? []).map((c) => (c.snippet ?? '').trim().slice(0, 80))
    );
    const unseen = mention.hits.filter(
      (h) => !seenSnippets.has(h.metadata.text.trim().slice(0, 80))
    );
    if (unseen.length > 0) {
      // Merge: literal hits first (certainty), then T1's semantic context so
      // the re-answer keeps what retrieval already found.
      const semanticCtx: ContextChunk[] = (result.citations ?? [])
        .filter((c) => c.source_id && c.snippet)
        .map((c) => ({
          score: c.score ?? 0.5,
          metadata: {
            source_id: c.source_id as string,
            source_name: (c as { source_name?: string }).source_name,
            text: c.snippet as string
          }
        }));
      const merged = [...mention.hits, ...semanticCtx];
      try {
        const r2 = await callMake(
          url, prompted, userQuestion, sourceIds, mode, guides,
          model, profile, speedParam, conversation, summary, ns,
          JSON.stringify(merged), orKey
        );
        if (r2.answer && r2.answer.trim()) {
          result = r2;
          result.noMatch = false; // literal text was found and injected
        }
      } catch {
        /* keep the T1 answer */
      }
    }
  }

  // Escalating small-to-big retrieval (gated by RAG_ESCALATE; requires the Make
  // answer module to honor injected_context). Trigger: score-gate no-match OR the
  // answer admitting it couldn't find it. Each tier widens the neighbor radius
  // and re-answers with that context injected — no re-chunking, bounded by
  // ESCALATE_RADII. Always safe: if expansion yields nothing we keep T1's answer.
  if (ESCALATE && (result.noMatch || answerSaysNotFound(result.answer))) {
    for (const radius of ESCALATE_RADII) {
      const ctx = await retrieveExpandedContext(userQuestion, ns, {
        topK: ESCALATE_TOPK,
        radius
      });
      if (!ctx.length) break;
      try {
        result = await callMake(
          url, prompted, userQuestion, sourceIds, mode, guides,
          model, profile, speedParam, conversation, summary, ns, JSON.stringify(ctx), orKey
        );
      } catch {
        break; // keep the best answer we already have
      }
      if (!answerSaysNotFound(result.answer)) {
        result.noMatch = false; // we force-fed context and the model used it
        break;
      }
    }
  }

  // NOTE: the Make validator verdict is ADVISORY ONLY — it NEVER blanks the
  // answer. A single LLM should not get veto power over the whole pipeline's
  // work (it once discarded a fully-grounded, 10-source, 0.75-score answer over
  // one inferential sentence). The honest "found nothing" decision comes from
  // RETRIEVAL SCORES (the no-match gate above, computed across many chunks),
  // not from one model judging the answer. `validation` is passed through so the
  // UI may optionally show a soft "unverified" hint — but the answer is always
  // shown when retrieval succeeded.
  const usedSources = result.noMatch ? null : result.used_sources;

  return Response.json({
    answer: result.answer,
    citations: result.citations,
    raw_citations: result.raw_citations,
    used_sources: usedSources,
    topScore: result.topScore,
    noMatch: result.noMatch,
    suggestedQuestions: result.suggestedQuestions,
    // ADVISORY ONLY — never gates the answer; UI may show a soft "unverified" hint.
    validation: result.validation,
    // present only when Make's expander rewrote the query (optional UI hint)
    resolvedQuestion: result.resolvedQuestion
  });
}
