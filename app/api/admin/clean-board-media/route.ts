import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql } from '@/lib/board-db';

// TEMP owner-only — DEDUPE a board's media records by id (a union-load bug
// duplicated them ~8x → 65k), preferring the copy that has a thumbnail, and
// reset the project's sourceIds to match. Keeps nodes/edges/chats. Remove after.

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

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope');
  const projectId = url.searchParams.get('project_id');
  if (!scope || !projectId) {
    return Response.json({ error: 'need scope, project_id' }, { status: 400 });
  }

  const brows = await sql`
    SELECT data FROM board_state WHERE scope=${scope} AND project_id=${projectId}`;
  if (!brows[0]) return Response.json({ error: 'board not found' }, { status: 404 });
  const board = brows[0].data as Record<string, unknown>;
  const media = Array.isArray(board.media)
    ? (board.media as Array<{ id: string; thumbnail?: string }>)
    : [];
  const before = media.length;

  // Dedupe by id, preferring a record that carries a thumbnail.
  const byId = new Map<string, { id: string; thumbnail?: string }>();
  for (const m of media) {
    if (!m || !m.id) continue;
    const ex = byId.get(m.id);
    if (!ex || (!ex.thumbnail && m.thumbnail)) byId.set(m.id, m);
  }
  const clean = [...byId.values()];
  board.media = clean;
  (board as { savedAt?: number }).savedAt = Date.now();

  await sql`
    INSERT INTO board_state (scope, project_id, user_id, data, updated_at)
    VALUES (${scope}, ${projectId}, ${userId}, ${JSON.stringify(board)}::jsonb, now())
    ON CONFLICT (scope, project_id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;

  // Reset the project's sourceIds to the deduped media ids so the count matches.
  const prows = await sql`SELECT data FROM projects_state WHERE scope=${scope}`;
  const projects = (prows[0]?.data ?? []) as Array<{ id: string; sourceIds?: string[] }>;
  if (Array.isArray(projects)) {
    const cleanIds = clean.map((m) => m.id);
    const next = projects.map((p) =>
      p.id === projectId ? { ...p, sourceIds: cleanIds } : p
    );
    await sql`
      INSERT INTO projects_state (scope, user_id, data, updated_at)
      VALUES (${scope}, ${userId}, ${JSON.stringify(next)}::jsonb, now())
      ON CONFLICT (scope)
      DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  }

  const withThumbs = clean.filter((m) => m.thumbnail).length;
  return Response.json({ ok: true, before, afterUnique: clean.length, withThumbnails: withThumbs });
}
