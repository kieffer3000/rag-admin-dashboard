'use client';

// Board state: one canvas per project (v1 — multi-board lands with Neon
// persistence). Boards live in memory for the session; the scope assembler
// here is THE bridge between graph connectivity and the Query webhook's
// source_ids[] contract. See BOARD_SPEC.md.

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  ReactNode
} from 'react';
import { useRag } from '../store';
import { ChatMessage, MediaItem } from '../types';
import {
  BoardNode,
  BoardEdge,
  BoardState,
  hubSize,
  hubSlot,
  stackOf
} from './types';

let boardIdCounter = 5000;
const nextId = (prefix: string) => `${prefix}${++boardIdCounter}`;

/** After loading a saved board, advance the counter past existing numeric ids
 *  so freshly-created nodes/edges never collide with persisted ones. */
function bumpCounterFrom(ids: string[]) {
  for (const id of ids) {
    const m = /(\d+)$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > boardIdCounter) boardIdCounter = n;
    }
  }
}

/** Seed a friendly starter layout from the project's existing sources. */
function seedBoard(media: MediaItem[]): BoardState {
  const docs = media.filter((m) => m.type === 'document').slice(0, 3);
  const loose = media.filter((m) => m.type !== 'document').slice(0, 3);

  const brainId = nextId('brain');
  const hubId = nextId('hub');

  const nodes: BoardNode[] = [
    {
      id: brainId,
      type: 'brain',
      position: { x: 640, y: 160 },
      width: 400,
      height: 480,
      data: { name: 'answersDoc Brain' }
    }
  ];
  const edges: BoardEdge[] = [];

  if (docs.length > 0) {
    nodes.push({
      id: hubId,
      type: 'hub',
      position: { x: 80, y: 80 },
      data: { name: 'Documents', mediaType: 'document' },
      ...hubSize(docs.length)
    });
    docs.forEach((m, i) => {
      nodes.push({
        id: nextId('chip'),
        type: 'chip',
        position: hubSlot(i),
        parentId: hubId,
        data: { mediaId: m.id }
      });
    });
    edges.push({
      id: nextId('e'),
      source: hubId,
      target: brainId,
      type: 'scope'
    });
  }

  loose.forEach((m, i) => {
    nodes.push({
      id: nextId('chip'),
      type: 'chip',
      position: { x: 120 + (i % 2) * 200, y: 420 + Math.floor(i / 2) * 90 },
      data: { mediaId: m.id }
    });
  });

  return { nodes, edges };
}

export interface BrainScope {
  /** Indexed media in scope for this brain, in wiring order (deduped). */
  items: MediaItem[];
  /** Ephemeral context texts from wired text nodes. */
  contextTexts: string[];
  /** True if an Everything hub is wired in. */
  everything: boolean;
}

interface BoardCtxState {
  /** Board for the ACTIVE project (lazily seeded). */
  board: BoardState;
  setBoard: (updater: (prev: BoardState) => BoardState) => void;
  /** Chat messages per brain node id. */
  brainMessages: Record<string, ChatMessage[]>;
  addBrainMessage: (brainId: string, m: ChatMessage) => void;
  updateBrainMessage: (brainId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  /** Resolve a brain's knowledge basis from graph connectivity. */
  resolveBrainScope: (brainId: string) => BrainScope;
  /** Patch a node's data (controlled flow — must go through the provider). */
  updateBoardNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  /** Set a node's width/height (used by the half-screen toggle). */
  resizeBoardNode: (
    nodeId: string,
    width: number,
    height: number,
    extraData?: Record<string, unknown>
  ) => void;
  /** Disconnect an edge (the hover-✕ on a connection). */
  removeBoardEdge: (edgeId: string) => void;
  /** Brains with a query in flight — their inbound edges march. */
  busyBrains: Set<string>;
  setBrainBusy: (brainId: string, busy: boolean) => void;
  nextBoardId: (prefix: string) => string;
}

const Ctx = createContext<BoardCtxState | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const { activeProjectId, projectMedia, media, hydrateMedia } = useRag();
  const [boards, setBoards] = useState<Record<string, BoardState>>({});
  const [brainMessages, setBrainMessages] = useState<Record<string, ChatMessage[]>>({});
  /** Projects whose saved state we've already loaded (don't reload/overwrite). */
  const hydrated = useRef<Set<string>>(new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const board = useMemo<BoardState>(() => {
    return boards[activeProjectId] ?? seedBoard(projectMedia);
    // projectMedia only matters for the first seed of a project's board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, activeProjectId]);

  // ---- LOAD persisted board on project mount/switch (Neon via /api/board) ----
  useEffect(() => {
    const pid = activeProjectId;
    if (hydrated.current.has(pid)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/board?projectId=${encodeURIComponent(pid)}`);
        if (res.ok) {
          const { data } = await res.json();
          if (!cancelled && data) {
            if (Array.isArray(data.media)) hydrateMedia(data.media, pid);
            bumpCounterFrom([
              ...(data.nodes ?? []).map((n: { id: string }) => n.id),
              ...(data.edges ?? []).map((e: { id: string }) => e.id)
            ]);
            setBoards((prev) => ({
              ...prev,
              [pid]: { nodes: data.nodes ?? [], edges: data.edges ?? [] }
            }));
            if (data.brainMessages)
              setBrainMessages((prev) => ({ ...prev, ...data.brainMessages }));
          }
        }
      } catch {
        /* offline / no DB → keep the seed */
      } finally {
        if (!cancelled) hydrated.current.add(pid);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, hydrateMedia]);

  // ---- AUTOSAVE (debounced) once the project is hydrated ----
  useEffect(() => {
    const pid = activeProjectId;
    if (!hydrated.current.has(pid)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const brainIds = new Set(
        board.nodes.filter((n) => n.type === 'brain').map((n) => n.id)
      );
      const msgs = Object.fromEntries(
        Object.entries(brainMessages).filter(([k]) => brainIds.has(k))
      );
      const doc = {
        nodes: board.nodes,
        edges: board.edges,
        brainMessages: msgs,
        media: projectMedia
      };
      fetch('/api/board', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid, data: doc })
      }).catch(() => {});
    }, 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [board, brainMessages, projectMedia, activeProjectId]);

  const setBoard = useCallback(
    (updater: (prev: BoardState) => BoardState) => {
      setBoards((prev) => {
        const cur = prev[activeProjectId] ?? board;
        return { ...prev, [activeProjectId]: updater(cur) };
      });
    },
    [activeProjectId, board]
  );

  const updateBoardNodeData = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setBoard((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
        )
      }));
    },
    [setBoard]
  );

  const resizeBoardNode = useCallback(
    (
      nodeId: string,
      width: number,
      height: number,
      extraData?: Record<string, unknown>
    ) => {
      setBoard((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                width,
                height,
                data: extraData ? { ...n.data, ...extraData } : n.data
              }
            : n
        )
      }));
    },
    [setBoard]
  );

  const [busyBrains, setBusyBrains] = useState<Set<string>>(new Set());
  const setBrainBusy = useCallback((brainId: string, busy: boolean) => {
    setBusyBrains((prev) => {
      const next = new Set(prev);
      busy ? next.add(brainId) : next.delete(brainId);
      return next;
    });
  }, []);

  const removeBoardEdge = useCallback(
    (edgeId: string) => {
      setBoard((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== edgeId)
      }));
    },
    [setBoard]
  );

  const addBrainMessage = useCallback((brainId: string, m: ChatMessage) => {
    setBrainMessages((prev) => ({
      ...prev,
      [brainId]: [...(prev[brainId] ?? []), m]
    }));
  }, []);

  const updateBrainMessage = useCallback(
    (brainId: string, msgId: string, patch: Partial<ChatMessage>) => {
      setBrainMessages((prev) => ({
        ...prev,
        [brainId]: (prev[brainId] ?? []).map((m) =>
          m.id === msgId ? { ...m, ...patch } : m
        )
      }));
    },
    []
  );

  /**
   * THE assembler: connectivity → source_ids.
   * chip→brain = that source; hub→brain = all docked chips;
   * everything-hub→brain = all indexed project sources;
   * textNode→brain = ephemeral prompt context.
   */
  const resolveBrainScope = useCallback(
    (brainId: string): BrainScope => {
      const { nodes, edges } = board;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const ids: string[] = [];
      const contextTexts: string[] = [];
      let everything = false;

      const typeOf = (n: BoardNode) =>
        media.find((m) => m.id === n.data.mediaId)?.type;

      for (const e of edges) {
        if (e.target !== brainId) continue;
        const src = byId.get(e.source);
        if (!src) continue;
        if (src.type === 'chip') {
          // A puzzle stack is ONE piece: wiring any member wires them all.
          for (const member of stackOf(src, nodes, typeOf)) {
            ids.push(member.data.mediaId as string);
          }
        } else if (src.type === 'hub') {
          if (src.data.mediaType === 'everything') {
            everything = true;
            projectMedia.forEach((m) => ids.push(m.id));
          } else {
            nodes
              .filter((n) => n.type === 'chip' && n.parentId === src.id)
              .forEach((n) => ids.push(n.data.mediaId as string));
          }
        } else if (src.type === 'textNode') {
          const t = (src.data.text as string)?.trim();
          if (t) contextTexts.push(t);
        }
      }

      const seen = new Set<string>();
      const items: MediaItem[] = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const m = media.find((x) => x.id === id);
        if (m && m.status === 'indexed') items.push(m);
      }
      return { items, contextTexts, everything };
    },
    [board, media, projectMedia]
  );

  const value: BoardCtxState = {
    board,
    setBoard,
    brainMessages,
    addBrainMessage,
    updateBrainMessage,
    resolveBrainScope,
    updateBoardNodeData,
    resizeBoardNode,
    removeBoardEdge,
    busyBrains,
    setBrainBusy,
    nextBoardId: nextId
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBoard must be used within BoardProvider');
  return ctx;
}
