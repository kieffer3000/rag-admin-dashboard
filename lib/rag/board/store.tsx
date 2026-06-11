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
  ReactNode
} from 'react';
import { useRag } from '../store';
import { ChatMessage, MediaItem } from '../types';
import { BoardNode, BoardEdge, BoardState, hubSize, hubSlot } from './types';

let boardIdCounter = 5000;
const nextId = (prefix: string) => `${prefix}${++boardIdCounter}`;

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
  nextBoardId: (prefix: string) => string;
}

const Ctx = createContext<BoardCtxState | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const { activeProjectId, projectMedia, media } = useRag();
  const [boards, setBoards] = useState<Record<string, BoardState>>({});
  const [brainMessages, setBrainMessages] = useState<Record<string, ChatMessage[]>>({});

  const board = useMemo<BoardState>(() => {
    return boards[activeProjectId] ?? seedBoard(projectMedia);
    // projectMedia only matters for the first seed of a project's board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, activeProjectId]);

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

      for (const e of edges) {
        if (e.target !== brainId) continue;
        const src = byId.get(e.source);
        if (!src) continue;
        if (src.type === 'chip') {
          ids.push(src.data.mediaId as string);
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
    nextBoardId: nextId
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBoard must be used within BoardProvider');
  return ctx;
}
