import { auth } from '@clerk/nextjs/server';
import { runUtilityLLM } from '@/lib/rag/utility-llm';
import { retrieveMemories } from '@/lib/rag/memory';

// Proxies the Board's brain queries to the Make.com Query scenario.
// The webhook contract is FROZEN (see BOARD_SPEC.md):
//   request:  { question, source_ids[], filter_json, scope, namespace, model,
//               answer_mode, guides }
//   response: { answer, citations: [{ source_name, source_id, snippet, score }],
//               suggestedQuestions? }
// Webhook URL stays server-side — this repo is public.
//
// Corrective-RAG retry (the old AnswersDoc "search further" loop, in code):
// if the first call comes back a no-match (weak/empty retrieval), we reformulate
// the question with Gemini and call Make ONCE more, then keep the better result.
// This needs no Make change — it just calls the existing webhook again. The
// deeper retrieval levers (higher topK, full-chunk text) live INSIDE the Make
// scenario and are specced separately.

export const runtime = 'nodejs';

const NOMATCH_THRESHOLD = Number(process.env.RAG_NOMATCH_THRESHOLD ?? 0.45);
const RETRY_ENABLED = process.env.RAG_CORRECTIVE_RETRY !== 'off';
const VALIDATOR_ENABLED = process.env.RAG_VALIDATOR !== 'off';
const MEMORY_ENABLED = process.env.RAG_MEMORY !== 'off';
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
  topScore: number | null;
  noMatch: boolean;
  suggestedQuestions: string[];
  /** Verdict from a Make-side validator module (LLM in the Query scenario,
   *  model + prompt editable in the Make UI). "positive" | "negative" | null.
   *  When present it is AUTHORITATIVE — the route does NOT run its own LLM
   *  validator (Make sees the FULL retrieved context; the route only sees a
   *  truncated subset, which is why the in-code one was naive). */
  validation: string | null;
}

function modeDirective(mode: 'cited' | 'hybrid'): string {
  return mode === 'hybrid'
    ? 'Answer primarily from the provided sources and cite them. If the sources do not fully cover the question, you MAY add helpful general knowledge — clearly prefix any such part with "Beyond your sources:".'
    : 'Answer ONLY from the provided sources and cite them. If the sources do not contain the answer, say so plainly rather than guessing.';
}

/** Wrap the raw user question with the mode directive, guides, and context. */
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

/** One call to the Make Query scenario; computes the no-match signal. */
async function callMake(
  url: string,
  promptedQuestion: string,
  queryText: string,
  sourceIds: string[],
  mode: 'cited' | 'hybrid',
  guides: string[],
  model: string,
  profile: string
): Promise<MakeResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: promptedQuestion,
      // Subject profile / context for the faceted query expander to bias
      // terminology toward the subject's domain/profession (the wired context
      // notes + guides). Maps to {{2.profile}} in the expander prompt.
      profile,
      // raw question/query for the RETRIEVAL embedding + multi-query expander
      // (embedding the wrapped prompt would dilute the search vector with the
      // instruction boilerplate). Generation still uses `question`.
      query_text: queryText,
      source_ids: sourceIds,
      // Pre-built Pinecone metadata filter. Make's Simple Filter UI only
      // carries scalar values (multi-id arrays get string-coerced -> zero
      // matches), so the scenario maps this verbatim instead.
      filter_json: JSON.stringify({ source_id: { $in: sourceIds } }),
      scope: 'selected',
      answer_mode: mode,
      guides,
      namespace: process.env.PINECONE_NAMESPACE ?? 'user_kieffer',
      model
    })
  });
  if (!res.ok) throw new Error(`Query webhook returned ${res.status}`);

  const data = await res.json();

  // Prefer the full aggregator array (raw_citations: {{14.json}} from Make
  // module 10 — ALL N retrieved chunks, not just the collapsed first item).
  // Falls back to data.citations for backward compatibility.
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

  // Dedup server-side (same chunk from multiple query expansions) and sort
  // by score. The client caps at 8 with its own dedup, but this prevents
  // stale/cached clients from rendering 60+ chips.
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

  const rawSuggested = data.suggestedQuestions ?? data.suggested_questions ?? [];
  const suggestedQuestions: string[] = (
    Array.isArray(rawSuggested) ? rawSuggested : []
  )
    .map((s: unknown) =>
      typeof s === 'string' ? s : ((s as { question?: string })?.question ?? '')
    )
    .filter((s: string) => typeof s === 'string' && s.trim())
    .slice(0, 6);

  // Make-side validator verdict, if the Query scenario includes a validator
  // module (positive/negative). Accept a few shapes the model might emit.
  const rawValidation =
    data.validation ?? data.valid ?? data.verdict ?? null;
  const validation =
    typeof rawValidation === 'string' ? rawValidation : null;

  return {
    answer: data.answer ?? '',
    citations,
    // Pass the full aggregated array through so ask.ts can dedupe+rank all chunks.
    raw_citations: data.raw_citations ?? null,
    topScore,
    noMatch: topScore === null || topScore < NOMATCH_THRESHOLD,
    suggestedQuestions,
    validation
  };
}

/** Reformulate a failed query for a second retrieval pass (Gemini). */
async function reformulate(
  question: string,
  failedAnswer: string
): Promise<string | null> {
  const prompt = `A vector-database search for the query below did not retrieve relevant results. Rewrite it as ONE different search query that uses alternative terminology, synonyms, and a different angle to improve retrieval. Output ONLY the rewritten query — a single line, no quotes, no preamble.\n\nOriginal query: ${question}${
    failedAnswer ? `\n\nThe unsuccessful response was: ${failedAnswer.slice(0, 400)}` : ''
  }`;
  const text = await runUtilityLLM(prompt, { temperature: 0.4, maxOutputTokens: 120 });
  if (!text) return null;
  const cleaned = text.split('\n')[0].replace(/^["']|["']$/g, '').trim();
  return cleaned && cleaned.toLowerCase() !== question.toLowerCase() ? cleaned : null;
}

/** History-aware query rewrite: resolve a follow-up ("who else was born on his
 *  street?") into a standalone, self-contained retrieval query using the recent
 *  conversation. Returns the question unchanged when there's no history or the
 *  rewrite fails. We don't classify new-vs-old — we always contextualize. */
async function contextualize(
  question: string,
  history: { role: string; content: string }[],
  summary = ''
): Promise<string> {
  if (history.length === 0 && !summary.trim()) return question;
  const convo = history
    .map((h) => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`)
    .join('\n');
  const earlier = summary.trim()
    ? `Summary of earlier conversation:\n${summary.trim()}\n\n`
    : '';
  const prompt = `Given the conversation below, rewrite the user's LATEST question into a standalone, self-contained search query that resolves every pronoun and reference using the conversation and the earlier-conversation summary (e.g. "his street" → the actual street name discussed earlier). If the latest question is already self-contained, return it unchanged. Output ONLY the rewritten query — one line, no quotes, no preamble.\n\n${earlier}Recent conversation:\n${convo}\n\nLatest question: ${question}`;
  const text = await runUtilityLLM(prompt, { temperature: 0.2, maxOutputTokens: 200 });
  if (!text) return question;
  const cleaned = text.split('\n')[0].replace(/^["']|["']$/g, '').trim();
  return cleaned.length >= 3 ? cleaned : question;
}

/** LLM answer-validator: does the GENERATED ANSWER actually address the
 *  question's subject? We judge the ANSWER (not the retrieved snippets) because
 *  the supporting chunk is often NOT the top-scored one — judging a score-sorted
 *  snippet subset truncated the answer-bearing chunk out of view and vetoed
 *  correct answers (the reason RAG_VALIDATOR was disabled). The answer is short,
 *  on-topic when right, and is what the user sees — so it's the reliable signal.
 *  This still catches the real failure: an off-topic answer (e.g. a "budget"
 *  answer to an "atomic habits" question). true = addresses it; fails OPEN. */
async function validateAnswer(
  question: string,
  answer: string
): Promise<boolean> {
  const plain = answer
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return false;
  const prompt = `A retrieval system generated the ANSWER below for the QUESTION, using the user's own sources. Decide whether the answer genuinely addresses the SUBJECT of the question. Answer "negative" ONLY if the answer is about a clearly different subject, or is empty / a pure non-answer. If it addresses the question's subject at all (even partially, even if it says some details are missing), answer "positive". Reply with exactly one word.\n\nQUESTION: ${question}\n\nANSWER: ${plain.slice(0, 1800)}`;
  const out = await runUtilityLLM(prompt, { temperature: 0, maxOutputTokens: 6 });
  if (!out) return true; // fail-open
  return !/negative/i.test(out);
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

  // Conversation history (capped, plain text) → resolve follow-up references
  // into a standalone query for retrieval AND generation. No history = no-op.
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(
      (h: unknown): h is { role: string; content: string } =>
        !!h &&
        typeof (h as { content?: unknown }).content === 'string' &&
        (h as { content: string }).content.trim().length > 0
    )
    .slice(-HISTORY_MAX_MESSAGES)
    .map((h: { role: string; content: string }) => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content.slice(0, 500)
    }));
  const summary = typeof body.summary === 'string' ? body.summary : '';
  const rawQuestion = await contextualize(userQuestion, history, summary);

  // Long-term memory: pull relevant past-conversation summaries and feed them in
  // as context so the brain "remembers" across sessions.
  const memories = MEMORY_ENABLED ? await retrieveMemories(rawQuestion) : [];
  const ctx = memories.length
    ? [
        ...contextTexts,
        ...memories.map((m) => `(recalled from an earlier conversation) ${m}`)
      ]
    : contextTexts;

  // Subject profile/context for the faceted expander — the wired context notes
  // + guides bias query expansion toward the subject's domain/profession.
  const profile = [...contextTexts, ...guides]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 1200);

  // First retrieval pass.
  let result: MakeResult;
  try {
    result = await callMake(
      url,
      buildPrompt(rawQuestion, mode, guides, ctx),
      rawQuestion,
      sourceIds,
      mode,
      guides,
      model,
      profile
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Query failed' },
      { status: 502 }
    );
  }

  // Corrective retry: weak/empty retrieval → reformulate once and try again,
  // keep whichever pass retrieved better.
  let retried = false;
  if (RETRY_ENABLED && result.noMatch) {
    const newQuery = await reformulate(rawQuestion, result.answer);
    if (newQuery) {
      try {
        const second = await callMake(
          url,
          buildPrompt(newQuery, mode, guides, ctx),
          newQuery,
          sourceIds,
          mode,
          guides,
          model,
          profile
        );
        retried = true;
        // prefer the pass that isn't a no-match; otherwise the higher score.
        const better =
          (!second.noMatch && result.noMatch) ||
          (second.topScore ?? -1) > (result.topScore ?? -1);
        if (better) result = second;
      } catch {
        /* keep the first result if the retry call fails */
      }
    }
  }

  // Answer-validator (cited mode): if the retrieved context doesn't actually
  // address the question, don't present a confident off-topic answer — replace
  // it with an honest "not in your sources". More reliable than the score gate.
  let validated = true;
  if (
    VALIDATOR_ENABLED &&
    mode === 'cited' &&
    !result.noMatch &&
    result.citations.length > 0
  ) {
    if (result.validation) {
      // AUTHORITATIVE: a Make-side validator module ran inside the Query
      // scenario (model + prompt live in the Make UI, and it sees the FULL
      // retrieved context). Just read its verdict — no extra LLM call here.
      validated = !/negative|no\b|false/i.test(result.validation);
    } else {
      // Fallback only when Make returns no `validation` field (validator
      // module not wired yet): the in-code answer-vs-question check.
      validated = await validateAnswer(userQuestion, result.answer);
    }
    if (!validated) {
      result.answer =
        "I couldn't find an answer to that in your wired sources. Try rephrasing, or wire a source that covers it.";
      result.citations = [];
      result.noMatch = true;
    }
  }

  return Response.json({
    answer: result.answer,
    citations: result.citations,
    topScore: result.topScore,
    noMatch: result.noMatch,
    suggestedQuestions: result.suggestedQuestions,
    retried,
    // present only when history-aware rewrite changed the query (for an
    // optional "interpreted as …" hint in the UI)
    resolvedQuestion: rawQuestion !== userQuestion ? rawQuestion : null
  });
}
