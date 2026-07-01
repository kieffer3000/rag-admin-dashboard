'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  getNodesBounds,
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
  Pencil,
  Trash2,
  Maximize,
  Landmark
} from 'lucide-react';
import { ResearchOverlay } from '@/components/rag/board/research-overlay';

import { useRag } from '@/lib/rag/store';
import { useBoard } from '@/lib/rag/board/store';
import { MediaType } from '@/lib/rag/types';
import {
  BoardNode,
  hubSlot,
  hubCols,
  hubUsesGrid,
  hubFootprint,
  stackOf,
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
  AGENT_W,
  AGENT_H,
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
import { AgentNode } from './agent-node';
import { AnnotationNode } from './annotation-node';
import { MindmapNode } from './mindmap-node';
import { ArtifactNode } from './artifact-node';
import { ReferenceNode } from './reference-node';
import { ArtifactDialog } from './artifact-dialog';
import { AgentEditDialog } from './agent-edit-dialog';
import { ArtifactBrainPicker } from './artifact-brain-picker';
import { BrandSplash } from './brand-splash';
import { ScopeEdge } from './scope-edge';
import { BoardToolbar } from './toolbar';
import { BoardChest, CHEST_MIME } from './board-chest';
import { transcribeAudioDetailed, timestampedTranscript } from '@/lib/rag/board/dictation';

const nodeTypes = {
  chip: ChipNode,
  hub: HubNode,
  brain: BrainNode,
  textNode: TextNode,
  prompt: PromptNode,
  agent: AgentNode,
  annotation: AnnotationNode,
  mindmap: MindmapNode,
  artifact: ArtifactNode,
  reference: ReferenceNode
};

const edgeTypes = { scope: ScopeEdge };

const SOURCE_TYPES = new Set([
  'chip', 'hub', 'textNode', 'prompt', 'agent', 'artifact', 'reference'
]);
/** Node types the right-click menu can duplicate (content artifacts — chips
 *  are one-per-source, hubs/brains aren't sensibly cloned). */
const DUPLICABLE = new Set([
  'textNode', 'prompt', 'agent', 'annotation', 'mindmap', 'artifact', 'reference'
]);
/** New-id prefix per duplicable node type. */
const DUP_PREFIX: Record<string, string> = {
  textNode: 'text',
  prompt: 'prompt',
  agent: 'agent',
  annotation: 'ann',
  mindmap: 'mm',
  artifact: 'art',
  reference: 'ref'
};
/** Node types that dock into cluster boxes as compact tiles (non-source
 *  context: notes + prompt/agent guides). */
const DOCKABLE_CONTEXT = new Set(['textNode', 'prompt', 'agent']);

/** Live measured node sizes from React Flow, keyed by id. Updated every render
 *  (a brain with a long chat is far bigger than its declared 500×600, so static
 *  estimates let pieces land on it — measured sizes fix that). */
let MEASURED = new Map<string, { width: number; height: number }>();

/** Real on-canvas footprint of a node (for overlap checks) — measured size when
 *  React Flow has it, else a generous fallback (chips render taller than CHIP_H
 *  once the thumbnail + 2-line title stack up). */
function nodeRect(n: BoardNode) {
  const m = MEASURED.get(n.id);
  const w = m?.width ?? n.width ?? (n.type === 'brain' ? 500 : CHIP_W);
  const h =
    m?.height ??
    n.height ??
    (n.type === 'brain' ? 600 : n.type === 'agent' ? AGENT_H : CHIP_H + 64);
  return { x: n.position.x, y: n.position.y, w, h };
}

/** Nudge `target` to the nearest spot where a w×h piece doesn't overlap any
 *  existing free (non-docked) node, spiralling outward in card-sized steps.
 *  Keeps freshly-dropped/placed pieces from landing on top of each other. */
function freePosition(
  nodes: BoardNode[],
  target: { x: number; y: number },
  w: number,
  h: number
): { x: number; y: number } {
  const GAP = 16;
  const others = nodes.filter((n) => !n.parentId).map(nodeRect);
  const collides = (x: number, y: number) =>
    others.some(
      (b) =>
        x < b.x + b.w + GAP &&
        x + w + GAP > b.x &&
        y < b.y + b.h + GAP &&
        y + h + GAP > b.y
    );
  if (!collides(target.x, target.y)) return target;
  const stepX = w + GAP;
  const stepY = h + GAP;
  for (let ring = 1; ring <= 14; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; // ring edge
        const x = target.x + dx * stepX;
        const y = target.y + dy * stepY;
        if (!collides(x, y)) return { x, y };
      }
    }
  }
  return target; // board is dense — give up rather than loop forever
}

// Concurrency-limited queue for INDEXING fetches. A 50-link import would
// otherwise fire 50 requests at once — exhausting the browser's per-host
// connection cap and hammering the Make webhook + Pinecone. Chips still appear
// instantly (optimistic); their indexing just runs a few at a time.
const INDEX_CONCURRENCY = 4;
const indexQueue: Array<() => Promise<unknown>> = [];
let indexActive = 0;
function pumpIndexQueue() {
  while (indexActive < INDEX_CONCURRENCY && indexQueue.length) {
    const task = indexQueue.shift()!;
    indexActive++;
    Promise.resolve(task()).finally(() => {
      indexActive--;
      pumpIndexQueue();
    });
  }
}
/** Run an indexing fetch when a slot frees up (max INDEX_CONCURRENCY at once). */
function enqueueIndex(task: () => Promise<unknown>) {
  indexQueue.push(task);
  pumpIndexQueue();
}

/** Re-tile a hub's docked tiles (chips + context notes + prompts) into its grid
 *  (columns widen with member count). */
function retile(nodes: BoardNode[], hubId: string): BoardNode[] {
  const isMember = (n: BoardNode) =>
    (n.type === 'chip' ||
      n.type === 'textNode' ||
      n.type === 'prompt' ||
      n.type === 'agent') &&
    n.parentId === hubId;
  const cols = hubCols(nodes.filter(isMember).length);
  let i = 0;
  return nodes.map((n) => (isMember(n) ? { ...n, position: hubSlot(i++, cols) } : n));
}

// Usable-canvas insets (px): the floating chrome that overlays the React Flow
// pane — left rails, right edge, top header, bottom dock. fitToFill() zooms the
// content to FILL the area BETWEEN these, so the work dominates the screen
// instead of sitting tiny in a sea of empty canvas.
const FILL_INSET = { left: 200, right: 48, top: 76, bottom: 104 };
/** Don't blow a single small piece up to cartoon size — cap the fill zoom. */
const FILL_MAX_ZOOM = 2;
const FILL_MIN_ZOOM = 0.2;

function BoardCanvasInner() {
  const { board, setBoard, setBoardSilent, nextBoardId, busyBrains, saveNow, removeBoardNode, connectArtifactToBrain, setBrainPicker, setAgentEditor, pendingDelete, setPendingDelete, hydratedProject, researchBrainId, setResearchBrainId } =
    useBoard();
  const { media, projectMedia, addMedia, updateMedia, queueMediaPatch, deleteMedia, activeProjectId, activeProject, pendingBox, setPendingBox } = useRag();

  // Library → Board handoff: build a box from a selection sent over from the
  // Library ("Send to box"). Creates the hub + a chip per source (pulling any
  // existing chip for that source in first), then clears the request.
  useEffect(() => {
    if (!pendingBox || !pendingBox.sourceIds.length || !hydratedProject) return;
    const { name, sourceIds } = pendingBox;
    const idSet = new Set(sourceIds);
    setBoard((prev) => {
      const leftHubs = new Set<string>();
      let nodes = prev.nodes.filter((n) => {
        if (n.type === 'chip' && idSet.has(n.data.mediaId as string)) {
          if (n.parentId) leftHubs.add(n.parentId);
          return false;
        }
        return true;
      });
      const hubId = nextBoardId('hub');
      const size = hubFootprint({ mediaType: 'cluster' }, sourceIds.length);
      const pos = freePosition(nodes, centerPos(), size.width, size.height);
      nodes.push({
        id: hubId,
        type: 'hub',
        position: pos,
        data: { name: name || 'New box', mediaType: 'cluster' }
      });
      sourceIds.forEach((mid) =>
        nodes.push({
          id: nextBoardId('chip'),
          type: 'chip',
          parentId: hubId,
          position: { x: 0, y: 0 },
          data: { mediaId: mid }
        })
      );
      for (const h of new Set([hubId, ...leftHubs])) {
        nodes = retile(nodes, h);
        nodes = nodes.map((n) =>
          n.id === h && (n.width != null || n.height != null)
            ? { ...n, width: undefined, height: undefined }
            : n
        );
      }
      return { ...prev, nodes };
    });
    setPendingBox(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBox, hydratedProject]);
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
  const { getIntersectingNodes, getNodes, screenToFlowPosition, fitView, setViewport } =
    useReactFlow();

  // Keep the measured-size map fresh so overlap checks know each node's REAL
  // footprint (esp. a brain grown tall by its chat). Only when the node SET
  // changes — not every render (that churned hard with 100+ nodes and flickered).
  const nodeSig = board.nodes
    .map((n) => n.id)
    .sort()
    .join(',');
  useEffect(() => {
    const next = new Map<string, { width: number; height: number }>();
    for (const n of getNodes()) {
      const w = n.measured?.width ?? n.width ?? undefined;
      const h = n.measured?.height ?? n.height ?? undefined;
      if (w && h) next.set(n.id, { width: w, height: h });
    }
    MEASURED = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeSig]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // On load/refresh (and project switch) the viewport doesn't follow the saved
  // board, so a restored board looks scattered. We focus ONLY after the store
  // signals this project's saved board has finished loading (`hydratedProject`)
  // — focusing earlier would lock onto the transient seed/cached board that
  // renders before the load resolves (the "stuck on the old brain" bug).
  // Then: focus the most-recently-used brain (latest message), else fit ALL.
  const focusedProject = useRef<string | null>(null);
  useEffect(() => {
    focusedProject.current = null; // re-focus when the project changes
  }, [activeProjectId]);

  // Summary tree, once per project: backfill Level-1 summaries for any sources
  // indexed before the summary tree existed. Idempotent (skips ones already
  // summarized). New sources get their summary at ingest, so this only catches
  // pre-existing ones. On completion, bump a tick so the cluster rollups below
  // re-run with the now-complete set of source summaries.
  const summaryBackfilled = useRef<string | null>(null);
  const [backfillTick, setBackfillTick] = useState(0);
  const [artifactDlgOpen, setArtifactDlgOpen] = useState(false);
  const [referenceDlgOpen, setReferenceDlgOpen] = useState(false);
  useEffect(() => {
    if (hydratedProject !== activeProjectId) return;
    if (summaryBackfilled.current === activeProjectId) return;
    const indexed = projectMedia.filter((m) => m.status === 'indexed');
    if (indexed.length === 0) return;
    summaryBackfilled.current = activeProjectId;
    fetch('/api/backfill-summaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sources: indexed.map((m) => ({ id: m.id, name: m.name }))
      })
    })
      .then(() => setBackfillTick((t) => t + 1))
      .catch(() => {});
  }, [hydratedProject, activeProjectId, projectMedia]);

  // Cluster rollups (Level 2 boxes + Level 3 project), debounced. Re-rolls any
  // cluster whose member-set CHANGED — which is also the delete-cleanup path: a
  // deleted source shrinks its box + the project, so both refresh. Rollups are
  // "summaries of summaries", so each is one cheap call and never re-reads text.
  const clusterSigs = useRef<Map<string, string>>(new Map());
  const clusterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hydratedProject !== activeProjectId) return;
    if (clusterTimer.current) clearTimeout(clusterTimer.current);
    clusterTimer.current = setTimeout(() => {
      const indexedId = (mid: unknown) =>
        media.find((m) => m.id === mid && m.status === 'indexed')?.id;
      const clusters: { id: string; name: string; ids: string[] }[] = [];
      // each box (hub) → its docked, indexed members
      const hubs = new Map<string, { name: string; ids: string[] }>();
      for (const n of board.nodes)
        if (n.type === 'hub')
          hubs.set(n.id, { name: (n.data?.name as string) ?? 'Box', ids: [] });
      for (const n of board.nodes) {
        if (n.type !== 'chip' || !n.parentId) continue;
        const h = hubs.get(n.parentId);
        const mid = indexedId(n.data?.mediaId);
        if (h && mid) h.ids.push(mid);
      }
      for (const [id, h] of hubs)
        if (h.ids.length >= 2) clusters.push({ id, name: h.name, ids: h.ids });
      // the whole project
      const projIds = projectMedia
        .filter((m) => m.status === 'indexed')
        .map((m) => m.id);
      if (projIds.length >= 2)
        clusters.push({
          id: activeProjectId,
          name: activeProject?.name ?? 'Project',
          ids: projIds
        });
      // re-roll only the clusters whose membership actually changed
      for (const c of clusters) {
        const sig = c.ids.slice().sort().join(',');
        if (clusterSigs.current.get(c.id) === sig) continue;
        clusterSigs.current.set(c.id, sig);
        fetch('/api/summarize-cluster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cluster_id: c.id,
            name: c.name,
            source_ids: c.ids
          })
        }).catch(() => {});
      }
    }, 4000);
    return () => {
      if (clusterTimer.current) clearTimeout(clusterTimer.current);
    };
  }, [
    board.nodes,
    media,
    projectMedia,
    hydratedProject,
    activeProjectId,
    activeProject,
    backfillTick
  ]);
  // Measure the bounding box of ALL visible content and zoom it to FILL the
  // usable canvas (inset from the rails + top/bottom menus), centered between
  // them. This is why the work dominates the screen instead of looking tiny.
  const fitToFill = useCallback(
    (duration = 600) => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const all = getNodes().filter((n) => !n.hidden); // skip collapsed members
      if (!all.length) return;
      // Exclude FAR OUTLIERS (a stray off-canvas box) from the framing — otherwise
      // one node at an extreme coordinate blows the bounds up and the zoom
      // collapses to minimum, dumping you in empty space. Frame the bulk; the
      // outlier is still reachable via the 📦 dock → jump.
      const med = (vals: number[]) => {
        const s = [...vals].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)] ?? 0;
      };
      const mx = med(all.map((n) => n.position.x));
      const my = med(all.map((n) => n.position.y));
      const OUTLIER = 14000;
      const core = all.filter(
        (n) => Math.abs(n.position.x - mx) < OUTLIER && Math.abs(n.position.y - my) < OUTLIER
      );
      const nodes = core.length ? core : all;
      const b = getNodesBounds(nodes);
      if (!b.width || !b.height) return;
      const availW = Math.max(120, rect.width - FILL_INSET.left - FILL_INSET.right);
      const availH = Math.max(120, rect.height - FILL_INSET.top - FILL_INSET.bottom);
      const zoom = Math.max(
        FILL_MIN_ZOOM,
        Math.min(FILL_MAX_ZOOM, availW / b.width, availH / b.height)
      );
      // Center the content's box within the inset area (screen = flow*zoom + v).
      const x = FILL_INSET.left + (availW - b.width * zoom) / 2 - b.x * zoom;
      const y = FILL_INSET.top + (availH - b.height * zoom) / 2 - b.y * zoom;
      setViewport({ x, y, zoom }, { duration });
    },
    [getNodes, setViewport]
  );

  // Holds the latest cleanDesk (defined later in the component) so the load
  // effect — which appears before it — can call it without a TDZ reference.
  const cleanDeskRef = useRef<((reframe?: boolean) => void) | null>(null);
  // Debounced gentle auto-tidy: after a burst of wiring settles, snap pieces to
  // their plug side around each brain — no viewport jump (reframe=false).
  const autoTidyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleTidy = useCallback(() => {
    if (autoTidyTimer.current) clearTimeout(autoTidyTimer.current);
    autoTidyTimer.current = setTimeout(() => cleanDeskRef.current?.(false), 380);
  }, []);
  useEffect(
    () => () => {
      if (autoTidyTimer.current) clearTimeout(autoTidyTimer.current);
    },
    []
  );
  useEffect(() => {
    if (hydratedProject !== activeProjectId) return; // wait for the real board
    if (focusedProject.current === activeProjectId) return;
    focusedProject.current = activeProjectId;
    // On load, LINE EVERYTHING UP: each brain's wired boxes/sources snap into its
    // own row-band (this also pulls any stray off-canvas box back into the
    // layout), then frame the result. Falls back to a plain fit if there's
    // nothing to tidy.
    const t = setTimeout(() => {
      try {
        if (cleanDeskRef.current) cleanDeskRef.current();
        else fitToFill(600);
      } catch (e) {
        console.error('focus-on-load', e);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [hydratedProject, activeProjectId, board.nodes, fitToFill]);

  // RESEARCH MODE is a dedicated full-screen overlay (ResearchOverlay), rendered
  // below — it covers the whole canvas, so nothing here needs to change.

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

  // Each source TYPE has exactly one plug (side) on the brain it wires into:
  // knowledge/sources → left, artifact → right, references → top, robot → bottom.
  // A connection auto-routes to its type's plug no matter where it's dropped.
  const plugFor = (type?: string): 'sources' | 'artifact' | 'references' | 'robot' =>
    type === 'artifact'
      ? 'artifact'
      : type === 'reference'
      ? 'references'
      : type === 'prompt' || type === 'agent'
      ? 'robot'
      : 'sources';

  const onConnect = useCallback(
    (conn: Connection) => {
      const src = board.nodes.find((n) => n.id === conn.source);
      const tgt = board.nodes.find((n) => n.id === conn.target);
      // Non-brain targets (shouldn't happen) just add as-is.
      if (!src || !tgt || tgt.type !== 'brain') {
        setBoard((prev) => ({
          ...prev,
          edges: addEdge({ ...conn, id: nextBoardId('e') }, prev.edges as Edge[])
        }));
        return;
      }
      // Artifact: belongs to exactly ONE brain → route through the lifecycle
      // helper (drops any prior brain for it / prior artifact on this brain).
      if (src.type === 'artifact') {
        connectArtifactToBrain(src.id, tgt.id);
        scheduleTidy();
        return;
      }
      const plug = plugFor(src.type);
      // Only ONE robot (agent/prompt persona) per brain.
      if (plug === 'robot') {
        const hasRobot = board.edges.some((e) => {
          if (e.target !== tgt.id) return false;
          const s = board.nodes.find((n) => n.id === e.source);
          return !!s && (s.type === 'prompt' || s.type === 'agent');
        });
        if (hasRobot) {
          window.alert('Only one Persona (agent or prompt) can connect to an Answers Bank. Unplug the current one first.');
          return;
        }
      }
      // AUTO-ROUTE: drop the wire ANYWHERE on the brain and it snaps to the
      // correct plug for the source TYPE (sources→left, artifact→right,
      // references→top, robot→bottom). No fiddly handle-targeting, so the edge
      // ALWAYS forms — a near-miss never silently fails to connect.
      setBoard((prev) => ({
        ...prev,
        edges: addEdge(
          { ...conn, targetHandle: plug, id: nextBoardId('e') },
          prev.edges as Edge[]
        )
      }));
      scheduleTidy();
    },
    [board.nodes, board.edges, setBoard, nextBoardId, connectArtifactToBrain, scheduleTidy]
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

      // NO-OVERLAP RULE (with ONE exception): a piece never rests on top of the
      // brain, the robot, or a DIFFERENT kind of piece. Same-type puzzle pieces
      // ARE allowed to overlap — that's the stack/weld (shadow → snap). After the
      // drop settles (dock logic runs on tick 0), slide this free piece to the
      // nearest clear spot if it overlaps anything it shouldn't.
      setTimeout(() => {
        setBoard((prev) => {
          const self = prev.nodes.find((n) => n.id === node.id);
          if (!self || self.parentId) return prev;
          // Boxes and brains are BIG and placed deliberately — never auto-move
          // them (a huge box would "fly away" by its own size). Only loose
          // pieces get the no-overlap nudge.
          if (self.type === 'hub' || self.type === 'brain') return prev;
          const typeOf = (n: BoardNode) =>
            media.find((m) => m.id === n.data?.mediaId)?.type;
          // WELDED STACK is sacred: if this chip is part of a same-type stack,
          // never move it — that's the deliberate weld, even near other things.
          if (self.type === 'chip' && stackOf(self, prev.nodes, typeOf).length > 1)
            return prev;
          const selfChipType = self.type === 'chip' ? typeOf(self) : null;
          // Obstacles = every free node EXCEPT a same-type chip (those weld).
          const obstacles = prev.nodes.filter(
            (n) =>
              n.id !== self.id &&
              !n.parentId &&
              !(selfChipType && n.type === 'chip' && typeOf(n) === selfChipType)
          );
          const { w, h } = nodeRect(self);
          const pos = freePosition(obstacles, self.position, w, h);
          if (pos.x === self.position.x && pos.y === self.position.y) return prev;
          return {
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.id === self.id ? { ...n, position: pos } : n
            )
          };
        });
      }, 90);

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
              tn.type === 'prompt' || tn.type === 'agent'
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
                const sz = hubFootprint(
                  h.data,
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
  // Monotonic placement counter: a whole batch of imports fires synchronously
  // (one onNewSource per link) BEFORE React commits, so reading board.nodes each
  // time returns the same stale count → everything piles in one slot. This ref
  // increments per placement so a batch fans across the grid; it's reconciled up
  // to the real node count so it never falls behind after deletes/loads.
  const placeCounter = useRef(0);
  /** Projects whose saved board we've already de-overlapped once this session. */
  const untangled = useRef<Set<string>>(new Set());
  const centerPos = useCallback(() => {
    const el = wrapRef.current;
    const rect = el?.getBoundingClientRect();
    const pt = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: 500, y: 300 };
    const pos = screenToFlowPosition(pt);
    // Lay new pieces out in a tidy grid around the viewport centre — the cards
    // are tall now, so a small jitter overlapped them and hid the name bar. A
    // 4×6 window (24 slots) lets a 20-link batch spread without overlap before
    // it wraps; step by a full card + gap so every connector stays visible.
    const actual = board.nodes.filter(
      (n) => n.type === 'chip' || n.type === 'hub'
    ).length;
    placeCounter.current = Math.max(placeCounter.current, actual);
    const i = placeCounter.current++;
    const COLS = 4;
    const ROWS = 6;
    const slot = i % (COLS * ROWS);
    const col = slot % COLS;
    const row = Math.floor(slot / COLS);
    return {
      x: pos.x - (CHIP_W + 18) * (COLS / 2 - 0.5) + col * (CHIP_W + 18),
      y: pos.y - (CHIP_H + 18) * 1.5 + row * (CHIP_H + 18)
    };
  }, [screenToFlowPosition, board.nodes]);

  const pushNode = useCallback(
    (node: BoardNode) =>
      setBoard((prev) => {
        // Resolve overlap against the LATEST nodes so a new piece never lands on
        // top of another (covers single placement AND rapid batch drops).
        const w = node.width ?? CHIP_W;
        const h = node.height ?? CHIP_H + 64;
        const position = freePosition(prev.nodes, node.position, w, h);
        return { ...prev, nodes: [...prev.nodes, { ...node, position }] };
      }),
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
      let payload: {
        kind: string;
        id?: string;
        text?: string;
        agentId?: string;
        name?: string;
        icon?: string;
      };
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
      } else if (payload.kind === 'agent') {
        pushNode({
          id: nextBoardId('agent'),
          type: 'agent',
          position: {
            x: pos.x - AGENT_W / 2,
            y: pos.y - AGENT_H / 2
          },
          width: AGENT_W,
          height: AGENT_H,
          data: {
            agentId: payload.agentId ?? '',
            name: payload.name ?? 'Agent',
            icon: payload.icon ?? '',
            text: payload.text ?? ''
          }
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

  /** Re-run indexing for an EXISTING source (after a failure) — reuses its id,
   *  so retry never creates a duplicate. Routed through the throttle queue. */
  const retrySource = useCallback(
    (type: MediaType, id: string, url: string) => {
      updateMedia(id, { status: 'processing', error: undefined });
      const cleanName = url
        ? url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        : 'Source';
      if (type === 'youtube') {
        enqueueIndex(() =>
          fetch('/api/index-youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: id, name: cleanName, url })
          })
            .then(async (r) => {
              const j = await r.json().catch(() => ({}));
              if (!r.ok || !j.ok) throw new Error(j?.error ?? j?.note ?? 'failed');
              queueMediaPatch(id, {
                status: 'indexed',
                chunks: j.chunks,
                ...(j.title ? { name: j.title } : {}),
                ...(j.thumbnail ? { thumbnail: j.thumbnail } : {})
              });
            })
            .catch((e: unknown) =>
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error && e.message ? e.message : 'Indexing failed'
              })
            )
        );
      } else if (type === 'website') {
        enqueueIndex(() =>
          fetch('/api/index-website', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: id, name: cleanName, url })
          })
            .then(async (r) => {
              const j = await r.json().catch(() => ({}));
              if (!r.ok || !j.ok) throw new Error(j?.note ?? j?.error ?? 'failed');
              queueMediaPatch(id, {
                status: 'indexed',
                chunks: j.chunks,
                ...(j.title ? { name: j.title } : {})
              });
            })
            .catch((e: unknown) =>
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error && e.message ? e.message : 'Indexing failed'
              })
            )
        );
      } else {
        enqueueIndex(() =>
          fetch('/api/index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: id,
              name: cleanName,
              type,
              text: url ? `${cleanName}\n${url}` : cleanName
            })
          })
            .then((r) => {
              if (!r.ok) throw new Error(`Indexing failed (HTTP ${r.status})`);
              queueMediaPatch(id, { status: 'indexed' });
            })
            .catch((e: unknown) =>
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error && e.message ? e.message : 'Indexing failed'
              })
            )
        );
      }
    },
    [updateMedia]
  );

  /** Delete a source: pull its chip(s) off the board AND remove the media + its
   *  Pinecone vectors. */
  const deleteSource = useCallback(
    (id: string) => {
      recallMedia(id);
      deleteMedia(id);
    },
    [recallMedia, deleteMedia]
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

  // Minimized boxes hide their docked members (still saved/wired — just not
  // drawn): the hub renders them as a scrollable thumbnail grid in its own DOM
  // instead. Big boxes minimize automatically (hubCollapsed), so a 100-item box
  // is never a giant cloud of canvas nodes — that's what flickered + flew away.
  const liveNodes = useMemo(() => {
    const memberCount = new Map<string, number>();
    for (const n of board.nodes) {
      if (
        n.parentId &&
        (n.type === 'chip' ||
          n.type === 'textNode' ||
          n.type === 'prompt' ||
          n.type === 'agent')
      )
        memberCount.set(n.parentId, (memberCount.get(n.parentId) ?? 0) + 1);
    }
    // Hide a box's canvas chips whenever the box renders as the DOM grid (mini OR
    // big-expanded) — the grid draws its own thumbnails, so the real chips would
    // otherwise spill across the canvas.
    const gridded = new Set(
      board.nodes
        .filter(
          (n) =>
            n.type === 'hub' &&
            hubUsesGrid(n.data, memberCount.get(n.id) ?? 0)
        )
        .map((n) => n.id)
    );
    if (!gridded.size) return board.nodes;
    return board.nodes.map((n) =>
      n.parentId && gridded.has(n.parentId) ? { ...n, hidden: true } : n
    );
  }, [board.nodes]);

  const placedIds = useMemo(
    () =>
      new Set(
        board.nodes
          .filter((n) => n.type === 'chip')
          .map((n) => n.data.mediaId as string)
      ),
    [board.nodes]
  );

  // De-overlap the SAVED board once, after it loads — placement-time spacing only
  // covers new pieces, so a board saved with pieces piled up stays piled until
  // we nudge them apart here. Brains, hubs and box-docked tiles stay put; only
  // free pieces that actually overlap get moved to the nearest clear spot.
  useEffect(() => {
    if (hydratedProject !== activeProjectId) return;
    if (untangled.current.has(activeProjectId)) return;
    untangled.current.add(activeProjectId);
    // Defer so React Flow has measured every node first (a brain's real height
    // depends on its chat) — otherwise we'd de-overlap against stale sizes.
    const t = setTimeout(() => {
      setBoard((prev) => {
        const typeOf = (n: BoardNode) =>
          media.find((m) => m.id === n.data?.mediaId)?.type;
        const fixed = prev.nodes.filter(
          (n) => n.parentId || n.type === 'brain' || n.type === 'hub'
        );
        const movable = prev.nodes.filter(
          (n) => !n.parentId && n.type !== 'brain' && n.type !== 'hub'
        );
        const accepted = [...fixed];
        const moved = new Map<string, { x: number; y: number }>();
        for (const n of movable) {
          const chipType = n.type === 'chip' ? typeOf(n) : null;
          // Don't push a piece off a same-type chip — those are allowed to stack.
          const obstacles = accepted.filter(
            (a) => !(chipType && a.type === 'chip' && typeOf(a) === chipType)
          );
          const { w, h } = nodeRect(n);
          const pos = freePosition(obstacles, n.position, w, h);
          if (pos.x !== n.position.x || pos.y !== n.position.y) moved.set(n.id, pos);
          accepted.push(pos === n.position ? n : { ...n, position: pos });
        }
        if (moved.size === 0) return prev;
        return {
          ...prev,
          nodes: prev.nodes.map((n) =>
            moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n
          )
        };
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedProject, activeProjectId]);

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
        data: { name: 'All sources', mediaType: 'cluster' }
        // No width/height — the hub measures its own collapse-aware DOM.
      }
    ];
    const cols = hubCols(unplaced.length);
    unplaced.forEach((m, i) =>
      newNodes.push({
        id: nextBoardId('chip'),
        type: 'chip',
        parentId: hubId,
        position: hubSlot(i, cols),
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
  // `reframe` re-fits the viewport after tidying (true for the manual button /
  // on-load tidy; false for the gentle auto-tidy after a wire, so the view
  // doesn't jump while the user is working).
  const cleanDesk = useCallback((reframe = true) => {
    if (tidying.current) return;
    const nodes = board.nodes;
    const typeOf = (n: BoardNode) =>
      media.find((m) => m.id === n.data.mediaId)?.type;

    // Block = one rigid unit to place (a chip stack, a hub, a brain, an item).
    // `kind` = which side of the brain it docks on (left sources/context, right
    // artifact, top references, bottom robot) or loose (annotations/mindmaps).
    // `owner` = the brain it's wired to (first one, by top-to-bottom order) so its
    // pieces tidy around THAT brain's cross.
    interface Block {
      ids: string[];
      w: number;
      h: number;
      // Which side of its brain a piece docks on, mirroring the brain's plugs:
      // sources/boxes/notes → left, artifact → right, references → top,
      // robot → bottom. So every wire exits straight from its plug, no crossing.
      kind: 'brain' | 'left' | 'right' | 'top' | 'bottom' | 'loose';
      owner: string | null;
      offs: { id: string; dx: number; dy: number }[];
    }
    // Brains, top-to-bottom — each gets a horizontal band; its wired pieces sit
    // beside it (sources left, artifact/references/robot right).
    const brainNodes = nodes
      .filter((n) => n.type === 'brain' && !n.parentId)
      .sort((a, b) => a.position.y - b.position.y);
    const brainOrder = new Map(brainNodes.map((b, i) => [b.id, i]));
    // The brain a piece belongs to = the first (topmost) brain any of its ids
    // wires into; null = orphan (parked at the bottom of its column).
    const ownerBrain = (memberIds: string[]): string | null => {
      let best: { id: string; order: number } | null = null;
      for (const e of board.edges) {
        if (!e.source || !memberIds.includes(e.source)) continue;
        const o = e.target ? brainOrder.get(e.target) : undefined;
        if (o === undefined) continue;
        if (!best || o < best.order) best = { id: e.target!, order: o };
      }
      return best?.id ?? null;
    };

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
          kind: 'left',
          owner: ownerBrain(members.map((m) => m.id)),
          offs: members.map((m) => ({
            id: m.id,
            dx: m.position.x - minX,
            dy: m.position.y - minY
          }))
        });
      } else {
        used.add(n.id);
        let kind: Block['kind'] = 'loose';
        if (n.type === 'brain') kind = 'brain';
        else if (n.type === 'hub' || n.type === 'textNode') kind = 'left';
        else if (n.type === 'reference') kind = 'top';
        else if (n.type === 'artifact') kind = 'right';
        else if (n.type === 'prompt' || n.type === 'agent') kind = 'bottom';
        let w = (n.width as number) ?? (n.type === 'brain' ? 500 : 240);
        let h = (n.height as number) ?? (n.type === 'brain' ? 600 : 150);
        if (n.type === 'hub') {
          // Collapse-aware: a minimized box reserves its real mini footprint.
          const sz = hubFootprint(
            n.data,
            nodes.filter((c) => c.parentId === n.id).length
          );
          w = sz.width;
          h = sz.height;
        }
        blocks.push({
          ids: [n.id],
          w,
          h,
          kind,
          owner: kind !== 'loose' && kind !== 'brain' ? ownerBrain([n.id]) : null,
          offs: [{ id: n.id, dx: 0, dy: 0 }]
        });
      }
    }
    if (blocks.length < 2) return;

    // Generous gaps so each brain's OUTSIDE plug labels (Library/Examples/Draft/
    // Persona) have room and never overlap the docked pieces.
    const COL_GAP = 200; // room for the side ports (label + plug jut ~140px out)
    const ROW_GAP = 28;
    const SIDE_GAP = 96; // gap between a brain and its top/bottom docked row
    const BAND_GAP = 150;
    const TOP = 80;
    const LEFT = 80;

    const leftBlocks = blocks.filter((b) => b.kind === 'left');
    const rightBlocks = blocks.filter((b) => b.kind === 'right');
    const topBlocks = blocks.filter((b) => b.kind === 'top');
    const bottomBlocks = blocks.filter((b) => b.kind === 'bottom');
    const looseBlocks = blocks.filter((b) => b.kind === 'loose');

    // Column widths from the widest block in each column.
    const leftColW = Math.max(0, ...leftBlocks.concat(looseBlocks).map((b) => b.w));
    const brainColW = Math.max(0, ...blocks.filter((b) => b.kind === 'brain').map((b) => b.w));
    const rightColW = Math.max(0, ...rightBlocks.map((b) => b.w));
    const leftX = LEFT;
    const midX = leftX + (leftColW ? leftColW + COL_GAP : 0);
    const rightX = midX + brainColW + COL_GAP;
    const brainCenterX = midX + brainColW / 2;

    const target = new Map<string, { x: number; y: number }>();
    const stackHeight = (bs: Block[]) =>
      bs.reduce((s, b, i) => s + b.h + (i ? ROW_GAP : 0), 0);
    const rowWidth = (bs: Block[]) =>
      bs.reduce((s, b, i) => s + b.w + (i ? ROW_GAP : 0), 0);
    const rowHeight = (bs: Block[]) => Math.max(0, ...bs.map((b) => b.h));
    // Lay a vertical stack of blocks in a column; returns the y after the stack.
    const placeStack = (bs: Block[], colX: number, colW: number, startY: number) => {
      let y = startY;
      for (const b of bs) {
        const x = colX + (colW - b.w) / 2;
        for (const o of b.offs) target.set(o.id, { x: x + o.dx, y: y + o.dy });
        y += b.h + ROW_GAP;
      }
      return y;
    };
    // Lay a horizontal row of blocks centered on a point (references above the
    // brain, robots below it).
    const placeRow = (bs: Block[], centerX: number, rowY: number) => {
      let x = centerX - rowWidth(bs) / 2;
      for (const b of bs) {
        for (const o of b.offs) target.set(o.id, { x: x + o.dx, y: rowY + o.dy });
        x += b.w + ROW_GAP;
      }
    };

    // One CROSS per brain: references dock ABOVE, sources LEFT, the brain in the
    // middle, artifact RIGHT, the robot BELOW — every piece sits beside its own
    // plug so a wire runs straight out and never crosses another. Each brain owns
    // a horizontal band (brain 2's pieces never mingle with brain 1's).
    let y = TOP;
    for (const bn of brainNodes) {
      const brainBlock = blocks.find((b) => b.kind === 'brain' && b.ids[0] === bn.id);
      if (!brainBlock) continue;
      const lefts = leftBlocks.filter((b) => b.owner === bn.id);
      const rights = rightBlocks.filter((b) => b.owner === bn.id);
      const tops = topBlocks.filter((b) => b.owner === bn.id);
      const bottoms = bottomBlocks.filter((b) => b.owner === bn.id);
      const leftH = stackHeight(lefts);
      const rightH = stackHeight(rights);
      const topH = rowHeight(tops);
      const bottomH = rowHeight(bottoms);
      const midH = Math.max(brainBlock.h, leftH, rightH);
      if (tops.length) placeRow(tops, brainCenterX, y);
      const midY = y + (topH ? topH + SIDE_GAP : 0);
      if (lefts.length) placeStack(lefts, leftX, leftColW, midY + (midH - leftH) / 2);
      placeStack([brainBlock], midX, brainColW, midY + (midH - brainBlock.h) / 2);
      if (rights.length) placeStack(rights, rightX, rightColW, midY + (midH - rightH) / 2);
      const bottomY = midY + midH + (bottomH ? SIDE_GAP : 0);
      if (bottoms.length) placeRow(bottoms, brainCenterX, bottomY);
      y = bottomY + bottomH + BAND_GAP;
    }

    // Orphans (wired to no brain) park at the BOTTOM of their columns.
    const orphanLeft = leftBlocks.filter((b) => !b.owner);
    const orphanRight = rightBlocks.filter((b) => !b.owner);
    const orphanRest = [
      ...topBlocks.filter((b) => !b.owner),
      ...bottomBlocks.filter((b) => !b.owner),
      ...looseBlocks
    ];
    const yL = placeStack(orphanLeft, leftX, leftColW, y);
    const yR = placeStack(orphanRight, rightX, rightColW, y);
    placeStack(orphanRest, leftX, leftColW, Math.max(yL, yR, y));

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
        if (reframe) fitView({ duration: 500, padding: 0.18 });
      }
    };
    requestAnimationFrame(tick);
  }, [board, media, setBoard, fitView]);
  // Expose the latest cleanDesk to the (earlier) load-focus effect.
  cleanDeskRef.current = cleanDesk;

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
      {/* Branded loading splash — covers the board until the saved board loads,
          so a refresh never flashes the bare canvas / starter Answers Bank. */}
      <BrandSplash visible={hydratedProject !== activeProjectId} />
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

      {/* Empty State Onboarding */}
      {liveNodes.length === 0 && hydratedProject === activeProjectId && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-6 text-center animate-fade-up">
            <div className="flex h-20 w-20 items-center justify-center rounded-[28%] bg-accent/5 text-accent/40 ring-1 ring-accent/10">
              <Landmark className="h-10 w-10" />
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground/80">Your Board is empty</h2>
              <p className="max-w-[340px] text-[15px] leading-relaxed text-muted-foreground/60">
                Start by adding a source or dropping an Answers Bank from the toolbar below.
              </p>
            </div>
            <div className="flex items-center gap-3 text-[13px] font-bold uppercase tracking-wider text-accent/70">
              <span>① Add Source</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
              <span>② Place Bank</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
              <span>③ Ask</span>
            </div>
          </div>
        </div>
      )}
      <ReactFlow
        nodes={liveNodes as Node[]}
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
        // canvas PANS. The rubber-band multi-select box is DISABLED entirely —
        // a missed Shift keyup (focus stolen by an alert/dialog) used to leave
        // React Flow stuck in "selecting" mode so nothing could be moved. With
        // no selection key, a plain drag always moves a node / pans the canvas.
        panOnDrag
        selectionOnDrag={false}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
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
          showFitView={false}
          className="!rounded-[14px] !border-none !bg-card !shadow-[0_2px_8px_rgb(0_0_0/0.08)]"
        >
          {/* Manual Fit: re-runs fitToFill so the user can re-frame the board to
              fill the usable canvas any time (not just on load). */}
          <ControlButton
            onClick={() => fitToFill(500)}
            title="Fit content to screen"
            aria-label="Fit content to screen"
          >
            <Maximize />
          </ControlButton>
        </Controls>
      </ReactFlow>

      {/* RESEARCH MODE — a clean full-screen chat overlay for one brain. It sits
          at z-40 (below the citation sheet at z-50, so citations still float). */}
      {researchBrainId && (
        <ResearchOverlay
          brainId={researchBrainId}
          onExit={() => setResearchBrainId(null)}
        />
      )}

      <BoardToolbar
        placedIds={placedIds}
        onCleanDesk={() => cleanDesk(true)}
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
          // YouTube: show the thumbnail immediately (derived from the video id —
          // no network wait); the real title arrives with the index response.
          const ytId =
            type === 'youtube' && source
              ? (source.match(
                  /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/
                ) ?? [])[1]
              : undefined;
          const thumb = ytId
            ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`
            : undefined;
          // No name typed (URL imports auto-title): fall back to the URL host so
          // the chip is never blank. YouTube gets its real oEmbed title on index.
          const cleanName =
            name.trim() ||
            (source
              ? source.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
              : 'Source');
          // Optimistic chip now; real status when indexing answers.
          const id = addMedia(
            {
              type,
              name: cleanName,
              description: '',
              date: new Date().toISOString().slice(0, 10),
              content: source || cleanName,
              source: source || undefined,
              thumbnail: thumb
            },
            { simulate: false }
          );
          pushNode({
            id: nextBoardId('chip'),
            type: 'chip',
            position: centerPos(),
            data: { mediaId: id }
          });

          // YouTube: fetch the full caption transcript (deterministic) → index
          // via the text pipeline. Website scrapes the page; text embeds as-is.
          if (type === 'youtube') {
            enqueueIndex(() =>
              fetch('/api/index-youtube', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_id: id, name: cleanName, url: source })
              })
                .then(async (r) => {
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || !j.ok)
                    throw new Error(j?.error ?? j?.note ?? 'index failed');
                  // Inherit the real YouTube title + thumbnail (oEmbed).
                  queueMediaPatch(id, {
                    status: 'indexed',
                    chunks: j.chunks,
                    ...(j.title ? { name: j.title } : {}),
                    ...(j.thumbnail ? { thumbnail: j.thumbnail } : {})
                  });
                })
                .catch((e: unknown) =>
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error && e.message ? e.message : 'Indexing failed'
              })
            )
            );
            return id;
          }

          // Website: fetch + read the page (robots-respecting, public-only).
          // Soft failures (paywalled / private / illegible / robots-blocked)
          // come back as { ok:false, note } → tell the user plainly why.
          if (type === 'website') {
            enqueueIndex(() =>
              fetch('/api/index-website', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_id: id, name: cleanName, url: source })
              })
                .then(async (r) => {
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || !j.ok) {
                    if (j?.note) window.alert(`Couldn’t read that website.\n\n${j.note}`);
                    throw new Error(j?.note ?? j?.error ?? 'index failed');
                  }
                  queueMediaPatch(id, {
                    status: 'indexed',
                    chunks: j.chunks,
                    ...(j.title ? { name: j.title } : {})
                  });
                })
                .catch((e: unknown) =>
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error && e.message ? e.message : 'Indexing failed'
              })
            )
            );
            return id;
          }

          enqueueIndex(() =>
            fetch('/api/index', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_id: id,
                name: cleanName,
                type,
                text: source ? `${cleanName}\n${source}` : cleanName
              })
            })
              .then((r) => {
                if (!r.ok) throw new Error();
                queueMediaPatch(id, { status: 'indexed' });
              })
              .catch((e: unknown) =>
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error && e.message ? e.message : 'Indexing failed'
              })
            )
          );
          return id;
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
          enqueueIndex(() =>
            fetch('/api/index-image', { method: 'POST', body: fd })
              .then(async (r) => {
                const j = await r.json().catch(() => ({}));
                if (!r.ok || !j.ok) throw new Error(j?.error ?? 'upload failed');
                queueMediaPatch(id, {
                  status: j.indexed ? 'indexed' : 'processing',
                  source: j.image_url, // hosted URL → thumbnail + visual search
                  content: j.caption || name
                });
                if (!j.indexed && j.note) console.warn('[image-index]', j.note);
              })
              .catch((e: unknown) =>
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error && e.message ? e.message : 'Indexing failed'
              })
            )
          );
          return id;
        }}
        onNewDocuments={(docs) => {
          // Batch upload (PDF/DOCX/EPUB/TXT). Chips appear immediately; the
          // uploads run THROTTLED (3 at a time) so a dozen files don't swamp the
          // Make webhook + Pinecone. Each file → extract → chunk → text pipeline.
          const jobs = docs.map(({ name, file, ocr }) => {
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
            return { id, name, file, ocr };
          });

          // Large/binary docs (books!) exceed Vercel's ~4.5MB POST cap, so the
          // client uploads the RAW file STRAIGHT to CloudConvert (no cap) and the
          // server indexes the extracted text. Tiny text files (and the
          // no-CloudConvert fallback) use a direct multipart POST.
          const BINARY = /\.(pdf|epub|docx|doc|rtf|odt)$/i;
          const upload = async ({ id, name, file, ocr }: (typeof jobs)[number]) => {
            const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
            try {
              if (BINARY.test(file.name)) {
                const jr = await fetch('/api/doc-job', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ext, ocr: !!ocr })
                });
                if (jr.ok) {
                  const { jobId, upload: form } = await jr.json();
                  const ccForm = new FormData();
                  for (const [k, v] of Object.entries(form?.parameters ?? {}))
                    ccForm.append(k, v as string);
                  ccForm.append('file', file);
                  const ur = await fetch(form.url, { method: 'POST', body: ccForm });
                  if (!ur.ok && ur.status !== 201)
                    throw new Error('Upload to the file converter failed.');
                  const ir = await fetch('/api/index-doc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source_id: id, name, cc_job_id: jobId })
                  });
                  const ij = await ir.json().catch(() => ({}));
                  if (!ir.ok || !ij.ok)
                    throw new Error(ij?.error ?? ij?.note ?? 'index failed');
                  queueMediaPatch(id, {
                    status: 'indexed',
                    chunks: ij.chunks,
                    source: ij.source_url
                  });
                  return;
                }
                // doc-job unavailable → fall through to the direct path (small
                // files still work; big ones will surface a clear 413 error).
              }
              const fd = new FormData();
              fd.append('file', file);
              fd.append('name', name);
              fd.append('source_id', id);
              if (ocr) fd.append('ocr', 'true');
              const r = await fetch('/api/index-doc', { method: 'POST', body: fd });
              const j = await r.json().catch(() => ({}));
              if (!r.ok || !j.ok)
                throw new Error(j?.error ?? j?.note ?? 'index failed');
              queueMediaPatch(id, {
                status: 'indexed',
                chunks: j.chunks,
                source: j.source_url
              });
            } catch (e) {
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error ? e.message : 'index failed'
              });
            }
          };

          // Concurrency-capped pool over the batch.
          let next = 0;
          const CONCURRENCY = 3;
          const runners = Array.from(
            { length: Math.min(CONCURRENCY, jobs.length) },
            async () => {
              while (next < jobs.length) await upload(jobs[next++]);
            }
          );
          void Promise.all(runners);
          return jobs.map((j) => j.id);
        }}
        onRetrySource={retrySource}
        onDeleteSource={deleteSource}
        boxes={board.nodes
          .filter((n) => n.type === 'hub' && n.data.mediaType === 'cluster')
          .map((n) => ({ id: n.id, name: (n.data.name as string) || 'Untitled box' }))}
        onCollectIntoBox={(box, mediaIds) => {
          // Gather freshly-imported pieces into a box — either a NEW named box or
          // an EXISTING one. The free chips just placed are removed and re-docked
          // in the box's grid (existing members realign to the new column count).
          if (!mediaIds.length) return;
          const isMember = (n: BoardNode) =>
            n.type === 'chip' ||
            n.type === 'textNode' ||
            n.type === 'prompt' ||
            n.type === 'agent';
          const idSet = new Set(mediaIds);
          setBoard((prev) => {
            // Pull these sources' chips out of WHEREVER they are (free, or in
            // another box) so the whole set ends up together in the target box.
            const leftHubs = new Set<string>();
            let nodes = prev.nodes.filter((n) => {
              if (n.type === 'chip' && idSet.has(n.data.mediaId as string)) {
                if (n.parentId) leftHubs.add(n.parentId);
                return false;
              }
              return true;
            });
            let hubId: string;
            if ('id' in box) {
              hubId = box.id;
              if (!nodes.some((n) => n.id === hubId)) return prev; // box gone
            } else {
              hubId = nextBoardId('hub');
              // Reserve the box's REAL (collapse-aware) footprint when placing
              // it, but DON'T bake size onto the node — it measures its own DOM.
              const size = hubFootprint({ mediaType: 'cluster' }, mediaIds.length);
              const pos = freePosition(nodes, centerPos(), size.width, size.height);
              nodes.push({
                id: hubId,
                type: 'hub',
                position: pos,
                data: { name: box.name, mediaType: 'cluster' }
              });
            }
            mediaIds.forEach((mid) =>
              nodes.push({
                id: nextBoardId('chip'),
                type: 'chip',
                parentId: hubId,
                position: { x: 0, y: 0 },
                data: { mediaId: mid }
              })
            );
            // Re-tile the target box AND any boxes the chips left. Hubs size
            // themselves from their DOM, so just strip any stale baked-in size
            // (a leftover width/height = a huge invisible hit box).
            for (const h of new Set([hubId, ...leftHubs])) {
              nodes = retile(nodes, h);
              nodes = nodes.map((n) =>
                n.id === h && (n.width != null || n.height != null)
                  ? { ...n, width: undefined, height: undefined }
                  : n
              );
            }
            return { ...prev, nodes };
          });
        }}
        onAddBrain={() => {
          // Up to 5 brains per board — one per subject/angle in a project.
          const brainCount = board.nodes.filter((n) => n.type === 'brain').length;
          if (brainCount >= 5) {
            window.alert('You can have up to 5 Answers Banks on a board.');
            return;
          }
          pushNode({
            id: nextBoardId('brain'),
            type: 'brain',
            position: centerPos(),
            width: 500,
            height: 600,
            data: { name: `Answers Bank ${brainCount + 1}` }
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
        onAddArtifact={() => setArtifactDlgOpen(true)}
        onAddReference={() => setReferenceDlgOpen(true)}
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
              if (!r.ok) throw new Error(`Indexing failed (HTTP ${r.status})`);
              queueMediaPatch(id, { status: 'indexed' });
            })
            .catch((e: unknown) =>
              queueMediaPatch(id, {
                status: 'failed',
                error: e instanceof Error && e.message ? e.message : 'Indexing failed'
              })
            );
        }}
        onNewAudio={(name, file) => {
          // Uploaded audio file → transcribe (MAI-Transcribe) → the transcript
          // IS the embedded text. Optimistic chip now; status flips on index.
          const id = addMedia(
            {
              type: 'audio',
              name,
              description: 'Uploaded audio (transcribed)',
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
          (async () => {
            try {
              // Transcribe WITH per-phrase timestamps → index a [M:SS]-marked
              // transcript so audio citations can point to the moment.
              const transcript = timestampedTranscript(await transcribeAudioDetailed(file));
              const r = await fetch('/api/index', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  source_id: id,
                  name,
                  type: 'audio',
                  text: transcript
                })
              });
              if (!r.ok) throw new Error(`Indexing failed (HTTP ${r.status})`);
              queueMediaPatch(id, { status: 'indexed', content: transcript });
            } catch (e: unknown) {
              const status = (e as { status?: number })?.status;
              const error =
                status === 501 || status === 503
                  ? 'High-accuracy transcription isn’t configured yet.'
                  : e instanceof Error && e.message
                    ? e.message
                    : 'Indexing failed';
              queueMediaPatch(id, { status: 'failed', error });
            }
          })();
        }}
      />

      {/* the CHEST — bottom dock of all produced media + prompts, drag onto
          the canvas as puzzle pieces */}
      <ArtifactDialog
        open={artifactDlgOpen}
        onOpenChange={setArtifactDlgOpen}
        onCreate={(a) => {
          const artId = nextBoardId('art');
          const brains = board.nodes.filter((n) => n.type === 'brain' && !n.parentId);
          pushNode({
            id: artId,
            type: 'artifact',
            position: centerPos(),
            width: 280,
            height: 240,
            data: {
              title: a.title ?? '',
              url: a.url ?? '',
              content: a.content,
              image: a.image,
              screenshot: a.screenshot
            }
          });
          // An artifact is born connected to a brain. One brain → auto-wire;
          // several → ask which; none → tell the user to add one.
          if (brains.length === 1) connectArtifactToBrain(artId, brains[0].id);
          else if (brains.length > 1) setBrainPicker({ artId });
          else
            window.alert(
              'Add an Answers Bank to the board first — a Draft must be connected to an Answers Bank.'
            );
        }}
      />
      <ArtifactDialog
        kind="reference"
        open={referenceDlgOpen}
        onOpenChange={setReferenceDlgOpen}
        onCreate={(a) => {
          // Same multi-modal ingestion as an artifact (file/audio/PDF-via-
          // CloudConvert/website/text) → a TOP-plug reference exemplar. The user
          // wires it to a brain's reference plug.
          pushNode({
            id: nextBoardId('ref'),
            type: 'reference',
            position: centerPos(),
            width: 234,
            height: 170,
            data: { title: a.title ?? '', url: a.url ?? '', content: a.content }
          });
        }}
      />
      <ArtifactBrainPicker />
      <AgentEditDialog />
      {/* Delete confirmation — any node delete (robot button or right-click) asks
          first. */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-[330px] rounded-2xl border border-[rgb(var(--hairline)/0.16)] bg-card p-5 shadow-[0_20px_60px_-10px_rgb(0_0_0/0.45)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold">Delete this?</h3>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              It will be removed from the board. This can&apos;t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/10"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = pendingDelete;
                  setPendingDelete(null);
                  deleteNodeById(id);
                }}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Build stamp — confirm you're on the latest code at a glance. */}
      <div className="pointer-events-none absolute bottom-1.5 right-2 z-50 rounded bg-black/55 px-2 py-0.5 font-mono text-[10px] text-amber-300/90">
        build {process.env.NEXT_PUBLIC_BUILD ?? 'dev'}
      </div>
      <BoardChest
        placedIds={placedIds}
        onSave={saveNow}
        binRef={binRef}
        binHot={binHot}
        dockRef={dockRef}
        onDeleteSelected={onDeleteSelected}
        onFocusBox={(hubId) =>
          fitView({ nodes: [{ id: hubId }], duration: 450, padding: 0.3 })
        }
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
        onPlaceAgent={(agent) =>
          pushNode({
            id: nextBoardId('agent'),
            type: 'agent',
            position: centerPos(),
            width: AGENT_W,
            height: AGENT_H,
            data: {
              agentId: agent.agentId,
              name: agent.name,
              icon: agent.icon ?? '',
              text: agent.text
            }
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
            {ctxNode.type === 'agent' && (
              <button
                onClick={() => {
                  setAgentEditor(ctxMenu.nodeId);
                  setCtxMenu(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent/10"
              >
                <Pencil className="h-4 w-4 text-foreground/70" /> Edit agent
              </button>
            )}
            <div className="my-1 h-px bg-[rgb(var(--hairline)/0.12)]" />
            <button
              onClick={() => {
                setPendingDelete(ctxMenu.nodeId);
                setCtxMenu(null);
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
