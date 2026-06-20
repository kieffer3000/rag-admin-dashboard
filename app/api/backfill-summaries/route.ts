import { auth } from '@clerk/nextjs/server';
import {
  hasSummary,
  reassembleSourceText,
  summarizeText,
  upsertSummary
} from '@/lib/rag/summary-core';

// Phase 1.5 — backfill: give sources indexed BEFORE the summary tree a Level-1
// summary. For each source missing one, reassemble its text from the indexed
// chunks, summarize, and upsert `${sourceId}#summary`. Idempotent (skips sources
// that already have a summary) so the client can fire it freely.

export const runtime = 'nodejs';
export const maxDuration = 300;

const CONCURRENCY = 3;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sourceIds: { id: string; name?: string }[] = (
    Array.isArray(body.sources) ? body.sources : []
  )
    .map((s: unknown) =>
      typeof s === 'string'
        ? { id: s }
        : { id: String((s as { id?: string })?.id ?? ''), name: (s as { name?: string })?.name }
    )
    .filter((s: { id: string }) => s.id);
  const namespace =
    typeof body.namespace === 'string' ? body.namespace : undefined;
  if (!sourceIds.length) return Response.json({ created: 0, skipped: 0, failed: 0 });

  let created = 0;
  let skipped = 0;
  let failed = 0;

  const one = async (src: { id: string; name?: string }) => {
    try {
      if (await hasSummary(src.id, namespace)) {
        skipped++;
        return;
      }
      const text = await reassembleSourceText(src.id, namespace);
      if (!text.trim()) {
        failed++;
        return;
      }
      const summary = await summarizeText(text, src.name ?? src.id);
      if (summary && (await upsertSummary({
        sourceId: src.id,
        name: src.name ?? src.id,
        summary,
        namespace
      }))) {
        created++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  };

  // Small concurrency pool so a big library doesn't swamp the LLM/Pinecone.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sourceIds.length) }, async () => {
      while (next < sourceIds.length) await one(sourceIds[next++]);
    })
  );

  return Response.json({ created, skipped, failed });
}
