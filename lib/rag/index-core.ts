import { deleteSourceVectors } from '@/lib/rag/pinecone-delete';
import { summarizeText, upsertSummary } from '@/lib/rag/summary-core';

// Shared text-indexing core: chunk → delete-before-reindex → upsert each chunk
// via the Make Indexing webhook. Used by /api/index (raw text) AND
// /api/index-doc (PDF/DOCX/TXT, after their text is extracted in-route). Keeping
// chunking + upsert in ONE place means every source type embeds identically.

// Smaller chunks = higher recall for narrow facts (a one-line aside no longer
// drowns in a long passage). More overlap so a fact spanning a boundary still
// lands whole. Tradeoff: more vectors/embeddings per source — worth it to not
// lose information. (Index-time: affects future uploads + re-indexes.)
const CHUNK_CHARS = Number(process.env.RAG_CHUNK_CHARS ?? 1000);
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP ?? 200);
const UPSERT_CONCURRENCY = 5;

/** Sentence-aware split into ~CHUNK_CHARS passages with a small overlap so a
 *  fact spanning a boundary still lands whole in at least one chunk. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (clean.length <= CHUNK_CHARS) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?\n]+[.!?]?\n*|\n+/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > CHUNK_CHARS) {
      if (cur.trim()) {
        chunks.push(cur.trim());
        cur = '';
      }
      for (let i = 0; i < s.length; i += CHUNK_CHARS - CHUNK_OVERLAP)
        chunks.push(s.slice(i, i + CHUNK_CHARS).trim());
      continue;
    }
    if ((cur + s).length > CHUNK_CHARS && cur) {
      chunks.push(cur.trim());
      cur = CHUNK_OVERLAP > 0 ? cur.slice(-CHUNK_OVERLAP) : '';
    }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => c.length > 0);
}

/** Run upserts with a small concurrency cap (Make ops + serverless time). */
async function runPool<T>(
  items: T[],
  worker: (item: T, i: number) => Promise<void>,
  concurrency: number
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i], i);
      }
    }
  );
  await Promise.all(runners);
}

export interface IndexResult {
  ok: boolean;
  chunks: number;
  failed: number;
  deletedPrior: number;
}

/**
 * Chunk `text` and upsert every passage for `sourceId`. Deletes prior vectors
 * for the source first (idempotent re-index). Throws on missing config / empty
 * text / total webhook failure so the caller can map a status code.
 */
export async function indexText(opts: {
  sourceId: string;
  name?: string;
  type?: string;
  text: string;
  namespace?: string;
}): Promise<IndexResult> {
  const url = process.env.MAKE_INDEX_WEBHOOK_URL;
  if (!url) throw new Error('MAKE_INDEX_WEBHOOK_URL is not configured');

  const sourceId = opts.sourceId;
  const name = opts.name ?? sourceId;
  const type = opts.type ?? 'text';
  const namespace =
    opts.namespace ?? process.env.PINECONE_NAMESPACE ?? 'user_kieffer';

  const chunks = chunkText(String(opts.text));
  if (chunks.length === 0) throw new Error('text is empty after cleaning');

  const deletedPrior = await deleteSourceVectors(sourceId, namespace);

  const failures: number[] = [];
  await runPool(
    chunks,
    async (chunkValue, i) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chunk_id: `${sourceId}#${i}`,
          source_id: sourceId,
          name,
          type,
          namespace,
          text: chunkValue
        })
      });
      if (!res.ok) failures.push(i);
    },
    UPSERT_CONCURRENCY
  );

  if (failures.length === chunks.length)
    throw new Error(`Indexing webhook failed for all ${chunks.length} chunks`);

  // Level 1 of the summary tree: one pre-made summary of the WHOLE source, kept
  // as a reserved `${sourceId}#summary` vector. Best-effort — a summary hiccup
  // never fails the indexing. The prior summary was already removed by the
  // delete-before-reindex above (same source prefix), so this stays idempotent.
  try {
    const summary = await summarizeText(String(opts.text), name);
    if (summary) await upsertSummary({ sourceId, name, summary, namespace });
  } catch {
    /* summary is best-effort */
  }

  return {
    ok: true,
    chunks: chunks.length,
    failed: failures.length,
    deletedPrior
  };
}
