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
  { key: 'audio', label: 'Audio Overview', desc: 'Two AI hosts discuss your sources', icon: AudioLines, color: 'text-orange-400', glow: '249 115 22' },
  { key: 'mindmap', label: 'Mind Map', desc: 'Explore an interactive topic tree', icon: Network, color: 'text-violet-400', glow: '167 139 250' },
  { key: 'quiz', label: 'Quiz', desc: 'Test yourself, with explanations', icon: ListChecks, color: 'text-emerald-400', glow: '52 211 153' },
  { key: 'flashcards', label: 'Flashcards', desc: 'Spaced-repetition Q&A cards', icon: Layers3, color: 'text-sky-400', glow: '56 189 248' },
  { key: 'compare', label: 'Compare', desc: 'Diff two or more sources', icon: GitCompareArrows, color: 'text-amber-400', glow: '251 191 36' },
  { key: 'brief', label: 'Briefing Doc', desc: 'A clean executive summary', icon: FileText, color: 'text-zinc-300', glow: '161 161 170' }
];

export function StudioPanel({ onCollapse }: { onCollapse?: () => void }) {
  const { contextItems } = useRag();
  const ready = contextItems.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Studio
        </h2>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse studio"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="px-4 pt-1.5 text-[12px] leading-relaxed text-muted-foreground/70">
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
                'card-glass group flex w-full items-center gap-3 rounded-[18px] p-3 text-left',
                ready ? 'hover-glow' : 'opacity-45'
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-card shadow-soft dark:bg-[rgb(255_255_255_/_0.05)] dark:shadow-none">
                <Icon
                  className={cn('h-[18px] w-[18px] transition-all', t.color)}
                  style={{ filter: `drop-shadow(0 0 6px rgb(${t.glow} / 0.55))` }}
                />
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-tight tracking-tight">{t.label}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{t.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
