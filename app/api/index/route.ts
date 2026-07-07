import { auth } from '@clerk/nextjs/server';
import { indexText } from '@/lib/rag/index-core';
import { nsForUser } from '@/lib/rag/namespace';
import { resolvePlan } from '@/lib/rag/plans';
import { namespaceVectorCount, gateUsage, monthPeriod } from '@/lib/rag/metering';

// Proxies Board ingestion to the Make.com Indexing scenario.
// Contract (per chunk): { chunk_id, source_id, name, type, namespace, text }
// → Gemini Embedding (768d) → Pinecone upsert (vector id = chunk_id;
//   metadata.source_id = base source_id so query-time $in filters still match).
// Chunk + upsert logic lives in lib/rag/index-core.ts (shared with /api/index-doc).

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const { userId, has } = await auth();
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
    const part =
      Number.isFinite(body.part_index) && Number.isFinite(body.part_total)
        ? { index: Number(body.part_index), total: Number(body.part_total) }
        : undefined;

    // STORAGE GATE (3.17): banked vectors vs the plan cap, measured live from
    // Pinecone. Checked on part 1 only (later parts of one book must land).
    // Fail-open: can't measure → allow.
    if (!part || part.index <= 1) {
      const { caps } = await resolvePlan(userId, has);
      if (Number.isFinite(caps.vectorsMax)) {
        const n = await namespaceVectorCount(nsForUser(userId));
        if (n !== null && n >= caps.vectorsMax) {
          return Response.json(
            {
              error: `Storage limit reached (${caps.vectorsMax.toLocaleString()} vectors). Delete sources you no longer need, or upgrade your plan.`
            },
            { status: 429 }
          );
        }
      }
      // Uploads gate (3.24): one credit per document (part 1 only).
      const up = await gateUsage(
        `user:${userId}`,
        'uploads',
        monthPeriod(),
        caps.uploadsPerMonth
      );
      if (!up.ok) {
        return Response.json(
          {
            error: `Monthly upload limit reached (${caps.uploadsPerMonth} documents). It resets at the start of next month.`
          },
          { status: 429 }
        );
      }
    }

    const r = await indexText({
      sourceId: body.source_id,
      name: body.name,
      type: body.type,
      text: String(body.text),
      namespace: nsForUser(userId),
      part
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
