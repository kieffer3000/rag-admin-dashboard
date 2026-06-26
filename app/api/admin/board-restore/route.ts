import { auth, clerkClient } from '@clerk/nextjs/server';
import { sql } from '@/lib/board-db';

// TEMP owner-only restore — copies a saved board snapshot from one (scope,
// project) to another. Used to move a board out from under an old org scope into
// the current one (the scope-mismatch "lost board"). Remove after recovery.

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
  const fromScope = url.searchParams.get('from_scope');
  const fromProject = url.searchParams.get('from_project');
  const toScope = url.searchParams.get('to_scope');
  const toProject = url.searchParams.get('to_project');
  if (!fromScope || !fromProject || !toScope || !toProject) {
    return Response.json(
      { error: 'need from_scope, from_project, to_scope, to_project' },
      { status: 400 }
    );
  }

  const src = await sql`
    SELECT data FROM board_state WHERE scope=${fromScope} AND project_id=${fromProject}`;
  if (!src[0]) return Response.json({ error: 'source board not found' }, { status: 404 });

  const data = (src[0].data ?? {}) as Record<string, unknown>;
  const nodeCount = Array.isArray(data.nodes) ? (data.nodes as unknown[]).length : 0;
  if (nodeCount <= 1) {
    return Response.json(
      { error: 'source board is blank — refusing to copy', nodeCount },
      { status: 409 }
    );
  }
  // Make it win the next load.
  (data as { savedAt?: number }).savedAt = Date.now();

  await sql`
    INSERT INTO board_state (scope, project_id, user_id, data, updated_at)
    VALUES (${toScope}, ${toProject}, ${userId}, ${JSON.stringify(data)}::jsonb, now())
    ON CONFLICT (scope, project_id)
    DO UPDATE SET data = EXCLUDED.data, user_id = EXCLUDED.user_id, updated_at = now()`;

  const edgeCount = Array.isArray(data.edges) ? (data.edges as unknown[]).length : 0;
  return Response.json({
    ok: true,
    copied: { nodes: nodeCount, edges: edgeCount },
    from: { fromScope, fromProject },
    to: { toScope, toProject }
  });
}
