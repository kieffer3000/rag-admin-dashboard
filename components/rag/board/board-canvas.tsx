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
  CHIP_W,
  CHIP_H
} from '@/lib/rag/board/types';
import { ChipNode } from './chip-node';
import { HubNode } from './hub-node';
import { BrainNode } from './brain-node';
import { TextNode } from './text-node';
import { AnnotationNode } from './annotation-node';
import { BoardToolbar } from './toolbar';

const nodeTypes = {
  chip: ChipNode,
  hub: HubNode,
  brain: BrainNode,
  textNode: TextNode,
  annotation: AnnotationNode
};

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
  const { board, setBoard, nextBoardId } = useBoard();
  const { media, addMedia, updateMedia } = useRag();
  const { getIntersectingNodes, screenToFlowPosition } = useReactFlow();
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

  /** Magnetic glow while dragging a chip over a compatible hub. */
  const onNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      if (node.type !== 'chip') return;
      const hub = hitHub(node);
      setBoard((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.type === 'hub'
            ? n.data.glow === (n.id === hub?.id)
              ? n
              : { ...n, data: { ...n.data, glow: n.id === hub?.id } }
            : n
        )
      }));
    },
    [hitHub, setBoard]
  );

  /** Dock / undock on drop. */
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (node.type !== 'chip') return;
      const hub = hitHub(node);

      setBoard((prev) => {
        let nodes = prev.nodes.map((n) =>
          n.type === 'hub' && n.data.glow ? { ...n, data: { ...n.data, glow: false } } : n
        );
        const chip = nodes.find((n) => n.id === node.id);
        if (!chip) return { ...prev, nodes };

        if (hub && chip.parentId !== hub.id) {
          // DOCK: reparent (chip must come after its parent in the array),
          // then tile the hub's members compactly.
          const oldHub = chip.parentId;
          nodes = nodes.filter((n) => n.id !== chip.id);
          nodes.push({ ...chip, parentId: hub.id, position: { x: 0, y: 0 } });
          nodes = retile(nodes, hub.id);
          if (oldHub) nodes = retile(nodes, oldHub);
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
        return { ...prev, nodes };
      });
    },
    [hitHub, setBoard]
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

  const placedIds = useMemo(
    () =>
      new Set(
        board.nodes
          .filter((n) => n.type === 'chip')
          .map((n) => n.data.mediaId as string)
      ),
    [board.nodes]
  );

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <ReactFlow
        nodes={board.nodes as Node[]}
        edges={board.edges as Edge[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        defaultEdgeOptions={{
          type: 'default',
          style: {
            stroke: 'hsl(var(--accent) / 0.5)',
            strokeWidth: 1.6,
            strokeDasharray: '6 6'
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
