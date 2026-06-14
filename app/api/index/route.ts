import { auth } from '@clerk/nextjs/server';

// Proxies Board ingestion to the Make.com Indexing scenario.
// Contract (per chunk): { chunk_id, source_id, name, type, namespace, text }
// → Gemini Embedding (768d) → Pinecone upsert (vector id = chunk_id;
//   metadata.source_id = base source_id so query-time $in filters still match).
//
// CHUNKING: documents are split into passages here (in code) and each passage
// is upserted as its OWN vector. Why: storing a whole document as one vector
// (a) risks Pinecone's ~40KB per-vector metadata limit on long docs, and
// (b) retrieves coarsely. Per-passage vectors give granular retrieval and keep
// each metadata.text well under the limit. The Make upsert maps the vector id
// from {{2.chunk_id}} (unique per passage) while metadata.source_id stays
// {{2.source_id}} (the base id used by the query filter).

export const runtime = 'nodejs';
export const maxDuration = 60;

const CHUNK_CHARS = Number(process.env.RAG_CHUNK_CHARS ?? 1800);
const CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP ?? 200);
const UPSERT_CONCURRENCY = 5;

/** Sentence-aware split into ~CHUNK_CHARS passages with a small overlap so a
 *  fact spanning a boundary still lands whole in at least one chunk. */
function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (clean.length <= CHUNK_CHARS) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?\n]+[.!?]?\n*|\n+/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > CHUNK_CHARS) {
      // a single very long sentence/blob — hard-split it
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
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.MAKE_INDEX_WEBHOOK_URL;
  if (!url) {
    return Response.json(
      { error: 'MAKE_INDEX_WEBHOOK_URL is not configured' },
      { status: 503 }
    );
  }

  const body = await req.json();
  if (!body.source_id || !body.text) {
    return Response.json(
      { error: 'source_id and text are required' },
      { status: 400 }
    );
  }

  const sourceId: string = body.source_id;
  const name: string = body.name ?? sourceId;
  const type: string = body.type ?? 'text';
  const namespace = process.env.PINECONE_NAMESPACE ?? 'user_kieffer';

  const chunks = chunkText(String(body.text));
  if (chunks.length === 0) {
    return Response.json({ error: 'text is empty after cleaning' }, { status: 400 });
  }

  const failures: number[] = [];
  await runPool(
    chunks,
    async (chunkTextValue, i) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chunk_id: `${sourceId}#${i}`,
          source_id: sourceId,
          name,
          type,
          namespace,
          text: chunkTextValue
        })
      });
      if (!res.ok) failures.push(i);
    },
    UPSERT_CONCURRENCY
  );

  if (failures.length === chunks.length) {
    return Response.json(
      { error: `Indexing webhook failed for all ${chunks.length} chunks` },
      { status: 502 }
    );
  }

  return Response.json({
    status: 'indexed',
    source_id: sourceId,
    chunks: chunks.length,
    failed_chunks: failures.length
  });
}
