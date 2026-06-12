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
import { AnnotationNode } from './annotation-node';
import { MindmapNode } from './mindmap-node';
import { ScopeEdge } from './scope-edge';
import { BoardToolbar } from './toolbar';

const nodeTypes = {
  chip: ChipNode,
  hub: HubNode,
  brain: BrainNode,
  textNode: TextNode,
  annotation: AnnotationNode,
  mindmap: MindmapNode
};

const edgeTypes = { scope: ScopeEdge };

const SOURCE_TYPES = new Set(['chip', 'hub', 'textNode']);

/** Re-tile a hub's docked chips into the compact 2-col grid. */
function retile(nodes: BoardNode[], hubId: string): BoardNode[] {
  let i = 0;
  return nodes.map((n) =>
    n.type === 'chip' && n.parentId === hubId
      ? { ...n, position: hubSlot(i++) }
      : n
  );
}

function BoardCanvasInner() {
  const { board, setBoard, nextBoardId, busyBrains } = useBoard();
  const { media, addMedia, updateMedia } = useRag();
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
    [hitHub, setBoard]
  );

  /** Dock / undock / snap on drop — stack-aware (the unit lands together). */
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const s = dragSession.current;
      dragSession.current = null;
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
    [hitHub, setBoard, media, mediaTypeOf]
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

  /**
   * Clean Desk: a brief force-directed relaxation that untangles the board —
   * bodies repel where they crowd, wires pull toward a comfortable length,
   * and everything drifts back toward the original centroid. RIGID BODIES:
   * a puzzle stack moves as one mass (members keep exact pitch, welds never
   * break) and hubs carry their docked chips for free (parent coords).
   * Runs live over ~70 rAF frames so it reads as physics, then re-frames.
   */
  const tidying = useRef(false);
  const cleanDesk = useCallback(() => {
    if (tidying.current) return;
    const nodes = board.nodes;
    const typeOf = (n: BoardNode) =>
      media.find((m) => m.id === n.data.mediaId)?.type;
    const FALLBACK: Record<string, [number, number]> = {
      brain: [400, 480],
      textNode: [240, 140],
      annotation: [220, 60],
      mindmap: [280, 200]
    };

    interface Body {
      ids: string[];
      x: number;
      y: number;
      w: number;
      h: number;
      vx: number;
      vy: number;
      offs: { id: string; dx: number; dy: number }[];
    }
    const used = new Set<string>();
    const bodies: Body[] = [];
    for (const n of nodes) {
      if (n.parentId || used.has(n.id)) continue;
      if (n.type === 'chip') {
        const members = stackOf(n, nodes, typeOf);
        members.forEach((m) => used.add(m.id));
        const minY = Math.min(...members.map((m) => m.position.y));
        bodies.push({
          ids: members.map((m) => m.id),
          x: n.position.x,
          y: minY,
          w: CHIP_W,
          h: members.length * STACK_PITCH + CHIP_TAB,
          vx: 0,
          vy: 0,
          offs: members.map((m) => ({
            id: m.id,
            dx: m.position.x - n.position.x,
            dy: m.position.y - minY
          }))
        });
      } else {
        used.add(n.id);
        let w = (n.width as number) ?? FALLBACK[n.type!]?.[0] ?? 240;
        let h = (n.height as number) ?? FALLBACK[n.type!]?.[1] ?? 140;
        if (n.type === 'hub') {
          const sz = hubSize(nodes.filter((c) => c.parentId === n.id).length);
          w = sz.width;
          h = sz.height;
        }
        bodies.push({
          ids: [n.id],
          x: n.position.x,
          y: n.position.y,
          w,
          h,
          vx: 0,
          vy: 0,
          offs: [{ id: n.id, dx: 0, dy: 0 }]
        });
      }
    }
    if (bodies.length < 2) return;
    tidying.current = true;

    const bodyOf = new Map<string, Body>();
    bodies.forEach((b) => b.ids.forEach((id) => bodyOf.set(id, b)));
    const springs: [Body, Body][] = [];
    for (const e of board.edges) {
      const a = bodyOf.get(e.source);
      const b = bodyOf.get(e.target);
      if (a && b && a !== b) springs.push([a, b]);
    }
    const cx0 =
      bodies.reduce((s, b) => s + b.x + b.w / 2, 0) / bodies.length;
    const cy0 =
      bodies.reduce((s, b) => s + b.y + b.h / 2, 0) / bodies.length;

    const TOTAL = 70;
    const MARGIN = 48;
    const REST = 340;
    let frame = 0;
    const step = () => {
      const temp = 1 - frame / TOTAL; // cooling schedule
      for (const b of bodies) {
        b.vx = 0;
        b.vy = 0;
      }
      // Repulsion: crowded bodies (AABB + margin) push apart.
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          let dx = a.x + a.w / 2 - (b.x + b.w / 2);
          let dy = a.y + a.h / 2 - (b.y + b.h / 2);
          const ox = (a.w + b.w) / 2 + MARGIN - Math.abs(dx);
          const oy = (a.h + b.h) / 2 + MARGIN - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          let len = Math.hypot(dx, dy);
          if (len < 1) {
            // dead-center overlap: split deterministically
            dx = i % 2 ? 1 : -1;
            dy = j % 2 ? 1 : -1;
            len = Math.hypot(dx, dy);
          }
          const push = (Math.min(ox, oy) * 0.5 * temp) / len;
          a.vx += dx * push;
          a.vy += dy * push;
          b.vx -= dx * push;
          b.vy -= dy * push;
        }
      }
      // Springs: each wire pulls its endpoints toward a comfortable length.
      for (const [a, b] of springs) {
        const dx = b.x + b.w / 2 - (a.x + a.w / 2);
        const dy = b.y + b.h / 2 - (a.y + a.h / 2);
        const dist = Math.hypot(dx, dy) || 1;
        const f = ((dist - REST) * 0.04 * temp) / dist;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
      // Gentle gravity toward the original centroid; clamp step size.
      for (const b of bodies) {
        b.vx += (cx0 - (b.x + b.w / 2)) * 0.004 * temp;
        b.vy += (cy0 - (b.y + b.h / 2)) * 0.004 * temp;
        const vmax = 26 * temp + 2;
        b.x += Math.max(-vmax, Math.min(vmax, b.vx));
        b.y += Math.max(-vmax, Math.min(vmax, b.vy));
      }
      const pos = new Map<string, { x: number; y: number }>();
      for (const b of bodies)
        for (const o of b.offs) pos.set(o.id, { x: b.x + o.dx, y: b.y + o.dy });
      setBoard((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n
        )
      }));
      frame++;
      if (frame <= TOTAL) requestAnimationFrame(step);
      else {
        tidying.current = false;
        playSnap(); // everything settles into place
        fitView({ duration: 500, padding: 0.22 });
      }
    };
    requestAnimationFrame(step);
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
        onAddBrain={() =>
          pushNode({
            id: nextBoardId('brain'),
            type: 'brain',
            position: centerPos(),
            width: 400,
            height: 480,
            data: { name: 'answersDoc Brain' }
          })
        }
        onAddText={() =>
          pushNode({
            id: nextBoardId('text'),
            type: 'textNode',
            position: centerPos(),
            data: { text: '' }
          })
        }
        onAddAnnotation={() =>
          pushNode({
            id: nextBoardId('ann'),
            type: 'annotation',
            position: centerPos(),
            data: { text: '' }
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
