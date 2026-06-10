'use client';

import { useMemo, useState } from 'react';
import { useRag, mediaTypeCounts } from '@/lib/rag/store';
import { useIsAdmin } from '@/lib/rag/use-role';
import { MediaType } from '@/lib/rag/types';
import { MEDIA_TYPES, MEDIA_TYPE_ORDER } from '@/lib/rag/media-config';
import { MediaRow } from './media-row';
import { UploadDialog } from './upload-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Plus, Search, MessagesSquare, X, Library as LibraryIcon } from 'lucide-react';
import Link from 'next/link';

type Filter = 'all' | MediaType;

export function LibraryView() {
  const { media, selectedIds, clearSelection, activeProject, addSourcesToProject } =
    useRag();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const isAdmin = useIsAdmin();

  const counts = useMemo(() => mediaTypeCounts(media), [media]);

  const visible = useMemo(() => {
    return media.filter((m) => {
      if (filter !== 'all' && m.type !== filter) return false;
      if (query && !`${m.name} ${m.description}`.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });
  }, [media, filter, query]);

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: media.length },
    ...MEDIA_TYPE_ORDER.map((t) => ({
      key: t as Filter,
      label: MEDIA_TYPES[t].plural,
      count: counts[t]
    }))
  ];

  return (
    <div className="h-full p-2.5">
      <div className="panel flex h-full flex-col overflow-hidden rounded-[26px]">
      {/* Header */}
      <div className="border-b border-[rgb(var(--hairline)/0.08)] px-6 pt-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Library</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {media.length} sources · {media.filter((m) => m.status === 'indexed').length} indexed
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sources…"
                className="h-9 w-56 rounded-xl pl-9"
              />
            </div>
            {isAdmin && (
              <Button variant="accent" className="gap-1.5 rounded-xl" onClick={() => setUploadOpen(true)}>
                <Plus className="h-4 w-4" /> Add source
              </Button>
            )}
          </div>
        </div>

        {/* Type tabs */}
        <div className="scroll-clean -mb-px mt-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = filter === t.key;
            const meta = t.key !== 'all' ? MEDIA_TYPES[t.key as MediaType] : null;
            const Icon = meta?.icon;
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-accent text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {Icon && <Icon className={cn('h-4 w-4', active && meta?.text)} />}
                {t.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px] tabular-nums',
                    active ? 'bg-accent/10 text-accent' : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="scroll-clean flex-1 space-y-2 overflow-y-auto px-6 py-4 lg:px-8">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
              <LibraryIcon className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium">No sources here yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Add your first source to start building your knowledge base.
            </p>
            <Button variant="accent" className="mt-4 gap-1.5 rounded-xl" onClick={() => setUploadOpen(true)}>
              <Plus className="h-4 w-4" /> Add source
            </Button>
          </div>
        ) : (
          visible.map((m) => <MediaRow key={m.id} item={m} />)
        )}
      </div>

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="panel pointer-events-auto flex items-center gap-3 rounded-full px-3 py-2">
            <span className="pl-1 text-[13px] font-medium">
              {selectedIds.size} selected
            </span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl"
              onClick={() => addSourcesToProject(activeProject.id, Array.from(selectedIds))}
            >
              {activeProject.icon} Add to {activeProject.name}
            </Button>
            <Link href="/">
              <Button
                variant="accent"
                size="sm"
                className="gap-1.5 rounded-xl"
                onClick={() =>
                  addSourcesToProject(activeProject.id, Array.from(selectedIds))
                }
              >
                <MessagesSquare className="h-4 w-4" /> Chat with selection
              </Button>
            </Link>
            <button
              onClick={clearSelection}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      </div>
    </div>
  );
}
