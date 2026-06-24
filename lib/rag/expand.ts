// Small-to-big neighbor expansion for escalating retrieval.
//
// On a no-match, we widen the context the answer LLM sees WITHOUT re-chunking:
// chunks are keyed `${sourceId}#${i}` (sequential), so the neighbors of a hit
// are just `#(i±radius)` — a cheap Pinecone fetch (no re-embed of the corpus).
//
// All of this runs IN CODE so the Make scenario stays tiny: the only Make change
// is that the answer module uses `injected_context` when present. We do the hit
// lookup here (embed the query once + a Pinecone query) so Make doesn't need to
// return chunk ids. Output is the SAME aggregator shape Make already consumes:
//   [{ score, metadata: { source_id, source_name, text } }]
//
// See agent_files/rag/projects/ESCALATING_RETRIEVAL_DRAFT.md.

import { embedText } from '@/lib/rag/embed';

const MAX_CONTEXT_CHARS = Number(process.env.RAG_ESCALATE_MAX_CHARS ?? 30000);

export interface ContextChunk {
  score: number;
  metadata: { source_id: string; source_name?: string; text: string };
}

function host(): string | null {
  const h = process.env.PINECONE_HOST;
  return h ? `https://${h.replace(/^https?:\/\//, '')}` : null;
}

/** "src#12" → { sourceId:'src', i:12 }; null if the id isn't a chunk id. */
export function parseChunkId(id: string): { sourceId: string; i: number } | null {
  const h = id.lastIndexOf('#');
  if (h < 0) return null;
  const i = Number(id.slice(h + 1));
  return Number.isInteger(i) ? { sourceId: id.slice(0, h), i } : null;
}

/** Pinecone fetch by id (≤100/call) → aggregator-shaped chunks with text. */
async function fetchByIds(
  ids: string[],
  namespace: string,
  key: string,
  base: string
): Promise<Map<string, ContextChunk>> {
  const out = new Map<string, ContextChunk>();
  for (let i = 0; i < ids.length; i += 100) {
    const u = new URL(`${base}/vectors/fetch`);
    u.searchParams.set('namespace', namespace);
    ids.slice(i, i + 100).forEach((id) => u.searchParams.append('ids', id));
    try {
      const r = await fetch(u, { headers: { 'Api-Key': key } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const [id, v] of Object.entries((j.vectors ?? {}) as Record<string, any>)) {
        const m = v?.metadata ?? {};
        if (typeof m.text === 'string' && m.text)
          out.set(id, {
            score: typeof v.score === 'number' ? v.score : 0.9,
            metadata: { source_id: m.source_id, source_name: m.source_name, text: m.text }
          });
      }
    } catch {
      /* best-effort */
    }
  }
  return out;
}

/**
 * Retrieve top-k chunks for `query`, then widen to ±radius neighbors. Returns
 * aggregator-shaped chunks ordered by source then position, capped to
 * MAX_CONTEXT_CHARS. Empty array on any failure (caller treats as "can't
 * expand" and stops escalating) — so this is always safe to call.
 */
export async function retrieveExpandedContext(
  query: string,
  namespace: string,
  opts: { topK?: number; radius?: number } = {}
): Promise<ContextChunk[]> {
  const base = host();
  const key = process.env.PINECONE_API_KEY;
  if (!base || !key || !query.trim()) return [];
  const topK = opts.topK ?? 12;
  const radius = opts.radius ?? 1;

  let vec: number[];
  try {
    vec = await embedText(query);
  } catch {
    return [];
  }

  // 1) find the hits (their chunk ids)
  let matches: Array<{ id: string; score: number; metadata: any }> = [];
  try {
    const r = await fetch(`${base}/query`, {
      method: 'POST',
      headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace, vector: vec, topK, includeMetadata: true })
    });
    if (!r.ok) return [];
    matches = (await r.json()).matches ?? [];
  } catch {
    return [];
  }
  if (matches.length === 0) return [];

  // 2) seed with the hits themselves
  const byId = new Map<string, ContextChunk>();
  for (const m of matches) {
    const t = m.metadata?.text;
    if (typeof t === 'string' && t)
      byId.set(m.id, {
        score: m.score ?? 0.9,
        metadata: { source_id: m.metadata.source_id, source_name: m.metadata.source_name, text: t }
      });
  }

  // 3) compute + fetch neighbors we don't already have
  const want: string[] = [];
  for (const m of matches) {
    const p = parseChunkId(m.id);
    if (!p) continue;
    for (let d = -radius; d <= radius; d++) {
      if (d === 0) continue;
      const ni = p.i + d;
      if (ni < 0) continue;
      const nid = `${p.sourceId}#${ni}`;
      if (!byId.has(nid)) want.push(nid);
    }
  }
  if (want.length) {
    const fetched = await fetchByIds([...new Set(want)], namespace, key, base);
    for (const [id, c] of fetched) byId.set(id, c);
  }

  // 4) order by source then chunk index (reading order), cap total chars
  const ordered = [...byId.entries()]
    .map(([id, c]) => ({ id, c, p: parseChunkId(id) }))
    .sort((a, b) => {
      const sa = a.p?.sourceId ?? a.id,
        sb = b.p?.sourceId ?? b.id;
      if (sa !== sb) return sa < sb ? -1 : 1;
      return (a.p?.i ?? 0) - (b.p?.i ?? 0);
    });

  const out: ContextChunk[] = [];
  let chars = 0;
  for (const { c } of ordered) {
    chars += c.metadata.text.length;
    if (chars > MAX_CONTEXT_CHARS) break;
    out.push(c);
  }
  return out;
}
