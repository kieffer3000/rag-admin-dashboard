'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { MEDIA_TYPES, MEDIA_TYPE_ORDER } from '@/lib/rag/media-config';
import { MediaIcon } from '@/components/rag/shared';
import { MediaType } from '@/lib/rag/types';
import { Search, Sparkles, Lightbulb, RotateCcw } from 'lucide-react';

/** Drag payload the canvas reads in its onDrop handler. */
export const CHEST_MIME = 'application/answersdoc-chest';

/** Common prompt presets the chest can spawn (mirrors the toolbar list). */
const PROMPT_PRESETS = [
  'Answer concisely, in bullet points',
  'Respond in a clear table',
  'Be skeptical — surface contradictions and caveats',
  'Explain simply, as if to a beginner',
  'Use a professional, executive tone',
  'Give step-by-step reasoning',
  'Always quote the exact source text'
];

/**
 * The CHEST — a Make-style bottom dock. One bubble per media type (plus a
 * Prompts bubble); click a bubble to open a searchable panel of everything
 * you've produced, then DRAG an item onto the canvas to drop it as a puzzle
 * piece (or click to add at center). Prompts drop as prompt pieces.
 */
export function BoardChest({
  placedIds,
  onPlaceMedia,
  onPlacePrompt,
  onRecallMedia
}: {
  placedIds: Set<string>;
  onPlaceMedia: (mediaId: string) => void;
  onPlacePrompt: (text: string) => void;
  onRecallMedia: (mediaId: string) => void;
}) {
  const { projectMedia } = useRag();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Click anywhere outside the chest → close the open panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Group sources by type; only show a bubble for types that have items.
  const byType = useMemo(() => {
    const m = new Map<MediaType, typeof projectMedia>();
    for (const item of projectMedia) {
      const arr = m.get(item.type) ?? [];
      arr.push(item);
      m.set(item.type, arr);
    }
    return m;
  }, [projectMedia]);

  const typeBubbles = MEDIA_TYPE_ORDER.filter((t) => (byType.get(t)?.length ?? 0) > 0);
  const query = q.trim().toLowerCase();

  function toggle(key: string) {
    setOpen((o) => (o === key ? null : key));
    setQ('');
  }

  const panelItems =
    open === 'prompt'
      ? PROMPT_PRESETS.filter((p) => p.toLowerCase().includes(query))
      : open
      ? (byType.get(open as MediaType) ?? []).filter((m) =>
          m.name.toLowerCase().includes(query)
        )
      : [];

  return (
    <div
      ref={rootRef}
      className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center"
    >
      {/* flyout panel */}
      {open && (
        <div className="mb-2 w-[320px] overflow-hidden rounded-[18px] bg-card shadow-[0_8px_40px_rgb(0_0_0/0.16)] ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <span className="text-[12px] font-semibold tracking-tight">
              {open === 'prompt'
                ? 'Prompt pieces'
                : MEDIA_TYPES[open as MediaType].plural}
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              {open === 'prompt'
                ? 'drag a guide onto the board'
                : `${byType.get(open as MediaType)?.length ?? 0} produced · drag onto board`}
            </span>
          </div>
          <div className="px-3 pb-2 pt-1.5">
            <div className="flex items-center gap-1.5 rounded-[10px] bg-[hsl(240_14%_96.5%)] px-2 py-1 dark:bg-white/[0.05]">
              <Search className="h-3.5 w-3.5 text-muted-foreground/50" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/45"
              />
            </div>
          </div>
          <div className="max-h-[280px] overflow-y-auto px-1.5 pb-2 scroll-clean">
            {panelItems.length === 0 ? (
              <p className="px-2 py-3 text-center text-[12px] text-muted-foreground/60">
                Nothing here yet.
              </p>
            ) : open === 'prompt' ? (
              (panelItems as string[]).map((preset) => (
                <div
                  key={preset}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      CHEST_MIME,
                      JSON.stringify({ kind: 'prompt', text: preset })
                    );
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onPlacePrompt(preset)}
                  className="flex cursor-grab items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[rgb(var(--hairline)/0.05)] active:cursor-grabbing"
                >
                  <Lightbulb className="h-4 w-4 shrink-0 text-indigo-500" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{preset}</span>
                </div>
              ))
            ) : (
              (panelItems as typeof projectMedia).map((m) => {
                const placed = placedIds.has(m.id);
                return (
                  <div
                    key={m.id}
                    // Already on the board → can't add a second copy; greyed,
                    // not draggable, with a Recall button to pull it back.
                    draggable={!placed}
                    onDragStart={
                      placed
                        ? undefined
                        : (e) => {
                            e.dataTransfer.setData(
                              CHEST_MIME,
                              JSON.stringify({ kind: 'media', id: m.id })
                            );
                            e.dataTransfer.effectAllowed = 'copy';
                          }
                    }
                    onClick={() => !placed && onPlaceMedia(m.id)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors',
                      placed
                        ? 'cursor-default opacity-50'
                        : 'cursor-grab hover:bg-[rgb(var(--hairline)/0.05)] active:cursor-grabbing'
                    )}
                  >
                    <MediaIcon type={m.type} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {m.name}
                      </span>
                      <span className="block text-[10.5px] text-muted-foreground/65">
                        {placed
                          ? 'on the board'
                          : m.status === 'indexed'
                          ? `${m.chunks} chunks`
                          : m.status}
                      </span>
                    </span>
                    {placed && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRecallMedia(m.id);
                        }}
                        title="Recall — remove from the board and return it here"
                        className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-foreground/[0.06] px-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground"
                      >
                        <RotateCcw className="h-3 w-3" /> R
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* the dock: a bubble per media type + a prompts bubble */}
      <div className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-2 shadow-[0_4px_24px_rgb(0_0_0/0.12)] ring-1 ring-black/[0.05] dark:ring-white/[0.08]">
        {typeBubbles.map((t) => {
          const meta = MEDIA_TYPES[t];
          const count = byType.get(t)?.length ?? 0;
          return (
            <button
              key={t}
              onClick={() => toggle(t)}
              title={meta.plural}
              className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-full transition-all',
                meta.tint,
                open === t ? 'ring-2 ring-accent' : 'hover:brightness-95'
              )}
            >
              <meta.icon className={cn('h-[18px] w-[18px]', meta.text)} strokeWidth={2.25} />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-bold text-background">
                {count}
              </span>
            </button>
          );
        })}
        <div className="mx-0.5 h-7 w-px bg-[rgb(var(--hairline)/0.12)]" />
        <button
          onClick={() => toggle('prompt')}
          title="Prompt pieces"
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 transition-all dark:bg-indigo-500/[0.12]',
            open === 'prompt' ? 'ring-2 ring-accent' : 'hover:brightness-95'
          )}
        >
          <Sparkles className="h-[18px] w-[18px] text-indigo-500" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
