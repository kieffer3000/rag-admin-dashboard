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
  const rows = await sql`
    SELECT data FROM projects_state WHERE scope = ${scopeOf(orgId, userId)}
  `;
  return Response.json({ projects: rows[0]?.data ?? null });
}

export async function PUT(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ ok: false });

  const { projects } = await req.json();
  if (!Array.isArray(projects)) {
    return Response.json({ error: 'projects array required' }, { status: 400 });
  }

  await ensureProjectsSchema();
  await sql`
    INSERT INTO projects_state (scope, user_id, data, updated_at)
    VALUES (${scopeOf(orgId, userId)}, ${userId}, ${JSON.stringify(projects)}::jsonb, now())
    ON CONFLICT (scope)
    DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, updated_at = now()
  `;
  return Response.json({ ok: true });
}
