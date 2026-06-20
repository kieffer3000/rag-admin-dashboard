'use client';

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
import {
  MediaItem,
  Agent,
  ChatMessage,
  QueryScope,
  MediaType,
  Project,
  Conversation,
  Note,
  Citation
} from './types';
import {
  MOCK_AGENTS,
  MOCK_PROJECTS,
  MOCK_NOTES
} from './mock-data';
import { DEFAULT_MODEL_ID } from './models';

interface RagState {
  media: MediaItem[];
  agents: Agent[];
  projects: Project[];
  activeProjectId: string;
  conversations: Conversation[];
  activeConversationId: string | null;
  notes: Note[];
  selectedIds: Set<string>;
  scope: QueryScope;
  modelId: string;
  /** Citation currently open in the source viewer sheet. */
  viewerCitation: Citation | null;
  /** Answer text the viewer highlights the cited passage against (so the user
   *  sees WHERE in a long chunk the answer resides). */
  viewerHighlight: string | null;

  // selection
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setScope: (s: QueryScope) => void;
  setModel: (id: string) => void;

  // media
  addMedia: (
    item: Omit<MediaItem, 'id' | 'status' | 'chunks'>,
    opts?: { simulate?: boolean }
  ) => string;
  /** Merge persisted media back in on load (board persistence). */
  hydrateMedia: (items: MediaItem[], projectId: string) => void;
  updateMedia: (id: string, patch: Partial<MediaItem>) => void;
  deleteMedia: (id: string) => void;
  reindexMedia: (id: string) => void;

  // projects
  setActiveProject: (id: string) => void;
  addProject: (p: { name: string; icon: string; description: string }) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  addSourcesToProject: (projectId: string, sourceIds: string[]) => void;
  removeSourceFromProject: (projectId: string, sourceId: string) => void;

  // conversations
  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  togglePinConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  addMessage: (m: ChatMessage) => void;

  // notes
  addNote: (content: string, citations?: Citation[]) => void;
  deleteNote: (id: string) => void;

  // agents
  addAgent: (a: Omit<Agent, 'id'>) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  deleteAgent: (id: string) => void;

  // viewer
  openViewer: (c: Citation, highlight?: string) => void;
  closeViewer: () => void;

  // derived
  activeProject: Project;
  projectMedia: MediaItem[];
  projectConversations: Conversation[];
  projectNotes: Note[];
  activeConversation: Conversation | null;
  contextItems: MediaItem[];
}

const Ctx = createContext<RagState | null>(null);

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}${++idCounter}`;
const now = () => new Date().toISOString();

export function RagProvider({ children }: { children: ReactNode }) {
  // Start empty — only real, indexed sources appear (no sample/mock files).
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>(MOCK_AGENTS);
  // Agents persist to Neon (account-global) with a localStorage cache as the
  // same-device safety net. `agentsHydrated` gates the save effect so the seed
  // never clobbers saved agents before the load resolves.
  const agentsHydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/agents');
        const j = r.ok ? await r.json() : null;
        if (cancelled) return;
        if (j && Array.isArray(j.agents)) {
          // Drop any stale built-in seeds (Scholar/Explainer) a prior version
          // persisted — we no longer seed built-ins, and user-created agents
          // are never `builtIn`. Re-persist if we cleaned anything.
          const cleaned = (j.agents as Agent[]).filter((a) => !a.builtIn);
          setAgents(cleaned); // DB is authoritative
          if (cleaned.length !== j.agents.length) {
            fetch('/api/agents', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agents: cleaned })
            }).catch(() => {});
          }
        } else {
          // No saved row (or no DB) → restore from localStorage, else keep the
          // seed; then create the row so future loads are authoritative.
          let fromLs: Agent[] | null = null;
          try {
            const ls = localStorage.getItem('answersdoc_agents_v1');
            if (ls) fromLs = JSON.parse(ls);
          } catch {
            /* private mode / quota */
          }
          if (Array.isArray(fromLs)) setAgents(fromLs);
          const initial = Array.isArray(fromLs) ? fromLs : MOCK_AGENTS;
          fetch('/api/agents', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agents: initial })
          }).catch(() => {});
        }
      } catch {
        /* offline → keep seed */
      } finally {
        if (!cancelled) agentsHydrated.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on every change (localStorage immediately, DB debounced), but only
  // after hydration so the initial seed render can't overwrite saved agents.
  useEffect(() => {
    if (!agentsHydrated.current) return;
    try {
      localStorage.setItem('answersdoc_agents_v1', JSON.stringify(agents));
    } catch {
      /* private mode / quota */
    }
    const t = setTimeout(() => {
      fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents })
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [agents]);
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState<string>(MOCK_PROJECTS[0].id);
  // Projects persist to Neon (account-global) + a localStorage cache, so a
  // project you create survives a refresh (its board/sources already persist).
  const projectsHydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/projects');
        const j = r.ok ? await r.json() : null;
        if (cancelled) return;
        let list: Project[] | null = null;
        if (j && Array.isArray(j.projects) && j.projects.length) {
          list = j.projects;
        } else {
          try {
            const ls = localStorage.getItem('answersdoc_projects_v1');
            if (ls) {
              const arr = JSON.parse(ls);
              if (Array.isArray(arr) && arr.length) list = arr;
            }
          } catch {
            /* private mode */
          }
          if (!list && (!j || j.projects === null)) {
            // Never saved → persist the current seed so the row exists.
            fetch('/api/projects', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projects: MOCK_PROJECTS })
            }).catch(() => {});
          }
        }
        if (list) {
          setProjects(list);
          // Re-open the project you were last on, if it still exists.
          let last: string | null = null;
          try {
            last = localStorage.getItem('answersdoc_active_project_v1');
          } catch {
            /* ignore */
          }
          setActiveProjectId(
            (last && list.some((p) => p.id === last) ? last : list[0].id)
          );
        }
      } catch {
        /* offline → keep seed */
      } finally {
        if (!cancelled) projectsHydrated.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the project list (localStorage now, DB debounced) once hydrated.
  useEffect(() => {
    if (!projectsHydrated.current) return;
    try {
      localStorage.setItem('answersdoc_projects_v1', JSON.stringify(projects));
    } catch {
      /* private mode */
    }
    const t = setTimeout(() => {
      fetch('/api/projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects })
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [projects]);

  // Remember which project is open, so a refresh reopens it (not always the seed).
  useEffect(() => {
    try {
      localStorage.setItem('answersdoc_active_project_v1', activeProjectId);
    } catch {
      /* private mode */
    }
  }, [activeProjectId]);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>(MOCK_NOTES);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [scope, setScope] = useState<QueryScope>('selected');
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [viewerCitation, setViewerCitation] = useState<Citation | null>(null);
  const [viewerHighlight, setViewerHighlight] = useState<string | null>(null);

  // ---- selection ----
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

  // ---- media ----
  const simulateIndexing = useCallback((id: string) => {
    setTimeout(() => {
      setMedia((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, status: 'indexed', chunks: Math.floor(20 + Math.random() * 200) }
            : m
        )
      );
    }, 2600);
  }, []);

  const addMedia = useCallback(
    (
      item: Omit<MediaItem, 'id' | 'status' | 'chunks'>,
      opts?: { simulate?: boolean }
    ) => {
      const id = nextId('m');
      const newItem: MediaItem = { ...item, id, status: 'processing', chunks: 0 };
      setMedia((prev) => [newItem, ...prev]);
      // New sources join the active project automatically.
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProjectId ? { ...p, sourceIds: [...p.sourceIds, id] } : p
        )
      );
      // Real ingestion (Board → /api/index) reports its own status;
      // only simulate for the mock-backed flows.
      if (opts?.simulate !== false) simulateIndexing(id);
      return id;
    },
    [activeProjectId, simulateIndexing]
  );

  const updateMedia = useCallback((id: string, patch: Partial<MediaItem>) => {
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const hydrateMedia = useCallback((items: MediaItem[], projectId: string) => {
    if (!items?.length) return;
    // Advance the id counter past every loaded id. The counter is module-level
    // and resets to its seed on each page load, so without this a fresh import
    // (`m1001`, `m1002`, …) collides with already-persisted media of the same
    // id — the new item is prepended and shadows the old one, making an
    // existing chip render the newly-imported source. Bumping here guarantees
    // freshly-created media ids never collide with hydrated ones.
    for (const it of items) {
      const m = /(\d+)$/.exec(it.id);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > idCounter) idCounter = n;
      }
    }
    setMedia((prev) => {
      const have = new Set(prev.map((m) => m.id));
      const add = items.filter((i) => !have.has(i.id));
      return add.length ? [...add, ...prev] : prev;
    });
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, sourceIds: Array.from(new Set([...p.sourceIds, ...items.map((i) => i.id)])) }
          : p
      )
    );
  }, []);

  const deleteMedia = useCallback((id: string) => {
    // Delete the source's vectors from Pinecone too (best-effort, fire-and-
    // forget) so a removed source doesn't leave orphaned, still-searchable data.
    fetch('/api/delete-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: id })
    }).catch(() => {});
    setMedia((prev) => prev.filter((m) => m.id !== id));
    setProjects((prev) =>
      prev.map((p) => ({ ...p, sourceIds: p.sourceIds.filter((s) => s !== id) }))
    );
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const reindexMedia = useCallback(
    (id: string) => {
      setMedia((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: 'processing', chunks: 0 } : m))
      );
      simulateIndexing(id);
    },
    [simulateIndexing]
  );

  // ---- projects ----
  const setActiveProject = useCallback((id: string) => {
    setActiveProjectId(id);
    setActiveConversationId(null);
    setSelectedIds(new Set());
  }, []);

  const addProject = useCallback(
    (p: { name: string; icon: string; description: string }) => {
      const id = nextId('proj');
      setProjects((prev) => [
        ...prev,
        { ...p, id, sourceIds: [], createdAt: now().slice(0, 10) }
      ]);
      setActiveProjectId(id);
      setActiveConversationId(null);
      setSelectedIds(new Set());
    },
    []
  );

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const deleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => {
        const remaining = prev.filter((p) => p.id !== id);
        if (remaining.length === 0) {
          const fallback: Project = {
            id: nextId('proj'),
            name: 'My Knowledge Base',
            icon: '📚',
            description: '',
            sourceIds: [],
            createdAt: now().slice(0, 10)
          };
          setActiveProjectId(fallback.id);
          return [fallback];
        }
        if (id === activeProjectId) setActiveProjectId(remaining[0].id);
        return remaining;
      });
      setConversations((prev) => prev.filter((c) => c.projectId !== id));
      setNotes((prev) => prev.filter((n) => n.projectId !== id));
      setActiveConversationId(null);
    },
    [activeProjectId]
  );

  const addSourcesToProject = useCallback((projectId: string, sourceIds: string[]) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, sourceIds: Array.from(new Set([...p.sourceIds, ...sourceIds])) }
          : p
      )
    );
  }, []);

  const removeSourceFromProject = useCallback(
    (projectId: string, sourceId: string) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, sourceIds: p.sourceIds.filter((s) => s !== sourceId) }
            : p
        )
      );
    },
    []
  );

  // ---- conversations ----
  const newConversation = useCallback(() => {
    const id = nextId('conv');
    const conv: Conversation = {
      id,
      projectId: activeProjectId,
      title: 'New chat',
      pinned: false,
      messages: [],
      createdAt: now(),
      updatedAt: now()
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveConversationId(id);
    return id;
  }, [activeProjectId]);

  const setActiveConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const togglePinConversation = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  }, []);

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setActiveConversationId((cur) => (cur === id ? null : cur));
    },
    []
  );

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }, []);

  const addMessage = useCallback(
    (m: ChatMessage) => {
      setConversations((prev) => {
        let targetId = activeConversationId;
        let list = prev;
        // Lazily create a conversation on first message.
        if (!targetId || !prev.some((c) => c.id === targetId)) {
          targetId = nextId('conv');
          const conv: Conversation = {
            id: targetId,
            projectId: activeProjectId,
            title: 'New chat',
            pinned: false,
            messages: [],
            createdAt: now(),
            updatedAt: now()
          };
          list = [conv, ...prev];
          setActiveConversationId(targetId);
        }
        return list.map((c) => {
          if (c.id !== targetId) return c;
          const title =
            c.title === 'New chat' && m.role === 'user'
              ? m.content.slice(0, 48) + (m.content.length > 48 ? '…' : '')
              : c.title;
          return { ...c, title, messages: [...c.messages, m], updatedAt: now() };
        });
      });
    },
    [activeConversationId, activeProjectId]
  );

  // ---- notes ----
  const addNote = useCallback(
    (content: string, citations?: Citation[]) => {
      setNotes((prev) => [
        {
          id: nextId('n'),
          projectId: activeProjectId,
          content,
          citations,
          createdAt: now().slice(0, 10)
        },
        ...prev
      ]);
    },
    [activeProjectId]
  );

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // ---- agents ----
  const addAgent = useCallback((a: Omit<Agent, 'id'>) => {
    setAgents((prev) => [{ ...a, id: nextId('a') }, ...prev]);
  }, []);

  const updateAgent = useCallback((id: string, patch: Partial<Agent>) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const deleteAgent = useCallback((id: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ---- viewer ----
  const openViewer = useCallback((c: Citation, highlight?: string) => {
    setViewerCitation(c);
    setViewerHighlight(highlight ?? null);
  }, []);
  const closeViewer = useCallback(() => {
    setViewerCitation(null);
    setViewerHighlight(null);
  }, []);

  // ---- derived ----
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId]
  );

  const projectMedia = useMemo(
    () => media.filter((m) => activeProject.sourceIds.includes(m.id)),
    [media, activeProject]
  );

  const projectConversations = useMemo(
    () =>
      conversations
        .filter((c) => c.projectId === activeProjectId)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
    [conversations, activeProjectId]
  );

  const projectNotes = useMemo(
    () => notes.filter((n) => n.projectId === activeProjectId),
    [notes, activeProjectId]
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const contextItems = useMemo(() => {
    if (scope === 'everything')
      return projectMedia.filter((m) => m.status === 'indexed');
    return projectMedia.filter((m) => selectedIds.has(m.id));
  }, [projectMedia, selectedIds, scope]);

  const value: RagState = {
    media,
    agents,
    projects,
    activeProjectId,
    conversations,
    activeConversationId,
    notes,
    selectedIds,
    scope,
    modelId,
    viewerCitation,
    viewerHighlight,
    toggleSelect,
    selectAll,
    clearSelection,
    setScope,
    setModel: setModelId,
    addMedia,
    hydrateMedia,
    updateMedia,
    deleteMedia,
    reindexMedia,
    setActiveProject,
    addProject,
    updateProject,
    deleteProject,
    addSourcesToProject,
    removeSourceFromProject,
    newConversation,
    setActiveConversation,
    togglePinConversation,
    deleteConversation,
    renameConversation,
    addMessage,
    addNote,
    deleteNote,
    addAgent,
    updateAgent,
    deleteAgent,
    openViewer,
    closeViewer,
    activeProject,
    projectMedia,
    projectConversations,
    projectNotes,
    activeConversation,
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
