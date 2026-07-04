'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRag, mediaTypeCounts } from '@/lib/rag/store';
import { useIsAdmin } from '@/lib/rag/use-role';
import { MediaType } from '@/lib/rag/types';
import { MEDIA_TYPES, MEDIA_TYPE_ORDER } from '@/lib/rag/media-config';
import { MediaRow } from './media-row';
import { UploadDialog } from './upload-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Plus, Search, MessagesSquare, X, Library as LibraryIcon, Boxes, ArrowDownUp, Trash2 } from 'lucide-react';
import Link from 'next/link';

type Filter = 'all' | MediaType;
type StatusFilter = 'all' | 'indexed' | 'processing' | 'failed';
const STATUS_PILLS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Any status' },
  { key: 'indexed', label: 'Indexed' },
  { key: 'processing', label: 'Processing' },
  { key: 'failed', label: 'Failed' }
];
type Sort = 'import-desc' | 'import-asc' | 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'import-desc', label: 'Import order (newest)' },
  { key: 'import-asc', label: 'Import order (oldest)' },
  { key: 'date-desc', label: 'Date — newest first' },
  { key: 'date-asc', label: 'Date — oldest first' },
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' }
];
// Media ids are assigned sequentially at import (m1109, m1362, …), so the
// trailing number is a reliable import-order key even when `date` is missing.
function importKey(id: string): number {
  const m = /(\d+)\s*$/.exec(id);
  return m ? parseInt(m[1], 10) : 0;
}

export function LibraryView() {
  const { media, selectedIds, toggleSelect, selectAll, clearSelection, activeProject, addSourcesToProject, setPendingBox, deleteMedia } =
    useRag();
  // Bulk delete — the ONE destructive act in the Library, so it gets the
  // typed-count guard (same discipline as delete-project's typed name).
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [typedCount, setTypedCount] = useState('');
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  // Status filter (2026-07-04, born of the 143-failure import): "select all
  // the failed ones" must be one click, not archaeology over a mixed list.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('import-desc');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const isAdmin = useIsAdmin();

  const counts = useMemo(() => mediaTypeCounts(media), [media]);

  const visible = useMemo(() => {
    const list = media.filter((m) => {
      if (filter !== 'all' && m.type !== filter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (query && !`${m.name} ${m.description}`.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });
    const byDate = (a: { date?: string }, b: { date?: string }) =>
      (a.date || '').localeCompare(b.date || '');
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name);
    const byImport = (a: { id: string }, b: { id: string }) =>
      importKey(a.id) - importKey(b.id);
    const sorted = [...list];
    if (sort === 'import-desc') sorted.sort((a, b) => byImport(b, a));
    else if (sort === 'import-asc') sorted.sort(byImport);
    else if (sort === 'date-desc') sorted.sort((a, b) => byDate(b, a));
    else if (sort === 'date-asc') sorted.sort(byDate);
    else if (sort === 'name-asc') sorted.sort(byName);
    else sorted.sort((a, b) => byName(b, a));
    return sorted;
  }, [media, filter, statusFilter, query, sort]);

  // Shift-click selects the range from the last-clicked row.
  function onRowToggle(index: number, shiftKey: boolean) {
    if (shiftKey && lastIndex !== null) {
      const [a, b] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
      selectAll(visible.slice(a, b + 1).map((m) => m.id));
    } else {
      toggleSelect(visible[index].id);
    }
    setLastIndex(index);
  }

  function sendToBox() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const name = window.prompt('Name this box:', 'New box');
    if (name === null) return;
    setPendingBox({ name: name.trim() || 'New box', sourceIds: ids });
    clearSelection();
    router.push('/');
  }

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
            <div className="relative">
              <ArrowDownUp className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                title="Sort sources"
                className="h-9 cursor-pointer rounded-xl border border-input bg-card pl-8 pr-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {isAdmin && (
              <Button variant="accent" className="gap-1.5 rounded-xl" onClick={() => setUploadOpen(true)}>
                <Plus className="h-4 w-4" /> Add source
              </Button>
            )}
          </div>
        </div>

        {/* Type filter — segmented pills, no underline */}
        <div className="scroll-clean mt-4 flex gap-1.5 overflow-x-auto pb-4">
          {tabs.map((t) => {
            const active = filter === t.key;
            const meta = t.key !== 'all' ? MEDIA_TYPES[t.key as MediaType] : null;
            const Icon = meta?.icon;
            return (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all',
                  active
                    ? 'bg-accent/[0.08] text-accent shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:bg-accent/[0.14] dark:shadow-none'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {t.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px] tabular-nums',
                    active ? 'text-accent/70' : 'text-muted-foreground/60'
                  )}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
          {/* Status filter — same pill language; counts respect the type tab.
              "Failed" + Select all + Delete is the one-click cleanup path. */}
          <div className="mx-1 my-1 w-px shrink-0 self-stretch bg-[rgb(var(--hairline)/0.12)]" />
          {STATUS_PILLS.map((s) => {
            const inType = media.filter(
              (m) => filter === 'all' || m.type === filter
            );
            const count =
              s.key === 'all'
                ? inType.length
                : inType.filter((m) => m.status === s.key).length;
            if (s.key !== 'all' && count === 0 && statusFilter !== s.key) return null;
            const active = statusFilter === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all',
                  active
                    ? s.key === 'failed'
                      ? 'bg-red-500/[0.08] text-red-600 dark:bg-red-500/[0.14] dark:text-red-400'
                      : 'bg-accent/[0.08] text-accent shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:bg-accent/[0.14] dark:shadow-none'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {s.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px] tabular-nums',
                    active ? 'opacity-70' : 'text-muted-foreground/60'
                  )}
                >
                  {count}
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
          <>
            <div className="flex items-center justify-between px-1 pb-1 text-[12px] text-muted-foreground">
              <button
                onClick={() => selectAll(visible.map((m) => m.id))}
                className="rounded-md px-2 py-1 font-medium hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
              >
                {visible.every((m) => selectedIds.has(m.id)) ? 'Deselect all' : `Select all ${visible.length}`}
              </button>
              <span>Tip: click one, then shift-click another to select the range.</span>
            </div>
            {visible.map((m, i) => (
              <MediaRow key={m.id} item={m} index={i} onToggle={onRowToggle} />
            ))}
          </>
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
              variant="accent"
              size="sm"
              className="gap-1.5 rounded-xl"
              onClick={sendToBox}
            >
              <Boxes className="h-4 w-4" /> Send to box
            </Button>
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
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 rounded-xl text-red-600 hover:bg-red-500/10 hover:text-red-600"
                onClick={() => {
                  setTypedCount('');
                  setBulkDeleteOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
            <button
              onClick={clearSelection}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk delete — typed-count guard; this PERMANENTLY removes sources
          and their vectors, unlike removing from a project (pointer-only). */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => {
          if (!o) {
            setBulkDeleteOpen(false);
            setTypedCount('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedIds.size} source{selectedIds.size === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              This is the permanent one — unlike removing a file from a
              project, deleting from the Library erases the source and its
              index entries from EVERY project. It cannot be undone from the
              app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>
              Type <span className="font-semibold">{selectedIds.size}</span> to
              confirm
            </Label>
            <Input
              value={typedCount}
              onChange={(e) => setTypedCount(e.target.value)}
              placeholder={String(selectedIds.size)}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => {
                setBulkDeleteOpen(false);
                setTypedCount('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={typedCount.trim() !== String(selectedIds.size)}
              onClick={() => {
                for (const id of Array.from(selectedIds)) deleteMedia(id);
                clearSelection();
                setBulkDeleteOpen(false);
                setTypedCount('');
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete {selectedIds.size}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      </div>
    </div>
  );
}
