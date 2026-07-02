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
  useSyncExternalStore,
  ReactNode
} from 'react';
import { useRag } from '../store';
import { idbGetBoard, idbPutBoard } from './idb-cache';

// ---- Save status lives in a TINY external store, NOT the board context. Its
// saving↔saved flips happen on every save/keystroke; if it were a context field
// it would re-render every node + open dialog on each flip (the "flicker every
// few seconds"). useSaveStatus() subscribes ONLY the save indicator. ----
type SaveStatus = 'saved' | 'saving' | 'local';
let _saveStatus: SaveStatus = 'saved';
const _saveListeners = new Set<() => void>();
function setSaveStatus(s: SaveStatus) {
  if (_saveStatus === s) return;
  _saveStatus = s;
  _saveListeners.forEach((l) => l());
}
export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(
    (cb) => {
      _saveListeners.add(cb);
      return () => _saveListeners.delete(cb);
    },
    () => _saveStatus,
    () => _saveStatus
  );
}
import { MediaItem } from '../types';
import {
  getAllBrainMessages,
  mergeBrainMessages,
  subscribeBrainMessages
} from './brain-messages-store';
import {
  BoardNode,
  BoardEdge,
  BoardState,
  hubSlot,
  hubCols,
  hubCollapsed,
  hubFootprint,
  HUB_MINI_SIZE,
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
  stackOf
} from './types';

let boardIdCounter = 5000;
const nextId = (prefix: string) => `${prefix}${++boardIdCounter}`;

// ---- Local persistence (the safety net) ----------------------------------
// The DB (Neon) gives cross-device sync, but can be unconfigured or fail
// silently. localStorage GUARANTEES the board survives a refresh on this
// device, so a user can never lose their work to a backend hiccup.
const LS_PREFIX = 'answersdoc_board_v2_';
// Recovery lock (off): protection now lives SERVER-SIDE in /api/board PUT
// (anti-shrink guard), which works regardless of client code version.
const BOARD_RECOVERY_READONLY = false;
function readLocal(pid: string): any | null {
  try {
    const s = localStorage.getItem(LS_PREFIX + pid);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function writeLocal(pid: string, doc: unknown) {
  try {
    localStorage.setItem(LS_PREFIX + pid, JSON.stringify(doc));
  } catch {
    /* quota / private mode — DB + in-memory still hold it */
  }
}

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
      width: 500,
      height: 600,
      data: { name: 'Answers Bank 1' }
    }
  ];
  const edges: BoardEdge[] = [];

  if (docs.length > 0) {
    nodes.push({
      id: hubId,
      type: 'hub',
      position: { x: 80, y: 80 },
      data: { name: 'Documents', mediaType: 'cluster' }
      // No width/height: the hub measures its own (collapse-aware) DOM. A baked
      // size gives React Flow a huge invisible hit box on a minimized box.
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
  /** Instruction guides from wired prompt pieces (how to answer). */
  guides: string[];
  /** True if an Everything hub is wired in. */
  everything: boolean;
  /** Wired box (hub) ids — so "summarize this box" can use the precomputed
   *  `${boxId}#summary` rollup instead of re-synthesizing every member. */
  clusterIds: string[];
  /** The wired ARTIFACT (right plug) — the user's working doc the corpus opines
   *  ON. Carried whole, NEVER indexed. One per brain (last wired wins). null when
   *  none → the brain behaves as normal RAG Q&A. */
  artifact: { title?: string; url?: string; content: string } | null;
  /** Wired REFERENCE samples (top plug) — exemplars/clues that steer Opine
   *  judgment. Carried whole, never indexed, never cited. */
  references: Array<{ title?: string; content: string }>;
}

interface BoardCtxState {
  /** Board for the ACTIVE project (lazily seeded). */
  board: BoardState;
  setBoard: (updater: (prev: BoardState) => BoardState) => void;
  /** Update the board WITHOUT marking the project user-edited — for React
   *  Flow's internal noise (node measurement, selection) so it can't block
   *  the saved-board load on mount. */
  setBoardSilent: (updater: (prev: BoardState) => BoardState) => void;
  // Chat messages + their mutators moved to brain-messages-store (isolated so
  // streaming never re-renders the board). Import useBrainMessages / the
  // add/update/remove/clear functions from there.
  /** Resolve a brain's knowledge basis from graph connectivity. */
  resolveBrainScope: (brainId: string) => BrainScope;
  /** Patch a node's data (controlled flow — must go through the provider). */
  updateBoardNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  toggleHubCollapse: (nodeId: string) => void;
  /** Pop a docked member out of its box onto the canvas (becomes a free piece),
   *  re-tiling the box it left. Used by the minimized box's per-tile actions. */
  undockMember: (nodeId: string) => void;
  /** Set a node's width/height (used by the half-screen toggle). */
  resizeBoardNode: (
    nodeId: string,
    width: number,
    height: number,
    extraData?: Record<string, unknown>
  ) => void;
  /** Disconnect an edge (the hover-✕ on a connection). */
  removeBoardEdge: (edgeId: string) => void;
  /** Remove a node from the board (+ its edges); re-tiles its box if docked. */
  removeBoardNode: (nodeId: string) => void;
  /** Wire an artifact to EXACTLY ONE brain (removes any prior brain for this
   *  artifact AND any prior artifact on that brain — an artifact always belongs
   *  to a single brain). */
  connectArtifactToBrain: (artifactId: string, brainId: string) => void;
  /** Brain-picker request — set when an artifact needs a brain chosen (created
   *  with multiple brains present, or its wire was cut). null = closed. */
  brainPicker: { artId: string; afterCutEdge?: string } | null;
  setBrainPicker: (p: { artId: string; afterCutEdge?: string } | null) => void;
  /** Agent (robot) node being edited — its node id, or null = closed. */
  agentEditor: string | null;
  setAgentEditor: (id: string | null) => void;
  /** A node id awaiting delete confirmation, or null = closed. */
  pendingDelete: string | null;
  setPendingDelete: (id: string | null) => void;
  /** Un-snap a welded stack at the seam ABOVE this piece — this piece and
   *  everything below it detach into their own stack. */
  unsnapPiece: (nodeId: string) => void;
  /** Park a brain in the Chest (off-canvas) — keeps its chats + wiring. */
  stashBrain: (brainId: string) => void;
  /** Bring a stashed brain back to the canvas (restores position + wiring). */
  unstashBrain: (brainId: string) => void;
  /** Park a box (hub + its pieces) in the Chest (off-canvas), recallable later. */
  stashBox: (hubId: string) => void;
  /** Bring a stashed box back to the canvas with its pieces + wiring. */
  unstashBox: (hubId: string) => void;
  /** Brains with a query in flight — their inbound edges march. */
  busyBrains: Set<string>;
  setBrainBusy: (brainId: string, busy: boolean) => void;
  nextBoardId: (prefix: string) => string;
  /** Project id whose saved board has finished loading (load-complete focus). */
  hydratedProject: string | null;
  /** Brain currently in full-screen Research Mode (distraction-free), or null. */
  researchBrainId: string | null;
  setResearchBrainId: (id: string | null) => void;
  /** Force an immediate save (the manual Save button). saveStatus itself is read
   *  via the separate useSaveStatus() hook so it never re-renders the board. */
  saveNow: () => void;
}

const Ctx = createContext<BoardCtxState | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const { activeProjectId, projectMedia, media, hydrateMedia } = useRag();
  const [boards, setBoards] = useState<Record<string, BoardState>>({});
  // Chat messages live in their OWN external store (brain-messages-store) so a
  // streaming answer never re-renders the board. See that file for why.
  /** Project id whose saved board has finished loading (for load-complete focus). */
  const [hydratedProject, setHydratedProject] = useState<string | null>(null);
  /** Brain in full-screen Research Mode (distraction-free). */
  const [researchBrainId, setResearchBrainId] = useState<string | null>(null);
  /** Which project's research-mode state we've restored from localStorage. */
  const researchRestored = useRef<string | null>(null);
  /** Projects whose saved state we've already loaded (don't reload/overwrite). */
  const hydrated = useRef<Set<string>>(new Set());
  /** Projects the user has edited this session — never let a late DB load
   *  clobber fresh local work (e.g. a note typed before the fetch resolved). */
  const touched = useRef<Set<string>>(new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest serialized doc per project — for synchronous flush on page-hide. */
  const latestDoc = useRef<{ pid: string; doc: any } | null>(null);

  const board = useMemo<BoardState>(() => {
    return boards[activeProjectId] ?? seedBoard(projectMedia);
    // projectMedia only matters for the first seed of a project's board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, activeProjectId]);

  // ---- Research Mode persistence (survive a refresh) -----------------------
  // Restore the full-screen research view after the board hydrates, if the saved
  // brain still exists. Runs once per project so it never fights user toggles.
  useEffect(() => {
    if (hydratedProject !== activeProjectId) return;
    if (researchRestored.current === activeProjectId) return;
    researchRestored.current = activeProjectId;
    try {
      const raw = localStorage.getItem('cf_research');
      if (raw) {
        const saved = JSON.parse(raw);
        if (
          saved?.pid === activeProjectId &&
          (boards[activeProjectId]?.nodes ?? []).some(
            (n: BoardNode) => n.id === saved.id
          )
        ) {
          setResearchBrainId(saved.id);
        }
      }
    } catch {
      /* ignore */
    }
  }, [hydratedProject, activeProjectId, boards]);
  // Persist open/closed research state (only after restore, so we never clobber
  // the saved value with the initial null on mount).
  useEffect(() => {
    if (researchRestored.current !== activeProjectId) return;
    try {
      if (researchBrainId)
        localStorage.setItem(
          'cf_research',
          JSON.stringify({ pid: activeProjectId, id: researchBrainId })
        );
      else localStorage.removeItem('cf_research');
    } catch {
      /* ignore */
    }
  }, [researchBrainId, activeProjectId]);

  // ---- LOAD persisted board on project mount/switch (Neon via /api/board) ----
  useEffect(() => {
    const pid = activeProjectId;
    if (hydrated.current.has(pid)) {
      // Already loaded THIS SESSION — nothing to fetch, but the splash gate
      // must still be lowered for THIS project. Without this line, switching
      // BACK to any previously-visited project left hydratedProject pointing
      // at the previous one → the full-screen splash (which blocks all
      // clicks) stayed up forever over a perfectly loaded board. This was
      // every "stuck on loading when I switch projects" report — MEASURED:
      // the board GET returned 200 and autosaves kept ticking behind the
      // splash while the user was locked out.
      setHydratedProject(pid);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Load from the DB AND localStorage; use whichever is newer so a
        // stale/offline DB can never wipe fresher local work, and a DB
        // outage still restores from this device.
        let dbData: any = null;
        try {
          // 20s cap: hydration must NEVER hang on a single await — a hung
          // fetch (AV/VPN) or unsettled cache read leaves the splash blocking
          // every click ("can't enter my project"). Same rule as idbGetBoard.
          const res = await fetch(`/api/board?projectId=${encodeURIComponent(pid)}`, {
            signal: AbortSignal.timeout(20_000)
          });
          if (res.ok) dbData = (await res.json()).data;
        } catch {
          /* network/DB down or timed out — fall back to local */
        }
        // Local cache lives in TWO places since the IDB migration: periodic
        // autosaves → IndexedDB (async, no jank); pagehide flush → legacy
        // localStorage (sync). Take whichever is newer.
        const idbData = await idbGetBoard(pid);
        const lsData = readLocal(pid);
        const localData =
          idbData && (!lsData || (idbData.savedAt ?? 0) >= (lsData.savedAt ?? 0))
            ? idbData
            : lsData;
        let data = dbData;
        if (
          localData &&
          (!dbData || (localData.savedAt ?? 0) > (dbData.savedAt ?? 0))
        )
          data = localData;
        // RECOVERY/SAFETY: a BLANK snapshot (≤1 node, no edges, no chat) must
        // never hide a REAL board, even if its timestamp is newer — that's how a
        // stray autosave from another window/incognito wiped boards. Prefer
        // whichever source actually has content.
        const isBlank = (d: any) =>
          !d ||
          ((Array.isArray(d.nodes) ? d.nodes.length : 0) <= 1 &&
            (Array.isArray(d.edges) ? d.edges.length : 0) === 0 &&
            !Object.values(d.brainMessages ?? {}).some(
              (a: any) => Array.isArray(a) && a.length > 0
            ));
        if (isBlank(data) && !isBlank(localData)) data = localData;
        if (isBlank(data) && !isBlank(dbData)) data = dbData;
        {
          if (!cancelled && data) {
            // Hydrate the source list from the chosen snapshot only. (A previous
            // union-of-both-snapshots attempt caused runaway media duplication.)
            if (Array.isArray(data.media)) hydrateMedia(data.media, pid);
            bumpCounterFrom([
              ...(data.nodes ?? []).map((n: { id: string }) => n.id),
              ...(data.edges ?? []).map((e: { id: string }) => e.id)
            ]);
            // Scrub transient interaction flags (glow/pulse/tug/peel) that a
            // mid-gesture autosave may have frozen into the document.
            let nodes = (data.nodes ?? []).map((n: BoardNode) =>
              n.data?.glow || n.data?.pulse || n.data?.tug || n.data?.peel
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      glow: false,
                      pulse: false,
                      tug: false,
                      peel: false
                    }
                  }
                : n
            );
            // HEAL: docked pieces are never half-in/half-out of their tray —
            // re-tile every box's members into the grid (old saves may hold
            // arbitrary in-box offsets from before the magnet-tidy rules).
            const hubCount = new Map<string, number>();
            for (const n of nodes) {
              if (
                n.parentId &&
                (n.type === 'chip' ||
                  n.type === 'textNode' ||
                  n.type === 'prompt' ||
                  n.type === 'agent')
              )
                hubCount.set(n.parentId, (hubCount.get(n.parentId) ?? 0) + 1);
            }
            const slotIdx = new Map<string, number>();
            nodes = nodes.map((n: BoardNode) => {
              if (n.type !== 'chip' || !n.parentId) return n;
              const i = slotIdx.get(n.parentId) ?? 0;
              slotIdx.set(n.parentId, i + 1);
              const slot = hubSlot(i, hubCols(hubCount.get(n.parentId) ?? 1));
              return n.position.x === slot.x && n.position.y === slot.y
                ? n
                : { ...n, position: slot };
            });
            // Hubs measure their own (collapse-aware) DOM. Strip any baked-in
            // width/height from older saves — a stale size gives React Flow a
            // huge INVISIBLE hit box, so a minimized box drags from far away /
            // when the cursor is nowhere near it.
            nodes = nodes.map((n: BoardNode) =>
              n.type === 'hub' && (n.width != null || n.height != null)
                ? { ...n, width: undefined, height: undefined }
                : n
            );
            // Don't clobber work the user started before this load resolved.
            if (!touched.current.has(pid))
              setBoards((prev) => ({
                ...prev,
                [pid]: {
                  nodes,
                  edges: data.edges ?? [],
                  stashedBrains: data.stashedBrains ?? [],
                  stashedBoxes: data.stashedBoxes ?? []
                }
              }));
            if (data.brainMessages) mergeBrainMessages(data.brainMessages);
          }
        }
      } catch {
        /* offline / no DB → keep the seed */
      } finally {
        if (!cancelled) {
          hydrated.current.add(pid);
          // Signal (state, not just the ref) that this project's saved board
          // has finished loading — lets the canvas focus the REAL board, not
          // the transient seed/cached state shown before the load resolved.
          setHydratedProject(pid);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, hydrateMedia]);

  /** Build the persistable document for the active project. */
  const buildDoc = useCallback(() => {
    const stashed = board.stashedBrains ?? [];
    const brainIds = new Set([
      ...board.nodes.filter((n) => n.type === 'brain').map((n) => n.id),
      // keep chats for parked brains too, so recall restores the conversation
      ...stashed.map((s) => s.node.id)
    ]);
    const msgs = Object.fromEntries(
      Object.entries(getAllBrainMessages()).filter(([k]) => brainIds.has(k))
    );
    return {
      nodes: board.nodes,
      edges: board.edges,
      stashedBrains: stashed,
      stashedBoxes: board.stashedBoxes ?? [],
      brainMessages: msgs,
      // Persist source METADATA only — never the full text (a book can be
      // megabytes; it would blow the ~5MB localStorage quota and silently
      // drop the save, losing positions/snaps). The text already lives in
      // Pinecone; the board only needs id/name/type/status to render chips.
      media: projectMedia.map((m) => ({ ...m, content: '' })),
      savedAt: Date.now()
    };
  }, [board, projectMedia]);

  // Refs the interval/flush saves read — updated cheaply each render (NO
  // serialization here, unlike the old per-change save that lagged dragging).
  const dirty = useRef(false);
  const buildDocRef = useRef(buildDoc);
  const pidRef = useRef(activeProjectId);
  buildDocRef.current = buildDoc;
  pidRef.current = activeProjectId;

  /** Serialize once and persist (local + cloud). The ONLY place the whole board
   *  doc is stringified — called on a timer / on chat / on page-hide, never per
   *  pointer-move. */
  const persistNow = useCallback(() => {
    if (BOARD_RECOVERY_READONLY) return;
    const pid = pidRef.current;
    if (!hydrated.current.has(pid)) return;
    const doc = buildDocRef.current();
    // SAFETY: never let a BLANK board overwrite a saved one. A lone unwired brain
    // (or zero nodes) with no edges and no chat = a fresh/load-race default, NOT
    // a real board the user built. Skip the cloud save so it can't clobber the
    // good copy in the DB (this was wiping boards on project-switch/incognito).
    const nodeCount = Array.isArray(doc.nodes) ? doc.nodes.length : 0;
    const edgeCount = Array.isArray(doc.edges) ? doc.edges.length : 0;
    const hasChat = Object.values(doc.brainMessages ?? {}).some(
      (arr) => Array.isArray(arr) && arr.length > 0
    );
    if (nodeCount <= 1 && edgeCount === 0 && !hasChat) {
      setSaveStatus('saved');
      return;
    }
    latestDoc.current = { pid, doc };
    dirty.current = false;
    setSaveStatus('saving');
    // JANK FIX: the old path did a synchronous multi-MB JSON.stringify +
    // localStorage.setItem here — on a 3000-node board that froze the main
    // thread for hundreds of ms EVERY autosave tick (visible as periodic
    // "uncontrollable jitter" during imports, when the board is always
    // dirty). Now: the local copy goes to IndexedDB (async, no stringify),
    // the doc is stringified ONCE (the network PUT needs it anyway), and the
    // heavy tail runs on an IDLE frame. The pagehide flush below still does
    // the sync localStorage write — the only moment sync is both safe and
    // required.
    const run = () => {
      idbPutBoard(pid, doc);
      fetch('/api/board', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid, data: doc })
      })
        .then((r) => setSaveStatus(r.ok ? 'saved' : 'local'))
        .catch(() => setSaveStatus('local'));
    };
    if (typeof requestIdleCallback === 'function')
      requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 0);
  }, []);

  // ---- Mark dirty on any change (cheap: a flag, no serialization). ----
  useEffect(() => {
    if (!hydrated.current.has(activeProjectId)) return;
    dirty.current = true;
    setSaveStatus('saving');
  }, [buildDoc, activeProjectId]);

  // ---- AUTOSAVE: every 60s, NOT on every move (so dragging stays smooth). The
  // synchronous per-change localStorage write of the whole board was the lag. ----
  useEffect(() => {
    const iv = setInterval(() => {
      if (dirty.current) persistNow();
    }, 60000);
    return () => clearInterval(iv);
  }, [persistNow]);

  // ---- Discussion text saves PROMPTLY (debounced ~2.5s) so chat is never lost
  // between 60s ticks. We SUBSCRIBE to the external chat store (instead of a
  // brainMessages state dep) so a streaming answer schedules a save WITHOUT
  // re-rendering this provider — that decoupling is the whole point. ----
  const chatSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = subscribeBrainMessages(() => {
      if (!hydrated.current.has(pidRef.current)) return;
      dirty.current = true;
      setSaveStatus('saving');
      if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current);
      chatSaveTimer.current = setTimeout(() => persistNow(), 2500);
    });
    return () => {
      unsub();
      if (chatSaveTimer.current) clearTimeout(chatSaveTimer.current);
    };
  }, [persistNow]);

  // ---- FLUSH on page-hide / tab-switch — builds the CURRENT doc fresh so the
  // latest positions/edits are saved even though we only persist every 60s. ----
  useEffect(() => {
    const flush = () => {
      if (BOARD_RECOVERY_READONLY) return;
      const pid = pidRef.current;
      if (!hydrated.current.has(pid)) return;
      const doc = buildDocRef.current();
      // Same SAFETY as persistNow: a blank board never overwrites a saved one.
      const nodeCount = Array.isArray(doc.nodes) ? doc.nodes.length : 0;
      const edgeCount = Array.isArray(doc.edges) ? doc.edges.length : 0;
      const hasChat = Object.values(doc.brainMessages ?? {}).some(
        (arr) => Array.isArray(arr) && arr.length > 0
      );
      if (nodeCount <= 1 && edgeCount === 0 && !hasChat) return;
      latestDoc.current = { pid, doc };
      dirty.current = false;
      writeLocal(pid, doc); // sync, always succeeds
      try {
        // keepalive lets the request outlive the page (best-effort cloud save)
        fetch('/api/board', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: pid, data: doc }),
          keepalive: true
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const saveNow = useCallback(() => {
    const pid = activeProjectId;
    const doc = buildDoc();
    latestDoc.current = { pid, doc };
    writeLocal(pid, doc);
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    fetch('/api/board', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: pid, data: doc })
    })
      .then((r) => setSaveStatus(r.ok ? 'saved' : 'local'))
      .catch(() => setSaveStatus('local'));
  }, [activeProjectId, buildDoc]);

  const setBoardSilent = useCallback(
    (updater: (prev: BoardState) => BoardState) => {
      setBoards((prev) => {
        const cur = prev[activeProjectId] ?? board;
        return { ...prev, [activeProjectId]: updater(cur) };
      });
    },
    [activeProjectId, board]
  );

  const setBoard = useCallback(
    (updater: (prev: BoardState) => BoardState) => {
      touched.current.add(activeProjectId); // a genuine user edit
      setBoardSilent(updater);
    },
    [activeProjectId, setBoardSilent]
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

  // Toggle a box minimized — and keep its CENTER fixed so a tall box doesn't
  // appear to fly off-screen (its top-left would otherwise stay way up high).
  // Flips the EFFECTIVE state (auto-minimized big boxes have collapsed===undefined
  // yet render minimized), and records the result EXPLICITLY (true/false) so the
  // user's choice overrides the auto-by-size default.
  const toggleHubCollapse = useCallback(
    (nodeId: string) => {
      setBoard((prev) => {
        const hub = prev.nodes.find((n) => n.id === nodeId);
        if (!hub) return prev;
        const members = prev.nodes.filter(
          (n) =>
            n.parentId === nodeId &&
            (n.type === 'chip' ||
              n.type === 'textNode' ||
              n.type === 'prompt' ||
              n.type === 'agent')
        ).length;
        const isCollapsed = hubCollapsed(hub.data, members);
        const willCollapse = !isCollapsed;
        // Use the grid-aware footprint (mini / 2x-expanded / small-canvas) so a
        // big box recenters by the RIGHT delta, not the old unbounded grid size.
        const from = hubFootprint(hub.data, members);
        const to = hubFootprint({ ...hub.data, collapsed: willCollapse }, members);
        const position = {
          x: hub.position.x + (from.width - to.width) / 2,
          y: hub.position.y + (from.height - to.height) / 2
        };
        return {
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, position, data: { ...n.data, collapsed: willCollapse } }
              : n
          )
        };
      });
    },
    [setBoard]
  );

  // Pop a docked piece out of its box onto the canvas just to the box's right
  // (a small cascade keeps several pop-outs from landing in one stack), then
  // re-tile the box it left. The box is the plug, so a docked piece never had a
  // private wire — nothing to disconnect.
  const undockMember = useCallback(
    (nodeId: string) => {
      setBoard((prev) => {
        const node = prev.nodes.find((n) => n.id === nodeId);
        if (!node || !node.parentId) return prev;
        const oldHub = node.parentId;
        const hub = prev.nodes.find((n) => n.id === oldHub);
        const base = hub ? hub.position : node.position;
        const freeChips = prev.nodes.filter(
          (n) => !n.parentId && n.type === 'chip'
        ).length;
        const off = (freeChips % 6) * 20;
        const restore =
          node.type === 'prompt' || node.type === 'agent'
            ? { width: CHIP_W, height: CHIP_H + CHIP_TAB }
            : node.type === 'textNode'
            ? { width: 234, height: 132 }
            : { width: CHIP_W, height: CHIP_H };
        let nodes = prev.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                parentId: undefined,
                position: {
                  x: base.x + HUB_MINI_SIZE.width + 24 + off,
                  y: base.y + off
                },
                ...restore
              }
            : n
        );
        const isMember = (n: BoardNode) =>
          (n.type === 'chip' ||
            n.type === 'textNode' ||
            n.type === 'prompt' ||
            n.type === 'agent') &&
          n.parentId === oldHub;
        const cols = hubCols(nodes.filter(isMember).length);
        let i = 0;
        nodes = nodes.map((n) =>
          isMember(n) ? { ...n, position: hubSlot(i++, cols) } : n
        );
        return { ...prev, nodes };
      });
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

  // An artifact belongs to exactly one brain. Wiring it to a brain drops any
  // edge it had to another brain AND any other artifact already on that brain.
  const [brainPicker, setBrainPicker] = useState<
    { artId: string; afterCutEdge?: string } | null
  >(null);
  const [agentEditor, setAgentEditor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const connectArtifactToBrain = useCallback(
    (artifactId: string, brainId: string) => {
      setBoard((prev) => {
        const artIds = new Set(
          prev.nodes.filter((n) => n.type === 'artifact').map((n) => n.id)
        );
        const edges = prev.edges.filter((e) => {
          // drop this artifact's existing brain link
          if (e.source === artifactId) return false;
          // drop any OTHER artifact already wired to this brain (one per brain)
          if (e.target === brainId && e.source && artIds.has(e.source)) return false;
          return true;
        });
        edges.push({
          id: `e${++boardIdCounter}`,
          source: artifactId,
          target: brainId,
          type: 'scope',
          targetHandle: 'artifact'
        } as BoardEdge);
        return { ...prev, edges };
      });
    },
    [setBoard]
  );

  const removeBoardNode = useCallback(
    (nodeId: string) => {
      setBoard((prev) => {
        const node = prev.nodes.find((n) => n.id === nodeId);
        if (!node) return prev;
        const parentId = node.parentId;
        let nodes = prev.nodes;
        // Removing a BOX/hub: undock its pieces to the canvas (absolute
        // coords) so they're never orphaned or lost.
        if (node.type === 'hub') {
          nodes = nodes.map((n) =>
            n.parentId === nodeId
              ? {
                  ...n,
                  parentId: undefined,
                  position: {
                    x: node.position.x + n.position.x,
                    y: node.position.y + n.position.y
                  }
                }
              : n
          );
        }
        nodes = nodes.filter((n) => n.id !== nodeId);
        if (parentId) {
          const isMember = (n: BoardNode) =>
            (n.type === 'chip' ||
              n.type === 'textNode' ||
              n.type === 'prompt' ||
              n.type === 'agent') &&
            n.parentId === parentId;
          const cols = hubCols(nodes.filter(isMember).length);
          let i = 0;
          nodes = nodes.map((n) =>
            isMember(n) ? { ...n, position: hubSlot(i++, cols) } : n
          );
        }
        const edges = prev.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        );
        return { ...prev, nodes, edges };
      });
    },
    [setBoard]
  );

  const stashBrain = useCallback(
    (brainId: string) => {
      setBoard((prev) => {
        const node = prev.nodes.find(
          (n) => n.id === brainId && n.type === 'brain'
        );
        if (!node) return prev;
        const edges = prev.edges.filter(
          (e) => e.source === brainId || e.target === brainId
        );
        return {
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== brainId),
          edges: prev.edges.filter(
            (e) => e.source !== brainId && e.target !== brainId
          ),
          stashedBrains: [...(prev.stashedBrains ?? []), { node, edges }]
        };
      });
    },
    [setBoard]
  );

  const unstashBrain = useCallback(
    (brainId: string) => {
      setBoard((prev) => {
        const stash = prev.stashedBrains ?? [];
        const entry = stash.find((s) => s.node.id === brainId);
        if (!entry) return prev;
        const existing = new Set(prev.nodes.map((n) => n.id));
        // restore only the edges whose OTHER endpoint still exists on the board
        const edges = entry.edges.filter((e) => {
          const other = e.source === brainId ? e.target : e.source;
          return existing.has(other);
        });
        return {
          ...prev,
          nodes: [...prev.nodes, entry.node],
          edges: [...prev.edges, ...edges],
          stashedBrains: stash.filter((s) => s.node.id !== brainId)
        };
      });
    },
    [setBoard]
  );

  // Park a whole box (hub + its docked pieces + touching edges) in the Chest.
  const stashBox = useCallback(
    (hubId: string) => {
      setBoard((prev) => {
        const node = prev.nodes.find((n) => n.id === hubId && n.type === 'hub');
        if (!node) return prev;
        const children = prev.nodes.filter((n) => n.parentId === hubId);
        const childIds = new Set(children.map((c) => c.id));
        const touchesBox = (e: { source: string; target: string }) =>
          e.source === hubId ||
          e.target === hubId ||
          childIds.has(e.source) ||
          childIds.has(e.target);
        const edges = prev.edges.filter(touchesBox);
        return {
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== hubId && n.parentId !== hubId),
          edges: prev.edges.filter((e) => !touchesBox(e)),
          stashedBoxes: [...(prev.stashedBoxes ?? []), { node, children, edges }]
        };
      });
    },
    [setBoard]
  );

  const unstashBox = useCallback(
    (hubId: string) => {
      setBoard((prev) => {
        const stash = prev.stashedBoxes ?? [];
        const entry = stash.find((s) => s.node.id === hubId);
        if (!entry) return prev;
        const restored = new Set([
          ...prev.nodes.map((n) => n.id),
          entry.node.id,
          ...entry.children.map((c) => c.id)
        ]);
        // restore only edges whose BOTH endpoints exist after recall
        const edges = entry.edges.filter(
          (e) => restored.has(e.source) && restored.has(e.target)
        );
        return {
          ...prev,
          nodes: [...prev.nodes, entry.node, ...entry.children],
          edges: [...prev.edges, ...edges],
          stashedBoxes: stash.filter((s) => s.node.id !== hubId)
        };
      });
    },
    [setBoard]
  );

  const unsnapPiece = useCallback(
    (nodeId: string) => {
      setBoard((prev) => {
        const self = prev.nodes.find((n) => n.id === nodeId);
        if (!self || self.parentId) return prev;
        const typeOf = (n: BoardNode) =>
          media.find((m) => m.id === n.data.mediaId)?.type;
        const stack = stackOf(self, prev.nodes, typeOf);
        if (stack.length < 2) return prev;
        // Detach THIS piece + everything below it: shift them down so the
        // seam above no longer sits at STACK_PITCH (they become their own
        // stack; the pieces above stay put).
        const GAP = 38;
        const moveIds = new Set(
          stack.filter((n) => n.position.y >= self.position.y - 0.5).map((n) => n.id)
        );
        const nodes = prev.nodes.map((n) =>
          moveIds.has(n.id)
            ? { ...n, position: { x: n.position.x, y: n.position.y + GAP } }
            : n
        );
        return { ...prev, nodes };
      });
    },
    [setBoard, media]
  );

  // Chat mutators now live in brain-messages-store (module functions) so they
  // never touch this provider's state. Consumers import them directly.

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
      const guides: string[] = [];
      const clusterIds: string[] = [];
      let everything = false;
      // Opine plugs (carried whole, NEVER indexed).
      let artifact: { title?: string; url?: string; content: string } | null = null;
      const references: Array<{ title?: string; content: string }> = [];

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
            clusterIds.push(src.id); // a wired box → its precomputed rollup
            nodes
              .filter((n) => n.type === 'chip' && n.parentId === src.id)
              .forEach((n) => ids.push(n.data.mediaId as string));
            // Context notes docked in the box ride along as prompt context.
            nodes
              .filter((n) => n.type === 'textNode' && n.parentId === src.id)
              .forEach((n) => {
                const t = (n.data.text as string)?.trim();
                if (t) contextTexts.push(t);
              });
            // Prompt + agent pieces docked in the box guide HOW it answers.
            nodes
              .filter(
                (n) =>
                  (n.type === 'prompt' || n.type === 'agent') &&
                  n.parentId === src.id
              )
              .forEach((n) => {
                const t = (n.data.text as string)?.trim();
                if (t) guides.push(t);
              });
          }
        } else if (src.type === 'textNode') {
          const t = (src.data.text as string)?.trim();
          if (t) contextTexts.push(t);
        } else if (src.type === 'prompt' || src.type === 'agent') {
          // An agent piece is a persona — its system prompt rides into the
          // answer as guidance, exactly like a prompt piece.
          const t = (src.data.text as string)?.trim();
          if (t) guides.push(t);
        } else if (src.type === 'artifact') {
          // RIGHT plug — the subject the corpus opines on. Carried whole, never
          // indexed. Present whenever an artifact node is wired (even empty): the
          // server loads its URL if needed, and if there's still no text it tells
          // the user WHY rather than silently giving a generic corpus answer.
          artifact = {
            title: (src.data.title as string) || undefined,
            url: (src.data.url as string)?.trim() || undefined,
            content: (src.data.content as string)?.trim() || ''
          };
        } else if (src.type === 'reference') {
          // TOP plug — exemplar/clue. Steers judgment; never a source.
          const content = (src.data.content as string)?.trim();
          if (content) {
            references.push({ title: (src.data.title as string) || undefined, content });
          }
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
      // Dedupe so the SAME source/note/guide placed twice never doubles up
      // (sources are already deduped above by id → no double vector ping).
      return {
        items,
        contextTexts: [...new Set(contextTexts)],
        guides: [...new Set(guides)],
        everything,
        clusterIds: [...new Set(clusterIds)],
        artifact,
        references
      };
    },
    [board, media, projectMedia]
  );

  const value: BoardCtxState = {
    board,
    setBoard,
    setBoardSilent,
    resolveBrainScope,
    updateBoardNodeData,
    toggleHubCollapse,
    undockMember,
    resizeBoardNode,
    removeBoardEdge,
    removeBoardNode,
    connectArtifactToBrain,
    brainPicker,
    setBrainPicker,
    agentEditor,
    setAgentEditor,
    pendingDelete,
    setPendingDelete,
    unsnapPiece,
    stashBrain,
    unstashBrain,
    stashBox,
    unstashBox,
    busyBrains,
    setBrainBusy,
    nextBoardId: nextId,
    hydratedProject,
    researchBrainId,
    setResearchBrainId,
    saveNow
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBoard must be used within BoardProvider');
  return ctx;
}
