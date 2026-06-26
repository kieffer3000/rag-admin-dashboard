'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { useBoard, useSaveStatus } from '@/lib/rag/board/store';
import { MEDIA_TYPES, MEDIA_TYPE_ORDER } from '@/lib/rag/media-config';
import { MediaIcon } from '@/components/rag/shared';
import { MediaType } from '@/lib/rag/types';
import {
  Search,
  RotateCcw,
  X,
  Trash2,
  Check,
  Loader2,
  CloudOff,
  Brain,
  Bot,
  Package,
  Plus
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { RefObject } from 'react';

const AGENT_EMOJIS = ['🤖', '🎓', '💡', '🧠', '⚖️', '🔍', '✨', '📊', '🎯', '🧑‍💻'];

/** Drag payload the canvas reads in its onDrop handler. */
export const CHEST_MIME = 'application/answersdoc-chest';

/**
 * The CHEST — a Make-style bottom dock. One bubble per media type (plus an
 * Agents bubble); click a bubble to open a searchable panel of everything
 * you've produced, then DRAG an item onto the canvas to drop it as a puzzle
 * piece (or click to add at center). Agents drop as persona pieces.
 */
export function BoardChest({
  placedIds,
  onPlaceMedia,
  onPlaceAgent,
  onRecallMedia,
  onSave,
  binRef,
  binHot,
  onDeleteSelected,
  onFocusBox,
  dockRef
}: {
  placedIds: Set<string>;
  /** Pan/zoom the canvas to an on-canvas box (hub) by id. */
  onFocusBox?: (hubId: string) => void;
  onPlaceMedia: (mediaId: string) => void;
  onPlaceAgent: (agent: { agentId: string; name: string; icon?: string; text: string }) => void;
  onRecallMedia: (mediaId: string) => void;
  onSave: () => void;
  binRef: RefObject<HTMLButtonElement | null>;
  binHot: boolean;
  onDeleteSelected: () => void;
  /** Canvas reads the dock's screen bounds to push dropped nodes off it. */
  dockRef?: RefObject<HTMLDivElement | null>;
}) {
  const { projectMedia, deleteMedia, agents, addAgent } = useRag();
  const { board, unstashBrain, unstashBox } = useBoard();
  const saveStatus = useSaveStatus(); // isolated store → flips don't re-render the board
  const stashedBrains = board.stashedBrains ?? [];
  const stashedBoxes = board.stashedBoxes ?? [];
  // Boxes currently ON the canvas (so the dock is a registry of ALL boxes, not
  // just parked ones — you can see them and jump to any).
  const canvasBoxes = board.nodes.filter(
    (n) => n.type === 'hub' && (n.data as { mediaType?: string })?.mediaType === 'cluster'
  );
  const totalBoxes = canvasBoxes.length + stashedBoxes.length;
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // "New agent" inline popup (create without leaving the board).
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [naName, setNaName] = useState('');
  const [naPrompt, setNaPrompt] = useState('');
  const [naIcon, setNaIcon] = useState('🤖');
  function openNewAgent() {
    setNaName('');
    setNaPrompt('');
    setNaIcon('🤖');
    setNewAgentOpen(true);
  }
  function saveNewAgent() {
    if (!naName.trim() || !naPrompt.trim()) return;
    addAgent({ name: naName.trim(), systemPrompt: naPrompt.trim(), icon: naIcon });
    setNewAgentOpen(false);
  }
  // A drag-and-drop ends with a trailing `click` on the source in some browsers.
  // This guards the click-to-place handler so a dragged agent isn't ALSO placed
  // at center (which spawned a duplicate second piece).
  const draggedRef = useRef(false);

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
    open === 'agent'
      ? agents.filter((a) => a.name.toLowerCase().includes(query))
      : open === 'brains'
      ? stashedBrains.filter((s) =>
          String(s.node.data?.name ?? 'Brain').toLowerCase().includes(query)
        )
      : open === 'boxes'
      ? stashedBoxes.filter((s) =>
          String(s.node.data?.name ?? 'Box').toLowerCase().includes(query)
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
              {open === 'agent'
                ? 'Agents'
                : open === 'brains'
                ? 'Parked brains'
                : open === 'boxes'
                ? 'Parked boxes'
                : MEDIA_TYPES[open as MediaType].plural}
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              {open === 'agent'
                ? 'drag a persona onto the board'
                : open === 'brains'
                ? 'click to bring one back to the canvas'
                : open === 'boxes'
                ? 'on canvas → jump · parked → restore'
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
            {/* Agents panel always offers a create row, even when empty. */}
            {open === 'agent' ? (
              <>
                <button
                  onClick={() => {
                    setOpen(null);
                    openNewAgent();
                  }}
                  className="mb-1 flex w-full items-center gap-2.5 rounded-[10px] border border-dashed border-emerald-300/70 px-2 py-2 text-[12.5px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-400/30 dark:text-emerald-300 dark:hover:bg-emerald-500/[0.08]"
                >
                  <Plus className="h-4 w-4 shrink-0" /> New agent
                </button>
                {(panelItems as typeof agents).length === 0 ? (
                  <p className="px-2 py-2 text-center text-[11.5px] text-muted-foreground/60">
                    No agents yet — create one to wire into a brain.
                  </p>
                ) : (
                  (panelItems as typeof agents).map((a) => (
                    <div
                      key={a.id}
                      draggable
                      onDragStart={(e) => {
                        draggedRef.current = true;
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
                      onDragEnd={() => {
                        // Swallow the trailing post-drop click, then re-enable.
                        setTimeout(() => {
                          draggedRef.current = false;
                        }, 60);
                      }}
                      onClick={() => {
                        if (draggedRef.current) return; // was a drag, not a click
                        onPlaceAgent({
                          agentId: a.id,
                          name: a.name,
                          icon: a.icon,
                          text: a.systemPrompt
                        });
                        setOpen(null); // close the panel so the new piece shows
                      }}
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
                )}
              </>
            ) : open !== 'boxes' && panelItems.length === 0 ? (
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
            ) : open === 'boxes' ? (
              (() => {
                const canvasMatch = canvasBoxes.filter((b) =>
                  String((b.data as { name?: string })?.name ?? 'Box')
                    .toLowerCase()
                    .includes(query)
                );
                const parkedMatch = stashedBoxes.filter((s) =>
                  String(s.node.data?.name ?? 'Box').toLowerCase().includes(query)
                );
                if (canvasMatch.length === 0 && parkedMatch.length === 0) {
                  return (
                    <p className="px-2 py-3 text-center text-[12px] text-muted-foreground/60">
                      No boxes yet — group sources into a box on the canvas (or from
                      the Library → Send to box).
                    </p>
                  );
                }
                return (
                  <>
                    {canvasMatch.map((b) => {
                      const count = board.nodes.filter(
                        (n) => n.parentId === b.id && n.type === 'chip'
                      ).length;
                      return (
                        <div
                          key={b.id}
                          onClick={() => {
                            onFocusBox?.(b.id);
                            setOpen(null);
                          }}
                          title="Jump to this box on the canvas"
                          className="group flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[rgb(var(--hairline)/0.05)]"
                        >
                          <Package className="h-4 w-4 shrink-0 text-accent" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium">
                              {String((b.data as { name?: string })?.name ?? 'Box')}
                            </span>
                            <span className="block text-[10.5px] text-muted-foreground/65">
                              {count} source{count === 1 ? '' : 's'} · on canvas · click to jump
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] font-medium text-emerald-600">
                            ●
                          </span>
                        </div>
                      );
                    })}
                    {parkedMatch.map((s) => {
                      const count = s.children.filter((c) => c.type === 'chip').length;
                      return (
                        <div
                          key={s.node.id}
                          onClick={() => {
                            unstashBox(s.node.id);
                            setOpen(null);
                          }}
                          title="Bring this parked box back to the canvas (pieces + wiring restored)"
                          className="group flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[rgb(var(--hairline)/0.05)]"
                        >
                          <Package className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium">
                              {String(s.node.data?.name ?? 'Box')}
                            </span>
                            <span className="block text-[10.5px] text-muted-foreground/65">
                              {count} source{count === 1 ? '' : 's'} · parked · click to restore
                            </span>
                          </span>
                          <RotateCcw className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-accent" />
                        </div>
                      );
                    })}
                  </>
                );
              })()
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

        {/* Parked boxes — minimize a box to here; click to bring it back. Always
            visible so you can SEE your boxes are saved, even with none parked. */}
        <button
          onClick={() => toggle('boxes')}
          title="Parked boxes — minimize a box to here, click to bring one back"
          className={cn(
            'relative flex h-10 w-10 items-center justify-center rounded-full bg-accent/[0.08] transition-all dark:bg-accent/[0.14]',
            open === 'boxes' ? 'ring-2 ring-accent' : 'hover:brightness-95'
          )}
        >
          <Package className="h-[18px] w-[18px] text-accent" strokeWidth={2.25} />
          {totalBoxes > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-bold text-background">
              {totalBoxes}
            </span>
          )}
        </button>

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

      {/* New-agent popup — create a persona without leaving the board. */}
      <Dialog open={newAgentOpen} onOpenChange={setNewAgentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New agent</DialogTitle>
            <DialogDescription>
              An agent is an answering persona — give it a name and a prompt, then
              wire it into a brain to steer how it answers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-10 w-12 items-center justify-center rounded-xl border border-input bg-card text-xl">
                      {naIcon}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="grid grid-cols-5 gap-1 p-2">
                    {AGENT_EMOJIS.map((e) => (
                      <button
                        key={e}
                        onClick={() => setNaIcon(e)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-[rgb(var(--hairline)/0.06)]"
                      >
                        {e}
                      </button>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Name</Label>
                <Input
                  autoFocus
                  value={naName}
                  onChange={(e) => setNaName(e.target.value)}
                  placeholder="e.g. Scholar"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>System prompt</Label>
              <Textarea
                value={naPrompt}
                onChange={(e) => setNaPrompt(e.target.value)}
                placeholder="Describe the persona — tone, stance, how it should answer…"
                className="min-h-[140px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setNewAgentOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              disabled={!naName.trim() || !naPrompt.trim()}
              onClick={saveNewAgent}
            >
              Create agent
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
