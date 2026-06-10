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
  PanelRightClose,
  ImagePlus
} from 'lucide-react';

// Resting state is monochrome grey-glass; each tool's jewel tone is
// revealed only on hover (Apple Pro pattern). Muted tones, not primaries.
const TILES = [
  { key: 'image', label: 'Generate Image', desc: 'NanoBanana & Kling, grounded in sources', icon: ImagePlus, hover: 'group-hover:text-[#5E5CE6]', glow: '94 92 230' },
  { key: 'audio', label: 'Audio Overview', desc: 'Two AI hosts discuss your sources', icon: AudioLines, hover: 'group-hover:text-[#E58B22]', glow: '229 139 34' },
  { key: 'mindmap', label: 'Mind Map', desc: 'Explore an interactive topic tree', icon: Network, hover: 'group-hover:text-[#5E5CE6]', glow: '94 92 230' },
  { key: 'quiz', label: 'Quiz', desc: 'Test yourself, with explanations', icon: ListChecks, hover: 'group-hover:text-[#34C759]', glow: '52 199 89' },
  { key: 'flashcards', label: 'Flashcards', desc: 'Spaced-repetition Q&A cards', icon: Layers3, hover: 'group-hover:text-[#32ADE6]', glow: '50 173 230' },
  { key: 'compare', label: 'Compare', desc: 'Diff two or more sources', icon: GitCompareArrows, hover: 'group-hover:text-[#FF9F0A]', glow: '255 159 10' },
  { key: 'brief', label: 'Briefing Doc', desc: 'A clean executive summary', icon: FileText, hover: 'group-hover:text-[#8E8E93]', glow: '142 142 147' }
];

export function StudioPanel({
  onCollapse,
  onGenerateImage
}: {
  onCollapse?: () => void;
  onGenerateImage?: () => void;
}) {
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
              disabled={t.key === 'image' ? false : !ready}
              onClick={t.key === 'image' ? onGenerateImage : undefined}
              className={cn(
                'card-glass group flex w-full items-center gap-3.5 rounded-[18px] p-4 text-left',
                t.key === 'image' || ready ? 'hover-glow' : 'opacity-45'
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[hsl(240_16%_96.5%)] dark:bg-[rgb(255_255_255_/_0.05)]">
                <Icon
                  className={cn(
                    'tile-icon h-[17px] w-[17px] text-muted-foreground transition-all duration-300',
                    t.hover
                  )}
                  style={
                    {
                      '--tile-glow': `rgb(${t.glow} / 0.5)`
                    } as React.CSSProperties
                  }
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
