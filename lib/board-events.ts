import 'server-only';
import { sql, ensureEventsSchema } from './board-db';

// Board event ledger — Phase 2 of the never-lose-a-file plan.
//
// Events are DERIVED here by diffing the previous stored board document
// against the incoming one, on every accepted /api/board PUT. Server-side
// derivation (instead of client-emitted events) means the ledger records what
// the DATABASE accepted — a stale tab, an old client build, or a mutator
// nobody instrumented can't leave a gap. Granularity = save cadence: ops that
// cancel out within one autosave tick aren't recorded; what persists is what
// the ledger witnesses.

export interface LedgerEvent {
  event: string;
  entityId?: string;
  /** The item's display name AT EVENT TIME. */
  name?: string;
  detail?: Record<string, unknown>;
}

type BNode = {
  id: string;
  type?: string;
  parentId?: string;
  data?: Record<string, unknown>;
};
type BEdge = {
  id: string;
  source: string;
  target: string;
  targetHandle?: string;
};
export type BoardDoc = {
  nodes?: BNode[];
  edges?: BEdge[];
  media?: Array<{ id: string; name?: string; type?: string }>;
  stashedBrains?: Array<{ node: BNode; edges?: BEdge[] }>;
  stashedBoxes?: Array<{ node: BNode; children?: BNode[]; edges?: BEdge[] }>;
};

/** Piece types that dock into boxes / sit loose on the canvas. */
const PIECE = new Set(['chip', 'textNode', 'prompt', 'agent']);

/** Hard cap per save — a pathological diff must never balloon one PUT into
 *  thousands of inserts. Truncation is announced, never silent. */
const MAX_EVENTS = 800;

/** Every node in the doc (canvas + Chest), with where it lives. */
function collectNodes(
  doc: BoardDoc
): Map<string, { n: BNode; where: 'canvas' | 'stashed' }> {
  const m = new Map<string, { n: BNode; where: 'canvas' | 'stashed' }>();
  for (const n of doc.nodes ?? []) if (n?.id) m.set(n.id, { n, where: 'canvas' });
  for (const s of doc.stashedBrains ?? [])
    if (s?.node?.id) m.set(s.node.id, { n: s.node, where: 'stashed' });
  for (const s of doc.stashedBoxes ?? []) {
    if (s?.node?.id) m.set(s.node.id, { n: s.node, where: 'stashed' });
    for (const c of s?.children ?? [])
      if (c?.id) m.set(c.id, { n: c, where: 'stashed' });
  }
  return m;
}

function mediaMap(doc: BoardDoc): Map<string, { name?: string; type?: string }> {
  const m = new Map<string, { name?: string; type?: string }>();
  for (const it of doc.media ?? [])
    if (it?.id) m.set(it.id, { name: it.name, type: it.type });
  return m;
}

/** Explicit display name only (data.name / data.title). Text-body edits on
 *  notes/prompts are content changes, not renames — logging them would spam. */
function explicitName(n: BNode): string | undefined {
  const d = n.data ?? {};
  if (typeof d.name === 'string' && d.name) return d.name;
  if (typeof d.title === 'string' && d.title) return d.title;
  return undefined;
}

function displayName(
  n: BNode,
  media: Map<string, { name?: string }>,
  fallbackMedia?: Map<string, { name?: string }>
): string {
  if (n.type === 'chip') {
    const mid = n.data?.mediaId as string | undefined;
    const hit = (mid && (media.get(mid) ?? fallbackMedia?.get(mid))) || undefined;
    return hit?.name ?? 'source';
  }
  const d = n.data ?? {};
  return (
    explicitName(n) ??
    (typeof d.text === 'string' && d.text ? d.text.slice(0, 60) : undefined) ??
    (n.type || 'node')
  );
}

/** Diff two board documents into ledger events (names at event time). */
export function deriveBoardEvents(prev: BoardDoc, next: BoardDoc): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  const prevMedia = mediaMap(prev);
  const nextMedia = mediaMap(next);
  const prevNodes = collectNodes(prev);
  const nextNodes = collectNodes(next);

  // Box-name resolvers for dock/undock detail.
  const boxName = (
    nodes: Map<string, { n: BNode }>,
    id: string | undefined
  ): string | undefined => {
    if (!id) return undefined;
    const hub = nodes.get(id)?.n;
    return hub ? displayName(hub, nextMedia, prevMedia) : undefined;
  };

  // ---- Media (the files themselves) ----
  for (const [id, m] of nextMedia) {
    const was = prevMedia.get(id);
    if (!was) {
      out.push({ event: 'media_added', entityId: id, name: m.name, detail: { type: m.type } });
    } else if (was.name !== m.name) {
      out.push({
        event: 'media_renamed',
        entityId: id,
        name: m.name,
        detail: { from: was.name, to: m.name }
      });
    }
  }
  for (const [id, m] of prevMedia) {
    if (!nextMedia.has(id))
      out.push({ event: 'media_removed', entityId: id, name: m.name, detail: { type: m.type } });
  }

  // ---- Nodes (pieces, boxes, banks, artifacts, references) ----
  for (const [id, { n, where }] of nextNodes) {
    const was = prevNodes.get(id);
    const isPiece = PIECE.has(n.type ?? '');
    if (!was) {
      out.push({
        event: isPiece ? 'piece_placed' : 'node_added',
        entityId: id,
        name: displayName(n, nextMedia, prevMedia),
        detail: {
          nodeType: n.type,
          ...(n.parentId ? { box: boxName(nextNodes, n.parentId) } : {})
        }
      });
      continue;
    }
    if (was.where === 'canvas' && where === 'stashed') {
      out.push({
        event: 'stashed',
        entityId: id,
        name: displayName(n, nextMedia, prevMedia),
        detail: { nodeType: n.type }
      });
    } else if (was.where === 'stashed' && where === 'canvas') {
      out.push({
        event: 'unstashed',
        entityId: id,
        name: displayName(n, nextMedia, prevMedia),
        detail: { nodeType: n.type }
      });
    }
    if (isPiece && (was.n.parentId ?? null) !== (n.parentId ?? null)) {
      const from = boxName(prevNodes, was.n.parentId);
      const to = boxName(nextNodes, n.parentId);
      out.push({
        event: n.parentId ? 'piece_docked' : 'piece_undocked',
        entityId: id,
        name: displayName(n, nextMedia, prevMedia),
        detail: { nodeType: n.type, ...(from ? { from } : {}), ...(to ? { to } : {}) }
      });
    }
    // Renames: explicit name/title fields only. Chips are named by their
    // media (covered by media_renamed above).
    if (n.type !== 'chip') {
      const before = explicitName(was.n);
      const after = explicitName(n);
      if (before !== after && (before || after)) {
        out.push({
          event: 'node_renamed',
          entityId: id,
          name: after,
          detail: { nodeType: n.type, from: before, to: after }
        });
      }
    }
  }
  for (const [id, { n }] of prevNodes) {
    if (nextNodes.has(id)) continue;
    out.push({
      event: PIECE.has(n.type ?? '') ? 'piece_removed' : 'node_removed',
      entityId: id,
      name: displayName(n, prevMedia, nextMedia),
      detail: {
        nodeType: n.type,
        ...(n.parentId ? { box: boxName(prevNodes, n.parentId) } : {})
      }
    });
  }

  // ---- Wires (canvas edges only — stashed edges travel with stash events) ----
  const prevEdges = new Map((prev.edges ?? []).map((e) => [e.id, e]));
  const nextEdges = new Map((next.edges ?? []).map((e) => [e.id, e]));
  const endpoints = (
    e: BEdge,
    nodes: Map<string, { n: BNode }>
  ): Record<string, unknown> => {
    const s = nodes.get(e.source)?.n;
    const t = nodes.get(e.target)?.n;
    return {
      source: s ? displayName(s, nextMedia, prevMedia) : e.source,
      target: t ? displayName(t, nextMedia, prevMedia) : e.target,
      ...(e.targetHandle ? { handle: e.targetHandle } : {})
    };
  };
  for (const [id, e] of nextEdges) {
    if (!prevEdges.has(id))
      out.push({ event: 'wired', entityId: id, detail: endpoints(e, nextNodes) });
  }
  for (const [id, e] of prevEdges) {
    if (!nextEdges.has(id))
      out.push({ event: 'unwired', entityId: id, detail: endpoints(e, prevNodes) });
  }

  if (out.length > MAX_EVENTS) {
    const dropped = out.length - MAX_EVENTS;
    out.length = MAX_EVENTS;
    out.push({ event: 'events_truncated', detail: { dropped } });
  }
  return out;
}

/** Append events in ONE round trip (jsonb unnest — a bulk import must not
 *  turn into hundreds of sequential inserts). Callers wrap in try/catch:
 *  the ledger is best-effort, a hiccup never fails the save. */
export async function appendBoardEvents(
  scope: string,
  projectId: string,
  userId: string | null,
  events: LedgerEvent[]
) {
  if (!sql || events.length === 0) return;
  await ensureEventsSchema();
  await sql`
    INSERT INTO board_events (scope, project_id, user_id, event, entity_id, name, detail)
    SELECT ${scope}, ${projectId}, ${userId},
           e->>'event', e->>'entityId', e->>'name', COALESCE(e->'detail', '{}'::jsonb)
    FROM jsonb_array_elements(${JSON.stringify(events)}::jsonb) AS e`;
}
