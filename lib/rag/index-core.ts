import { deleteSourceVectors } from '@/lib/rag/pinecone-delete';
import { summarizeText, upsertSummary } from '@/lib/rag/summary-core';
import { embedTexts } from '@/lib/rag/embed';

// Shared text-indexing core: chunk → delete-before-reindex → embed (in code,
// gemini-embedding-2 @768, identical to the Make scenarios) → batch-upsert
// straight to Pinecone. Used by /api/index (raw text) AND /api/index-doc
// (PDF/DOCX/TXT, after their text is extracted in-route).
//
// Why in-code (not the Make Indexing webhook): the old path fired ONE webhook
// per chunk, so a 315-chunk PDF made 315 calls — Make throttled/queued most
// (returning "Accepted" while embedding nothing), silently dropping ~2/3 of the
// document. In-code embeds in a few batched API calls and upserts to Pinecone
// directly: zero Make operations, reliable, and it FAILS LOUD instead of losing
// text. Every chunk that's counted as indexed is actually in Pinecone.

// Smaller chunks = higher recall for narrow facts (a one-line aside no longer
// drowns in a long passage). More overlap so a fact spanning a boundary still
// lands whole. Tradeoff: more vectors/embeddings per source — worth it to not
// lose information. (Index-time: affects future uploads + re-indexes.)
// Smaller default chunks = precise retrieval (a single address/fact isn't
// drowned by ~30 others in one passage). Context for the ANSWER is restored at
// read time by neighbor expansion (lib/rag/expand.ts) — "small to find, big to
// answer". See agent_files/rag/projects/ESCALATING_RETRIEVAL_DRAFT.md.
const CHUNK_CHARS = Number(process.env.RAG_CHUNK_CHARS ?? 500);
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP ?? 100);
const UPSERT_BATCH = 100; // Pinecone upsert cap per request
// 8 tries, exp backoff capped at 15s + jitter (~45s budget). The old 4-try /
// ~6s budget gave up under Pinecone's sustained-write 429s the moment a BATCH
// of big books indexed together (164-doc import, 2026-07-04) — rate limits
// need patience, not surrender.
const UPSERT_MAX_RETRY = 8;
// Small pause between consecutive batches of the SAME document — smooths the
// write rate so parallel big books don't collectively slam the 429 wall.
const INTER_BATCH_MS = 150;

function pineconeHost(): string {
  const h = process.env.PINECONE_HOST;
  if (!h) throw new Error('PINECONE_HOST is not configured');
  return `https://${h.replace(/^https?:\/\//, '')}`;
}
function pineconeKey(): string {
  const k = process.env.PINECONE_API_KEY;
  if (!k) throw new Error('PINECONE_API_KEY is not configured');
  return k;
}

interface PineVector {
  id: string;
  values: number[];
  metadata: Record<string, unknown>;
}

/** Upsert one ≤100-vector batch to Pinecone with retries. Throws on final
 *  failure so callers never count un-landed vectors as indexed. */
async function upsertBatch(
  host: string,
  key: string,
  namespace: string,
  vectors: PineVector[]
): Promise<void> {
  let lastErr = '';
  for (let attempt = 0; attempt < UPSERT_MAX_RETRY; attempt++) {
    try {
      const res = await fetch(`${host}/vectors/upsert`, {
        method: 'POST',
        headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, vectors })
      });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
      if (res.status !== 429 && res.status < 500) throw new Error(lastErr);
    } catch (e: any) {
      lastErr = e?.message ?? 'upsert error';
    }
    await new Promise((r) =>
      setTimeout(r, Math.min(400 * 2 ** attempt, 15_000) + Math.random() * 400)
    );
  }
  throw new Error(`Pinecone upsert failed after ${UPSERT_MAX_RETRY} attempts: ${lastErr}`);
}

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

export interface IndexResult {
  ok: boolean;
  chunks: number;
  upserted: number;
  failed: number;
  deletedPrior: number;
}

/**
 * Chunk `text`, embed in code, and batch-upsert every passage for `sourceId`
 * into `namespace`. Deletes prior vectors for the source first (idempotent
 * re-index). Throws on missing config / empty text / any upsert batch that
 * can't land — so a partial index is reported as a failure, never as success.
 */
export async function indexText(opts: {
  sourceId: string;
  name?: string;
  type?: string;
  text: string;
  namespace: string;
  /** Extra metadata stored on every vector (e.g. { email }). */
  meta?: Record<string, unknown>;
}): Promise<IndexResult> {
  const sourceId = opts.sourceId;
  const name = opts.name ?? sourceId;
  const type = opts.type ?? 'text';
  const namespace = opts.namespace;
  if (!namespace) throw new Error('namespace is required');

  const chunks = chunkText(String(opts.text));
  if (chunks.length === 0) throw new Error('text is empty after cleaning');

  const host = pineconeHost();
  const key = pineconeKey();

  const deletedPrior = await deleteSourceVectors(sourceId, namespace);

  // Embed every chunk in code (throws if any chunk fails to embed → no silent
  // loss). Vectors come back aligned to `chunks` order.
  const values = await embedTexts(chunks);

  const records: PineVector[] = chunks.map((text, i) => ({
    id: `${sourceId}#${i}`,
    values: values[i],
    // store BOTH `name` and `source_name` — the Make query scenario reads
    // metadata.source_name for citations; the app reads name. Keep them in sync.
    metadata: {
      source_id: sourceId,
      name,
      source_name: name,
      type,
      text,
      ...(opts.meta ?? {})
    }
  }));

  // Batch-upsert to Pinecone. Each batch retries; a batch that still fails
  // throws → the whole index reports failure (caller re-runs; delete-before-
  // reindex keeps it idempotent). No batch is counted unless it landed.
  let upserted = 0;
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);
    await upsertBatch(host, key, namespace, batch);
    upserted += batch.length;
    // Pace consecutive batches — see INTER_BATCH_MS.
    if (i + UPSERT_BATCH < records.length)
      await new Promise((r) => setTimeout(r, INTER_BATCH_MS));
  }

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
    upserted,
    failed: chunks.length - upserted,
    deletedPrior
  };
}
