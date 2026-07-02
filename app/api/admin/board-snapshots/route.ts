import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql, ensureSnapshotsSchema } from '@/lib/board-db';

// Owner-only VERSION HISTORY console for board snapshots.
//   GET ?projectId=X                 → list this board's snapshots (newest first)
//   GET ?projectId=X&restore=<id>    → restore that snapshot into board_state
// Restores are themselves protected: the CURRENT state is snapshotted first,
// and the restored doc's internal savedAt is bumped so stale client caches
// lose the newer-copy contest (2026-07-02 lesson).

export const runtime = 'nodejs';

const OWNER = (process.env.ALLOWED_EMAILS ?? 'tiosquareinc@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase());

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'unauth' }, { status: 401 });
  try {
    const u = await (await clerkClient()).users.getUser(userId);
    const email = (
      u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      ''
    ).toLowerCase();
    if (!OWNER.includes(email)) return Response.json({ error: 'forbidden' }, { status: 403 });
  } catch {
    return Response.json({ error: 'auth check failed' }, { status: 500 });
  }
  if (!sql) return Response.json({ error: 'no db' }, { status: 500 });
  await ensureSnapshotsSchema();

  const url = new URL(req.url);
  const pid = url.searchParams.get('projectId') ?? '';
  const restoreId = url.searchParams.get('restore');
  if (!pid) return Response.json({ error: 'projectId required' }, { status: 400 });

  if (restoreId) {
    const snap = await sql`
      SELECT scope, user_id, data FROM board_snapshots
      WHERE id=${restoreId} AND project_id=${pid} LIMIT 1`;
    if (!snap[0]) return Response.json({ error: 'snapshot not found' }, { status: 404 });
    const scope = String(snap[0].scope);

    // Safety net: snapshot the CURRENT state before overwriting, so a restore
    // is always itself reversible.
    const cur = await sql`
      SELECT data FROM board_state WHERE scope=${scope} AND project_id=${pid}`;
    if (cur[0]?.data) {
      const curJson = JSON.stringify(cur[0].data);
      const { createHash } = await import('crypto');
      await sql`
        INSERT INTO board_snapshots (scope, project_id, user_id, hash, node_count, media_count, bytes, data)
        VALUES (${scope}, ${pid}, ${String(snap[0].user_id ?? '')},
                ${'pre-restore-' + createHash('md5').update(curJson).digest('hex')},
                ${Array.isArray((cur[0].data as { nodes?: unknown[] }).nodes) ? (cur[0].data as { nodes: unknown[] }).nodes.length : 0},
                ${Array.isArray((cur[0].data as { media?: unknown[] }).media) ? (cur[0].data as { media: unknown[] }).media.length : 0},
                ${curJson.length}, ${curJson}::jsonb)`;
    }

    // Restore with a bumped internal savedAt so client caches don't outrank it.
    const doc = { ...(snap[0].data as Record<string, unknown>), savedAt: Date.now() };
    await sql`
      UPDATE board_state SET data=${JSON.stringify(doc)}::jsonb, updated_at=now()
      WHERE scope=${scope} AND project_id=${pid}`;
    return Response.json({ restored: true, snapshotId: restoreId, projectId: pid });
  }

  const rows = await sql`
    SELECT id, saved_at, node_count, media_count, bytes, hash
    FROM board_snapshots
    WHERE project_id=${pid}
    ORDER BY saved_at DESC LIMIT 60`;
  return Response.json({ projectId: pid, count: rows.length, snapshots: rows });
}
