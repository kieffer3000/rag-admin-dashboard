'use client';

import { useEffect, useState } from 'react';
import { X, ExternalLink, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MediaIcon } from '@/components/rag/shared';
import { Citation } from '@/lib/rag/types';

function cleanSnippet(s: string | undefined): string {
  return (s ?? '')
    .replace(/\[\d+:\d{2}\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Perplexity-style slide-in sources panel. Opened by the stacked "N sources"
 * pill under an answer; lists every cited source (icon · name · locator ·
 * snippet). A row closes the sheet and opens that single source in the global
 * SourceViewer (so the two never fight for z-index).
 */
export function SourcesSheet({
  open,
  onClose,
  citations,
  onCitation,
  question
}: {
  open: boolean;
  onClose: () => void;
  citations: Citation[];
  onCitation: (c: Citation) => void;
  question?: string;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={cn(
          'absolute inset-0 bg-black/30 transition-opacity duration-300',
          shown ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          'absolute right-0 top-0 flex h-full w-[420px] max-w-[88vw] flex-col bg-card shadow-2xl transition-transform duration-300',
          shown ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header className="flex items-center gap-2 border-b border-[rgb(var(--hairline)/0.14)] px-4 py-3">
          <span className="text-[15px] font-semibold">
            {citations.length} source{citations.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        {question && (
          <p className="truncate px-4 pt-3 text-[12.5px] text-muted-foreground/70">
            Sources for “{question}”
          </p>
        )}
        <div className="scroll-brain min-h-0 flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-2">
            {citations.map((c, i) => {
              const snip = cleanSnippet(c.snippet).slice(0, 320);
              const isTs = c.type === 'youtube' || c.type === 'audio';
              return (
                <button
                  key={i}
                  onClick={() => onCitation(c)}
                  className="group/src flex flex-col gap-1.5 rounded-xl border border-[rgb(var(--hairline)/0.12)] bg-black/[0.015] p-3 text-left transition-colors hover:border-accent/40 hover:bg-accent/[0.04] dark:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold tabular-nums text-accent">
                      [{i + 1}]
                    </span>
                    <MediaIcon
                      type={c.type}
                      size="sm"
                      className="h-4 w-4 shrink-0 rounded"
                    />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground/90">
                      {c.mediaName}
                    </span>
                    {c.locator && (
                      <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground/60">
                        {isTs ? <Clock className="h-3 w-3" /> : null}
                        {c.locator}
                      </span>
                    )}
                    {c.jumpUrl && (
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover/src:text-accent" />
                    )}
                  </div>
                  {snip && (
                    <p className="line-clamp-3 text-[12.5px] leading-snug text-muted-foreground/80">
                      {snip}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
