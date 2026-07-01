'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { MediaType } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import { WavRecorder, transcribeAudio } from '@/lib/rag/board/dictation';
import { soundEnabled, setSoundEnabled } from '@/lib/rag/board/sound';
import {
  Brain,
  Type,
  StickyNote,
  FolderPlus,
  Sparkles,
  LibraryBig,
  Mic,
  Square,
  Loader2,
  GitFork,
  ChevronDown,
  ChevronUp,
  Wand2,
  Volume2,
  VolumeX,
  Check,
  AlertCircle,
  RotateCcw,
  Trash2,
  UploadCloud,
  Film,
  FileText,
  BookOpen,
  HelpCircle,
  ArrowLeft
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export interface BoardToolbarProps {
  onPlaceMedia: (mediaId: string) => void;
  /** Returns the created media id (so the importer can track its progress). */
  onNewSource: (type: MediaType, name: string, source: string) => string;
  /** Upload an actual image file → Blob + multimodal index (Make Image scenario).
   *  Returns the created media id. */
  onNewImage: (name: string, file: File) => string;
  /** Upload PDF/DOCX/TXT/… → extract text → chunk + index. Returns media ids. */
  onNewDocuments: (docs: { name: string; file: File; ocr?: boolean }[]) => string[];
  /** Upload an audio file → transcribe → index the transcript. */
  onNewAudio: (name: string, file: File) => void;
  /** Existing boxes (clusters) on the board, for "add to an existing box". */
  boxes: { id: string; name: string }[];
  /** Gather freshly-imported media into a box — a NEW one ({name}) or an
   *  EXISTING one ({id}). */
  onCollectIntoBox: (
    box: { id: string } | { name: string },
    mediaIds: string[]
  ) => void;
  /** Re-run indexing for a source that failed (reuses its id — no duplicate). */
  onRetrySource: (type: MediaType, id: string, url: string) => void;
  /** Delete a source (chip + media + Pinecone vectors). */
  onDeleteSource: (id: string) => void;
  onAddBrain: () => void;
  onAddText: () => void;
  /** Drop an ARTIFACT (right plug) — your working doc the corpus opines ON. */
  onAddArtifact: () => void;
  /** Drop a REFERENCE (top plug) — an exemplar/clue to steer Opine judgment. */
  onAddReference: () => void;
  onAddAnnotation: () => void;
  /** Create a BOX — a named cluster of intelligence holding any media mix. */
  onAddHub: (name: string) => void;
  onAddEverything: () => void;
  onAddMindmap: () => void;
  /** Drop a prompt piece (instruction that guides how a brain answers). */
  onNewRecording: (name: string, transcript: string) => void;
  /** Auto-tidy: arrange the board into tidy type zones. */
  onCleanDesk: () => void;
  /** Drop every not-yet-placed source into one new cluster box. */
  onPlaceAllInBox: () => void;
  /** Media ids already placed on the canvas. */
  placedIds: Set<string>;
}

const URL_TYPES: MediaType[] = ['youtube', 'website'];

/** A stable identity for a link so the SAME video/page isn't imported twice —
 *  YouTube collapses to its 11-char video id (any URL form); a website
 *  normalizes host+path+query (case/trailing-slash-insensitive). */
function dedupKey(type: MediaType | undefined, raw: string): string {
  const u = raw.trim();
  if (type === 'youtube') {
    const id = (u.match(
      /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/
    ) ?? [])[1];
    return id ? `yt:${id}` : `url:${u.toLowerCase()}`;
  }
  try {
    const x = new URL(u);
    return `web:${(x.host + x.pathname).toLowerCase().replace(/\/$/, '')}${x.search}`;
  } catch {
    return `url:${u.toLowerCase()}`;
  }
}

/** Common prompt-piece presets — instructions that guide how a brain answers.
 *  Wire several into a brain (or box them) and they all apply. */
/**
 * Floating left rail — collapsible. Media buttons ingest a NEW source
 * (→ RAG database) and drop its chip; Record captures a voice memo,
 * transcribes it via MAI-Transcribe, and indexes the transcript.
 */
export function BoardToolbar(p: BoardToolbarProps) {
  const { projectMedia, media } = useRag();
  // id → item, built once per media change — the import progress list looks up
  // dozens of rows per render; an O(1) map keeps each render (esp. during scroll)
  // cheap instead of O(rows × media).
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const [collapsed, setCollapsed] = useState(false);
  // Sound starts unknown on the server; sync from localStorage after mount.
  const [sound, setSound] = useState(true);
  useEffect(() => setSound(soundEnabled()), []);
  const [sourceType, setSourceType] = useState<MediaType | null>(null);
  // The unified upload picker — a 2-step wizard: first WHAT it is (long-term RAG
  // / working artifact / supporting reference), then (for RAG) which file type.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadStep, setUploadStep] = useState<'category' | 'type'>('category');
  // Which category card has its longer "?" explanation expanded (null = none).
  const [helpKind, setHelpKind] = useState<'rag' | 'artifact' | 'reference' | null>(
    null
  );
  const [hubOpen, setHubOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  // Multi-URL import (YouTube/website): one link per line, auto-titled.
  const [urls, setUrls] = useState('');
  // Pieces created by the current import, tracked so the dialog can show
  // per-link progress and stay open until everything is indexed.
  const [importing, setImporting] = useState<{ id: string; url: string }[]>([]);
  // File uploads — any number, any supported type, routed per file.
  const [files, setFiles] = useState<File[]>([]);
  // OCR mode for document uploads (set by the dedicated "OCR" tile). When on, the
  // doc runs through CloudConvert's OCR path — for scanned / image-only PDFs.
  const [ocr, setOcr] = useState(false);
  // "Add to a box": dock everything into a cluster — an existing one or a new
  // one. boxTarget is 'new' or an existing box id.
  const [addToBox, setAddToBox] = useState(false);
  const [boxName, setBoxName] = useState('');
  const [boxTarget, setBoxTarget] = useState<string>('new');
  // How many links the last import skipped as already-in-this-project duplicates.
  const [dupSkipped, setDupSkipped] = useState(0);
  // The actual skipped URLs, so the "Skipped" filter pill can list them.
  const [dupSkippedList, setDupSkippedList] = useState<string[]>([]);
  // Status filter for the import progress list: all | indexed | failed | pending | skipped.
  const [importFilter, setImportFilter] = useState<
    'all' | 'indexed' | 'failed' | 'pending' | 'skipped'
  >('all');
  const stripExt = (n: string) => n.replace(/\.[^.]+$/, '');

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
          'Recording needs high-accuracy transcription configured on the server (OPENAI_API_KEY).'
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

  // Hard 2-minute cap: auto-stop + transcribe so a memo left running forever
  // can't grow past the upload limit. The transcript still lands in review.
  useEffect(() => {
    if (recState === 'recording' && elapsed >= 120) {
      void stopRec();
      window.alert(
        'Reached the 2-minute recording limit — stopping and transcribing. Record another memo to keep going.'
      );
    }
  }, [recState, elapsed]);

  const unplaced = projectMedia.filter((m) => !p.placedIds.has(m.id));

  function closeSource() {
    setSourceType(null);
    setName('');
    setUrl('');
    setUrls('');
    setFiles([]);
    setImporting([]);
    setAddToBox(false);
    setBoxName('');
    setBoxTarget('new');
    setDupSkipped(0);
    setDupSkippedList([]);
    setImportFilter('all');
  }

  /** If "Add to a box" is on, gather this import into the chosen box (new or
   *  existing). */
  function maybeBox(ids: string[]) {
    if (!addToBox || !ids.length) return;
    if (boxTarget === 'new') {
      if (boxName.trim()) p.onCollectIntoBox({ name: boxName.trim() }, ids);
    } else {
      p.onCollectIntoBox({ id: boxTarget }, ids);
    }
  }

  function submitSource() {
    if (!sourceType) return;
    if (sourceType === 'image' || sourceType === 'document') {
      // Bulk, mixed file types: route each file to the right pipeline.
      if (!files.length) return;
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      const docs = files.filter((f) => !f.type.startsWith('image/'));
      const nameFor = (f: File) =>
        files.length === 1 && name.trim() ? name.trim() : stripExt(f.name);
      const imgIds = imgs.map((f) => p.onNewImage(nameFor(f), f));
      const docItems = docs.map((f) => ({ name: nameFor(f), file: f, ocr }));
      const docIds = docItems.length ? p.onNewDocuments(docItems) : [];
      maybeBox([...imgIds, ...docIds]);
      // Documents get the live progress popup (per-file status + Retry), just
      // like link imports — so a failed PDF/EPUB is visible and retryable.
      if (docIds.length) {
        setImporting(
          docIds.map((id, i) => ({ id, url: docItems[i]?.name ?? 'Document' }))
        );
        setDupSkipped(0);
        setDupSkippedList([]);
        setImportFilter('all');
        setFiles([]);
        setName('');
        return; // stay open — progress view takes over
      }
    } else if (sourceType === 'audio') {
      // Audio: an uploaded file → transcribe → index. (Recording uses its own
      // dialog + onNewRecording — this branch only fires when a file is chosen.)
      if (!files.length) return;
      const f = files[0];
      p.onNewAudio(name.trim() || stripExt(f.name), f);
    } else if (URL_TYPES.includes(sourceType)) {
      // One or many links, one per line — each auto-titles itself. Keep the
      // dialog OPEN and show per-link progress so a piece is never "lost".
      const raw = urls
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      // Map existing sources by identity. A link already INDEXED is skipped; a
      // link that FAILED is RETRIED (reusing its id — no duplicate); a new link
      // imports. So re-pasting a batch heals failures without making dupes.
      const byKey = new Map(
        projectMedia
          .filter((m) => m.source)
          .map((m) => [dedupKey(m.type, m.source as string), m] as const)
      );
      const inBatch = new Set<string>();
      const created: { id: string; url: string }[] = [];
      const retried: { id: string; url: string }[] = [];
      const allIds: string[] = []; // every pasted link's media id (for the box)
      const skippedUrls = new Set<string>(); // dupes, for the Skipped filter list
      let skipped = 0;
      for (const u of raw) {
        const k = dedupKey(sourceType, u);
        if (inBatch.has(k)) {
          skipped++;
          skippedUrls.add(u);
          continue;
        }
        inBatch.add(k);
        const existing = byKey.get(k);
        if (existing) {
          allIds.push(existing.id);
          if (existing.status === 'failed') {
            p.onRetrySource(sourceType, existing.id, u);
            retried.push({ id: existing.id, url: u });
          } else {
            skipped++; // already indexed / indexing (still gathered into the box)
            skippedUrls.add(u);
          }
        } else {
          const id = p.onNewSource(sourceType, '', u);
          created.push({ id, url: u });
          allIds.push(id);
        }
      }
      const all = [...created, ...retried];
      setDupSkipped(skipped);
      setDupSkippedList([...skippedUrls]);
      setImportFilter('all');
      if (!all.length && !addToBox) {
        window.alert(
          skipped
            ? `Nothing to do — all ${skipped} link${skipped === 1 ? ' is' : 's are'} already indexed in this project.`
            : 'No links to import.'
        );
        return;
      }
      // With "Add to a box" on, gather EVERY pasted link into the box (new,
      // retried, and ones already in the project) so the whole set lives together.
      maybeBox(allIds);
      if (!all.length) {
        // Everything was already indexed — just consolidated into the box.
        closeSource();
        return;
      }
      setImporting(all);
      setUrls('');
      return; // stay open — progress view takes over
    } else {
      if (!name.trim()) return;
      maybeBox([p.onNewSource(sourceType, name.trim(), url.trim())]);
    }
    closeSource();
  }

  function submitHub() {
    if (!name.trim()) return;
    p.onAddHub(name.trim());
    setHubOpen(false);
    setName('');
  }

  /** Route a tile in the unified picker to the existing per-type Add dialog. */
  function openType(t: MediaType) {
    setUploadOpen(false);
    setName('');
    setUrl('');
    setFiles([]);
    setOcr(false);
    setSourceType(t);
  }

  /** Open the voice-memo recorder (from the Audio tile's "record instead"). */
  function openRecorder() {
    setUploadOpen(false);
    setRecName('');
    setTranscript('');
    setRecState('idle');
    setRecOpen(true);
  }

  return (
    <>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setCollapsed(false)}
              className="absolute bottom-4 left-1/2 z-20 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-[14px] bg-card text-muted-foreground shadow-[0_2px_8px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.10)] transition-colors hover:text-foreground dark:ring-1 dark:ring-white/[0.08]"
            >
              <ChevronUp className="h-[20px] w-[20px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-[11.5px]">
            Show toolbar
          </TooltipContent>
        </Tooltip>
      ) : (
        <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-row items-center gap-0.5 overflow-x-auto rounded-[18px] bg-card p-1.5 shadow-[0_2px_8px_rgb(0_0_0/0.06),0_12px_40px_rgb(0_0_0/0.10)] dark:ring-1 dark:ring-white/[0.08]">
          <RailButton
            label="Hide toolbar"
            desc="Tuck this bar away to free up the canvas. A small tab brings it back."
            icon={<ChevronDown className="h-[18px] w-[18px]" />}
            onClick={() => setCollapsed(true)}
          />
          <RailDivider />
          <RailButton
            label="New Answers Bank"
            desc="Add an Answers Bank (chat) node. Wire sources or boxes into it and ask — it answers only from what's connected, with citations."
            accent
            icon={<Brain className="h-[19px] w-[19px]" />}
            onClick={p.onAddBrain}
          />
          <RailButton
            label="Upload"
            desc="One place to add anything — long-term knowledge (RAG), a working doc (Artifact), or a supporting example (Reference). It asks what you're adding, then how."
            icon={<UploadCloud className="h-[19px] w-[19px]" />}
            onClick={() => {
              setUploadStep('category');
              setHelpKind(null);
              setUploadOpen(true);
            }}
          />
          <RailDivider />
          <Popover>
            <PopoverTrigger asChild>
              <span>
                <RailButton
                  label="Place from Library"
                  desc="Drop a source you've already indexed back onto the canvas as a piece."
                  icon={<LibraryBig className="h-[19px] w-[19px]" />}
                />
              </span>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-72 p-2">
              <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Library — not on board
                </p>
                {unplaced.length > 1 && (
                  <button
                    onClick={p.onPlaceAllInBox}
                    className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-semibold text-accent transition-colors hover:bg-accent/20"
                  >
                    Place all in a box
                  </button>
                )}
              </div>
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
            icon={<FolderPlus className="h-[19px] w-[19px]" />}
            onClick={() => {
              setName('');
              setHubOpen(true);
            }}
          />
          <RailButton
            label="Everything hub"
            desc="A shortcut that wires every indexed source in this project into an Answers Bank at once."
            icon={<Sparkles className="h-[19px] w-[19px] text-accent" />}
            onClick={p.onAddEverything}
          />
          <RailDivider />
          <RailButton
            label="Mind map"
            desc="Sketch a quick tree of ideas. Enter adds a sibling, Tab adds a child. For thinking, not retrieval."
            icon={<GitFork className="h-[19px] w-[19px]" />}
            onClick={p.onAddMindmap}
          />
          <RailButton
            label="Context note"
            desc="A scratch instruction wired into an Answers Bank as prompt context — steers the answer but is never indexed."
            icon={<Type className="h-[19px] w-[19px]" />}
            onClick={p.onAddText}
          />
          <RailButton
            label="Annotation"
            desc="A free-floating label to caption a region of the board. Purely visual."
            icon={<StickyNote className="h-[19px] w-[19px]" />}
            onClick={p.onAddAnnotation}
          />
          <RailDivider />
          <RailButton
            label="Draft"
            desc="Your working doc (article, webpage, draft). Wire it to an Answers Bank WITH a Library → it opines on it. Carried whole, never indexed."
            icon={<FileText className="h-[19px] w-[19px]" />}
            onClick={p.onAddArtifact}
          />
          <RailButton
            label="Examples"
            desc="A sample or template to steer the answer by ('make it like this'). Guides judgment; never indexed, never cited."
            icon={<BookOpen className="h-[19px] w-[19px]" />}
            onClick={p.onAddReference}
          />
          <RailDivider />
          <RailButton
            label="Clean desk"
            desc="Untangle: snaps every piece to its plug around each Answers Bank — Library left, Examples top, Draft right, Persona bottom — so no wires cross."
            icon={<Wand2 className="h-[19px] w-[19px]" />}
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
                <Volume2 className="h-[19px] w-[19px]" />
              ) : (
                <VolumeX className="h-[19px] w-[19px] opacity-60" />
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
      <Dialog open={!!sourceType} onOpenChange={(o) => !o && closeSource()}>
        <DialogContent className="sm:max-w-lg">
          {sourceType && importing.length > 0 ? (
            // ---- progress view: stays open until every link finishes ----
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MediaIcon type={sourceType} size="sm" />
                  Importing {importing.length}{' '}
                  {sourceType === 'document'
                    ? importing.length === 1
                      ? 'document'
                      : 'documents'
                    : importing.length === 1
                      ? 'link'
                      : 'links'}
                </DialogTitle>
                <DialogDescription>
                  The pieces are already on your board — this stays open so you
                  can watch them finish and never lose one.
                  {dupSkipped > 0 && (
                    <span className="mt-1 block font-medium text-amber-600">
                      Skipped {dupSkipped} duplicate
                      {dupSkipped === 1 ? '' : 's'} already in this project.
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              {/* status filter pills — click to slice the list by status */}
              {(() => {
                const stOf = (mid: string) => mediaById.get(mid)?.status ?? 'processing';
                const indexedN = importing.filter(
                  (it) => stOf(it.id) === 'indexed'
                ).length;
                const failedN = importing.filter(
                  (it) => stOf(it.id) === 'failed'
                ).length;
                const pendingN = importing.length - indexedN - failedN;
                const skippedN = dupSkippedList.length;
                const pills: {
                  key: 'all' | 'indexed' | 'failed' | 'pending' | 'skipped';
                  label: string;
                  show: boolean;
                }[] = [
                  { key: 'all', label: `All ${importing.length + skippedN}`, show: true },
                  { key: 'indexed', label: `${indexedN} Imported`, show: true },
                  { key: 'pending', label: `${pendingN} Indexing`, show: pendingN > 0 },
                  { key: 'failed', label: `${failedN} Failed`, show: failedN > 0 },
                  { key: 'skipped', label: `${skippedN} Skipped`, show: skippedN > 0 }
                ];
                return (
                  <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                    {pills
                      .filter((pl) => pl.show)
                      .map((pl) => (
                        <button
                          key={pl.key}
                          onClick={() => setImportFilter(pl.key)}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                            importFilter === pl.key
                              ? 'bg-accent text-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]'
                              : 'bg-black/[0.05] text-muted-foreground hover:text-foreground dark:bg-white/[0.06]'
                          )}
                        >
                          {pl.label}
                        </button>
                      ))}
                  </div>
                );
              })()}
              <div className="max-h-72 space-y-1.5 overflow-y-auto py-1">
                {importing
                  .filter((it) => {
                    if (importFilter === 'all') return true;
                    if (importFilter === 'skipped') return false;
                    const s = mediaById.get(it.id)?.status ?? 'processing';
                    if (importFilter === 'indexed') return s === 'indexed';
                    if (importFilter === 'failed') return s === 'failed';
                    return s !== 'indexed' && s !== 'failed'; // pending
                  })
                  .map(({ id, url }) => {
                  const m = mediaById.get(id);
                  const st = m?.status ?? 'processing';
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2.5 rounded-lg border border-input px-2.5 py-2"
                    >
                      {st === 'indexed' ? (
                        <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                      ) : st === 'failed' ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                      ) : (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                      )}
                      <span
                        className="min-w-0 flex-1 leading-tight"
                        title={m?.error ? `${url}\n\nWhy it failed: ${m.error}` : url}
                      >
                        {/* Failed rows show the real link (the title never loaded)
                            so you can see exactly which video didn't make it —
                            plus WHY it failed underneath. */}
                        <span className="block truncate text-[12.5px] font-medium">
                          {st === 'failed' ? url : m?.name?.trim() || url}
                        </span>
                        {st === 'failed' && m?.error && (
                          <span className="block truncate text-[10.5px] text-red-500/80">
                            {m.error}
                          </span>
                        )}
                      </span>
                      {st === 'failed' ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => p.onRetrySource(sourceType, id, url)}
                            title="Retry — index this one again"
                            className="flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20"
                          >
                            <RotateCcw className="h-3 w-3" /> Retry
                          </button>
                          <button
                            onClick={() => p.onDeleteSource(id)}
                            title="Delete this source"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-red-500/10 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
                          {st === 'indexed' ? 'Indexed' : 'Indexing…'}
                        </span>
                      )}
                    </div>
                  );
                })}
                {(importFilter === 'all' || importFilter === 'skipped') &&
                  dupSkippedList.map((url) => (
                    <div
                      key={`skip-${url}`}
                      className="flex items-center gap-2.5 rounded-lg border border-input/60 px-2.5 py-2 opacity-75"
                      title={`${url}\n\nSkipped — already in this project.`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500/70" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                        {url}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-amber-600/80">
                        Skipped
                      </span>
                    </div>
                  ))}
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                {(() => {
                  const failed = importing.filter(
                    (it) => media.find((x) => x.id === it.id)?.status === 'failed'
                  );
                  return failed.length > 0 ? (
                    <div className="mr-auto flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="gap-1.5"
                        onClick={() =>
                          failed.forEach((it) =>
                            p.onRetrySource(sourceType, it.id, it.url)
                          )
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry {failed.length} failed
                      </Button>
                      <Button
                        variant="ghost"
                        className="gap-1.5 text-[12px]"
                        title="Copy the failed links to your clipboard"
                        onClick={() => {
                          const text = failed.map((it) => it.url).join('\n');
                          navigator.clipboard?.writeText(text).then(
                            () => window.alert(`Copied ${failed.length} failed link${failed.length === 1 ? '' : 's'} to your clipboard.`),
                            () => window.alert(text)
                          );
                        }}
                      >
                        Copy URLs
                      </Button>
                    </div>
                  ) : null;
                })()}
                <Button variant="ghost" onClick={() => setImporting([])}>
                  Import more
                </Button>
                <Button variant="accent" onClick={closeSource}>
                  {importing.every((it) => {
                    const st = media.find((x) => x.id === it.id)?.status;
                    return st === 'indexed' || st === 'failed';
                  })
                    ? 'Done'
                    : 'Close'}
                </Button>
              </div>
            </>
          ) : (
            sourceType && (
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
                {/* URL imports auto-title themselves — no Name field needed. */}
                {!URL_TYPES.includes(sourceType) && (
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Source name"
                      autoFocus
                    />
                  </div>
                )}
                {sourceType === 'image' || sourceType === 'document' ? (
                  // Bulk upload, ANY supported type — images go to Blob + caption/
                  // pixel-embed; PDF/DOCX/EPUB/TXT/MD extract → chunk → index. Mixed
                  // selections are routed per file automatically.
                  <div className="space-y-1.5">
                    <Label>Files</Label>
                    <input
                      type="file"
                      multiple
                      accept={
                        sourceType === 'image'
                          ? 'image/png,image/jpeg,image/webp,image/gif'
                          : '.pdf,.docx,.doc,.epub,.rtf,.odt,.txt,.md,application/pdf,application/msword,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/vnd.oasis.opendocument.text,text/plain'
                      }
                      onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                      className="block w-full cursor-pointer rounded-lg border border-input bg-card text-[13px] file:mr-3 file:cursor-pointer file:border-0 file:bg-accent/10 file:px-3 file:py-2 file:text-accent hover:border-accent/40"
                    />
                    {files.length === 1 ? (
                      <p className="text-[11.5px] text-muted-foreground/70">
                        {files[0].name} · {(files[0].size / 1048576).toFixed(1)} MB
                      </p>
                    ) : files.length > 1 ? (
                      <p className="text-[11.5px] text-accent">
                        {files.length} files ·{' '}
                        {(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)} MB
                        total — each becomes its own indexed source.
                      </p>
                    ) : sourceType === 'image' ? (
                      <p className="text-[11.5px] text-muted-foreground/55">
                        Images (PNG/JPEG/WebP/GIF) — select as many as you like.
                        Each is hosted, captioned, and indexed on its own.
                      </p>
                    ) : (
                      <p className="text-[11.5px] text-muted-foreground/55">
                        Documents (PDF, DOCX, EPUB, TXT, MD) — select as many as
                        you like. Each is extracted, chunked, and indexed on its
                        own.{' '}
                        {ocr
                          ? 'OCR is ON — scanned / image-only PDFs will be read too (slower, uses more credits).'
                          : 'For scanned / image-only PDFs, use the OCR tile instead.'}
                      </p>
                    )}
                  </div>
                ) : sourceType === 'audio' ? (
                  // Audio: upload a file (transcribed → indexed) OR jump to the
                  // voice-memo recorder. Either way the transcript is the source.
                  <div className="space-y-2.5">
                    <div className="space-y-1.5">
                      <Label>Audio file</Label>
                      <input
                        type="file"
                        accept="audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg"
                        onChange={(e) =>
                          setFiles(Array.from(e.target.files ?? []).slice(0, 1))
                        }
                        className="block w-full cursor-pointer rounded-lg border border-input bg-card text-[13px] file:mr-3 file:cursor-pointer file:border-0 file:bg-accent/10 file:px-3 file:py-2 file:text-accent hover:border-accent/40"
                      />
                      {files.length === 1 ? (
                        <p className="text-[11.5px] text-muted-foreground/70">
                          {files[0].name} ·{' '}
                          {(files[0].size / 1048576).toFixed(1)} MB — transcribed,
                          then indexed.
                        </p>
                      ) : (
                        <p className="text-[11.5px] text-muted-foreground/55">
                          MP3, M4A, WAV, AAC, FLAC, or OGG. We transcribe it and
                          index the transcript so you can query what was said.
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={openRecorder}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[rgb(var(--hairline)/0.3)] px-3 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground"
                    >
                      <Mic className="h-4 w-4" /> Record a voice memo instead
                    </button>
                  </div>
                ) : URL_TYPES.includes(sourceType) ? (
                  <div className="space-y-1.5">
                    <Label>
                      {sourceType === 'youtube' ? 'YouTube links' : 'Website URLs'}
                    </Label>
                    <Textarea
                      value={urls}
                      onChange={(e) => setUrls(e.target.value)}
                      autoFocus
                      rows={5}
                      placeholder={
                        sourceType === 'youtube'
                          ? 'https://youtube.com/watch?v=…\nPaste one link per line — import 1 or 20 at once'
                          : 'https://…\nOne URL per line'
                      }
                      className="min-h-[120px] font-mono text-[12.5px]"
                    />
                    <p className="text-[11.5px] text-muted-foreground/60">
                      One link per line. Each piece names itself from the{' '}
                      {sourceType === 'youtube' ? 'video title' : 'page'} — no
                      typing needed.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>File / content</Label>
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="filename or pasted text"
                    />
                  </div>
                )}

                {/* Add to a box — dock this whole import into a cluster (new or
                    an existing one). Audio uploads index on their own, so the
                    box option doesn't apply there. */}
                {sourceType !== 'audio' && (
                <div className="space-y-2 rounded-lg border border-dashed border-[rgb(var(--hairline)/0.25)] p-2.5">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                    <input
                      type="checkbox"
                      checked={addToBox}
                      onChange={(e) => setAddToBox(e.target.checked)}
                      className="h-4 w-4 accent-[hsl(var(--accent))]"
                    />
                    Add all to a box
                  </label>
                  {addToBox && (
                    <>
                      {p.boxes.length > 0 && (
                        <select
                          value={boxTarget}
                          onChange={(e) => setBoxTarget(e.target.value)}
                          className="block w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none focus:border-accent/50"
                        >
                          <option value="new">＋ Create a new box…</option>
                          {p.boxes.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {boxTarget === 'new' && (
                        <Input
                          value={boxName}
                          onChange={(e) => setBoxName(e.target.value)}
                          placeholder="Box name — e.g. SEO Videos"
                        />
                      )}
                      <p className="text-[11px] text-muted-foreground/60">
                        {boxTarget === 'new'
                          ? 'Everything from this import drops into one new named box.'
                          : 'Everything from this import is added to the selected box.'}
                      </p>
                    </>
                  )}
                </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={closeSource}>
                  Cancel
                </Button>
                <Button
                  variant="accent"
                  disabled={
                    (addToBox && boxTarget === 'new' && !boxName.trim()) ||
                    (sourceType === 'image' ||
                    sourceType === 'document' ||
                    sourceType === 'audio'
                      ? files.length === 0
                      : URL_TYPES.includes(sourceType)
                        ? urls.trim().length === 0
                        : !name.trim())
                  }
                  onClick={submitSource}
                >
                  {URL_TYPES.includes(sourceType) ? 'Import' : 'Index & place'}
                </Button>
              </div>
            </>
            )
          )}
        </DialogContent>
      </Dialog>

      {/* unified Upload wizard — STEP 1 picks WHAT it is (long-term RAG / working
          artifact / supporting reference); STEP 2 (RAG only) picks the file type.
          Artifact & Reference hand straight off to their own ingest dialog. */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(o) => {
          setUploadOpen(o);
          if (!o) {
            setUploadStep('category');
            setHelpKind(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[17px]">
              {uploadStep === 'type' ? (
                <button
                  type="button"
                  onClick={() => setUploadStep('category')}
                  title="Back"
                  className="-ml-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]"
                >
                  <ArrowLeft className="h-[18px] w-[18px]" />
                </button>
              ) : (
                <UploadCloud className="h-[18px] w-[18px] text-accent" />
              )}
              {uploadStep === 'type'
                ? 'Long-term memory — pick a file type'
                : 'What are you adding?'}
            </DialogTitle>
            <DialogDescription>
              {uploadStep === 'type'
                ? 'These get read, indexed, and stored so any Answers Bank can search and cite them — forever.'
                : 'Pick how this should live in your workspace. Tap the ? on any card for a fuller explanation.'}
            </DialogDescription>
          </DialogHeader>

          {uploadStep === 'category' ? (
            <div className="grid gap-2.5">
              <CategoryCard
                icon={LibraryBig}
                tint="bg-accent/10"
                text="text-accent"
                title="Library"
                sub="Long-term knowledge · indexed forever"
                desc="Books, lectures, images, audio you'll come back to again and again."
                long="Choose this for anything you want remembered permanently and searched across. It's chunked, embedded, and stored in your vector database, so any Answers Bank can retrieve and cite exact passages — even months later. Best for research libraries, full books, course transcripts, and large document sets. Slower to add (it's processed once), instant to query forever."
                expanded={helpKind === 'rag'}
                onToggleHelp={() =>
                  setHelpKind(helpKind === 'rag' ? null : 'rag')
                }
                onClick={() => setUploadStep('type')}
              />
              <CategoryCard
                icon={FileText}
                tint="bg-indigo-500/10"
                text="text-indigo-500"
                title="Draft"
                sub="Working doc · short-term"
                desc="A draft, article, or page for a quick project — carried whole, not indexed."
                long="Choose this when you're actively working ON a document and want an Answers Bank to read it in full and opine — rewrite, critique, summarize, or answer about it. It's held complete in the Answers Bank's context (not chunked or stored long-term), so it sees every word. Best for the article you're drafting, a webpage you're editing, or a transcript you're analyzing right now. It leaves memory when you remove it."
                expanded={helpKind === 'artifact'}
                onToggleHelp={() =>
                  setHelpKind(helpKind === 'artifact' ? null : 'artifact')
                }
                onClick={() => {
                  setUploadOpen(false);
                  setHelpKind(null);
                  setUploadStep('category');
                  p.onAddArtifact();
                }}
              />
              <CategoryCard
                icon={BookOpen}
                tint="bg-violet-500/10"
                text="text-violet-500"
                title="Examples"
                sub="Style samples · never indexed"
                desc="A template or example that shows an Answers Bank the style or shape you want."
                long="Choose this to steer HOW an Answers Bank answers without it becoming a source. Examples are exemplars — 'make it like this' — that shape tone, format, and judgment but are never indexed and never cited. Best for a sample whose style you want matched, a rubric, or a 'good answer' to imitate. Pair it with a Draft and a Library for the sharpest results."
                expanded={helpKind === 'reference'}
                onToggleHelp={() =>
                  setHelpKind(helpKind === 'reference' ? null : 'reference')
                }
                onClick={() => {
                  setUploadOpen(false);
                  setHelpKind(null);
                  setUploadStep('category');
                  p.onAddReference();
                }}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <UploadTile meta={MEDIA_TYPES.document} onClick={() => openType('document')} />
                <UploadTile
                  label="OCR"
                  icon={OcrDocIcon}
                  text="text-accent"
                  tint="bg-accent/10"
                  onClick={() => {
                    openType('document');
                    setOcr(true);
                  }}
                />
                <UploadTile meta={MEDIA_TYPES.image} onClick={() => openType('image')} />
                <UploadTile meta={MEDIA_TYPES.audio} onClick={() => openType('audio')} />
                <UploadTile
                  label="Video"
                  icon={Film}
                  text="text-muted-foreground"
                  tint="bg-[rgb(var(--hairline)/0.06)]"
                  comingSoon
                />
                <UploadTile meta={MEDIA_TYPES.youtube} onClick={() => openType('youtube')} />
                <UploadTile meta={MEDIA_TYPES.website} onClick={() => openType('website')} />
              </div>
              <div className="mt-1.5 flex items-center justify-center">
                <UploadTile
                  meta={MEDIA_TYPES.text}
                  onClick={() => openType('text')}
                  compact
                />
              </div>
              <p className="mt-1 text-center text-[11.5px] text-muted-foreground/60">
                Supported files: Documents · Audio · Images · YouTube · Websites
              </p>
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
                className={cn(
                  'flex h-16 w-16 items-center justify-center rounded-full text-white',
                  elapsed >= 110
                    ? 'recording-warn'
                    : 'animate-pulse bg-red-500 shadow-[0_4px_16px_rgb(239_68_68/0.5)]'
                )}
              >
                <Square className="h-6 w-6 fill-white" />
              </button>
              <p
                className={cn(
                  'font-mono text-[15px] tabular-nums',
                  elapsed >= 110 && 'font-semibold text-red-500'
                )}
              >
                {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')}
              </p>
              <p className="text-[12.5px] text-muted-foreground">
                {elapsed >= 110
                  ? `${120 - elapsed}s left — stops at 2:00`
                  : 'Tap to stop · 2 min max'}
              </p>
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
          // Native title is a guaranteed fallback if the rich tooltip is ever
          // occluded by the canvas — hover always reveals what a tool does.
          title={desc ? `${label} — ${desc}` : label}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-[12px] transition-all',
            accent
              ? 'bg-gradient-to-br from-[#84923F] to-[#525C20] text-white shadow-[0_2px_10px_hsl(var(--accent)/0.4)] hover:brightness-110'
              : 'text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground'
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      {/* Rich tooltip: bold title + a description of what the tool does. */}
      <TooltipContent side="top" className="max-w-[214px]">
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
  return <div className="mx-1 my-0 h-6 w-px shrink-0 bg-[rgb(var(--hairline)/0.08)]" />;
}

/** A category tile in the unified upload picker. Pass `meta` for a known media
 *  type, or an explicit label/icon/text/tint (e.g. the disabled Video tile). */
/** A document glyph with "OCR" lettered across the middle. */
function OcrDocIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <text
        x="12"
        y="16.6"
        textAnchor="middle"
        fontSize="6.5"
        fontWeight="800"
        fill="currentColor"
        stroke="none"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        OCR
      </text>
    </svg>
  );
}

/** Step-1 card in the Upload wizard: a big tappable choice (RAG / Artifact /
 *  Reference) with a one-line summary and a "?" that expands a fuller note. */
function CategoryCard({
  icon: Icon,
  tint,
  text,
  title,
  sub,
  desc,
  long,
  expanded,
  onToggleHelp,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  text: string;
  title: string;
  sub: string;
  desc: string;
  long: string;
  expanded: boolean;
  onToggleHelp: () => void;
  onClick: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full flex-col gap-2 rounded-2xl border border-[rgb(var(--hairline)/0.12)] bg-card p-3.5 pr-10 text-left transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_4px_18px_rgb(0_0_0/0.08)]"
      >
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              tint
            )}
          >
            <Icon className={cn('h-5 w-5', text)} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold leading-tight text-foreground">
              {title}
            </span>
            <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              {sub}
            </span>
          </span>
        </span>
        <span className="text-[12.5px] leading-snug text-muted-foreground">
          {desc}
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleHelp}
        title="What's this?"
        aria-label="What's this?"
        className={cn(
          'absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full transition-colors',
          expanded
            ? 'bg-accent/15 text-accent'
            : 'text-muted-foreground/55 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]'
        )}
      >
        <HelpCircle className="h-[15px] w-[15px]" />
      </button>
      {expanded && (
        <p className="mt-1 rounded-xl bg-[rgb(var(--hairline)/0.05)] px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          {long}
        </p>
      )}
    </div>
  );
}

function UploadTile({
  meta,
  label,
  icon,
  text,
  tint,
  onClick,
  comingSoon,
  compact
}: {
  meta?: (typeof MEDIA_TYPES)[MediaType];
  label?: string;
  icon?: React.ComponentType<{ className?: string }>;
  text?: string;
  tint?: string;
  onClick?: () => void;
  comingSoon?: boolean;
  compact?: boolean;
}) {
  const Icon = meta?.icon ?? icon;
  const tileLabel = meta?.label ?? label ?? '';
  const tileText = meta?.text ?? text ?? 'text-foreground';
  const tileTint = meta?.tint ?? tint ?? 'bg-[rgb(var(--hairline)/0.06)]';
  return (
    <button
      type="button"
      onClick={comingSoon ? undefined : onClick}
      disabled={comingSoon}
      className={cn(
        'group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-[rgb(var(--hairline)/0.12)] bg-card text-center transition-all',
        compact ? 'px-5 py-3' : 'px-3 py-5',
        comingSoon
          ? 'cursor-not-allowed opacity-55'
          : 'cursor-pointer hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_4px_18px_rgb(0_0_0/0.08)]'
      )}
    >
      {comingSoon && (
        <span className="absolute right-2 top-2 rounded-full bg-[rgb(var(--hairline)/0.1)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          Coming soon
        </span>
      )}
      {Icon && (
        <span
          className={cn(
            'flex items-center justify-center rounded-xl',
            tileTint,
            compact ? 'h-8 w-8' : 'h-11 w-11'
          )}
        >
          <Icon className={cn(compact ? 'h-4 w-4' : 'h-[22px] w-[22px]', tileText)} />
        </span>
      )}
      <span className="text-[12.5px] font-semibold leading-tight text-foreground">
        {tileLabel}
      </span>
    </button>
  );
}
