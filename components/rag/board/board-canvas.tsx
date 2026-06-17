'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
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
import {
  ArrowUpToLine,
  ArrowDownToLine,
  Copy,
  Unplug,
  Trash2
} from 'lucide-react';

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
  STACK_SNAP
} from '@/lib/rag/board/types';
import { playSnap } from '@/lib/rag/board/sound';
import { cn } from '@/lib/utils';
import { ChipNode } from './chip-node';
import { HubNode } from './hub-node';
import { BrainNode } from './brain-node';
import { TextNode } from './text-node';
import { PromptNode } from './prompt-node';
import { AnnotationNode } from './annotation-node';
import { MindmapNode } from './mindmap-node';
import { ScopeEdge } from './scope-edge';
import { BoardToolbar } from './toolbar';
import { BoardChest, CHEST_MIME } from './board-chest';

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
/** Node types the right-click menu can duplicate (content artifacts — chips
 *  are one-per-source, hubs/brains aren't sensibly cloned). */
const DUPLICABLE = new Set(['textNode', 'prompt', 'annotation', 'mindmap']);
/** New-id prefix per duplicable node type. */
const DUP_PREFIX: Record<string, string> = {
  textNode: 'text',
  prompt: 'prompt',
  annotation: 'ann',
  mindmap: 'mm'
};
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
  const { board, setBoard, setBoardSilent, nextBoardId, busyBrains, saveStatus, saveNow, removeBoardNode } =
    useBoard();
  const { media, projectMedia, addMedia, updateMedia, deleteMedia } = useRag();
  // Garbage bin (bottom-left): drag a source chip onto it to delete the source
  // and its Pinecone vectors. `binHot` highlights it while a chip hovers over.
  const binRef = useRef<HTMLButtonElement>(null);
  // The bottom dock's screen bounds — used to bounce a dropped node up so it
  // can never come to rest hidden behind the dock.
  const dockRef = useRef<HTMLDivElement>(null);
  const [binHot, setBinHot] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Right-click context menu (Make-style): anchored at the cursor, acts on the
  // node it was opened over.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(
    null
  );
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
    (changes: NodeChange[]) => {
      // Only a genuine edit (drag/add/remove) marks the project touched; mount
      // measurement ('dimensions') + selection must NOT, or they'd block the
      // saved-board load on refresh.
      const userEdit = changes.some(
        (c) =>
          c.type === 'position' ||
          c.type === 'add' ||
          c.type === 'remove' ||
          c.type === 'replace'
      );
      (userEdit ? setBoard : setBoardSilent)((prev) => ({
        ...prev,
        nodes: applyNodeChanges(changes, prev.nodes as Node[]) as BoardNode[]
      }));
    },
    [setBoard, setBoardSilent]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const userEdit = changes.some(
        (c) => c.type === 'add' || c.type === 'remove' || c.type === 'replace'
      );
      (userEdit ? setBoard : setBoardSilent)((prev) => ({
        ...prev,
        edges: applyEdgeChanges(changes, prev.edges as Edge[])
      }));
    },
    [setBoard, setBoardSilent]
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
   * Sibling-sync drag session. A welded stack ALWAYS moves as ONE unit —
   * dragging any member translates the whole column rigidly. Pieces never
   * disconnect by dragging; the ONLY way to separate is the un-snap (✂) seam
   * button between two pieces. Stacks stay emergent — this only coordinates
   * movement, never the data model.
   */
  const dragSession = useRef<{
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
        startX: self.position.x,
        startY: self.position.y,
        mates: mates.map((m) => ({ id: m.id, x: m.position.x, y: m.position.y }))
      };
    },
    [board.nodes, media]
  );

  /** Magnetic hub glow + stack movement, per drag tick. */
  const onNodeDrag = useCallback(
    (e: unknown, node: Node) => {
      // Highlight the garbage bin when a source chip is dragged over it.
      if (node.type === 'chip' && binRef.current) {
        const me = e as MouseEvent;
        const r = binRef.current.getBoundingClientRect();
        const over =
          me.clientX >= r.left &&
          me.clientX <= r.right &&
          me.clientY >= r.top &&
          me.clientY <= r.bottom;
        setBinHot((prev: boolean) => (prev !== over ? over : prev));
      }
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
        // Rigid translate: the whole welded column follows the lead delta.
        const dx = node.position.x - s.startX;
        const dy = node.position.y - s.startY;
        stackPatch = (nodes) =>
          nodes.map((n) => {
            const mate = s.mates.find((m) => m.id === n.id);
            return mate
              ? { ...n, position: { x: mate.x + dx, y: mate.y + dy } }
              : n;
          });
      }

      // Snap preview: when NOT heading into a hub, find the free same-type
      // piece whose slot the dragged piece is closest to — it highlights to
      // promise "drop here and we'll click together" (like the box glow).
      let snapTargetId: string | null = null;
      if (node.type === 'chip' && !hub) {
        const t = mediaTypeOf(node);
        const mateIds = new Set(s?.mates.map((m) => m.id) ?? []);
        let bestD = STACK_SNAP;
        for (const o of board.nodes) {
          if (
            o.id === node.id ||
            o.type !== 'chip' ||
            o.parentId ||
            mateIds.has(o.id)
          )
            continue;
          if (mediaTypeOf(o as Node) !== t) continue;
          for (const sy of [STACK_PITCH, -STACK_PITCH]) {
            const d = Math.hypot(
              node.position.x - o.position.x,
              node.position.y - (o.position.y + sy)
            );
            if (d < bestD) {
              bestD = d;
              snapTargetId = o.id;
            }
          }
        }
      }

      setBoard((prev) => {
        let nodes = prev.nodes.map((n) => {
          if (n.type === 'hub') {
            const want = n.id === hub?.id;
            return n.data.glow === want ? n : { ...n, data: { ...n.data, glow: want } };
          }
          if (n.type === 'chip') {
            const want = n.id === snapTargetId;
            return !!n.data.snapTarget === want
              ? n
              : { ...n, data: { ...n.data, snapTarget: want } };
          }
          return n;
        });
        if (stackPatch) nodes = stackPatch(nodes);
        return { ...prev, nodes };
      });
    },
    [hitHub, hitCluster, setBoard, board.nodes, mediaTypeOf]
  );

  /** If a just-dropped node came to rest overlapping the bottom dock, bounce it
   *  up (in flow space, pan/zoom aware) so it's never trapped behind the dock. */
  const clearDock = useCallback(
    (nodeId: string) => {
      const dock = dockRef.current;
      const el = document.querySelector(
        `.react-flow__node[data-id="${nodeId}"]`
      ) as HTMLElement | null;
      if (!dock || !el) return;
      const nr = el.getBoundingClientRect();
      const dr = dock.getBoundingClientRect();
      const GAP = 14;
      if (nr.right < dr.left || nr.left > dr.right) return; // no horizontal overlap
      const overlapPx = nr.bottom + GAP - dr.top; // intrusion past the dock's top
      if (overlapPx <= 0) return;
      const a = screenToFlowPosition({ x: nr.left, y: nr.top });
      const b = screenToFlowPosition({ x: nr.left, y: nr.top - overlapPx });
      const dy = a.y - b.y;
      if (dy <= 0) return;
      setBoard((prev) => {
        const self = prev.nodes.find((n) => n.id === nodeId);
        if (!self || self.parentId) return prev; // docked pieces aren't loose
        // Lift the whole welded unit together so a stack doesn't split.
        const typeOf = (n: BoardNode) =>
          media.find((m) => m.id === n.data.mediaId)?.type;
        const unitIds = new Set(
          (self.type === 'chip' ? stackOf(self, prev.nodes, typeOf) : [self]).map(
            (n) => n.id
          )
        );
        return {
          ...prev,
          nodes: prev.nodes.map((n) =>
            unitIds.has(n.id)
              ? { ...n, position: { x: n.position.x, y: n.position.y - dy } }
              : n
          )
        };
      });
    },
    [screenToFlowPosition, setBoard, media]
  );

  /** Dock / undock / snap on drop — stack-aware (the unit lands together). */
  const onNodeDragStop = useCallback(
    (e: unknown, node: Node) => {
      const s = dragSession.current;
      dragSession.current = null;

      // Garbage bin: a source chip dropped on the bin → delete the source AND
      // its Pinecone vectors (via deleteMedia → /api/delete-source).
      if (node.type === 'chip' && binRef.current) {
        const me = e as MouseEvent;
        const r = binRef.current.getBoundingClientRect();
        if (
          me.clientX >= r.left &&
          me.clientX <= r.right &&
          me.clientY >= r.top &&
          me.clientY <= r.bottom
        ) {
          setBinHot(false);
          const mediaId = node.data?.mediaId as string | undefined;
          const item = mediaId ? media.find((m) => m.id === mediaId) : undefined;
          if (
            mediaId &&
            window.confirm(
              `Delete "${item?.name ?? mediaId}" permanently? This removes it from your knowledge base and Pinecone. This cannot be undone.`
            )
          ) {
            recallMedia(mediaId);
            deleteMedia(mediaId);
          }
          return;
        }
      }
      setBinHot(false);

      // Once the drop settles, bounce the node up if it landed behind the dock
      // (covers brains, notes, and chips — all share the same dock no-go zone).
      setTimeout(() => clearDock(node.id), 60);

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
      // The set of pieces travelling together this gesture (the whole stack).
      const unitIds = s
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
          if (n.type === 'chip' && n.data.snapTarget)
            out = { ...out, data: { ...out.data, snapTarget: false } };
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
    [hitHub, hitCluster, setBoard, media, mediaTypeOf, clearDock]
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

  // Drag a chest item onto the canvas → drop it as a piece at the cursor.
  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(CHEST_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(CHEST_MIME);
      if (!raw) return;
      e.preventDefault();
      let payload: { kind: string; id?: string; text?: string };
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (payload.kind === 'media' && payload.id) {
        // One copy of a source per board — refuse a duplicate drop.
        const exists = board.nodes.some(
          (n) => n.type === 'chip' && n.data.mediaId === payload.id
        );
        if (exists) return;
        pushNode({
          id: nextBoardId('chip'),
          type: 'chip',
          position: { x: pos.x - CHIP_W / 2, y: pos.y - CHIP_H / 2 },
          data: { mediaId: payload.id }
        });
      } else if (payload.kind === 'prompt') {
        pushNode({
          id: nextBoardId('prompt'),
          type: 'prompt',
          position: {
            x: pos.x - CHIP_W / 2,
            y: pos.y - (CHIP_H + CHIP_TAB) / 2
          },
          width: CHIP_W,
          height: CHIP_H + CHIP_TAB,
          data: { text: payload.text ?? '' }
        });
      }
    },
    [screenToFlowPosition, pushNode, nextBoardId, board.nodes]
  );

  /** Recall: pull every copy of a source off the board (and out of any box),
   *  returning it to "available" in the Chest. */
  const recallMedia = useCallback(
    (mediaId: string) => {
      setBoard((prev) => {
        const removeIds = new Set(
          prev.nodes
            .filter((n) => n.type === 'chip' && n.data.mediaId === mediaId)
            .map((n) => n.id)
        );
        if (!removeIds.size) return prev;
        const hubs = new Set(
          prev.nodes
            .filter((n) => removeIds.has(n.id) && n.parentId)
            .map((n) => n.parentId as string)
        );
        let nodes = prev.nodes.filter((n) => !removeIds.has(n.id));
        for (const h of hubs) nodes = retile(nodes, h);
        const edges = prev.edges.filter((e) => !removeIds.has(e.source));
        return { ...prev, nodes, edges };
      });
    },
    [setBoard]
  );

  // Delete one node by id. A source chip → delete the source + its Pinecone
  // vectors (confirmed); anything else → remove the node from the board.
  const deleteNodeById = useCallback(
    (nodeId: string) => {
      const node = board.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (node.type === 'chip') {
        const mediaId = node.data?.mediaId as string | undefined;
        const item = mediaId ? media.find((m) => m.id === mediaId) : undefined;
        if (
          mediaId &&
          window.confirm(
            `Delete "${item?.name ?? mediaId}" permanently? This removes it from your knowledge base and Pinecone. This cannot be undone.`
          )
        ) {
          recallMedia(mediaId);
          deleteMedia(mediaId);
        }
      } else if (window.confirm('Delete this from the board?')) {
        removeBoardNode(nodeId);
      }
    },
    [board.nodes, media, recallMedia, deleteMedia, removeBoardNode]
  );

  // Garbage-bin click: delete the currently-selected node (or hint how to use it).
  const onDeleteSelected = useCallback(() => {
    if (!selectedNodeId) {
      window.alert(
        'Select a node first (click it), then click the bin — or drag a source chip onto the bin.'
      );
      return;
    }
    deleteNodeById(selectedNodeId);
    setSelectedNodeId(null);
  }, [selectedNodeId, deleteNodeById]);

  // ---- right-click context-menu actions ----
  /** Z-order: move a node (with its docked children, so parent-before-child
   *  holds) to the array's end (front = on top) or start (back). */
  const reorderNode = useCallback(
    (nodeId: string, dir: 'front' | 'back') => {
      setBoard((prev) => {
        if (!prev.nodes.some((n) => n.id === nodeId)) return prev;
        const groupIds = new Set([
          nodeId,
          ...prev.nodes.filter((n) => n.parentId === nodeId).map((n) => n.id)
        ]);
        const group = prev.nodes.filter((n) => groupIds.has(n.id));
        const rest = prev.nodes.filter((n) => !groupIds.has(n.id));
        return {
          ...prev,
          nodes: dir === 'front' ? [...rest, ...group] : [...group, ...rest]
        };
      });
    },
    [setBoard]
  );

  /** Clone a content artifact (note/prompt/annotation/mindmap) onto the canvas,
   *  offset from the original and detached from any box. */
  const duplicateNode = useCallback(
    (nodeId: string) => {
      setBoard((prev) => {
        const n = prev.nodes.find((x) => x.id === nodeId);
        if (!n || !DUPLICABLE.has(n.type!)) return prev;
        const copy: BoardNode = {
          ...n,
          id: nextBoardId(DUP_PREFIX[n.type!] ?? 'node'),
          parentId: undefined,
          position: { x: n.position.x + 28, y: n.position.y + 28 },
          data: JSON.parse(JSON.stringify(n.data ?? {}))
        };
        return { ...prev, nodes: [...prev.nodes, copy] };
      });
    },
    [setBoard, nextBoardId]
  );

  /** Cut every wire touching a node (as a source or into a brain). */
  const disconnectNode = useCallback(
    (nodeId: string) => {
      setBoard((prev) => ({
        ...prev,
        edges: prev.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        )
      }));
    },
    [setBoard]
  );

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  }, []);

  const ctxNode = ctxMenu
    ? board.nodes.find((n) => n.id === ctxMenu.nodeId)
    : null;
  const ctxHasEdges = ctxNode
    ? board.edges.some((e) => e.source === ctxNode.id || e.target === ctxNode.id)
    : false;

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
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
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

      {/* Save + garbage bin live in the bottom-middle dock (BoardChest). */}
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
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setCtxMenu(null)}
        onMoveStart={() => setCtxMenu(null)}
        onSelectionChange={({ nodes }) =>
          setSelectedNodeId(nodes.length === 1 ? nodes[0].id : null)
        }
        zoomOnDoubleClick={false}
        // Gesture contract: plain drag on a node MOVES it; plain drag on the
        // canvas PANS; the rubber-band multi-select box appears ONLY while
        // holding Shift. Dragging never auto-selects (no surprise group box).
        panOnDrag
        selectionOnDrag={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        selectNodesOnDrag={false}
        // Don't pan the canvas when a node is dragged to the edge — it makes
        // the other (wired) pieces appear to scroll away.
        autoPanOnNodeDrag={false}
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
        // `isolate` gives the canvas its OWN stacking context, so a node's high
        // drag/select z-index can't escape and paint over the bottom dock or
        // toolbar (which sit at z-20+ as siblings above this isolated block).
        className="isolate bg-transparent"
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
        onNewImage={(name, file) => {
          // Real image upload: optimistic chip now; the route hosts the bytes on
          // Blob and hands the pixel-embed + caption to the Make Image scenario.
          const id = addMedia(
            {
              type: 'image',
              name,
              description: '',
              date: new Date().toISOString().slice(0, 10),
              content: name
            },
            { simulate: false }
          );
          pushNode({
            id: nextBoardId('chip'),
            type: 'chip',
            position: centerPos(),
            data: { mediaId: id }
          });
          const fd = new FormData();
          fd.append('file', file);
          fd.append('name', name);
          fd.append('source_id', id);
          fetch('/api/index-image', { method: 'POST', body: fd })
            .then(async (r) => {
              const j = await r.json().catch(() => ({}));
              if (!r.ok || !j.ok) throw new Error(j?.error ?? 'upload failed');
              updateMedia(id, {
                status: j.indexed ? 'indexed' : 'processing',
                source: j.image_url, // hosted URL → thumbnail + visual search
                content: j.caption || name
              });
              if (!j.indexed && j.note) console.warn('[image-index]', j.note);
            })
            .catch(() => updateMedia(id, { status: 'failed' }));
        }}
        onNewDocument={(name, file) => {
          // PDF/DOCX/TXT: optimistic chip; the route extracts text → chunk +
          // index via the SAME text pipeline (embedding in Make).
          const id = addMedia(
            {
              type: 'document',
              name,
              description: '',
              date: new Date().toISOString().slice(0, 10),
              content: name
            },
            { simulate: false }
          );
          pushNode({
            id: nextBoardId('chip'),
            type: 'chip',
            position: centerPos(),
            data: { mediaId: id }
          });
          const fd = new FormData();
          fd.append('file', file);
          fd.append('name', name);
          fd.append('source_id', id);
          fetch('/api/index-doc', { method: 'POST', body: fd })
            .then(async (r) => {
              const j = await r.json().catch(() => ({}));
              if (!r.ok || !j.ok) throw new Error(j?.error ?? j?.note ?? 'index failed');
              updateMedia(id, {
                status: 'indexed',
                chunks: j.chunks,
                source: j.source_url
              });
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

      {/* the CHEST — bottom dock of all produced media + prompts, drag onto
          the canvas as puzzle pieces */}
      <BoardChest
        placedIds={placedIds}
        saveStatus={saveStatus}
        onSave={saveNow}
        binRef={binRef}
        binHot={binHot}
        dockRef={dockRef}
        onDeleteSelected={onDeleteSelected}
        onRecallMedia={recallMedia}
        onPlaceMedia={(mediaId) => {
          if (placedIds.has(mediaId)) return; // no duplicate sources
          pushNode({
            id: nextBoardId('chip'),
            type: 'chip',
            position: centerPos(),
            data: { mediaId }
          });
        }}
        onPlacePrompt={(text) =>
          pushNode({
            id: nextBoardId('prompt'),
            type: 'prompt',
            position: centerPos(),
            width: CHIP_W,
            height: CHIP_H + CHIP_TAB,
            data: { text }
          })
        }
      />

      {/* Right-click context menu — Make-style per-node actions. */}
      {ctxMenu && ctxNode && (
        <>
          {/* click / right-click anywhere away closes it */}
          <div
            className="fixed inset-0 z-[55]"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="fixed z-[60] w-52 overflow-hidden rounded-xl border border-[rgb(var(--hairline)/0.16)] bg-card p-1 text-[13px] shadow-[0_10px_34px_-6px_rgb(0_0_0/0.32)]"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 220),
              top: Math.min(ctxMenu.y, window.innerHeight - 250)
            }}
          >
            <button
              onClick={() => {
                reorderNode(ctxMenu.nodeId, 'front');
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent/10"
            >
              <ArrowUpToLine className="h-4 w-4 text-foreground/70" /> Bring to front
            </button>
            <button
              onClick={() => {
                reorderNode(ctxMenu.nodeId, 'back');
                setCtxMenu(null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent/10"
            >
              <ArrowDownToLine className="h-4 w-4 text-foreground/70" /> Send to back
            </button>
            {DUPLICABLE.has(ctxNode.type!) && (
              <button
                onClick={() => {
                  duplicateNode(ctxMenu.nodeId);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent/10"
              >
                <Copy className="h-4 w-4 text-foreground/70" /> Duplicate
              </button>
            )}
            {ctxHasEdges && (
              <button
                onClick={() => {
                  disconnectNode(ctxMenu.nodeId);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent/10"
              >
                <Unplug className="h-4 w-4 text-foreground/70" /> Disconnect wires
              </button>
            )}
            <div className="my-1 h-px bg-[rgb(var(--hairline)/0.12)]" />
            <button
              onClick={() => {
                const id = ctxMenu.nodeId;
                setCtxMenu(null);
                deleteNodeById(id);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-red-600 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </>
      )}
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
