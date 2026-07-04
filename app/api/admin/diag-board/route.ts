import { sql, ensureSnapshotsSchema } from '@/lib/board-db';

// TEMP headless diagnostics for the 2026-07-04 "ghost banks" incident —
// read-only SELECTs over board_state / board_snapshots / board_events so the
// incident can be measured without a browser session. Shared-secret gated
// (same pattern as /api/caption-image): requires the x-diag-secret header to
// equal CAPTION_WEBHOOK_SECRET. Remove after the incident closes.

export const runtime = 'nodejs';

type AnyNode = {
  id: string;
  type?: string;
  parentId?: string;
  position?: { x?: unknown; y?: unknown };
  width?: unknown;
  height?: unknown;
  data?: Record<string, unknown>;
};

function brainSummary(d: Record<string, unknown>) {
  const nodes = (Array.isArray(d.nodes) ? d.nodes : []) as AnyNode[];
  const stash = (s: unknown) => {
    const n = (s as { node?: AnyNode })?.node;
    return n ? { id: n.id, name: String(n.data?.name ?? ''), pos: n.position } : null;
  };
  return {
    nodeCount: nodes.length,
    edgeCount: Array.isArray(d.edges) ? (d.edges as unknown[]).length : 0,
    savedAt: (d as { savedAt?: number }).savedAt ?? null,
    brains: nodes
      .filter((n) => n.type === 'brain')
      .map((n) => ({
        id: n.id,
        name: String(n.data?.name ?? ''),
        pos: n.position ?? null,
        parentId: n.parentId ?? null,
        w: n.width ?? null,
        h: n.height ?? null
      })),
    hubs: nodes
      .filter((n) => n.type === 'hub')
      .map((n) => ({ id: n.id, name: String(n.data?.name ?? ''), pos: n.position ?? null })),
    stashedBrains: (Array.isArray(d.stashedBrains) ? d.stashedBrains : []).map(stash),
    stashedBoxes: (Array.isArray(d.stashedBoxes) ? d.stashedBoxes : []).map(stash),
    chatKeys: Object.fromEntries(
      Object.entries((d.brainMessages ?? {}) as Record<string, unknown>).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.length : 0
      ])
    )
  };
}

export async function GET(req: Request) {
  const secret = process.env.CAPTION_WEBHOOK_SECRET;
  if (!secret || req.headers.get('x-diag-secret') !== secret) {
    return Response.json({ error: 'unauth' }, { status: 401 });
  }
  if (!sql) return Response.json({ error: 'no db' }, { status: 500 });

  const url = new URL(req.url);
  const pid = url.searchParams.get('projectId');

  // ?projectId=X&snapshots=1 → version history with per-snapshot brain summary
  if (pid && url.searchParams.get('snapshots')) {
    await ensureSnapshotsSchema();
    const rows = await sql`
      SELECT id, scope, saved_at, node_count, media_count, bytes, data
      FROM board_snapshots WHERE project_id=${pid}
      ORDER BY saved_at DESC LIMIT 60`;
    return Response.json({
      snapshots: rows.map((r) => ({
        id: r.id,
        scope: r.scope,
        saved_at: r.saved_at,
        node_count: r.node_count,
        media_count: r.media_count,
        bytes: r.bytes,
        ...brainSummary((r.data ?? {}) as Record<string, unknown>)
      }))
    });
  }

  // ?projectId=X&events=1 → recent board event ledger rows
  if (pid && url.searchParams.get('events')) {
    const rows = await sql`
      SELECT id, scope, user_id, event, detail, created_at
      FROM board_events WHERE project_id=${pid}
      ORDER BY created_at DESC LIMIT 200`;
    return Response.json({ events: rows });
  }

  // ?projectId=X → the live board_state doc's brain/hub/stash summary
  if (pid) {
    const rows = await sql`
      SELECT scope, user_id, updated_at, data FROM board_state
      WHERE project_id=${pid} ORDER BY updated_at DESC`;
    return Response.json({
      boards: rows.map((r) => ({
        scope: r.scope,
        user_id: r.user_id,
        updated_at: r.updated_at,
        ...brainSummary((r.data ?? {}) as Record<string, unknown>)
      }))
    });
  }

  // default → every saved board (locate the ghost project)
  const rows = await sql`
    SELECT scope, project_id, updated_at,
           jsonb_array_length(COALESCE(data->'nodes','[]'::jsonb)) AS nodes
    FROM board_state ORDER BY updated_at DESC LIMIT 100`;
  return Response.json({ boards: rows });
}
