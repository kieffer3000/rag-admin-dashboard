import {
  sql,
  ensureBoardSchema,
  ensureAgentsSchema,
  ensureProjectsSchema,
  ensureUserDataSchema
} from '@/lib/board-db';

// TEMPORARY one-off admin endpoint: copy a user's Postgres records from one Clerk
// identity to another (used after the Clerk dev→prod switch changed the user id).
// Gated by a secret header (MIGRATE_SECRET). Additive: copies from → to (upsert),
// never deletes the source. Remove this route + the secret after running.

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = req.headers.get('x-migrate-secret');
  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!sql) return Response.json({ error: 'no database' }, { status: 503 });

  const { from, to } = await req.json().catch(() => ({}));
  if (!from || !to) {
    return Response.json({ error: 'from and to (Clerk user ids) required' }, { status: 400 });
  }
  const fromScope = `user:${from}`;
  const toScope = `user:${to}`;

  await ensureBoardSchema();
  await ensureAgentsSchema();
  await ensureProjectsSchema();
  await ensureUserDataSchema();

  // What's there before (for verification)
  const srcBoard = await sql`SELECT project_id FROM board_state WHERE scope=${fromScope}`;
  const srcAgents = await sql`SELECT 1 FROM agents_state WHERE scope=${fromScope}`;
  const srcProjects = await sql`SELECT 1 FROM projects_state WHERE scope=${fromScope}`;
  const srcUser = await sql`SELECT 1 FROM userdata_state WHERE scope=${fromScope}`;

  // board_state: one row per project
  const board = await sql`
    INSERT INTO board_state (scope, project_id, user_id, data, updated_at)
    SELECT ${toScope}, project_id, ${to}, data, now() FROM board_state WHERE scope=${fromScope}
    ON CONFLICT (scope, project_id)
    DO UPDATE SET data=EXCLUDED.data, user_id=EXCLUDED.user_id, updated_at=now()
    RETURNING project_id`;
  const agents = await sql`
    INSERT INTO agents_state (scope, user_id, data, updated_at)
    SELECT ${toScope}, ${to}, data, now() FROM agents_state WHERE scope=${fromScope}
    ON CONFLICT (scope) DO UPDATE SET data=EXCLUDED.data, user_id=EXCLUDED.user_id, updated_at=now()
    RETURNING scope`;
  const projects = await sql`
    INSERT INTO projects_state (scope, user_id, data, updated_at)
    SELECT ${toScope}, ${to}, data, now() FROM projects_state WHERE scope=${fromScope}
    ON CONFLICT (scope) DO UPDATE SET data=EXCLUDED.data, user_id=EXCLUDED.user_id, updated_at=now()
    RETURNING scope`;
  const userdata = await sql`
    INSERT INTO userdata_state (scope, user_id, data, updated_at)
    SELECT ${toScope}, ${to}, data, now() FROM userdata_state WHERE scope=${fromScope}
    ON CONFLICT (scope) DO UPDATE SET data=EXCLUDED.data, user_id=EXCLUDED.user_id, updated_at=now()
    RETURNING scope`;

  return Response.json({
    ok: true,
    from: fromScope,
    to: toScope,
    source_had: {
      board_projects: srcBoard.length,
      agents: srcAgents.length,
      projects: srcProjects.length,
      userdata: srcUser.length
    },
    migrated: {
      board_projects: board.length,
      agents: agents.length,
      projects: projects.length,
      userdata: userdata.length
    }
  });
}
