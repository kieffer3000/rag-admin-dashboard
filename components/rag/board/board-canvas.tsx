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
  stackOf,
  CHIP_W,
  CHIP_H,
  STACK_PITCH,
  STACK_SNAP,
  PEEL_BREAK,
  STACK_GRAB
} from '@/lib/rag/board/types';
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

  /** The matching-type hub currently under a dragged chip, if any. */
  const hitHub = useCallback(
    (chip: Node): Node | undefined => {
      const t = mediaTypeOf(chip);
      return getIntersectingNodes(chip).find(
        (n) => n.type === 'hub' && n.data.mediaType === t
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

      setBoard((prev) => {
        let nodes = prev.nodes.map((n) => {
          let out = n;
          if (n.type === 'hub' && n.data.glow)
            out = { ...out, data: { ...out.data, glow: false } };
          if (n.type === 'chip' && (n.data.tug || n.data.peel))
            out = { ...out, data: { ...out.data, tug: false, peel: false } };
          return out;
        });
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
          }
        }
        return { ...prev, nodes };
      });
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
        defaultEdgeOptions={{
          type: 'scope',
          // Resting wires: smooth, semi-transparent curves. The dashes are
          // reserved for the in-progress connection line; flowing light
          // pulses appear only while a brain is thinking (scope-edge.tsx).
          style: {
            stroke: 'hsl(var(--accent) / 0.38)',
            strokeWidth: 1.6
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
        onAddHub={(name, type) =>
          pushNode({
            id: nextBoardId('hub'),
            type: 'hub',
            position: centerPos(),
            data: { name, mediaType: type }
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
