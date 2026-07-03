import 'server-only';

import { longFetch } from '@/lib/rag/long-fetch';

// Minimal relay to the Make.com Query scenario for the PUBLIC keyed endpoint.
// Mirrors the contract of /api/query (the in-app path) but stripped to the
// essentials a one-shot external question needs: question + namespace +
// source_ids -> { answer, citations }. The webhook URL stays server-side.

export interface PublicCitation {
  source_id: string;
  source_name?: string;
  snippet?: string;
  score?: number;
}

export interface PublicAnswer {
  answer: string;
  citations: PublicCitation[];
}

/** The public API is citation-FREE: strip the citation highlights and inline
 *  [n] footnote markers the answer model adds, WITHOUT touching real bracketed
 *  content like [Free] or [Tips] (only numeric markers go). */
function stripCitations(html: string): string {
  return (html ?? '')
    // unwrap citation highlights, keep the text
    .replace(/<\/?mark[^>]*>/gi, '')
    // remove [2], [1, 2], [1-3], and consecutive [1][2] + any leading space
    .replace(/\s*\[\d+(?:\s*[,;–-]\s*\d+)*\](?:\s*\[\d+(?:\s*[,;–-]\s*\d+)*\])*/g, '')
    .trim();
}

/** Make wraps scenario output in varying envelopes; dig out the JSON payload. */
function unwrap(json: unknown): Record<string, unknown> {
  let cur: unknown = json;
  for (let i = 0; i < 4; i++) {
    if (Array.isArray(cur)) cur = cur[0];
    else if (cur && typeof cur === 'object') {
      const o = cur as Record<string, unknown>;
      if ('answer' in o || 'citations' in o || 'raw_citations' in o) return o;
      if ('body' in o) cur = o.body;
      else if ('data' in o) cur = o.data;
      else return o;
    } else break;
  }
  return (cur && typeof cur === 'object' ? cur : {}) as Record<string, unknown>;
}

export interface RelayInput {
  question: string;
  namespace: string;
  sourceIds: string[];
  answerMode?: 'cited' | 'hybrid';
  model?: string;
  speed?: 'fast' | 'detailed' | 'research';
  conversation?: string;
  /** Instruction guides (e.g. the Bank's stored doctrine). Embedded into the
   *  GENERATION question the same way /api/query's buildPrompt does — the raw
   *  question still drives retrieval via query_text. */
  guides?: string[];
}

/** POST one question to the Make Query scenario and shape the reply. Throws on
 *  a missing webhook or a non-OK response (the caller maps that to a 5xx). */
export async function relayPublicQuery(input: RelayInput): Promise<PublicAnswer> {
  const url = process.env.MAKE_QUERY_WEBHOOK_URL;
  if (!url) throw new Error('MAKE_QUERY_WEBHOOK_URL is not configured');

  const sourceIds = input.sourceIds ?? [];
  const guides = (input.guides ?? []).filter((g) => g && g.trim());
  // Guides (doctrine) wrap the GENERATION question deterministically, exactly
  // like /api/query's buildPrompt — retrieval keeps the raw question below.
  const prompted = guides.length
    ? `Additional instructions (follow all of these):\n${guides
        .map((g) => `- ${g}`)
        .join('\n')}\n\nQuestion: ${input.question}`
    : input.question;
  // longFetch: Research-speed runs can exceed global fetch's ~300s default —
  // matched undici set w/ a 780s window (see lib/rag/long-fetch.ts).
  const res = await longFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: prompted,
      query_text: input.question,
      conversation: input.conversation ?? '',
      summary: '',
      profile: '',
      source_ids: sourceIds,
      filter_json: JSON.stringify({ source_id: { $in: sourceIds } }),
      scope: 'selected',
      answer_mode: input.answerMode === 'hybrid' ? 'hybrid' : 'cited',
      guides: '',
      namespace: input.namespace,
      injected_context: '',
      openrouter_key: '',
      model: input.model ?? '',
      speed: input.speed ?? 'detailed'
    })
  });
  if (!res.ok) throw new Error(`Query webhook returned ${res.status}`);

  const data = unwrap(await res.json());

  // Prefer the full aggregator array; fall back to data.citations.
  let raw: Array<Record<string, unknown>> = [];
  if (data.raw_citations) {
    try {
      const parsed =
        typeof data.raw_citations === 'string'
          ? JSON.parse(data.raw_citations as string)
          : data.raw_citations;
      if (Array.isArray(parsed)) raw = parsed as Array<Record<string, unknown>>;
    } catch {
      /* fall through */
    }
  }
  if (raw.length === 0 && Array.isArray(data.citations)) {
    raw = data.citations as Array<Record<string, unknown>>;
  }

  const seen = new Set<string>();
  const citations: PublicCitation[] = raw
    .map((item) => {
      if (item.source_id) return item as unknown as PublicCitation;
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      return {
        score: item.score as number,
        source_id: meta.source_id as string,
        source_name: meta.source_name as string,
        snippet: (meta.text ?? meta.snippet ?? '') as string
      } as PublicCitation;
    })
    .filter((c) => {
      if (!c || !c.source_id) return false;
      const key = `${c.source_id}::${(c.snippet ?? '').trim().slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  return { answer: stripCitations(String(data.answer ?? '')), citations };
}
