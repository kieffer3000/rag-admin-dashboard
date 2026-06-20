import { auth } from '@clerk/nextjs/server';
import { sql, ensureUserDataSchema } from '@/lib/board-db';

// Persistence for misc account data that isn't on the board — Notes and Chat
// conversations — as one JSONB blob per Clerk scope. (Board layout, sources,
// agents and the project list each persist in their own table.)

export const runtime = 'nodejs';

function scopeOf(orgId: string | null | undefined, userId: string) {
  return orgId ?? `user:${userId}`;
}

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ data: null });

  await ensureUserDataSchema();
  const rows = await sql`
    SELECT data FROM userdata_state WHERE scope = ${scopeOf(orgId, userId)}
  `;
  return Response.json({ data: rows[0]?.data ?? null });
}

export async function PUT(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ ok: false });

  const body = await req.json();
  const data = {
    notes: Array.isArray(body?.notes) ? body.notes : [],
    conversations: Array.isArray(body?.conversations) ? body.conversations : []
  };

  await ensureUserDataSchema();
  await sql`
    INSERT INTO userdata_state (scope, user_id, data, updated_at)
    VALUES (${scopeOf(orgId, userId)}, ${userId}, ${JSON.stringify(data)}::jsonb, now())
    ON CONFLICT (scope)
    DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, updated_at = now()
  `;
  return Response.json({ ok: true });
}
