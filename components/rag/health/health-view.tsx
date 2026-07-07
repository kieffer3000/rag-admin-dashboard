'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import type { MediaItem } from '@/lib/rag/types';
import { MediaIcon, StatusBadge } from '@/components/rag/shared';
import { Button } from '@/components/ui/button';
import {
  Database,
  Boxes,
  HardDrive,
  RefreshCw,
  Trash2,
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

function fmtBytes(n: number) {
  if (n > 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  return (n / 1e3).toFixed(0) + ' KB';
}

interface UsageRow {
  namespace: string;
  user: string;
  vectors: number;
  estBytes: number;
}
interface Usage {
  vectors: number;
  estBytes: number;
  /** Owner-only (3.19): index-wide totals + per-user breakdown. */
  isOwner?: boolean;
  totalVectors?: number;
  totalEstBytes?: number;
  breakdown?: UsageRow[];
  /** Ops metering (3.17): this month's counted usage + the caller's plan. */
  month?: string;
  questionsThisMonth?: number;
  uploadsThisMonth?: number;
  plan?: string;
  caps?: { questionsPerMonth: number | null; vectorsMax: number | null };
}

/** "132 of 2,000" meter — null cap = unlimited (no bar). */
function Meter({ n, cap }: { n: number; cap: number | null | undefined }) {
  if (cap == null) return null;
  const pct = Math.min(100, Math.round((n / Math.max(1, cap)) * 100));
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full ${pct >= 90 ? 'bg-amber-500' : 'bg-primary'}`}
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </div>
  );
}

export function HealthView() {
  const { media, projects, activeProject, reindexMedia, deleteMedia } = useRag();

  // ADMIN/USER VIEW TOGGLE (3.19): owners can flip to "User view" to see the
  // page EXACTLY as a non-owner sees it (admin-only blocks hidden). Regular
  // users never get the toggle — their view is already the user view.
  const [asUser, setAsUser] = useState(false);

  // ALL-PROJECTS SOURCES (3.22): the client only hydrates the ACTIVE project's
  // media (each project's board doc carries its own list), so the page fetches
  // the other projects' docs itself and renders every source grouped by
  // project. The active project keeps its LIVE store copy (statuses update);
  // other projects show their saved snapshot, read-only.
  const [otherMedia, setOtherMedia] = useState<Record<string, MediaItem[]>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const others = projects.filter((p) => p.id !== activeProject.id);
      const entries = await Promise.all(
        others.map(async (p) => {
          try {
            const r = await fetch(`/api/board?projectId=${encodeURIComponent(p.id)}`);
            const j = r.ok ? await r.json() : null;
            const items = Array.isArray(j?.data?.media) ? (j.data.media as MediaItem[]) : [];
            return [p.id, items] as const;
          } catch {
            return [p.id, [] as MediaItem[]] as const;
          }
        })
      );
      if (!cancelled) setOtherMedia(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [projects, activeProject.id]);

  // Per-project groups: active project first (LIVE store rows — statuses tick),
  // then every other project's saved snapshot. Projects with no sources are
  // listed at the end as a one-line count, not empty sections.
  const groups = useMemo(() => {
    const activeItems = media.filter((m) => activeProject.sourceIds.includes(m.id));
    const out: { project: typeof activeProject; items: MediaItem[]; live: boolean }[] = [
      { project: activeProject, items: activeItems, live: true }
    ];
    for (const p of projects) {
      if (p.id === activeProject.id) continue;
      const items = (otherMedia[p.id] ?? []).filter(
        (m) => !p.sourceIds.length || p.sourceIds.includes(m.id)
      );
      out.push({ project: p, items, live: false });
    }
    return out;
  }, [media, projects, activeProject, otherMedia]);

  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // ORGANIZATION (3.23): search, sort, and collapsible groups.
  const [q, setQ] = useState('');
  type SortKey = 'name' | 'chunks' | 'size' | 'date';
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapseInit, setCollapseInit] = useState(false);

  // Collapse state persists per browser; first visit = only the active
  // project open (the overview stays scannable at 10+ projects).
  useEffect(() => {
    if (collapseInit || projects.length === 0) return;
    try {
      const saved = localStorage.getItem('ad_health_collapsed');
      if (saved) {
        setCollapsed(new Set(JSON.parse(saved) as string[]));
        setCollapseInit(true);
        return;
      }
    } catch {
      /* fall through to default */
    }
    setCollapsed(new Set(projects.filter((p) => p.id !== activeProject.id).map((p) => p.id)));
    setCollapseInit(true);
  }, [collapseInit, projects, activeProject.id]);

  const persistCollapsed = (n: Set<string>) => {
    setCollapsed(n);
    try {
      localStorage.setItem('ad_health_collapsed', JSON.stringify([...n]));
    } catch {
      /* private mode — session-only */
    }
  };
  const toggleGroup = (id: string) => {
    const n = new Set(collapsed);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    persistCollapsed(n);
  };
  const allCollapsed = groups.every((g) => collapsed.has(g.project.id));
  const setAllCollapsed = () =>
    persistCollapsed(allCollapsed ? new Set<string>() : new Set(groups.map((g) => g.project.id)));

  // Search filters by source name; sorting applies within each group.
  // `size` shares chunk ordering (size is derived from chunks) but stays a
  // separate control so the header pills match the visible columns.
  const searching = q.trim().toLowerCase();
  const viewGroups = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a: MediaItem, b: MediaItem) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'date') return (a.date || '').localeCompare(b.date || '') * dir;
      return (a.chunks - b.chunks) * dir; // chunks + size
    };
    return groups.map((g) => ({
      ...g,
      items: (searching
        ? g.items.filter((m) => m.name.toLowerCase().includes(searching))
        : g.items
      )
        .slice()
        .sort(cmp)
    }));
  }, [groups, searching, sortKey, sortDir]);

  const sortPill = (k: SortKey, label: string) => (
    <button
      key={k}
      onClick={() => {
        if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
          setSortKey(k);
          setSortDir(k === 'name' ? 'asc' : 'desc');
        }
      }}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        sortKey === k
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
      {sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  // REAL metered usage from Pinecone (/api/usage) — the client-side chunk
  // estimate below stays as the instant placeholder until this resolves.
  // Metering exists because the org hit its storage cap invisibly (2026-07-04):
  // what a user has banked must be visible before it can be limited or billed.
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j && typeof j.vectors === 'number') setUsage(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Counts span ALL projects (3.22) — the old per-active-project numbers made
  // the Sources card read "1" while nine other projects held documents.
  const stats = useMemo(() => {
    const totalChunks = allItems.reduce((a, m) => a + m.chunks, 0);
    const indexed = allItems.filter((m) => m.status === 'indexed').length;
    const processing = allItems.filter((m) => m.status === 'processing').length;
    const failed = allItems.filter((m) => m.status === 'failed').length;
    // 768 dims × 4 bytes per float + ~1KB metadata per chunk
    const storage = totalChunks * (768 * 4 + 1024);
    return { totalChunks, indexed, processing, failed, storage };
  }, [allItems]);

  const CARDS = [
    {
      label: 'Vectors',
      value: (usage ? usage.vectors : stats.totalChunks).toLocaleString(),
      sub: usage ? 'measured · 768-dim · cosine' : '768-dim · cosine',
      icon: Database
    },
    {
      label: 'Sources',
      value: String(allItems.length),
      sub: `${stats.indexed} indexed · ${stats.processing} processing · all projects`,
      icon: Boxes
    },
    {
      label: 'Storage',
      value: fmtBytes(usage ? usage.estBytes : stats.storage),
      sub: usage ? 'estimated from live vector count' : 'estimated',
      icon: HardDrive
    },
    {
      // 3.19: this card previously said "Namespaces · one per project" — WRONG.
      // Isolation is one private space per ACCOUNT (all projects share it,
      // separated by source filters at question time).
      label: 'Projects',
      value: String(projects.length),
      sub: 'all in your private space',
      icon: Activity
    }
  ];

  const showAdmin = !!usage?.isOwner && !asUser;

  return (
    <div className="h-full p-2.5">
      {/* 3.21: the WHOLE panel scrolls as one column. The old split (fixed
          header + flex-1 scrolling list) broke once the header grew (This-month
          card + admin table): the fixed part exceeded the viewport and crushed
          the list's scroll area to zero height — per-source rows unreachable. */}
      <div className="panel h-full overflow-hidden rounded-[26px]">
        <div className="scroll-clean h-full overflow-y-auto">
        <div className="px-6 pt-6 lg:px-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Knowledge health</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Your knowledge index and this month&apos;s usage at a glance.
              </p>
            </div>
            {usage?.isOwner && (
              <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted p-1">
                {(['Admin', 'User'] as const).map((v) => {
                  const active = (v === 'User') === asUser;
                  return (
                    <button
                      key={v}
                      onClick={() => setAsUser(v === 'User')}
                      className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                        active
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {v} view
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {CARDS.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.label} className="card-glass rounded-[18px] p-4">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" /> {c.label}
                  </div>
                  <div className="mt-2 text-[24px] font-semibold tracking-tight">{c.value}</div>
                  <div className="text-[11px] text-muted-foreground/70">{c.sub}</div>
                </div>
              );
            })}
          </div>

          {/* THIS MONTH (3.18): the ops meters — questions asked (vs the plan
              cap when one applies), documents added, and banked-vector budget.
              Data rides the same /api/usage call as the cards above. */}
          {usage && typeof usage.questionsThisMonth === 'number' && (
            <div className="card-glass mt-4 rounded-[18px] p-4">
              <div className="flex items-baseline justify-between">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  This month{usage.month ? ` · ${usage.month}` : ''}
                </div>
                {usage.plan && (
                  <div className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium capitalize text-primary">
                    {usage.plan === 'owner' ? 'unlimited' : `${usage.plan} plan`}
                  </div>
                )}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-[12px] text-muted-foreground">Questions asked</div>
                  <div className="mt-1 text-[20px] font-semibold tracking-tight tabular-nums">
                    {usage.questionsThisMonth.toLocaleString()}
                    {usage.caps?.questionsPerMonth != null && (
                      <span className="text-[13px] font-normal text-muted-foreground">
                        {' '}of {usage.caps.questionsPerMonth.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <Meter n={usage.questionsThisMonth} cap={usage.caps?.questionsPerMonth} />
                </div>
                <div>
                  <div className="text-[12px] text-muted-foreground">Documents added</div>
                  <div className="mt-1 text-[20px] font-semibold tracking-tight tabular-nums">
                    {(usage.uploadsThisMonth ?? 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[12px] text-muted-foreground">Storage used</div>
                  <div className="mt-1 text-[20px] font-semibold tracking-tight tabular-nums">
                    {usage.vectors.toLocaleString()}
                    {usage.caps?.vectorsMax != null && (
                      <span className="text-[13px] font-normal text-muted-foreground">
                        {' '}of {usage.caps.vectorsMax.toLocaleString()}
                      </span>
                    )}
                    <span className="text-[13px] font-normal text-muted-foreground"> items</span>
                  </div>
                  <Meter n={usage.vectors} cap={usage.caps?.vectorsMax} />
                </div>
              </div>
            </div>
          )}

          {showAdmin && usage?.breakdown && (
            <div className="card-glass mt-5 rounded-[18px] p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Storage by user (admin) · index total{' '}
                {(usage.totalVectors ?? 0).toLocaleString()} vectors
                · ~{fmtBytes(usage.totalEstBytes ?? 0)}
              </div>
              <div className="mt-3 space-y-1.5">
                {usage.breakdown.map((r) => (
                  <div
                    key={r.namespace}
                    className="flex items-center gap-3 text-[13px]"
                  >
                    <div className="min-w-0 flex-1 truncate">{r.user}</div>
                    <div className="w-28 text-right tabular-nums">
                      {r.vectors.toLocaleString()} vec
                    </div>
                    <div className="w-24 text-right tabular-nums text-muted-foreground">
                      ~{fmtBytes(r.estBytes)}
                    </div>
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.max(1, Math.round((r.vectors / Math.max(1, usage.totalVectors ?? 0)) * 100))}%`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.failed > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-[14px] bg-amber-50 px-4 py-2.5 text-[13px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              {stats.failed} source{stats.failed > 1 ? 's' : ''} failed to index — retry below.
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Per-source index status · by project
            </h2>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sources…"
                className="h-7 w-44 rounded-full border border-border bg-card px-3 text-[12px] outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary/40"
              />
              <span className="mx-1 text-[11px] text-muted-foreground/50">sort</span>
              {sortPill('name', 'Name')}
              {sortPill('chunks', 'Chunks')}
              {sortPill('size', 'Size')}
              {sortPill('date', 'Indexed')}
              <button
                onClick={setAllCollapsed}
                className="ml-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </button>
            </div>
          </div>
        </div>

        {/* 3.22: sources grouped by project — every project, not just the
            active one. The active project's rows are live and manageable;
            other projects' rows are their saved snapshot (switch to that
            project to re-index or delete). */}
        <div className="space-y-3 px-6 py-4 lg:px-8">
          {viewGroups
            .filter((g) => g.items.length > 0)
            .map((g) => {
              // While searching, groups with matches are forced open so hits
              // are never hidden behind a collapsed header.
              const isOpen = searching ? true : !collapsed.has(g.project.id);
              const gChunks = g.items.reduce((a, m) => a + m.chunks, 0);
              return (
              <div key={g.project.id}>
                <button
                  onClick={() => toggleGroup(g.project.id)}
                  className="mb-2 flex w-full items-center gap-2 rounded-[12px] px-1 py-1 text-left text-[13px] font-semibold transition-colors hover:bg-muted/60"
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span>{g.project.icon}</span>
                  <span className="truncate">{g.project.name}</span>
                  <span className="text-[11px] font-normal text-muted-foreground/70">
                    {g.items.length} source{g.items.length === 1 ? '' : 's'} ·{' '}
                    {gChunks.toLocaleString()} chunks · ~{fmtBytes(gChunks * (768 * 4 + 1024))}
                    {g.live ? ' · current project' : ''}
                  </span>
                </button>
                {isOpen && (
                <div className="space-y-2">
                  {g.items.map((m) => (
                    <div
                      key={m.id}
                      className="card-glass flex items-center gap-3.5 rounded-[18px] px-4 py-3"
                    >
                      <MediaIcon type={m.type} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{m.name}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                          {m.chunks} chunks ·{' '}
                          {fmtBytes(m.chunks * (768 * 4 + 1024))} · indexed {m.date}
                        </div>
                      </div>
                      <StatusBadge status={m.status} />
                      {g.live ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 rounded-lg text-muted-foreground hover:text-foreground"
                            disabled={m.status === 'processing'}
                            onClick={() => reindexMedia(m.id)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Re-index
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 rounded-lg text-muted-foreground hover:text-red-500"
                            onClick={() => deleteMedia(m.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/60">
                          switch project to manage
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
              );
            })}
          {searching && viewGroups.every((g) => g.items.length === 0) && (
            <div className="text-[12px] text-muted-foreground/70">
              No sources match “{q.trim()}”.
            </div>
          )}
          {!searching && groups.some((g) => g.items.length === 0) && (
            <div className="text-[12px] text-muted-foreground/70">
              {groups
                .filter((g) => g.items.length === 0)
                .map((g) => `${g.project.icon} ${g.project.name}`)
                .join(' · ')}{' '}
              — no sources yet
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
