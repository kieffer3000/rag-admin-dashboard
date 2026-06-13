'use client';

import { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type IsValidConnection
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useRag } from '@/lib/rag/store';
import { useBoard } from '@/lib/rag/board/store';
import { MediaType } from '@/lib/rag/types';
import {
  BoardNode,
  hubSlot,
  hubSize,
  stackOf,
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
  STACK_PITCH,
  STACK_SNAP,
  PEEL_BREAK,
  STACK_GRAB
} from '@/lib/rag/board/types';
import { playSnap, playPop } from '@/lib/rag/board/sound';
import { ChipNode } from './chip-node';
import { HubNode } from './hub-node';
import { BrainNode } from './brain-node';
import { TextNode } from './text-node';
import { PromptNode } from './prompt-node';
import { AnnotationNode } from './annotation-node';
import { MindmapNode } from './mindmap-node';
import { ScopeEdge } from './scope-edge';
import { BoardToolbar } from './toolbar';

const nodeTypes = {
  chip: ChipNode,
  hub: HubNode,
  brain: BrainNode,
  textNode: TextNode,
  prompt: PromptNode,
  annotation: AnnotationNode,
  mindmap: MindmapNode
};

const edgeTypes = { scope: ScopeEdge };

const SOURCE_TYPES = new Set(['chip', 'hub', 'textNode', 'prompt']);
/** Node types that dock into cluster boxes as compact tiles (non-source
 *  context: notes + prompt guides). */
const DOCKABLE_CONTEXT = new Set(['textNode', 'prompt']);

/** Re-tile a hub's docked tiles (chips + context notes + prompts) into the
 *  2-col grid. */
function retile(nodes: BoardNode[], hubId: string): BoardNode[] {
  let i = 0;
  return nodes.map((n) =>
    (n.type === 'chip' || n.type === 'textNode' || n.type === 'prompt') &&
    n.parentId === hubId
      ? { ...n, position: hubSlot(i++) }
      : n
  );
}

function BoardCanvasInner() {
  const { board, setBoard, nextBoardId, busyBrains } = useBoard();
  const { media, projectMedia, addMedia, updateMedia } = useRag();
  const { getIntersectingNodes, screenToFlowPosition, fitView } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  const mediaTypeOf = useCallback(
    (chip: Node): MediaType | undefined =>
      media.find((m) => m.id === chip.data.mediaId)?.type,
    [media]
  );

  /** The box currently under a dragged chip, if any. Cluster boxes accept
   *  ANY media (they're sub-projects, not type bins); legacy typed hubs
   *  still only take their own type. */
  const hitHub = useCallback(
    (chip: Node): Node | undefined => {
      const t = mediaTypeOf(chip);
      return getIntersectingNodes(chip).find(
        (n) =>
          n.type === 'hub' &&
          (n.data.mediaType === 'cluster' || n.data.mediaType === t)
      ) as Node | undefined;
    },
    [getIntersectingNodes, mediaTypeOf]
  );

  /** A cluster box under a dragged node — context notes only dock into
   *  clusters (a named sub-project), never typed media hubs. */
  const hitCluster = useCallback(
    (node: Node): Node | undefined =>
      getIntersectingNodes(node).find(
        (n) => n.type === 'hub' && n.data.mediaType === 'cluster'
      ) as Node | undefined,
    [getIntersectingNodes]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setBoard((prev) => ({
        ...prev,
        nodes: applyNodeChanges(changes, prev.nodes as Node[]) as BoardNode[]
      })),
    [setBoard]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setBoard((prev) => ({
        ...prev,
        edges: applyEdgeChanges(changes, prev.edges as Edge[])
      })),
    [setBoard]
  );

  const onConnect = useCallback(
    (conn: Connection) =>
      setBoard((prev) => ({
        ...prev,
        edges: addEdge({ ...conn, id: nextBoardId('e') }, prev.edges as Edge[])
      })),
    [setBoard, nextBoardId]
  );

  /** Edges only flow INTO a brain, from chips / hubs / text nodes. */
  const isValidConnection: IsValidConnection = useCallback(
    (conn) => {
      const src = board.nodes.find((n) => n.id === conn.source);
      const tgt = board.nodes.find((n) => n.id === conn.target);
      return !!src && !!tgt && tgt.type === 'brain' && SOURCE_TYPES.has(src.type!);
    },
    [board.nodes]
  );

  /**
   * Sibling-sync drag session. A welded stack moves as ONE unit; yanking a
   * piece sideways past PEEL_BREAK pops it loose (yank-to-peel) and the
   * column closes the gap behind it. Stacks stay emergent — this only
   * coordinates movement, never the data model.
   */
  const dragSession = useRef<{
    mode: 'undecided' | 'stack' | 'peel';
    startX: number;
    startY: number;
    mates: { id: string; x: number; y: number }[];
  } | null>(null);

  const onNodeDragStart = useCallback(
    (_: unknown, node: Node) => {
      dragSession.current = null;
      if (node.type !== 'chip' || node.parentId) return;
      const self = board.nodes.find((n) => n.id === node.id);
      if (!self) return;
      const typeOf = (n: BoardNode) =>
        media.find((m) => m.id === n.data.mediaId)?.type;
      const mates = stackOf(self, board.nodes, typeOf).filter(
        (n) => n.id !== node.id
      );
      if (!mates.length) return; // lone piece — plain drag
      dragSession.current = {
        mode: 'undecided',
        startX: self.position.x,
        startY: self.position.y,
        mates: mates.map((m) => ({ id: m.id, x: m.position.x, y: m.position.y }))
      };
    },
    [board.nodes, media]
  );

  /** Magnetic hub glow + stack movement, per drag tick. */
  const onNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      // Context notes / prompt pieces glow a cluster box they're over.
      if (DOCKABLE_CONTEXT.has(node.type!)) {
        const cl = hitCluster(node);
        setBoard((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.type === 'hub'
              ? n.data.glow === (n.id === cl?.id)
                ? n
                : { ...n, data: { ...n.data, glow: n.id === cl?.id } }
              : n
          )
        }));
        return;
      }
      if (node.type !== 'chip') return;
      const hub = hitHub(node);

      const s = dragSession.current;
      let stackPatch: ((nodes: BoardNode[]) => BoardNode[]) | null = null;

      if (s) {
        const dx = node.position.x - s.startX;
        const dy = node.position.y - s.startY;

        if (s.mode === 'undecided') {
          if (Math.abs(dx) >= PEEL_BREAK && Math.abs(dx) > Math.abs(dy)) {
            // POP: the piece breaks free; the column seals the gap behind it.
            s.mode = 'peel';
            playPop();
            const gapY = s.startY;
            stackPatch = (nodes) =>
              nodes.map((n) => {
                if (n.id === node.id)
                  return { ...n, data: { ...n.data, peel: true, tug: false } };
                const mate = s.mates.find((m) => m.id === n.id);
                if (mate && mate.y > gapY)
                  return { ...n, position: { x: mate.x, y: mate.y - STACK_PITCH } };
                return n;
              });
            s.mates = s.mates.map((m) =>
              m.y > gapY ? { ...m, y: m.y - STACK_PITCH } : m
            );
          } else if (Math.abs(dy) >= STACK_GRAB && Math.abs(dy) > Math.abs(dx)) {
            // Vertical intent grabs the whole welded block.
            s.mode = 'stack';
          } else {
            // Sideways tug under the break distance: the piece resists —
            // warm seam glow warns it's about to pop loose.
            const tug = Math.abs(dx) > 10;
            stackPatch = (nodes) =>
              nodes.map((n) =>
                n.id === node.id && !!n.data.tug !== tug
                  ? { ...n, data: { ...n.data, tug } }
                  : n
              );
          }
        }

        if (s.mode === 'stack') {
          // Rigid translate: every mate follows the lead piece's delta.
          stackPatch = (nodes) =>
            nodes.map((n) => {
              if (n.id === node.id && n.data.tug)
                return { ...n, data: { ...n.data, tug: false } };
              const mate = s.mates.find((m) => m.id === n.id);
              return mate
                ? { ...n, position: { x: mate.x + dx, y: mate.y + dy } }
                : n;
            });
        }
      }

      setBoard((prev) => {
        let nodes = prev.nodes.map((n) =>
          n.type === 'hub'
            ? n.data.glow === (n.id === hub?.id)
              ? n
              : { ...n, data: { ...n.data, glow: n.id === hub?.id } }
            : n
        );
        if (stackPatch) nodes = stackPatch(nodes);
        return { ...prev, nodes };
      });
    },
    [hitHub, hitCluster, setBoard]
  );

  /** Dock / undock / snap on drop — stack-aware (the unit lands together). */
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const s = dragSession.current;
      dragSession.current = null;

      // Context note / prompt piece dropped on a cluster box → dock it (joins
      // the family as context/guidance); dropped outside → undock.
      if (DOCKABLE_CONTEXT.has(node.type!)) {
        const cl = hitCluster(node);
        setTimeout(() => setBoard((prev) => {
          let nodes = prev.nodes.map((n) =>
            n.type === 'hub' && n.data.glow
              ? { ...n, data: { ...n.data, glow: false } }
              : n
          );
          let edges = prev.edges;
          const tn = nodes.find((n) => n.id === node.id);
          if (!tn) return { ...prev, nodes };
          if (cl && tn.parentId !== cl.id) {
            const oldHub = tn.parentId;
            nodes = nodes.filter((n) => n.id !== tn.id);
            nodes.push({
              ...tn,
              parentId: cl.id,
              position: { x: 0, y: 0 },
              width: CHIP_W,
              height: CHIP_H
            });
            nodes = retile(nodes, cl.id);
            if (oldHub) nodes = retile(nodes, oldHub);
            edges = edges.filter((e) => e.source !== tn.id); // box is the plug
          } else if (!cl && tn.parentId) {
            const parent = nodes.find((n) => n.id === tn.parentId);
            const abs = parent
              ? {
                  x: parent.position.x + node.position.x,
                  y: parent.position.y + node.position.y
                }
              : node.position;
            const oldHub = tn.parentId;
            const restore =
              tn.type === 'prompt'
                ? { width: CHIP_W, height: CHIP_H + CHIP_TAB }
                : { width: 234, height: 132 };
            nodes = nodes.map((n) =>
              n.id === tn.id
                ? { ...n, parentId: undefined, position: abs, ...restore }
                : n
            );
            nodes = retile(nodes, oldHub);
          } else if (cl && tn.parentId === cl.id) {
            // dropped inside its own box → settle back into the grid
            nodes = retile(nodes, cl.id);
          }
          return { ...prev, nodes, edges };
        }), 0);
        return;
      }

      if (node.type !== 'chip') return;
      // The set of pieces travelling together this gesture.
      const unitIds =
        s && s.mode === 'stack'
          ? new Set([node.id, ...s.mates.map((m) => m.id)])
          : new Set([node.id]);
      const hub = hitHub(node);

      // Defer one tick: React Flow flushes its final drag position AFTER this
      // callback — by applying the dock on the next tick we are the LAST
      // writer, so a dropped piece always seats INTO the glowing box instead
      // of being snapped back to wherever it was released.
      setTimeout(() => setBoard((prev) => {
        let nodes = prev.nodes.map((n) => {
          let out = n;
          if (n.type === 'hub' && n.data.glow)
            out = { ...out, data: { ...out.data, glow: false } };
          if (n.type === 'chip' && (n.data.tug || n.data.peel))
            out = { ...out, data: { ...out.data, tug: false, peel: false } };
          return out;
        });
        let edges = prev.edges;
        const chip = nodes.find((n) => n.id === node.id);
        if (!chip) return { ...prev, nodes };

        if (hub && chip.parentId !== hub.id) {
          // DOCK: reparent the grabbed piece — and on a stack move, the whole
          // welded unit (chips must come after their parent in the array).
          const docking = nodes.filter(
            (n) => unitIds.has(n.id) && n.parentId !== hub.id
          );
          const oldHubs = new Set(
            docking.map((n) => n.parentId).filter(Boolean) as string[]
          );
          nodes = nodes.filter((n) => !unitIds.has(n.id) || n.parentId === hub.id);
          for (const d of docking)
            nodes.push({ ...d, parentId: hub.id, position: { x: 0, y: 0 } });
          nodes = retile(nodes, hub.id);
          for (const oh of oldHubs) nodes = retile(nodes, oh);
          // The BOX is now these pieces' plug — cut their old private wires
          // so "in the box" and "wired" can never disagree.
          edges = edges.filter((e) => !unitIds.has(e.source));
        } else if (!hub && chip.parentId) {
          // UNDOCK: back to absolute coordinates where it was dropped.
          const parent = nodes.find((n) => n.id === chip.parentId);
          const abs = parent
            ? {
                x: parent.position.x + node.position.x,
                y: parent.position.y + node.position.y
              }
            : node.position;
          const oldHub = chip.parentId;
          nodes = nodes.map((n) =>
            n.id === chip.id
              ? { ...n, parentId: undefined, position: abs }
              : n
          );
          nodes = retile(nodes, oldHub);
        } else if (hub) {
          // Released INSIDE its own box: a piece is never half-in/half-out —
          // it settles straight back into the tray's grid.
          nodes = retile(nodes, hub.id);
        }

        // Puzzle docking: the dragged piece (or whole unit) dropped near a
        // free chip of the SAME type clicks into place above/below it — the
        // unit shifts rigidly, and only if every member's landing is clear.
        const moved = nodes.find((n) => n.id === node.id);
        if (!hub && moved && !moved.parentId) {
          const t = mediaTypeOf(node);
          const members = nodes.filter(
            (n) => unitIds.has(n.id) && !n.parentId
          );
          let best: { dx: number; dy: number; d: number } | null = null;
          for (const o of nodes) {
            if (unitIds.has(o.id) || o.type !== 'chip' || o.parentId) continue;
            if (media.find((m) => m.id === o.data.mediaId)?.type !== t) continue;
            for (const slot of [
              { x: o.position.x, y: o.position.y + STACK_PITCH },
              { x: o.position.x, y: o.position.y - STACK_PITCH }
            ]) {
              const dx = slot.x - moved.position.x;
              const dy = slot.y - moved.position.y;
              const collides = members.some((mem) =>
                nodes.some(
                  (n) =>
                    n.type === 'chip' &&
                    !n.parentId &&
                    !unitIds.has(n.id) &&
                    Math.abs(n.position.x - (mem.position.x + dx)) < 6 &&
                    Math.abs(n.position.y - (mem.position.y + dy)) < 6
                )
              );
              if (collides) continue;
              const d = Math.hypot(dx, dy);
              if (d < STACK_SNAP && (!best || d < best.d)) best = { dx, dy, d };
            }
          }
          if (best && best.d > 0.5) {
            const { dx, dy } = best;
            playSnap(); // wooden clack — the weld is audible
            // Settle bounce: the whole unit jiggles once as one mass.
            nodes = nodes.map((n) =>
              unitIds.has(n.id) && !n.parentId
                ? {
                    ...n,
                    position: {
                      x: n.position.x + dx,
                      y: n.position.y + dy
                    },
                    data: {
                      ...n.data,
                      settle: ((n.data.settle as number) ?? 0) + 1
                    }
                  }
                : n
            );
          } else {
            // MAGNET REPULSION: a free piece is either IN a box or CLEAR of
            // every box — never touching one. If the dropped unit's rect
            // grazes any tray (plus a halo), push it out along the axis of
            // least penetration, like same-pole magnets.
            const HALO = 14;
            const trays = nodes
              .filter((n) => n.type === 'hub')
              .map((h) => {
                const sz =
                  h.data.mediaType === 'everything'
                    ? { width: 230, height: 86 }
                    : hubSize(
                        nodes.filter((c) => c.parentId === h.id).length
                      );
                return {
                  x: h.position.x - HALO,
                  y: h.position.y - HALO,
                  w: sz.width + HALO * 2,
                  h: sz.height + HALO * 2
                };
              });
            const unit = nodes.filter((n) => unitIds.has(n.id) && !n.parentId);
            if (unit.length && trays.length) {
              const minX = Math.min(...unit.map((m) => m.position.x));
              const minY = Math.min(...unit.map((m) => m.position.y));
              const maxX = Math.max(...unit.map((m) => m.position.x + CHIP_W));
              const maxY = Math.max(
                ...unit.map((m) => m.position.y + CHIP_H + CHIP_TAB)
              );
              let dx = 0;
              let dy = 0;
              for (let pass = 0; pass < 3; pass++) {
                let pushed = false;
                for (const r of trays) {
                  const ox =
                    Math.min(maxX + dx, r.x + r.w) - Math.max(minX + dx, r.x);
                  const oy =
                    Math.min(maxY + dy, r.y + r.h) - Math.max(minY + dy, r.y);
                  if (ox <= 0 || oy <= 0) continue; // already clear
                  if (ox < oy) {
                    dx +=
                      (minX + maxX) / 2 + dx < r.x + r.w / 2 ? -ox : ox;
                  } else {
                    dy +=
                      (minY + maxY) / 2 + dy < r.y + r.h / 2 ? -oy : oy;
                  }
                  pushed = true;
                }
                if (!pushed) break;
              }
              if (dx || dy) {
                nodes = nodes.map((n) =>
                  unitIds.has(n.id) && !n.parentId
                    ? {
                        ...n,
                        position: {
                          x: n.position.x + dx,
                          y: n.position.y + dy
                        }
                      }
                    : n
                );
              }
            }
          }
        }
        return { ...prev, nodes, edges };
      }), 0);
    },
    [hitHub, hitCluster, setBoard, media, mediaTypeOf]
  );

  /** Double-click a module to zoom the viewport straight to it. Ignores
   *  double-clicks on interactive bits (composer, buttons) so text-select
   *  and typing still work. */
  const onNodeDoubleClick = useCallback(
    (e: React.MouseEvent, node: Node) => {
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, button, a, [role="checkbox"]')) return;
      fitView({
        nodes: [{ id: node.id }],
        duration: 450,
        padding: 0.22,
        maxZoom: 1.4
      });
    },
    [fitView]
  );

  // ---- toolbar actions ----
  const centerPos = useCallback(() => {
    const el = wrapRef.current;
    const rect = el?.getBoundingClientRect();
    const pt = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: 500, y: 300 };
    const pos = screenToFlowPosition(pt);
    // Slight scatter so repeated adds don't stack exactly.
    return {
      x: pos.x - CHIP_W / 2 + (Math.random() - 0.5) * 60,
      y: pos.y - CHIP_H / 2 + (Math.random() - 0.5) * 60
    };
  }, [screenToFlowPosition]);

  const pushNode = useCallback(
    (node: BoardNode) =>
      setBoard((prev) => ({ ...prev, nodes: [...prev.nodes, node] })),
    [setBoard]
  );

  // Ants march ONLY while a brain is thinking — and only on ITS edges.
  // Idle canvas = zero animation work (battery + visual calm).
  const liveEdges = useMemo(
    () =>
      (board.edges as Edge[]).map((e) =>
        busyBrains.has(e.target) === !!e.animated
          ? e
          : { ...e, animated: busyBrains.has(e.target) }
      ),
    [board.edges, busyBrains]
  );

  const placedIds = useMemo(
    () =>
      new Set(
        board.nodes
          .filter((n) => n.type === 'chip')
          .map((n) => n.data.mediaId as string)
      ),
    [board.nodes]
  );

  /** Gather every not-yet-placed source into ONE new cluster box so the user
   *  can see all their resources and pick what to wire. */
  const placeAllInBox = useCallback(() => {
    const unplaced = projectMedia.filter((m) => !placedIds.has(m.id));
    if (unplaced.length === 0) return;
    const hubId = nextBoardId('hub');
    const newNodes: BoardNode[] = [
      {
        id: hubId,
        type: 'hub',
        position: centerPos(),
        data: { name: 'All sources', mediaType: 'cluster' },
        ...hubSize(unplaced.length)
      }
    ];
    unplaced.forEach((m, i) =>
      newNodes.push({
        id: nextBoardId('chip'),
        type: 'chip',
        parentId: hubId,
        position: hubSlot(i),
        data: { mediaId: m.id }
      })
    );
    setBoard((prev) => ({ ...prev, nodes: [...prev.nodes, ...newNodes] }));
    setTimeout(
      () => fitView({ nodes: [{ id: hubId }], duration: 450, padding: 0.3 }),
      60
    );
  }, [projectMedia, placedIds, nextBoardId, centerPos, setBoard, fitView]);

  /**
   * Clean Desk: arrange everything into tidy TYPE ZONES — left→right columns
   * that follow the flow of work: Boxes → loose Pieces → Notes → Brains. Each
   * column stacks its blocks vertically, top-aligned, evenly gapped. Welded
   * stacks move as one rigid block; hubs carry their docked chips for free.
   * Animated with a short ease so it reads as "everything snaps into place".
   */
  const tidying = useRef(false);
  const cleanDesk = useCallback(() => {
    if (tidying.current) return;
    const nodes = board.nodes;
    const typeOf = (n: BoardNode) =>
      media.find((m) => m.id === n.data.mediaId)?.type;

    interface Block {
      ids: string[];
      w: number;
      h: number;
      col: number; // which zone
      offs: { id: string; dx: number; dy: number }[]; // member offset from block origin
    }
    const ZONE = { hub: 0, chip: 1, note: 2, brain: 3 } as const;
    const used = new Set<string>();
    const blocks: Block[] = [];

    for (const n of nodes) {
      if (n.parentId || used.has(n.id)) continue;
      if (n.type === 'chip') {
        const members = stackOf(n, nodes, typeOf);
        members.forEach((m) => used.add(m.id));
        const minX = Math.min(...members.map((m) => m.position.x));
        const minY = Math.min(...members.map((m) => m.position.y));
        blocks.push({
          ids: members.map((m) => m.id),
          w: CHIP_W,
          h: members.length * STACK_PITCH + CHIP_TAB,
          col: ZONE.chip,
          offs: members.map((m) => ({
            id: m.id,
            dx: m.position.x - minX,
            dy: m.position.y - minY
          }))
        });
      } else {
        used.add(n.id);
        const col =
          n.type === 'hub'
            ? ZONE.hub
            : n.type === 'brain'
            ? ZONE.brain
            : ZONE.note; // textNode, annotation, mindmap
        let w = (n.width as number) ?? 240;
        let h = (n.height as number) ?? 150;
        if (n.type === 'hub') {
          const sz = hubSize(nodes.filter((c) => c.parentId === n.id).length);
          w = sz.width;
          h = sz.height;
        }
        blocks.push({ ids: [n.id], w, h, col, offs: [{ id: n.id, dx: 0, dy: 0 }] });
      }
    }
    if (blocks.length < 2) return;

    // Column geometry: each zone's x is the running sum of prior zones' widest
    // block + a gap. Within a zone, blocks stack top-down with a row gap.
    const COL_GAP = 90;
    const ROW_GAP = 34;
    const TOP = 80;
    const byCol = [0, 1, 2, 3].map((c) => blocks.filter((b) => b.col === c));
    const colWidth = byCol.map((bs) =>
      bs.length ? Math.max(...bs.map((b) => b.w)) : 0
    );
    const colX: number[] = [];
    let runX = 80;
    for (let c = 0; c < 4; c++) {
      colX[c] = runX;
      if (colWidth[c] > 0) runX += colWidth[c] + COL_GAP;
    }

    // Target origin (top-left) per block, centered within its column.
    const target = new Map<string, { x: number; y: number }>();
    for (let c = 0; c < 4; c++) {
      let y = TOP;
      for (const b of byCol[c]) {
        const x = colX[c] + (colWidth[c] - b.w) / 2;
        for (const o of b.offs) target.set(o.id, { x: x + o.dx, y: y + o.dy });
        y += b.h + ROW_GAP;
      }
    }

    // Animate from current → target with an ease, then re-frame.
    tidying.current = true;
    const start = new Map<string, { x: number; y: number }>();
    for (const n of nodes)
      if (target.has(n.id)) start.set(n.id, { ...n.position });
    const TOTAL = 26;
    let frame = 0;
    const tick = () => {
      frame++;
      const t = frame / TOTAL;
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setBoard((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          const s = start.get(n.id);
          const tg = target.get(n.id);
          if (!s || !tg) return n;
          return {
            ...n,
            position: {
              x: s.x + (tg.x - s.x) * e,
              y: s.y + (tg.y - s.y) * e
            }
          };
        })
      }));
      if (frame < TOTAL) requestAnimationFrame(tick);
      else {
        tidying.current = false;
        playSnap();
        fitView({ duration: 500, padding: 0.18 });
      }
    };
    requestAnimationFrame(tick);
  }, [board, media, setBoard, fitView]);

  // Cursor spotlight: a faint radial light that follows the pointer, painted
  // BEHIND the dot grid (ReactFlow's pane is transparent). Direct style
  // mutation — no React re-render per mousemove.
  const spotRef = useRef<HTMLDivElement>(null);
  const onSpotMove = useCallback((e: React.PointerEvent) => {
    const el = spotRef.current;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!el || !rect) return;
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full"
      onPointerMove={onSpotMove}
    >
      <div
        ref={spotRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(560px circle at var(--spot-x, 50%) var(--spot-y, 40%), hsl(var(--accent) / 0.06), transparent 70%)'
        }}
      />
      <ReactFlow
        nodes={board.nodes as Node[]}
        edges={liveEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        zoomOnDoubleClick={false}
        // Gesture contract: plain drag on a node MOVES it; plain drag on the
        // canvas PANS; the rubber-band multi-select box appears ONLY while
        // holding Shift. Dragging never auto-selects (no surprise group box).
        panOnDrag
        selectionOnDrag={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        selectNodesOnDrag={false}
        defaultEdgeOptions={{
          type: 'scope',
          // Resting wires: substantial, semi-transparent curves that read as
          // physical data cables. The dashes are reserved for the in-progress
          // connection line; flowing light pulses appear only while a brain is
          // thinking (scope-edge.tsx).
          style: {
            stroke: 'hsl(var(--accent) / 0.45)',
            strokeWidth: 2.5
          }
        }}
        connectionLineStyle={{
          stroke: 'hsl(var(--accent) / 0.6)',
          strokeWidth: 1.6,
          strokeDasharray: '6 6'
        }}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.4}
          color="rgb(var(--hairline) / 0.16)"
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          className="!rounded-[14px] !border-none !bg-card !shadow-[0_2px_8px_rgb(0_0_0/0.08)]"
        />
      </ReactFlow>

      <BoardToolbar
        placedIds={placedIds}
        onCleanDesk={cleanDesk}
        onPlaceAllInBox={placeAllInBox}
        onPlaceMedia={(mediaId) =>
          pushNode({
            id: nextBoardId('chip'),
            type: 'chip',
            position: centerPos(),
            data: { mediaId }
          })
        }
        onNewSource={(type, name, source) => {
          // Optimistic chip now; real status when the Indexing webhook
          // (Gemini embed → Pinecone upsert) answers. v1 embeds the given
          // text/URL as-is — transcript/crawl extraction is Scenario A v2.
          const id = addMedia(
            {
              type,
              name,
              description: '',
              date: new Date().toISOString().slice(0, 10),
              content: source || name,
              source: source || undefined
            },
            { simulate: false }
          );
          pushNode({
            id: nextBoardId('chip'),
            type: 'chip',
            position: centerPos(),
            data: { mediaId: id }
          });
          fetch('/api/index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: id,
              name,
              type,
              text: source ? `${name}\n${source}` : name
            })
          })
            .then((r) => {
              if (!r.ok) throw new Error();
              updateMedia(id, { status: 'indexed' });
            })
            .catch(() => updateMedia(id, { status: 'failed' }));
        }}
        onAddBrain={() => {
          // Up to 5 brains per board — one per subject/angle in a project.
          const brainCount = board.nodes.filter((n) => n.type === 'brain').length;
          if (brainCount >= 5) {
            window.alert('You can have up to 5 brains on a board.');
            return;
          }
          pushNode({
            id: nextBoardId('brain'),
            type: 'brain',
            position: centerPos(),
            width: 400,
            height: 480,
            data: { name: `Brain ${brainCount + 1}` }
          });
        }}
        onAddText={() =>
          pushNode({
            id: nextBoardId('text'),
            type: 'textNode',
            position: centerPos(),
            width: 234,
            height: 132,
            data: { text: '' }
          })
        }
        onAddPrompt={(text) =>
          pushNode({
            id: nextBoardId('prompt'),
            type: 'prompt',
            position: centerPos(),
            width: CHIP_W,
            height: CHIP_H + CHIP_TAB,
            data: { text }
          })
        }
        onAddAnnotation={() =>
          pushNode({
            id: nextBoardId('ann'),
            type: 'annotation',
            position: centerPos(),
            width: 240,
            height: 150,
            data: { text: '', color: 'amber' }
          })
        }
        onAddMindmap={() =>
          pushNode({
            id: nextBoardId('mm'),
            type: 'mindmap',
            position: centerPos(),
            width: 280,
            height: 200,
            data: {
              tree: { id: 'root', text: 'Main Topic', children: [] }
            }
          })
        }
        onAddHub={(name) =>
          pushNode({
            id: nextBoardId('hub'),
            type: 'hub',
            position: centerPos(),
            data: { name, mediaType: 'cluster' }
          })
        }
        onAddEverything={() =>
          pushNode({
            id: nextBoardId('hub'),
            type: 'hub',
            position: centerPos(),
            data: { name: 'Everything', mediaType: 'everything' }
          })
        }
        onNewRecording={(name, transcript) => {
          // Voice memo → indexed source: transcript IS the embedded text.
          const id = addMedia(
            {
              type: 'audio',
              name,
              description: 'Voice memo (MAI-Transcribe)',
              date: new Date().toISOString().slice(0, 10),
              content: transcript
            },
            { simulate: false }
          );
          pushNode({
            id: nextBoardId('chip'),
            type: 'chip',
            position: centerPos(),
            data: { mediaId: id }
          });
          fetch('/api/index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: id,
              name,
              type: 'audio',
              text: transcript
            })
          })
            .then((r) => {
              if (!r.ok) throw new Error();
              updateMedia(id, { status: 'indexed' });
            })
            .catch(() => updateMedia(id, { status: 'failed' }));
        }}
      />
    </div>
  );
}

export function BoardCanvas() {
  return (
    <ReactFlowProvider>
      <BoardCanvasInner />
    </ReactFlowProvider>
  );
}
