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

  // DETAIL mode (?projectId=X): name every brain, box (with member count),
  // stashed brain and stashed box in one project's doc — locates "missing"
  // Banks (stashed? other scope? actually deleted?) without guesswork.
  const pid = new URL(req.url).searchParams.get('projectId');
  if (pid) {
    const rows = await sql`
      SELECT scope, user_id, updated_at, data FROM board_state
      WHERE project_id=${pid} ORDER BY updated_at DESC`;
    const out = rows.map((r) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const nodes = (Array.isArray(d.nodes) ? d.nodes : []) as Array<{
        id: string; type?: string; parentId?: string; data?: Record<string, unknown>;
      }>;
      const memberCount = new Map<string, number>();
      for (const n of nodes)
        if (n.parentId) memberCount.set(n.parentId, (memberCount.get(n.parentId) ?? 0) + 1);
      const stashName = (s: unknown) => {
        const n = (s as { node?: { id?: string; data?: { name?: string } } })?.node;
        return n?.data?.name ?? n?.id ?? '?';
      };
      return {
        scope: r.scope,
        user_id: r.user_id,
        updated_at: r.updated_at,
        brains: nodes.filter((n) => n.type === 'brain').map((n) => ({ id: n.id, name: String(n.data?.name ?? '') })),
        boxes: nodes.filter((n) => n.type === 'hub').map((n) => ({ id: n.id, name: String(n.data?.name ?? ''), members: memberCount.get(n.id) ?? 0 })),
        stashedBrains: (Array.isArray(d.stashedBrains) ? d.stashedBrains : []).map(stashName),
        stashedBoxes: (Array.isArray(d.stashedBoxes) ? d.stashedBoxes : []).map(stashName),
        chatBrainIds: Object.keys((d.brainMessages ?? {}) as Record<string, unknown>)
      };
    });
    return Response.json({ projectId: pid, rows: out });
  }

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
