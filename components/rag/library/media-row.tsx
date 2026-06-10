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
import {
  MoreHorizontal,
  Copy,
  Check,
  Trash2,
  Pencil,
  ExternalLink
} from 'lucide-react';

export function MediaRow({ item }: { item: MediaItem }) {
  const { selectedIds, toggleSelect, updateMedia, deleteMedia } = useRag();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [desc, setDesc] = useState(item.description);
  const [date, setDate] = useState(item.date);
  const [copied, setCopied] = useState(false);
  const isAdmin = useIsAdmin();

  const checked = selectedIds.has(item.id);

  function saveEdit() {
    updateMedia(item.id, { name: name.trim() || item.name, description: desc, date });
    setEditing(false);
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(item.content);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div
      className={cn(
        'card-glass group flex items-center gap-3.5 rounded-[18px] px-4 py-3 transition-all hover:border-[rgb(var(--hairline)/0.16)]',
        checked && 'ring-1 ring-accent/25'
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={() => toggleSelect(item.id)}
        className={cn(item.status !== 'indexed' && 'opacity-50')}
      />
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
          <>
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{item.name}</span>
            </div>
            <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {item.description || 'No description'}
            </div>
            <div className="mt-1 flex items-center gap-2.5 text-[11px] text-muted-foreground">
              <span>{item.date}</span>
              <span className="text-border">·</span>
              <span>
                {item.sizeLabel ?? item.durationLabel ?? `${item.chunks} chunks`}
              </span>
              {item.source?.startsWith('http') && (
                <>
                  <span className="text-border">·</span>
                  <a
                    href={item.source}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-accent hover:underline"
                  >
                    source <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {!editing && (
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />

          <button
            onClick={copyContent}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground group-hover:opacity-100"
            title="Copy content"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>

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
              <DropdownMenuItem onClick={copyContent} className="gap-2">
                <Copy className="h-3.5 w-3.5" /> Copy content
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
