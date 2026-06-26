import { auth } from '@clerk/nextjs/server';
import { sql, ensureBoardSchema } from '@/lib/board-db';

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
  const exRows = await sql`
    SELECT data FROM board_state WHERE scope=${scope} AND project_id=${projectId}`;
  const ex = exRows[0]?.data as { nodes?: unknown[]; media?: unknown[] } | undefined;
  if (ex) {
    const exMedia = Array.isArray(ex.media) ? ex.media.length : 0;
    const exNodes = Array.isArray(ex.nodes) ? ex.nodes.length : 0;
    const mediaShrank = exMedia > 100 && incMedia < exMedia * 0.5;
    const nodesShrank = exNodes > 3 && incNodes <= 1;
    if (mediaShrank || nodesShrank) {
      return Response.json(
        { ok: false, rejected: 'anti-shrink', exMedia, incMedia, exNodes, incNodes },
        { status: 200 }
      );
    }
  }

  await sql`
    INSERT INTO board_state (scope, project_id, user_id, data, updated_at)
    VALUES (${scopeOf(orgId, userId)}, ${projectId}, ${userId}, ${JSON.stringify(data)}::jsonb, now())
    ON CONFLICT (scope, project_id)
    DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, updated_at = now()
  `;
  return Response.json({ ok: true });
}
