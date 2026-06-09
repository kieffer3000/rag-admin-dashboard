'use client';

import { useRag } from '@/lib/rag/store';
import { cn } from '@/lib/utils';
import {
  AudioLines,
  Network,
  ListChecks,
  Layers3,
  GitCompareArrows,
  FileText,
  Sparkles,
  PanelRightClose
} from 'lucide-react';

const TILES = [
  {
    key: 'audio',
    label: 'Audio Overview',
    desc: 'Two AI hosts discuss your sources',
    icon: AudioLines,
    grad: 'from-orange-400 to-pink-500'
  },
  {
    key: 'mindmap',
    label: 'Mind Map',
    desc: 'Explore an interactive topic tree',
    icon: Network,
    grad: 'from-violet-400 to-purple-600'
  },
  {
    key: 'quiz',
    label: 'Quiz',
    desc: 'Test yourself, with explanations',
    icon: ListChecks,
    grad: 'from-emerald-400 to-teal-600'
  },
  {
    key: 'flashcards',
    label: 'Flashcards',
    desc: 'Spaced-repetition Q&A cards',
    icon: Layers3,
    grad: 'from-sky-400 to-blue-600'
  },
  {
    key: 'compare',
    label: 'Compare',
    desc: 'Diff two or more sources',
    icon: GitCompareArrows,
    grad: 'from-amber-400 to-orange-600'
  },
  {
    key: 'brief',
    label: 'Briefing Doc',
    desc: 'A clean executive summary',
    icon: FileText,
    grad: 'from-zinc-400 to-zinc-600'
  }
];

export function StudioPanel({ onCollapse }: { onCollapse?: () => void }) {
  const { contextItems } = useRag();
  const ready = contextItems.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Studio
        </h2>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse studio"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="px-4 pt-1 text-[12px] leading-relaxed text-muted-foreground">
        Generate from your {ready ? `${contextItems.length} source(s)` : 'sources'}.
      </p>

      <div className="scroll-clean flex-1 space-y-2.5 overflow-y-auto p-4">
        {TILES.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              disabled={!ready}
              className={cn(
                'group flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 text-left shadow-soft transition-all duration-150',
                ready ? 'hover:-translate-y-0.5 hover:shadow-float' : 'opacity-50'
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm',
                  t.grad
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-tight">{t.label}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {t.desc}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
