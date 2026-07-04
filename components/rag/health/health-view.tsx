'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { MediaIcon, StatusBadge } from '@/components/rag/shared';
import { Button } from '@/components/ui/button';
import {
  Database,
  Boxes,
  HardDrive,
  RefreshCw,
  Trash2,
  Activity,
  AlertTriangle
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
  totalVectors: number;
  totalEstBytes: number;
  breakdown?: UsageRow[];
}

export function HealthView() {
  const { media, projects, reindexMedia, deleteMedia } = useRag();

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

  const stats = useMemo(() => {
    const totalChunks = media.reduce((a, m) => a + m.chunks, 0);
    const indexed = media.filter((m) => m.status === 'indexed').length;
    const processing = media.filter((m) => m.status === 'processing').length;
    const failed = media.filter((m) => m.status === 'failed').length;
    // 768 dims × 4 bytes per float + ~1KB metadata per chunk
    const storage = totalChunks * (768 * 4 + 1024);
    return { totalChunks, indexed, processing, failed, storage };
  }, [media]);

  const CARDS = [
    {
      label: 'Vectors',
      value: (usage ? usage.vectors : stats.totalChunks).toLocaleString(),
      sub: usage ? 'measured · 768-dim · cosine' : '768-dim · cosine',
      icon: Database
    },
    {
      label: 'Sources',
      value: String(media.length),
      sub: `${stats.indexed} indexed · ${stats.processing} processing`,
      icon: Boxes
    },
    {
      label: 'Storage',
      value: fmtBytes(usage ? usage.estBytes : stats.storage),
      sub: usage ? 'estimated from live vector count' : 'estimated',
      icon: HardDrive
    },
    {
      label: 'Namespaces',
      value: String(projects.length),
      sub: 'one per project',
      icon: Activity
    }
  ];

  return (
    <div className="h-full p-2.5">
      <div className="panel flex h-full flex-col overflow-hidden rounded-[26px]">
        <div className="px-6 pt-6 lg:px-8">
          <h1 className="text-[22px] font-semibold tracking-tight">Knowledge health</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your vector index at a glance — Pinecone <code className="text-[12px]">life-agents-kb</code>.
          </p>

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

          {usage?.breakdown && (
            <div className="card-glass mt-5 rounded-[18px] p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Storage by user (admin) · index total {usage.totalVectors.toLocaleString()} vectors
                · ~{fmtBytes(usage.totalEstBytes)}
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
                          width: `${Math.max(1, Math.round((r.vectors / Math.max(1, usage.totalVectors)) * 100))}%`
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

          <h2 className="mt-7 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Per-source index status
          </h2>
        </div>

        <div className="scroll-clean flex-1 space-y-2 overflow-y-auto px-6 py-4 lg:px-8">
          {media.map((m) => (
            <div key={m.id} className="card-glass flex items-center gap-3.5 rounded-[18px] px-4 py-3">
              <MediaIcon type={m.type} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{m.name}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                  {m.chunks} chunks ·{' '}
                  {fmtBytes(m.chunks * (768 * 4 + 1024))} · indexed {m.date}
                </div>
              </div>
              <StatusBadge status={m.status} />
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
