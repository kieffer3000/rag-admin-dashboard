import { auth } from '@clerk/nextjs/server';
import { createHash } from 'crypto';
import { sql, ensureBoardSchema, ensureSnapshotsSchema } from '@/lib/board-db';
import {
  deriveBoardEvents,
  appendBoardEvents,
  type BoardDoc
} from '@/lib/board-events';

// Persistence for the Board canvas + brain chats. One JSONB document per
// (scope, project), where scope = Clerk org (the client) or the user. This is
// what makes the board + chats survive a refresh.

export const runtime = 'nodejs';

function scopeOf(orgId: string | null | undefined, userId: string) {
  return orgId ?? `user:${userId}`;
}

export async function GET(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ data: null }); // no DB configured → use seed

  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 });

  await ensureBoardSchema();
  const rows = await sql`
    SELECT data FROM board_state
    WHERE scope = ${scopeOf(orgId, userId)} AND project_id = ${projectId}
  `;
  return Response.json({ data: rows[0]?.data ?? null });
}

export async function PUT(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ ok: false }); // silently no-op without DB

  const { projectId, data } = await req.json();
  if (!projectId || !data) {
    return Response.json({ error: 'projectId and data required' }, { status: 400 });
  }

  await ensureBoardSchema();

  // ANTI-SHRINK GUARD: never let a much SMALLER board overwrite a bigger saved
  // one. A stale-tab autosave, a load race, or a restore can submit a board with
  // far fewer media records / nodes than what's stored — that's an accidental
  // clobber, not an intentional bulk delete, and it wiped boards/source-lists.
  // Reject the write and keep the larger copy.
  const scope = scopeOf(orgId, userId);
  const inc = data as { nodes?: unknown[]; media?: unknown[] };
  const incMedia = Array.isArray(inc.media) ? inc.media.length : 0;
  const incNodes = Array.isArray(inc.nodes) ? inc.nodes.length : 0;

  // OVERFLOW guard: a corrupt media list (a duplication bug once hit 65k) must
  // never be saved — it freezes the board. Real source counts are in the low
  // thousands; reject anything absurd so a frozen tab can't re-persist it.
  if (incMedia > 12000) {
    // Ledger: rejected saves used to be invisible — now they're on the record.
    try {
      await appendBoardEvents(scope, projectId, userId, [
        { event: 'save_rejected', detail: { reason: 'media-overflow', incMedia } }
      ]);
    } catch {}
    return Response.json({ ok: false, rejected: 'media-overflow', incMedia }, { status: 200 });
  }
  const exRows = await sql`
    SELECT data FROM board_state WHERE scope=${scope} AND project_id=${projectId}`;
  const ex = exRows[0]?.data as { nodes?: unknown[]; media?: unknown[] } | undefined;
  if (ex) {
    const exMedia = Array.isArray(ex.media) ? ex.media.length : 0;
    const exNodes = Array.isArray(ex.nodes) ? ex.nodes.length : 0;
    const mediaShrank = exMedia > 100 && incMedia < exMedia * 0.5;
    const nodesShrank = exNodes > 3 && incNodes <= 1;
    if (mediaShrank || nodesShrank) {
      try {
        await appendBoardEvents(scope, projectId, userId, [
          {
            event: 'save_rejected',
            detail: { reason: 'anti-shrink', exMedia, incMedia, exNodes, incNodes }
          }
        ]);
      } catch {}
      return Response.json(
        { ok: false, rejected: 'anti-shrink', exMedia, incMedia, exNodes, incNodes },
        { status: 200 }
      );
    }
  }

  const json = JSON.stringify(data);
  await sql`
    INSERT INTO board_state (scope, project_id, user_id, data, updated_at)
    VALUES (${scope}, ${projectId}, ${userId}, ${json}::jsonb, now())
    ON CONFLICT (scope, project_id)
    DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, updated_at = now()
  `;

  // ---- VERSION HISTORY: append an immutable snapshot of every accepted save.
  // Hash-deduplicated (identical states don't stack copies) and best-effort
  // (a snapshot hiccup never fails the save). Retention: everything from the
  // last 48h is kept untouched; beyond that, only the newest 40 per board.
  // This is the "files can never be lost" guarantee — any past state is a
  // 2-minute restore, never archaeology (2026-07-02 incident).
  try {
    await ensureSnapshotsSchema();
    const hash = createHash('md5').update(json).digest('hex');
    const last = await sql`
      SELECT hash FROM board_snapshots
      WHERE scope=${scope} AND project_id=${projectId}
      ORDER BY saved_at DESC LIMIT 1`;
    if (last[0]?.hash !== hash) {
      await sql`
        INSERT INTO board_snapshots (scope, project_id, user_id, hash, node_count, media_count, bytes, data)
        VALUES (${scope}, ${projectId}, ${userId}, ${hash}, ${incNodes}, ${incMedia}, ${json.length}, ${json}::jsonb)`;
      await sql`
        DELETE FROM board_snapshots
        WHERE scope=${scope} AND project_id=${projectId}
          AND saved_at < now() - interval '48 hours'
          AND id NOT IN (
            SELECT id FROM board_snapshots
            WHERE scope=${scope} AND project_id=${projectId}
            ORDER BY saved_at DESC LIMIT 40
          )`;
    }
  } catch (e) {
    console.error('[board] snapshot failed (save itself succeeded)', e);
  }

  // ---- EVENT LEDGER (Phase 2): derive events by diffing the previous stored
  // doc against this accepted save — place/dock/undock/remove/rename/delete,
  // each with the item's name at event time. Server-side derivation = complete
  // coverage regardless of client version. Best-effort, never fails the save.
  try {
    const events = ex
      ? deriveBoardEvents(ex as BoardDoc, inc as BoardDoc)
      : // First save of a board: one baseline row, not thousands of adds.
        [{ event: 'baseline', detail: { nodes: incNodes, media: incMedia } }];
    await appendBoardEvents(scope, projectId, userId, events);
  } catch (e) {
    console.error('[board] event ledger failed (save itself succeeded)', e);
  }

  return Response.json({ ok: true });
}
