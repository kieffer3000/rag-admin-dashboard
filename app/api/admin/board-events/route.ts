import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql, ensureEventsSchema } from '@/lib/board-db';

// Owner-only EVENT LEDGER console (Phase 2 of never-lose-a-file).
//   GET ?projectId=X                     → newest events for that board
//   GET ?projectId=X&entityId=<id>       → everything that ever happened to
//                                          one file/node ("where did X go?")
//   GET ?projectId=X&event=media_removed → filter by event type
//   &limit=N (default 200, max 1000)
// The ledger is derived server-side on every accepted board save
// (lib/board-events.ts) — this route only reads it.

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
  await ensureEventsSchema();

  const url = new URL(req.url);
  const pid = url.searchParams.get('projectId') ?? '';
  const entityId = url.searchParams.get('entityId');
  const event = url.searchParams.get('event');
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 1),
    1000
  );
  if (!pid) return Response.json({ error: 'projectId required' }, { status: 400 });

  const rows = await sql`
    SELECT id, at, user_id, event, entity_id, name, detail
    FROM board_events
    WHERE project_id = ${pid}
      AND (${entityId}::text IS NULL OR entity_id = ${entityId})
      AND (${event}::text IS NULL OR event = ${event})
    ORDER BY at DESC, id DESC
    LIMIT ${limit}`;
  return Response.json({ projectId: pid, count: rows.length, events: rows });
}
