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

/** Reassemble a source's full text from its indexed chunks (for backfilling a
 *  summary on a source indexed before the summary tree existed). Lists chunk ids
 *  by prefix, fetches their text in batches, and stitches them in #i order. */
export async function reassembleSourceText(
  sourceId: string,
  namespace?: string
): Promise<string> {
  const host = pineconeHost();
  const key = process.env.PINECONE_API_KEY;
  if (!host || !key) return '';
  const ns = namespace ?? process.env.PINECONE_NAMESPACE ?? 'user_kieffer';
  const ids: string[] = [];
  try {
    let token: string | undefined;
    for (let page = 0; page < 50; page++) {
      const u = new URL(`${host}/vectors/list`);
      u.searchParams.set('prefix', `${sourceId}#`);
      u.searchParams.set('namespace', ns);
      u.searchParams.set('limit', '100');
      if (token) u.searchParams.set('paginationToken', token);
      const r = await fetch(u, { headers: { 'Api-Key': key } });
      if (!r.ok) break;
      const j = await r.json();
      for (const v of j.vectors ?? [])
        if (v?.id && !String(v.id).endsWith('#summary')) ids.push(v.id);
      token = j.pagination?.next;
      if (!token) break;
    }
  } catch {
    return '';
  }
  if (!ids.length) return '';

  const byIndex: { i: number; text: string }[] = [];
  // Fetch in batches so the GET URL never blows the length limit.
  for (let b = 0; b < ids.length; b += 80) {
    const batch = ids.slice(b, b + 80);
    try {
      const u = new URL(`${host}/vectors/fetch`);
      batch.forEach((id) => u.searchParams.append('ids', id));
      u.searchParams.set('namespace', ns);
      const r = await fetch(u, { headers: { 'Api-Key': key } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const [id, v] of Object.entries(
        (j.vectors ?? {}) as Record<string, { metadata?: { text?: string } }>
      )) {
        const m = String(id).match(/#(\d+)$/);
        byIndex.push({
          i: m ? parseInt(m[1], 10) : 0,
          text: v.metadata?.text ?? ''
        });
      }
    } catch {
      /* skip the batch */
    }
  }
  return byIndex
    .sort((a, b) => a.i - b.i)
    .map((e) => e.text)
    .join('\n');
}

/** Roll a CLUSTER (box or project) up into one summary FROM its members' L1
 *  summaries — "summaries of summaries", so it never re-reads source text and
 *  stays cheap to recompute on add/delete. Stored as `${clusterId}#summary`. */
export async function summarizeCluster(opts: {
  clusterId: string;
  name: string;
  sourceIds: string[];
  namespace?: string;
}): Promise<boolean> {
  const summaries = await fetchSummaries(opts.sourceIds, opts.namespace);
  if (!summaries.length) return false;
  const combined = summaries
    .map((s, i) => `[${i + 1}] ${s.name}\n${s.text}`)
    .join('\n\n');
  const rollup = await runUtilityLLM(
    `Below are summaries of the sources inside "${opts.name}". Write ONE cohesive overview of the whole collection: the shared themes, what each major source contributes, and the overall takeaways — enough to answer "summarize this" and "what are the main themes across these". 2–4 tight paragraphs (bullets fine). Output only the summary.\n\n${combined}`,
    { maxOutputTokens: 1200, temperature: 0.3 }
  );
  if (!rollup || !rollup.trim()) return false;
  return upsertSummary({
    sourceId: opts.clusterId,
    name: opts.name,
    summary: rollup,
    type: 'cluster-summary',
    namespace: opts.namespace
  });
}

/** True when a source already has a stored summary (skip backfill). */
export async function hasSummary(
  sourceId: string,
  namespace?: string
): Promise<boolean> {
  return (await fetchSummaries([sourceId], namespace)).length > 0;
}

/** Does this question want a summary/overview rather than a specific fact? */
export function wantsSummary(question: string): boolean {
  return /\b(summar(?:y|ies|ise|ize|ising|izing|ised|ized)|overview|tl;?dr|recap|gist|main\s+(?:points?|ideas?|themes?|takeaways?)|key\s+(?:points?|ideas?|themes?|takeaways?)|what(?:'?s| is)\s+(?:this|it)\s+(?:about|mainly about))\b/i.test(
    question
  );
}
