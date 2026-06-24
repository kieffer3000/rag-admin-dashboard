import { auth } from '@clerk/nextjs/server';
import { runUtilityLLM } from '@/lib/rag/utility-llm';
import { fetchSummaries, wantsSummary } from '@/lib/rag/summary-core';
import { nsForUser } from '@/lib/rag/namespace';

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

const NOMATCH_THRESHOLD = Number(process.env.RAG_NOMATCH_THRESHOLD ?? 0.6);
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
  const parts = [`Instruction: ${modeDirective(mode)}`];
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
  namespace: string
): Promise<MakeResult> {
  const res = await fetch(url, {
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
      model,
      // Lets the Make scenario branch its pipeline (fast skips the expander;
      // research uses the heavier answer model).
      speed
    })
  });
  if (!res.ok) throw new Error(`Query webhook returned ${res.status}`);

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
  const { userId } = await auth();
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
  const sourceIds: string[] = body.source_ids ?? [];
  const contextTexts: string[] = body.context_texts ?? [];
  const guides: string[] = (body.guides ?? []).filter(
    (g: unknown) => typeof g === 'string' && g.trim()
  );

  if (!body.question || sourceIds.length === 0) {
    return Response.json(
      { error: 'question and source_ids are required' },
      { status: 400 }
    );
  }

  const mode: 'cited' | 'hybrid' =
    body.answer_mode === 'hybrid' ? 'hybrid' : 'cited';
  const model = body.model ?? 'gemini-2.5-flash';
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

  // Single retrieval pass. Corrective-retry now lives in the Make scenario
  // (router loop off the validator verdict).
  let result: MakeResult;
  try {
    result = await callMake(
      url,
      buildPrompt(userQuestion, mode, guides, contextTexts),
      userQuestion,
      sourceIds,
      mode,
      guides,
      model,
      profile,
      speedParam,
      conversation,
      summary,
      nsForUser(userId)
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Query failed' },
      { status: 502 }
    );
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
