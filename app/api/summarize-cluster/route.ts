import { auth } from '@clerk/nextjs/server';
import { summarizeCluster } from '@/lib/rag/summary-core';

// Phase 2/3 — roll a CLUSTER up into one summary. A cluster is a BOX (its wired
// sources) or a PROJECT (all its sources). The rollup is built FROM the members'
// Level-1 summaries (summaries-of-summaries), so it never re-reads source text
// and is cheap to recompute when membership changes (the dirty-flag path).
//   request: { cluster_id, name, source_ids[], namespace? }

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const clusterId = String(body.cluster_id ?? '').trim();
  const name = String(body.name ?? '').trim() || clusterId;
  const sourceIds: string[] = (Array.isArray(body.source_ids) ? body.source_ids : [])
    .map((s: unknown) => String(s ?? '').trim())
    .filter(Boolean);
  const namespace =
    typeof body.namespace === 'string' ? body.namespace : undefined;

  if (!clusterId || sourceIds.length === 0) {
    return Response.json(
      { ok: false, error: 'cluster_id and source_ids are required' },
      { status: 400 }
    );
  }

  const ok = await summarizeCluster({ clusterId, name, sourceIds, namespace });
  return Response.json({ ok });
}
