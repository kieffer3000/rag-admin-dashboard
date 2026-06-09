'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode
} from 'react';
import { MediaItem, Prompt, ChatMessage, QueryScope, MediaType } from './types';
import { MOCK_MEDIA, MOCK_PROMPTS } from './mock-data';
import { DEFAULT_MODEL_ID } from './models';

interface RagState {
  media: MediaItem[];
  prompts: Prompt[];
  selectedIds: Set<string>;
  scope: QueryScope;
  activePromptId: string | null;
  modelId: string;
  messages: ChatMessage[];

  // selection
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setScope: (s: QueryScope) => void;
  setModel: (id: string) => void;

  // media
  addMedia: (item: Omit<MediaItem, 'id' | 'status' | 'chunks'>) => void;
  updateMedia: (id: string, patch: Partial<MediaItem>) => void;
  deleteMedia: (id: string) => void;

  // prompts
  setActivePrompt: (id: string | null) => void;
  addPrompt: (p: Omit<Prompt, 'id'>) => void;
  updatePrompt: (id: string, patch: Partial<Prompt>) => void;
  deletePrompt: (id: string) => void;

  // chat
  addMessage: (m: ChatMessage) => void;
  resetChat: () => void;

  // derived
  contextItems: MediaItem[];
}

const Ctx = createContext<RagState | null>(null);

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}${++idCounter}`;

export function RagProvider({ children }: { children: ReactNode }) {
  const [media, setMedia] = useState<MediaItem[]>(MOCK_MEDIA);
  const [prompts, setPrompts] = useState<Prompt[]>(MOCK_PROMPTS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(['m1', 'm4'])
  );
  const [scope, setScope] = useState<QueryScope>('selected');
  const [activePromptId, setActivePromptId] = useState<string | null>('p1');
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.every((i) => prev.has(i));
      if (allSelected) {
        const next = new Set(prev);
        ids.forEach((i) => next.delete(i));
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const addMedia = useCallback(
    (item: Omit<MediaItem, 'id' | 'status' | 'chunks'>) => {
      const id = nextId('m');
      const newItem: MediaItem = {
        ...item,
        id,
        status: 'processing',
        chunks: 0
      };
      setMedia((prev) => [newItem, ...prev]);
      // Simulate async indexing for the demo.
      setTimeout(() => {
        setMedia((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  status: 'indexed',
                  chunks: Math.floor(20 + Math.random() * 200)
                }
              : m
          )
        );
      }, 2600);
    },
    []
  );

  const updateMedia = useCallback((id: string, patch: Partial<MediaItem>) => {
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const deleteMedia = useCallback((id: string) => {
    setMedia((prev) => prev.filter((m) => m.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const addPrompt = useCallback((p: Omit<Prompt, 'id'>) => {
    setPrompts((prev) => [{ ...p, id: nextId('p') }, ...prev]);
  }, []);

  const updatePrompt = useCallback((id: string, patch: Partial<Prompt>) => {
    setPrompts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const deletePrompt = useCallback((id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id));
    setActivePromptId((cur) => (cur === id ? null : cur));
  }, []);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const resetChat = useCallback(() => setMessages([]), []);

  const contextItems = useMemo(() => {
    if (scope === 'everything') return media.filter((m) => m.status === 'indexed');
    return media.filter((m) => selectedIds.has(m.id));
  }, [media, selectedIds, scope]);

  const value: RagState = {
    media,
    prompts,
    selectedIds,
    scope,
    activePromptId,
    modelId,
    messages,
    toggleSelect,
    selectAll,
    clearSelection,
    setScope,
    setModel: setModelId,
    addMedia,
    updateMedia,
    deleteMedia,
    setActivePrompt: setActivePromptId,
    addPrompt,
    updatePrompt,
    deletePrompt,
    addMessage,
    resetChat,
    contextItems
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRag() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRag must be used within RagProvider');
  return ctx;
}

export function mediaTypeCounts(media: MediaItem[]) {
  const counts: Record<MediaType, number> = {
    youtube: 0,
    image: 0,
    audio: 0,
    document: 0,
    text: 0,
    website: 0
  };
  media.forEach((m) => (counts[m.type] += 1));
  return counts;
}
