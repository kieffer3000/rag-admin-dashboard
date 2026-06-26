import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql } from '@/lib/board-db';

// TEMP owner-only inspector — lists every saved board snapshot (scope, project,
// node/edge counts, timestamps) so we can locate a board that isn't loading.
// Remove after recovery. Owner-gated (no secret); reachable because the owner
// passes the middleware gate.

export const runtime = 'nodejs';

const OWNER = (process.env.ALLOWED_EMAILS ?? 'tiosquareinc@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase());

export async function GET() {
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

  const rows = await sql`
    SELECT scope, project_id, user_id, updated_at,
           jsonb_array_length(COALESCE(data->'nodes', '[]'::jsonb))  AS node_count,
           jsonb_array_length(COALESCE(data->'edges', '[]'::jsonb))  AS edge_count,
           (data->>'savedAt')                                        AS saved_at,
           (SELECT count(*) FROM jsonb_object_keys(COALESCE(data->'brainMessages','{}'::jsonb))) AS brain_chats
    FROM board_state
    ORDER BY updated_at DESC`;

  return Response.json({ count: rows.length, rows });
}
