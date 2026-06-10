'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useRag } from '@/lib/rag/store';
import { Checkbox } from '@/components/ui/checkbox';
import { MediaIcon, StatusBadge } from '@/components/rag/shared';
import { cn } from '@/lib/utils';
import { Layers, Plus, PanelLeftClose } from 'lucide-react';

export function SourcesPanel({ onCollapse }: { onCollapse?: () => void }) {
  const { media, selectedIds, toggleSelect, selectAll, scope, setScope } = useRag();

  const indexedIds = useMemo(
    () => media.filter((m) => m.status === 'indexed').map((m) => m.id),
    [media]
  );
  const allSelected =
    indexedIds.length > 0 && indexedIds.every((id) => selectedIds.has(id));
  const someSelected = indexedIds.some((id) => selectedIds.has(id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sources
        </h2>
        <div className="flex items-center gap-1">
          <Link
            href="/library"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Link>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse sources"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scope segmented control */}
      <div className="px-4 pt-3">
        <div className="flex rounded-xl bg-secondary p-0.5 text-[13px] font-medium">
          <button
            onClick={() => setScope('selected')}
            className={cn(
              'flex-1 rounded-[10px] py-1.5 transition-all',
              scope === 'selected'
                ? 'bg-card text-foreground shadow-soft'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Selected
          </button>
          <button
            onClick={() => setScope('everything')}
            className={cn(
              'flex-1 rounded-[10px] py-1.5 transition-all',
              scope === 'everything'
                ? 'bg-card text-foreground shadow-soft'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Everything
          </button>
        </div>
      </div>

      {/* Select all */}
      <button
        onClick={() => selectAll(indexedIds)}
        disabled={scope === 'everything'}
        className={cn(
          'mx-4 mt-3 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] disabled:opacity-40',
          scope === 'everything' && 'pointer-events-none'
        )}
      >
        <Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} />
        <span>Select all indexed</span>
      </button>

      {/* List */}
      <div className="scroll-clean mt-1 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {media.map((m) => {
          const inEverything = scope === 'everything' && m.status === 'indexed';
          const checked = scope === 'everything' ? inEverything : selectedIds.has(m.id);
          const disabled = scope === 'everything' || m.status !== 'indexed';
          return (
            <button
              key={m.id}
              onClick={() => !disabled && toggleSelect(m.id)}
              disabled={disabled}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors',
                checked ? 'bg-accent/5' : 'hover:bg-[rgb(var(--hairline)/0.05)]',
                disabled && scope !== 'everything' && 'opacity-55'
              )}
            >
              <Checkbox checked={checked} className={cn(disabled && 'opacity-60')} />
              <MediaIcon type={m.type} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium leading-tight">
                  {m.name}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {m.status === 'indexed' ? (
                    <span className="text-[11px] text-muted-foreground">
                      {m.chunks} chunks
                    </span>
                  ) : (
                    <StatusBadge status={m.status} />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Context summary */}
      <div className="border-t border-[rgb(var(--hairline)/0.08)] px-4 py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <Layers className="h-4 w-4 text-accent" />
          <span className="font-medium">
            {scope === 'everything'
              ? `${indexedIds.length} sources`
              : `${selectedIds.size} selected`}
          </span>
          <span className="text-muted-foreground">in context</span>
        </div>
      </div>
    </div>
  );
}
