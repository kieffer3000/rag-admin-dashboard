// Summary tree — Level 1 (per-source). At ingest we make ONE cheap LLM summary
// of a source's full text and store it as a `${sourceId}#summary` vector (same
// Make Indexing webhook, just a reserved chunk id). At query time a "summarize
// this" question fetches those summaries by id — no vector search, no no-match
// gate, and the expensive read happened once at upload. See BOARD_SPEC.md.
//
// Box (Level 2) and project (Level 3) rollups reuse `summarizeText` over the
// child summaries — "summaries of summaries", so a rollup never re-reads source
// text and stays cheap on add/delete.

import { runUtilityLLM } from '@/lib/rag/utility-llm';

// Stuff when it fits (one call, most coherent); map-reduce only when it doesn't.
const STUFF_LIMIT = Number(process.env.RAG_SUMMARY_STUFF_CHARS ?? 120_000);
const MAP_CHUNK = Number(process.env.RAG_SUMMARY_MAP_CHARS ?? 30_000);

function pineconeHost(): string | null {
  const h = process.env.PINECONE_HOST;
  return h ? `https://${h.replace(/^https?:\/\//, '')}` : null;
}

async function summarizePassage(
  text: string,
  name: string,
  combine = false
): Promise<string | null> {
  const prompt = combine
    ? `Below are partial summaries of "${name}". Merge them into ONE cohesive summary — the overall topic, the key points and structure, and any notable specifics — so it can answer both "what is this about?" and "summarize this". Write 1–3 tight paragraphs (bullets are fine). Output only the summary.\n\n${text}`
    : `Summarize the source below ("${name}"). Capture the overall topic, the main points and how it's structured, and notable specifics — enough to answer both "what is this about?" and "summarize this" from the summary alone. Write 1–3 tight paragraphs (bullets are fine). Output only the summary.\n\n${text}`;
  return runUtilityLLM(prompt, { maxOutputTokens: 700, temperature: 0.3 });
}

/** One summary of `text`. Stuffs when it fits the context; otherwise map-reduces
 *  (summarize big slices in parallel, then combine). Returns null if too short
 *  to bother or the LLM is unavailable. */
export async function summarizeText(
  text: string,
  name: string
): Promise<string | null> {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 200) return null; // too short to need a summary
  if (clean.length <= STUFF_LIMIT) return summarizePassage(clean, name);

  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += MAP_CHUNK)
    parts.push(clean.slice(i, i + MAP_CHUNK));
  const partial = (
    await Promise.all(parts.map((p) => summarizePassage(p, name)))
  ).filter((s): s is string => !!s && s.trim().length > 0);
  if (!partial.length) return null;
  if (partial.length === 1) return partial[0];
  return summarizePassage(partial.join('\n\n---\n\n'), name, true);
}

/** Upsert a summary as a reserved `${sourceId}#summary` vector via the Make
 *  Indexing webhook. `level`/`type` ride in `type` for debuggability; retrieval
 *  is by exact id, so no Make-side metadata change is needed. */
export async function upsertSummary(opts: {
  sourceId: string;
  name: string;
  summary: string;
  type?: string;
  namespace?: string;
}): Promise<boolean> {
  const url = process.env.MAKE_INDEX_WEBHOOK_URL;
  if (!url || !opts.summary.trim()) return false;
  const namespace =
    opts.namespace ?? process.env.PINECONE_NAMESPACE ?? 'user_kieffer';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunk_id: `${opts.sourceId}#summary`,
        source_id: opts.sourceId,
        name: opts.name,
        type: opts.type ?? 'summary',
        namespace,
        text: opts.summary
      })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export interface SourceSummary {
  source_id: string;
  name: string;
  text: string;
}

/** Fetch pre-made summaries for the given sources BY ID (Pinecone-direct, no
 *  vector search) — the fast path for "summarize this" that dodges the no-match
 *  gate. Returns only the sources that have a summary. */
export async function fetchSummaries(
  sourceIds: string[],
  namespace?: string
): Promise<SourceSummary[]> {
  const host = pineconeHost();
  const key = process.env.PINECONE_API_KEY;
  if (!host || !key || sourceIds.length === 0) return [];
  const ns = namespace ?? process.env.PINECONE_NAMESPACE ?? 'user_kieffer';
  try {
    const u = new URL(`${host}/vectors/fetch`);
    sourceIds.forEach((s) => u.searchParams.append('ids', `${s}#summary`));
    u.searchParams.set('namespace', ns);
    const r = await fetch(u, { headers: { 'Api-Key': key } });
    if (!r.ok) return [];
    const j = await r.json();
    const vectors = (j.vectors ?? {}) as Record<
      string,
      { metadata?: { source_id?: string; name?: string; text?: string } }
    >;
    return Object.values(vectors)
      .map((v) => ({
        source_id: v.metadata?.source_id ?? '',
        name: v.metadata?.name ?? '',
        text: v.metadata?.text ?? ''
      }))
      .filter((s) => s.text.trim().length > 0);
  } catch {
    return [];
  }
}

/** Does this question want a summary/overview rather than a specific fact? */
export function wantsSummary(question: string): boolean {
  return /\b(summar(?:y|ies|ise|ize|ising|izing|ised|ized)|overview|tl;?dr|recap|gist|main\s+(?:points?|ideas?|themes?|takeaways?)|key\s+(?:points?|ideas?|themes?|takeaways?)|what(?:'?s| is)\s+(?:this|it)\s+(?:about|mainly about))\b/i.test(
    question
  );
}
