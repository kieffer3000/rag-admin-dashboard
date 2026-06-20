import { auth } from '@clerk/nextjs/server';
import { sql, ensureAgentsSchema } from '@/lib/board-db';

// Persistence for account-global answering personas (Agents). One JSONB array
// per scope (Clerk org = the client, else the user). This is what makes created
// agents survive a refresh instead of resetting to the in-memory seed.

export const runtime = 'nodejs';

function scopeOf(orgId: string | null | undefined, userId: string) {
  return orgId ?? `user:${userId}`;
}

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  // No DB configured → signal "never saved" so the client keeps its seed.
  if (!sql) return Response.json({ agents: null });

  await ensureAgentsSchema();
  const rows = await sql`
    SELECT data FROM agents_state WHERE scope = ${scopeOf(orgId, userId)}
  `;
  // `null` = no row yet (never saved) vs an array (possibly empty) = saved.
  return Response.json({ agents: rows[0]?.data ?? null });
}

export async function PUT(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ ok: false }); // silently no-op without DB

  const { agents } = await req.json();
  if (!Array.isArray(agents)) {
    return Response.json({ error: 'agents array required' }, { status: 400 });
  }

  await ensureAgentsSchema();
  await sql`
    INSERT INTO agents_state (scope, user_id, data, updated_at)
    VALUES (${scopeOf(orgId, userId)}, ${userId}, ${JSON.stringify(agents)}::jsonb, now())
    ON CONFLICT (scope)
    DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, updated_at = now()
  `;
  return Response.json({ ok: true });
}
