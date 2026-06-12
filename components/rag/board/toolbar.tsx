'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { MEDIA_TYPES, MEDIA_TYPE_ORDER } from '@/lib/rag/media-config';
import { MediaType } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import { WavRecorder, transcribeAudio } from '@/lib/rag/board/dictation';
import { soundEnabled, setSoundEnabled } from '@/lib/rag/board/sound';
import {
  MessageSquarePlus,
  Type,
  StickyNote,
  FolderPlus,
  Sparkles,
  LibraryBig,
  Mic,
  Square,
  Loader2,
  GitFork,
  PanelLeftClose,
  PanelLeftOpen,
  Wand2,
  Volume2,
  VolumeX
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
  /** Create a BOX — a named cluster of intelligence holding any media mix. */
  onAddHub: (name: string) => void;
  onAddEverything: () => void;
  onAddMindmap: () => void;
  onNewRecording: (name: string, transcript: string) => void;
  /** Auto-tidy: brief force-directed cleanup of the whole board. */
  onCleanDesk: () => void;
  /** Media ids already placed on the canvas. */
  placedIds: Set<string>;
}

const URL_TYPES: MediaType[] = ['youtube', 'website'];

/**
 * Floating left rail — collapsible. Media buttons ingest a NEW source
 * (→ RAG database) and drop its chip; Record captures a voice memo,
 * transcribes it via MAI-Transcribe, and indexes the transcript.
 */
export function BoardToolbar(p: BoardToolbarProps) {
  const { projectMedia } = useRag();
  const [collapsed, setCollapsed] = useState(false);
  // Sound starts unknown on the server; sync from localStorage after mount.
  const [sound, setSound] = useState(true);
  useEffect(() => setSound(soundEnabled()), []);
  const [sourceType, setSourceType] = useState<MediaType | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  // ---- voice recording ----
  const [recOpen, setRecOpen] = useState(false);
  const [recState, setRecState] = useState<'idle' | 'recording' | 'transcribing' | 'review'>(
    'idle'
  );
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [recName, setRecName] = useState('');
  const recRef = useRef<WavRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopTimer(), []);

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function startRec() {
    try {
      const r = new WavRecorder();
      await r.start();
      recRef.current = r;
      setElapsed(0);
      setRecState('recording');
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      window.alert('Microphone permission is needed to record.');
    }
  }

  async function stopRec() {
    stopTimer();
    setRecState('transcribing');
    try {
      const blob = await recRef.current!.stop();
      const text = await transcribeAudio(
        blob,
        projectMedia.map((m) => m.name)
      );
      setTranscript(text);
      setRecState('review');
    } catch (e: any) {
      if (e?.status === 503 || e?.status === 501) {
        window.alert(
          'Recording needs MAI-Transcribe configured (MAI_TRANSCRIBE_* env).'
        );
      } else {
        window.alert(e?.message ?? 'Transcription failed.');
      }
      resetRec();
    }
  }

  function confirmRec() {
    p.onNewRecording(recName.trim() || 'Voice memo', transcript);
    resetRec();
  }

  function resetRec() {
    stopTimer();
    recRef.current = null;
    setRecOpen(false);
    setRecState('idle');
    setElapsed(0);
    setTranscript('');
    setRecName('');
  }

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
    p.onAddHub(name.trim());
    setHubOpen(false);
    setName('');
  }

  return (
    <>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setCollapsed(false)}
              className="absolute left-4 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[14px] bg-card text-muted-foreground shadow-[0_2px_8px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.10)] transition-colors hover:text-foreground dark:ring-1 dark:ring-white/[0.08]"
            >
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-[11.5px]">
            Show toolbar
          </TooltipContent>
        </Tooltip>
      ) : (
        <div className="absolute left-4 top-1/2 z-20 flex max-h-[calc(100%-2rem)] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto rounded-[18px] bg-card p-1.5 shadow-[0_2px_8px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.10)] dark:ring-1 dark:ring-white/[0.08]">
          <RailButton
            label="Collapse toolbar"
            desc="Tuck this rail away to free up the canvas. A small tab brings it back."
            icon={<PanelLeftClose className="h-[16px] w-[16px]" />}
            onClick={() => setCollapsed(true)}
          />
          <RailDivider />
          <RailButton
            label="New brain"
            desc="Add a chat node. Wire sources or boxes into it and ask — it answers only from what's connected, with citations."
            accent
            icon={<MessageSquarePlus className="h-[17px] w-[17px]" />}
            onClick={p.onAddBrain}
          />
          <RailButton
            label="Record voice memo"
            desc="Capture audio, transcribe it, and index the transcript as a source you can query."
            icon={<Mic className="h-[17px] w-[17px]" />}
            onClick={() => {
              setRecName('');
              setTranscript('');
              setRecState('idle');
              setRecOpen(true);
            }}
          />
          <RailDivider />
          {MEDIA_TYPE_ORDER.map((t) => {
            const meta = MEDIA_TYPES[t];
            const Icon = meta.icon;
            return (
              <RailButton
                key={t}
                label={`Add ${meta.label}`}
                desc={`Ingest a ${meta.label.toLowerCase()} into the knowledge base — it appears as a puzzle piece and turns Indexed when ready.`}
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
                  desc="Drop a source you've already indexed back onto the canvas as a piece."
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
            label="New box"
            desc="Create a named cluster of intelligence — a sub-project (SEO, PPC…) holding any mix of pieces. Wire the box to query the whole family together."
            icon={<FolderPlus className="h-[17px] w-[17px]" />}
            onClick={() => {
              setName('');
              setHubOpen(true);
            }}
          />
          <RailButton
            label="Everything hub"
            desc="A shortcut that wires every indexed source in this project into a brain at once."
            icon={<Sparkles className="h-[17px] w-[17px] text-accent" />}
            onClick={p.onAddEverything}
          />
          <RailDivider />
          <RailButton
            label="Mind map"
            desc="Sketch a quick tree of ideas. Enter adds a sibling, Tab adds a child. For thinking, not retrieval."
            icon={<GitFork className="h-[17px] w-[17px]" />}
            onClick={p.onAddMindmap}
          />
          <RailButton
            label="Context note"
            desc="A scratch instruction wired into a brain as prompt context — steers the answer but is never indexed."
            icon={<Type className="h-[17px] w-[17px]" />}
            onClick={p.onAddText}
          />
          <RailButton
            label="Annotation"
            desc="A free-floating label to caption a region of the board. Purely visual."
            icon={<StickyNote className="h-[17px] w-[17px]" />}
            onClick={p.onAddAnnotation}
          />
          <RailDivider />
          <RailButton
            label="Clean desk"
            desc="Auto-tidy: gently untangles wires and spaces everything out, keeping stacks and boxes intact."
            icon={<Wand2 className="h-[17px] w-[17px]" />}
            onClick={p.onCleanDesk}
          />
          <RailButton
            label={sound ? 'Sounds on' : 'Sounds off'}
            desc={
              sound
                ? 'Snap clacks, the thinking hum, and the answer chime are playing. Click to mute.'
                : 'Board sounds are muted. Click to bring back the snap, hum, and chime.'
            }
            icon={
              sound ? (
                <Volume2 className="h-[17px] w-[17px]" />
              ) : (
                <VolumeX className="h-[17px] w-[17px] opacity-60" />
              )
            }
            onClick={() => {
              setSoundEnabled(!sound);
              setSound(!sound);
            }}
          />
        </div>
      )}

      {/* new-source dialog */}
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

      {/* new-box (cluster) dialog */}
      <Dialog open={hubOpen} onOpenChange={setHubOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New box</DialogTitle>
            <DialogDescription>
              A box is a cluster of intelligence — a sub-project, not a media
              type. Mix documents, videos, audio, anything. Wire the box to a
              brain and the whole family answers together; unplug it and the
              whole family goes silent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SEO · PPC · Conference 2026"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submitHub()}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setHubOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" disabled={!name.trim()} onClick={submitHub}>
              Create box
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* voice recording dialog */}
      <Dialog open={recOpen} onOpenChange={(o) => (o ? setRecOpen(true) : resetRec())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mic className="h-4 w-4" /> Record a voice memo
            </DialogTitle>
            <DialogDescription>
              Speak your thoughts — MAI-Transcribe turns them into text and
              indexes it as a source you can query.
            </DialogDescription>
          </DialogHeader>

          {recState === 'idle' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <button
                onClick={startRec}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_4px_16px_rgb(239_68_68/0.45)] transition-transform hover:scale-105"
              >
                <Mic className="h-7 w-7" />
              </button>
              <p className="text-[12.5px] text-muted-foreground">Tap to start recording</p>
            </div>
          )}

          {recState === 'recording' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <button
                onClick={stopRec}
                className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-red-500 text-white shadow-[0_4px_16px_rgb(239_68_68/0.5)]"
              >
                <Square className="h-6 w-6 fill-white" />
              </button>
              <p className="font-mono text-[15px] tabular-nums">
                {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')}
              </p>
              <p className="text-[12.5px] text-muted-foreground">Tap to stop</p>
            </div>
          )}

          {recState === 'transcribing' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-7 w-7 animate-spin text-accent" />
              <p className="text-[12.5px] text-muted-foreground">Transcribing…</p>
            </div>
          )}

          {recState === 'review' && (
            <>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={recName}
                    onChange={(e) => setRecName(e.target.value)}
                    placeholder="Voice memo"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Transcript (editable)</Label>
                  <textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    rows={6}
                    className="w-full resize-none rounded-xl border border-input bg-card px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent/50"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={resetRec}>
                  Discard
                </Button>
                <Button
                  variant="accent"
                  disabled={!transcript.trim()}
                  onClick={confirmRec}
                >
                  Index &amp; place
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RailButton({
  label,
  desc,
  icon,
  onClick,
  accent
}: {
  label: string;
  /** One-line explanation shown under the title on hover. */
  desc?: string;
  icon: React.ReactNode;
  onClick?: () => void;
  accent?: boolean;
}) {
  return (
    <Tooltip delayDuration={150}>
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
      {/* Rich tooltip: bold title + a description of what the tool does. */}
      <TooltipContent side="right" className="max-w-[214px]">
        <p className="text-[12px] font-semibold leading-tight">{label}</p>
        {desc && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {desc}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function RailDivider() {
  return <div className="mx-2 my-1 h-px bg-[rgb(var(--hairline)/0.08)]" />;
}
