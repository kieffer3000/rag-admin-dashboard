import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql } from '@/lib/board-db';

// TEMP owner-only — write a board doc (e.g. this device's localStorage backup)
// straight into board_state for a scope+project. Used to restore the FULL board
// (boxes + media-with-thumbnails) from the browser's local copy. Remove after.

export const runtime = 'nodejs';

const OWNER = (process.env.ALLOWED_EMAILS ?? 'tiosquareinc@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase());

export async function POST(req: Request) {
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

  let doc: Record<string, unknown>;
  try {
    doc = await req.json();
  } catch {
    return Response.json({ error: 'body must be the board JSON' }, { status: 400 });
  }
  const nodeCount = Array.isArray(doc.nodes) ? (doc.nodes as unknown[]).length : 0;
  const mediaCount = Array.isArray(doc.media) ? (doc.media as unknown[]).length : 0;
  // Refuse a blank import so we never make things worse.
  if (nodeCount <= 1 && mediaCount === 0) {
    return Response.json({ error: 'refusing blank import', nodeCount, mediaCount }, { status: 409 });
  }
  (doc as { savedAt?: number }).savedAt = Date.now();

  await sql`
    INSERT INTO board_state (scope, project_id, user_id, data, updated_at)
    VALUES (${scope}, ${projectId}, ${userId}, ${JSON.stringify(doc)}::jsonb, now())
    ON CONFLICT (scope, project_id)
    DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, updated_at = now()`;

  const thumbs = Array.isArray(doc.media)
    ? (doc.media as Array<{ thumbnail?: string }>).filter((m) => m?.thumbnail).length
    : 0;
  return Response.json({ ok: true, imported: { nodes: nodeCount, media: mediaCount, withThumbnails: thumbs } });
}
