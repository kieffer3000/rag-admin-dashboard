import { auth } from '@clerk/nextjs/server';
import { sql, ensureProjectsSchema } from '@/lib/board-db';

// Persistence for the PROJECT LIST (account-global). One JSONB array per scope
// (Clerk org = the client, else the user). This is what makes a project survive
// a refresh — each project's board + sources already persist separately.

export const runtime = 'nodejs';

function scopeOf(orgId: string | null | undefined, userId: string) {
  return orgId ?? `user:${userId}`;
}

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ projects: null }); // no DB → keep seed

  await ensureProjectsSchema();
  const scope = scopeOf(orgId, userId);
  const rows = await sql`
    SELECT data FROM projects_state WHERE scope = ${scope}
  `;
  // Also report every project id that has a SAVED BOARD for this scope — the
  // client resurrects any board whose directory entry went missing (a lost
  // project's board/sources always outlive the projects list, which is just
  // a directory).
  let boardProjectIds: string[] = [];
  try {
    const b = await sql`SELECT project_id FROM board_state WHERE scope = ${scope}`;
    boardProjectIds = b.map((r: Record<string, unknown>) => String(r.project_id));
  } catch {
    /* board table may not exist yet */
  }
  return Response.json({ projects: rows[0]?.data ?? null, boardProjectIds });
}

export async function PUT(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ ok: false });

  const body = await req.json();
  const projects = body?.projects;
  const deletedIds: string[] = Array.isArray(body?.deletedIds)
    ? body.deletedIds.filter((s: unknown): s is string => typeof s === 'string')
    : [];
  if (!Array.isArray(projects)) {
    return Response.json({ error: 'projects array required' }, { status: 400 });
  }

  await ensureProjectsSchema();
  const scope = scopeOf(orgId, userId);
  // NON-DESTRUCTIVE MERGE: a client that loaded a partial/failed list (flaky
  // network) then saved used to CLOBBER the server row — losing projects that
  // were only on the server ("siu"). Now: incoming wins for shared ids, but a
  // server-only project SURVIVES unless explicitly tombstoned via deletedIds.
  // Absence is never deletion.
  const existingRows = await sql`SELECT data FROM projects_state WHERE scope = ${scope}`;
  const existing: Array<{ id: string }> = Array.isArray(existingRows[0]?.data)
    ? existingRows[0].data
    : [];
  const dead = new Set(deletedIds);
  const byId = new Map<string, unknown>();
  for (const p of existing) if (p?.id && !dead.has(p.id)) byId.set(p.id, p);
  for (const p of projects) if (p?.id && !dead.has(p.id)) byId.set(p.id, p);
  const merged = Array.from(byId.values());

  await sql`
    INSERT INTO projects_state (scope, user_id, data, updated_at)
    VALUES (${scope}, ${userId}, ${JSON.stringify(merged)}::jsonb, now())
    ON CONFLICT (scope)
    DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, updated_at = now()
  `;
  return Response.json({ ok: true, count: merged.length });
}
