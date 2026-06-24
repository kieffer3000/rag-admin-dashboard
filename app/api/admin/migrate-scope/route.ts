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

// Inventory: list every scope that has data + row counts, so we can see where
// the board/library actually lives. Secret-gated.
export async function GET(req: Request) {
  const secret = req.headers.get('x-migrate-secret');
  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!sql) return Response.json({ error: 'no database' }, { status: 503 });
  await ensureBoardSchema();
  await ensureAgentsSchema();
  await ensureProjectsSchema();
  await ensureUserDataSchema();
  const board = await sql`SELECT scope, count(*)::int AS n FROM board_state GROUP BY scope ORDER BY n DESC`;
  const agents = await sql`SELECT scope FROM agents_state`;
  const projects = await sql`SELECT scope FROM projects_state`;
  const userdata = await sql`SELECT scope FROM userdata_state`;
  return Response.json({ board, agents, projects, userdata });
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-migrate-secret');
  if (!process.env.MIGRATE_SECRET || secret !== process.env.MIGRATE_SECRET) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!sql) return Response.json({ error: 'no database' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const fromScope = body.fromScope ?? (body.from ? `user:${body.from}` : null);
  const toScope = body.toScope ?? (body.to ? `user:${body.to}` : null);
  if (!fromScope || !toScope) {
    return Response.json(
      { error: 'from/to (user ids) or fromScope/toScope (raw) required' },
      { status: 400 }
    );
  }

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
    SELECT ${toScope}, project_id, user_id, data, now() FROM board_state WHERE scope=${fromScope}
    ON CONFLICT (scope, project_id)
    DO UPDATE SET data=EXCLUDED.data, user_id=EXCLUDED.user_id, updated_at=now()
    RETURNING project_id`;
  const agents = await sql`
    INSERT INTO agents_state (scope, user_id, data, updated_at)
    SELECT ${toScope}, user_id, data, now() FROM agents_state WHERE scope=${fromScope}
    ON CONFLICT (scope) DO UPDATE SET data=EXCLUDED.data, user_id=EXCLUDED.user_id, updated_at=now()
    RETURNING scope`;
  const projects = await sql`
    INSERT INTO projects_state (scope, user_id, data, updated_at)
    SELECT ${toScope}, user_id, data, now() FROM projects_state WHERE scope=${fromScope}
    ON CONFLICT (scope) DO UPDATE SET data=EXCLUDED.data, user_id=EXCLUDED.user_id, updated_at=now()
    RETURNING scope`;
  const userdata = await sql`
    INSERT INTO userdata_state (scope, user_id, data, updated_at)
    SELECT ${toScope}, user_id, data, now() FROM userdata_state WHERE scope=${fromScope}
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
