'use client';

import { useState } from 'react';
import { MediaItem } from '@/lib/rag/types';
import { useRag } from '@/lib/rag/store';
import { useIsAdmin } from '@/lib/rag/use-role';
import { Checkbox } from '@/components/ui/checkbox';
import { MediaIcon, StatusBadge } from '@/components/rag/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MoreHorizontal, Trash2, Pencil } from 'lucide-react';

export function MediaRow({
  item,
  index,
  onToggle
}: {
  item: MediaItem;
  index?: number;
  onToggle?: (index: number, shiftKey: boolean) => void;
}) {
  const { selectedIds, toggleSelect, updateMedia, deleteMedia } = useRag();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [desc, setDesc] = useState(item.description);
  const [date, setDate] = useState(item.date);
  const isAdmin = useIsAdmin();

  const checked = selectedIds.has(item.id);

  function saveEdit() {
    updateMedia(item.id, { name: name.trim() || item.name, description: desc, date });
    setEditing(false);
  }

  // NOTE (2026-07-04): the old "Copy content" action is GONE — item.content
  // is intentionally stripped on save to keep state docs light, so after any
  // reload it copied an empty string while flashing a success check. Never
  // ship a button whose success state can lie.

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-[14px] bg-card px-3.5 py-2 transition-all',
        'shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_14px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.07)]',
        'dark:bg-[rgb(255_255_255_/_0.03)] dark:shadow-none dark:ring-1 dark:ring-white/[0.06]',
        checked && 'ring-1 ring-accent/25 dark:ring-accent/40'
      )}
    >
      {/* Wrapper captures shiftKey for range-select; the Checkbox just displays. */}
      <span
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          if (onToggle && index !== undefined) onToggle(index, e.shiftKey);
          else toggleSelect(item.id);
        }}
      >
        <Checkbox
          checked={checked}
          className={cn('pointer-events-none', item.status !== 'indexed' && 'opacity-50')}
        />
      </span>
      <MediaIcon type={item.type} />

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-input px-2 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-ring/50"
              autoFocus
            />
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description"
              className="w-full rounded-lg border border-input px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring/50"
            />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-input px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring/50"
              />
              <button
                onClick={saveEdit}
                className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setName(item.name);
                  setDesc(item.description);
                  setDate(item.date);
                }}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* 3.30: ONE dense line — name, description, then meta pinned to the
             right edge. The old 3-line stack left a desert of white space
             between the text and the status badge on wide screens.
             NOTE the old "source ↗" external link is GONE: it navigated to
             whatever URL a source was imported from — a dead/parked domain
             (madisonavenue.ai → Atom's marketplace) hijacked the click. */
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 max-w-[38%] shrink-0 truncate text-sm font-medium">
              {item.name}
            </span>
            <span className="hidden min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground md:block">
              {item.description || ''}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2.5 whitespace-nowrap text-[11px] text-muted-foreground/60">
              {item.status === 'processing' && item.statusNote ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {item.statusNote}
                </span>
              ) : null}
              <span className="hidden sm:inline">{item.date}</span>
              <span>
                {item.sizeLabel ?? item.durationLabel ?? `${item.chunks} chunks`}
                {item.sizeLabel && item.status === 'indexed' && item.chunks
                  ? ` · ${item.chunks.toLocaleString()} chunks`
                  : ''}
              </span>
            </span>
          </div>
        )}
      </div>

      {!editing && (
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />

          {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setEditing(true)} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Edit details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => deleteMedia(item.id)}
                className="gap-2 text-red-600 focus:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}
