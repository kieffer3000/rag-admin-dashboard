'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { useBoard } from '@/lib/rag/board/store';
import { MEDIA_TYPES, MEDIA_TYPE_ORDER } from '@/lib/rag/media-config';
import { MediaIcon } from '@/components/rag/shared';
import { MediaType } from '@/lib/rag/types';
import {
  Search,
  MessageSquareQuote,
  RotateCcw,
  X,
  Trash2,
  Check,
  Loader2,
  CloudOff,
  Brain,
  Bot
} from 'lucide-react';
import type { RefObject } from 'react';

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
  onPlaceAgent,
  onRecallMedia,
  saveStatus,
  onSave,
  binRef,
  binHot,
  onDeleteSelected,
  dockRef
}: {
  placedIds: Set<string>;
  onPlaceMedia: (mediaId: string) => void;
  onPlacePrompt: (text: string) => void;
  onPlaceAgent: (agent: { agentId: string; name: string; icon?: string; text: string }) => void;
  onRecallMedia: (mediaId: string) => void;
  saveStatus: 'saved' | 'saving' | 'local';
  onSave: () => void;
  binRef: RefObject<HTMLButtonElement | null>;
  binHot: boolean;
  onDeleteSelected: () => void;
  /** Canvas reads the dock's screen bounds to push dropped nodes off it. */
  dockRef?: RefObject<HTMLDivElement | null>;
}) {
  const { projectMedia, deleteMedia, agents } = useRag();
  const { board, unstashBrain } = useBoard();
  const stashedBrains = board.stashedBrains ?? [];
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
    // Capture phase: fires even on the React Flow pane (it stops bubbling),
    // so clicking empty canvas closes the chest too.
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
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
      : open === 'agent'
      ? agents.filter((a) => a.name.toLowerCase().includes(query))
      : open === 'brains'
      ? stashedBrains.filter((s) =>
          String(s.node.data?.name ?? 'Brain').toLowerCase().includes(query)
        )
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
                : open === 'agent'
                ? 'Agents'
                : open === 'brains'
                ? 'Parked brains'
                : MEDIA_TYPES[open as MediaType].plural}
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              {open === 'prompt'
                ? 'drag a guide onto the board'
                : open === 'agent'
                ? 'drag a persona onto the board'
                : open === 'brains'
                ? 'click to bring one back to the canvas'
                : `${byType.get(open as MediaType)?.length ?? 0} produced · drag onto board`}
            </span>
            <button
              onClick={() => setOpen(null)}
              title="Close"
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-[rgb(var(--hairline)/0.08)] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
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
            ) : open === 'brains' ? (
              (panelItems as typeof stashedBrains).map((s) => {
                return (
                  <div
                    key={s.node.id}
                    onClick={() => {
                      unstashBrain(s.node.id);
                      setOpen(null);
                    }}
                    title="Bring this brain back to the canvas (chats + wiring restored)"
                    className="group flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[rgb(var(--hairline)/0.05)]"
                  >
                    <Brain className="h-4 w-4 shrink-0 text-indigo-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {String(s.node.data?.name ?? 'Brain')}
                      </span>
                      <span className="block text-[10.5px] text-muted-foreground/65">
                        {s.edges.length
                          ? `${s.edges.length} wire${s.edges.length > 1 ? 's' : ''} · click to restore`
                          : 'click to restore'}
                      </span>
                    </span>
                    <RotateCcw className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-accent" />
                  </div>
                );
              })
            ) : open === 'agent' ? (
              (panelItems as typeof agents).map((a) => (
                <div
                  key={a.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      CHEST_MIME,
                      JSON.stringify({
                        kind: 'agent',
                        agentId: a.id,
                        name: a.name,
                        icon: a.icon,
                        text: a.systemPrompt
                      })
                    );
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() =>
                    onPlaceAgent({
                      agentId: a.id,
                      name: a.name,
                      icon: a.icon,
                      text: a.systemPrompt
                    })
                  }
                  className="group flex cursor-grab items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[rgb(var(--hairline)/0.05)] active:cursor-grabbing"
                >
                  {a.icon ? (
                    <span className="shrink-0 text-[16px] leading-none">{a.icon}</span>
                  ) : (
                    <Bot className="h-4 w-4 shrink-0 text-emerald-500" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">
                      {a.name}
                    </span>
                    <span className="block truncate text-[10.5px] text-muted-foreground/65">
                      {a.systemPrompt}
                    </span>
                  </span>
                </div>
              ))
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
                  <MessageSquareQuote className="h-4 w-4 shrink-0 text-indigo-500" />
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
                      'group flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors',
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `Delete "${m.name}" permanently? This removes it from your knowledge base and Pinecone. This cannot be undone.`
                          )
                        ) {
                          if (placed) onRecallMedia(m.id);
                          deleteMedia(m.id);
                        }
                      }}
                      title="Delete permanently — removes it from your knowledge base and Pinecone"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* the dock: a bubble per media type + a prompts bubble */}
      <div
        ref={dockRef}
        className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-2 shadow-[0_4px_24px_rgb(0_0_0/0.12)] ring-1 ring-black/[0.05] dark:ring-white/[0.08]"
      >
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
          <MessageSquareQuote className="h-[18px] w-[18px] text-indigo-500" strokeWidth={2.25} />
        </button>

        {/* Agents — saved answering personas; drag one onto the board and wire
            it into a brain to steer how it answers. */}
        <button
          onClick={() => toggle('agent')}
          title="Agents — answering personas"
          className={cn(
            'relative flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 transition-all dark:bg-emerald-500/[0.12]',
            open === 'agent' ? 'ring-2 ring-accent' : 'hover:brightness-95'
          )}
        >
          <Bot className="h-[18px] w-[18px] text-emerald-500" strokeWidth={2.25} />
          {agents.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-bold text-background">
              {agents.length}
            </span>
          )}
        </button>

        {/* Parked brains — appears once a brain is sent here, to declutter the
            canvas; click to bring one back (chats + wiring restored). */}
        {stashedBrains.length > 0 && (
          <button
            onClick={() => toggle('brains')}
            title="Parked brains — click to bring one back to the canvas"
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 transition-all dark:bg-indigo-500/[0.12]',
              open === 'brains' ? 'ring-2 ring-accent' : 'hover:brightness-95'
            )}
          >
            <Brain className="h-[18px] w-[18px] text-indigo-500" strokeWidth={2.25} />
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-bold text-background">
              {stashedBrains.length}
            </span>
          </button>
        )}

        <div className="mx-0.5 h-7 w-px bg-[rgb(var(--hairline)/0.12)]" />
        {/* save status / force-save */}
        <button
          onClick={onSave}
          title="Everything autosaves. Click to save now."
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-all hover:brightness-95',
            saveStatus === 'local' ? 'text-amber-600' : 'text-muted-foreground'
          )}
        >
          {saveStatus === 'saving' ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : saveStatus === 'local' ? (
            <CloudOff className="h-[18px] w-[18px]" />
          ) : (
            <Check className="h-[18px] w-[18px] text-emerald-500" />
          )}
        </button>
        {/* garbage bin: drag a source chip here, or select a node + click to delete */}
        <button
          ref={binRef}
          onClick={onDeleteSelected}
          title="Garbage bin — drag a source here, or select a node and click to delete it"
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-all',
            binHot
              ? 'scale-110 bg-red-500/15 text-red-500 ring-2 ring-red-400'
              : 'text-muted-foreground/70 hover:bg-red-500/10 hover:text-red-500'
          )}
        >
          <Trash2 className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}
