import { auth } from '@clerk/nextjs/server';
import { indexText } from '@/lib/rag/index-core';

// Proxies Board ingestion to the Make.com Indexing scenario.
// Contract (per chunk): { chunk_id, source_id, name, type, namespace, text }
// → Gemini Embedding (768d) → Pinecone upsert (vector id = chunk_id;
//   metadata.source_id = base source_id so query-time $in filters still match).
// Chunk + upsert logic lives in lib/rag/index-core.ts (shared with /api/index-doc).

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  if (!body.source_id || !body.text) {
    return Response.json(
      { error: 'source_id and text are required' },
      { status: 400 }
    );
  }

  try {
    const r = await indexText({
      sourceId: body.source_id,
      name: body.name,
      type: body.type,
      text: String(body.text)
    });
    return Response.json({
      status: 'indexed',
      source_id: body.source_id,
      chunks: r.chunks,
      failed_chunks: r.failed,
      deleted_prior_chunks: r.deletedPrior
    });
  } catch (e: any) {
    const msg = e?.message ?? 'index failed';
    const code = /not configured/.test(msg)
      ? 503
      : /empty/.test(msg)
        ? 400
        : 502;
    return Response.json({ error: msg }, { status: code });
  }
}
