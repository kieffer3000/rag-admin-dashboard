'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { MEDIA_TYPES, MEDIA_TYPE_ORDER } from '@/lib/rag/media-config';
import { MediaType } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import {
  MessageSquarePlus,
  Type,
  StickyNote,
  FolderPlus,
  Sparkles,
  LibraryBig
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface BoardToolbarProps {
  onPlaceMedia: (mediaId: string) => void;
  onNewSource: (type: MediaType, name: string, source: string) => void;
  onAddBrain: () => void;
  onAddText: () => void;
  onAddAnnotation: () => void;
  onAddHub: (name: string, type: MediaType) => void;
  onAddEverything: () => void;
  /** Media ids already placed on the canvas. */
  placedIds: Set<string>;
}

const URL_TYPES: MediaType[] = ['youtube', 'website'];

/**
 * Floating left rail — Poppy-style. Media buttons ingest a NEW source
 * (→ RAG database) and drop its chip on the canvas; the rest add board
 * furniture (brain, hub, notes).
 */
export function BoardToolbar(p: BoardToolbarProps) {
  const { projectMedia } = useRag();
  const [sourceType, setSourceType] = useState<MediaType | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [hubType, setHubType] = useState<MediaType>('document');

  const unplaced = projectMedia.filter((m) => !p.placedIds.has(m.id));

  function submitSource() {
    if (!sourceType || !name.trim()) return;
    p.onNewSource(sourceType, name.trim(), url.trim());
    setSourceType(null);
    setName('');
    setUrl('');
  }

  function submitHub() {
    if (!name.trim()) return;
    p.onAddHub(name.trim(), hubType);
    setHubOpen(false);
    setName('');
  }

  return (
    <>
      <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-0.5 rounded-[18px] bg-card p-1.5 shadow-[0_2px_8px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.10)] dark:ring-1 dark:ring-white/[0.08]">
        <RailButton
          label="New brain"
          accent
          icon={<MessageSquarePlus className="h-[17px] w-[17px]" />}
          onClick={p.onAddBrain}
        />
        <RailDivider />
        {MEDIA_TYPE_ORDER.map((t) => {
          const meta = MEDIA_TYPES[t];
          const Icon = meta.icon;
          return (
            <RailButton
              key={t}
              label={`Add ${meta.label} → index into RAG`}
              icon={<Icon className={cn('h-[17px] w-[17px]', meta.text)} />}
              onClick={() => {
                setName('');
                setUrl('');
                setSourceType(t);
              }}
            />
          );
        })}
        <RailDivider />
        <Popover>
          <PopoverTrigger asChild>
            <span>
              <RailButton
                label="Place from Library"
                icon={<LibraryBig className="h-[17px] w-[17px]" />}
              />
            </span>
          </PopoverTrigger>
          <PopoverContent side="right" align="center" className="w-72 p-2">
            <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Library — not on board
            </p>
            {unplaced.length === 0 ? (
              <p className="px-2 pb-2 text-[12px] text-muted-foreground/70">
                Every source in this project is already placed.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {unplaced.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => p.onPlaceMedia(m.id)}
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-[rgb(var(--hairline)/0.05)]"
                  >
                    <MediaIcon type={m.type} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {m.name}
                      </span>
                      <span className="block text-[10.5px] text-muted-foreground/70">
                        {MEDIA_TYPES[m.type].label}
                        {m.status !== 'indexed' && ` · ${m.status}`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <RailButton
          label="New typed hub"
          icon={<FolderPlus className="h-[17px] w-[17px]" />}
          onClick={() => {
            setName('');
            setHubOpen(true);
          }}
        />
        <RailButton
          label="Everything hub"
          icon={<Sparkles className="h-[17px] w-[17px] text-accent" />}
          onClick={p.onAddEverything}
        />
        <RailDivider />
        <RailButton
          label="Context note (not indexed)"
          icon={<Type className="h-[17px] w-[17px]" />}
          onClick={p.onAddText}
        />
        <RailButton
          label="Annotation"
          icon={<StickyNote className="h-[17px] w-[17px]" />}
          onClick={p.onAddAnnotation}
        />
      </div>

      {/* new-source dialog (P4 wires this to the Indexing webhook) */}
      <Dialog open={!!sourceType} onOpenChange={(o) => !o && setSourceType(null)}>
        <DialogContent className="sm:max-w-md">
          {sourceType && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MediaIcon type={sourceType} size="sm" />
                  Add {MEDIA_TYPES[sourceType].label}
                </DialogTitle>
                <DialogDescription>
                  This goes straight into the knowledge base — it&apos;ll appear
                  as a chip and flip to Indexed when ready.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      sourceType === 'youtube'
                        ? 'e.g. Huberman — Habit Formation'
                        : 'Source name'
                    }
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    {URL_TYPES.includes(sourceType) ? 'URL' : 'File / content'}
                  </Label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={
                      sourceType === 'youtube'
                        ? 'https://youtube.com/watch?v=…'
                        : sourceType === 'website'
                          ? 'https://…'
                          : 'filename or pasted text'
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setSourceType(null)}>
                  Cancel
                </Button>
                <Button variant="accent" disabled={!name.trim()} onClick={submitSource}>
                  Index &amp; place
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* new-hub dialog */}
      <Dialog open={hubOpen} onOpenChange={setHubOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New hub</DialogTitle>
            <DialogDescription>
              A hub holds ONE media type. Drag matching chips near it to dock
              them; wire the hub to a brain to query everything inside.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Research Videos"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Accepts</Label>
              <div className="flex flex-wrap gap-1.5">
                {MEDIA_TYPE_ORDER.map((t) => {
                  const meta = MEDIA_TYPES[t];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={t}
                      onClick={() => setHubType(t)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-all',
                        hubType === t
                          ? 'bg-accent text-white shadow-[0_2px_8px_hsl(var(--accent)/0.35)]'
                          : cn(meta.tint, meta.text, 'hover:brightness-95')
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.plural}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setHubOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" disabled={!name.trim()} onClick={submitHub}>
              Create hub
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RailButton({
  label,
  icon,
  onClick,
  accent
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  accent?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-[12px] transition-all',
            accent
              ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_2px_10px_hsl(var(--accent)/0.4)] hover:brightness-110'
              : 'text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground'
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-[11.5px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function RailDivider() {
  return <div className="mx-2 my-1 h-px bg-[rgb(var(--hairline)/0.08)]" />;
}
