'use client';

import { useState, useRef } from 'react';
import { useRag } from '@/lib/rag/store';
import { MediaType } from '@/lib/rag/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  UploadCloud,
  Youtube,
  Globe,
  Type,
  FileText,
  AudioLines,
  Image as ImageIcon,
  X
} from 'lucide-react';

type Method = 'file' | 'youtube' | 'website' | 'text';

const METHODS: { key: Method; label: string; icon: any }[] = [
  { key: 'file', label: 'Upload files', icon: UploadCloud },
  { key: 'youtube', label: 'YouTube', icon: Youtube },
  { key: 'website', label: 'Websites', icon: Globe },
  { key: 'text', label: 'Paste text', icon: Type }
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function inferFileType(name: string): MediaType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'image';
  if (['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio';
  return 'document';
}

function nameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '').split('/').pop();
    return path ? decodeURIComponent(path).replace(/[-_]/g, ' ') : u.hostname;
  } catch {
    return url.slice(0, 48);
  }
}

export function UploadDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { addMedia, updateMedia } = useRag();
  const [method, setMethod] = useState<Method>('file');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today());
  const [urls, setUrls] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [ocr, setOcr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const urlList = urls
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);
  const single = method === 'file' ? files.length === 1 : method === 'text' ? true : urlList.length === 1;

  function reset() {
    setName('');
    setDescription('');
    setDate(today());
    setUrls('');
    setBody('');
    setFiles([]);
    setMethod('file');
    setOcr(false);
  }

  function pickFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + ':' + f.size));
      return [...prev, ...incoming.filter((f) => !seen.has(f.name + ':' + f.size))];
    });
    if (incoming.length === 1 && !name) setName(incoming[0].name.replace(/\.[^.]+$/, ''));
  }

  const canSubmit =
    (method === 'file' && files.length > 0) ||
    ((method === 'youtube' || method === 'website') && urlList.length > 0) ||
    (method === 'text' && body.trim().length > 0 && name.trim().length > 0);

  function submit() {
    if (!canSubmit) return;

    // Each job creates the source (so it shows immediately as "processing")
    // then runs REAL ingestion against the same routes the board uses. The
    // source's status flips to indexed/failed as it completes. (This dialog used
    // to only addMedia with fake content — nothing was ever indexed.)
    const jobs: { id: string; run: () => Promise<void> }[] = [];

    if (method === 'file') {
      for (const file of files) {
        const type = inferFileType(file.name);
        const nm = single && name.trim() ? name.trim() : file.name.replace(/\.[^.]+$/, '');
        // Audio → transcribe CLIENT-side via the shared hardened path
        // (transcribeAudioDetailed → /api/transcribe = OpenAI Whisper; large/long
        // files compress + chunk through CloudConvert), with [M:SS] timestamps,
        // then index the transcript TEXT as a normal source (/api/index never
        // sees audio bytes — same transcription path as the board + voice notes).
        if (type === 'audio') {
          const id = addMedia(
            { type, name: nm, description: description.trim(), date, content: '', source: file.name },
            { simulate: false }
          );
          jobs.push({
            id,
            run: async () => {
              const { transcribeAudioDetailed, timestampedTranscript } = await import(
                '@/lib/rag/board/dictation'
              );
              const d = await transcribeAudioDetailed(file);
              const text = timestampedTranscript(d);
              if (!text.trim()) throw new Error('No speech was detected in the audio.');
              const r = await fetch('/api/index', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_id: id, name: nm, type: 'audio', text })
              });
              const j = await r.json().catch(() => ({}));
              if (!r.ok || j.status !== 'indexed') throw new Error(j?.error ?? 'index failed');
              updateMedia(id, { status: 'indexed', chunks: j.chunks });
            }
          });
        } else if (type === 'document' || type === 'image') {
          const id = addMedia(
            { type, name: nm, description: description.trim(), date, content: '', source: file.name },
            { simulate: false }
          );
          const endpoint = type === 'image' ? '/api/index-image' : '/api/index-doc';
          jobs.push({
            id,
            run: async () => {
              const fd = new FormData();
              fd.append('file', file);
              fd.append('name', nm);
              fd.append('source_id', id);
              if (type === 'document') fd.append('ocr', ocr ? 'true' : 'false');
              const r = await fetch(endpoint, { method: 'POST', body: fd });
              const j = await r.json().catch(() => ({}));
              if (!r.ok || !j.ok) throw new Error(j?.error ?? j?.note ?? 'index failed');
              updateMedia(id, { status: 'indexed', chunks: j.chunks, source: j.source_url });
            }
          });
        } else {
          addMedia({
            type,
            name: nm,
            description: description.trim(),
            date,
            content: '',
            source: file.name
          });
        }
      }
    } else if (method === 'youtube' || method === 'website') {
      for (const u of urlList) {
        const nm = single && name.trim() ? name.trim() : nameFromUrl(u);
        const id = addMedia(
          {
            type: method === 'youtube' ? 'youtube' : 'website',
            name: nm,
            description: description.trim(),
            date,
            content: '',
            source: u
          },
          { simulate: false }
        );
        const endpoint = method === 'youtube' ? '/api/index-youtube' : '/api/index-website';
        jobs.push({
          id,
          run: async () => {
            const r = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: u, source_id: id, name: nm })
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j.ok === false) throw new Error(j?.error ?? 'index failed');
            updateMedia(id, { status: 'indexed', chunks: j.chunks });
          }
        });
      }
    } else {
      const nm = name.trim();
      const id = addMedia(
        { type: 'text', name: nm, description: description.trim(), date, content: body.slice(0, 400) },
        { simulate: false }
      );
      jobs.push({
        id,
        run: async () => {
          const r = await fetch('/api/index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: id, name: nm, type: 'text', text: body })
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j.status !== 'indexed') throw new Error(j?.error ?? 'index failed');
          updateMedia(id, { status: 'indexed', chunks: j.chunks });
        }
      });
    }

    // Fire ingestion in the background (status updates live) — concurrency-capped.
    void (async () => {
      let next = 0;
      const CONCURRENCY = 3;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
          while (next < jobs.length) {
            const job = jobs[next++];
            try {
              await job.run();
            } catch {
              updateMedia(job.id, { status: 'failed' });
            }
          }
        })
      );
    })();

    reset();
    onOpenChange(false);
  }

  const count =
    method === 'file' ? files.length : method === 'text' ? 1 : urlList.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add to your knowledge base</DialogTitle>
          <DialogDescription>
            Upload media in bulk or paste links — Gemini extracts and indexes everything
            automatically.
          </DialogDescription>
        </DialogHeader>

        {/* method tabs */}
        <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-secondary p-1">
          {METHODS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => setMethod(m.key)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-all',
                  method === m.key
                    ? 'bg-card text-foreground shadow-soft'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* method body */}
        <div className="min-h-[120px]">
          {method === 'file' && (
            <div className="space-y-2.5">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) pickFiles(e.dataTransfer.files);
                }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors',
                  dragOver ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
                )}
              >
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) pickFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <UploadCloud className="mb-2 h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium">
                  Drop files (multiple welcome) or click to browse
                </p>
                <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    PDF · DOCX · TXT
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <AudioLines className="h-3 w-3" />
                    MP3 · M4A
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    PNG · JPG
                  </span>
                </p>
              </div>

              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <span
                      key={f.name + ':' + f.size + ':' + i}
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent"
                    >
                      <FileText className="h-3 w-3" />
                      {f.name}
                      <button
                        onClick={() => setFiles((prev) => prev.filter((_, x) => x !== i))}
                        className="opacity-70 hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <label className="mt-0.5 flex cursor-pointer select-none items-start gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={ocr}
                  onChange={(e) => setOcr(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--accent))]"
                />
                <span>
                  <span className="font-medium text-foreground">OCR scanned docs</span> — pull
                  text from image-only / scanned PDFs (slower, uses more credits)
                </span>
              </label>
            </div>
          )}

          {(method === 'youtube' || method === 'website') && (
            <div className="space-y-1.5">
              <Label>
                {method === 'youtube' ? 'YouTube URLs' : 'Website URLs'}{' '}
                <span className="normal-case text-muted-foreground">(one per line)</span>
              </Label>
              <Textarea
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                placeholder={
                  method === 'youtube'
                    ? 'https://youtube.com/watch?v=…\nhttps://youtube.com/watch?v=…'
                    : 'https://…\nhttps://…'
                }
                className="min-h-[90px] font-mono text-[12px]"
              />
              <p className="text-[11px] text-muted-foreground">
                {urlList.length > 0 && `${urlList.length} URL${urlList.length > 1 ? 's' : ''} · `}
                {method === 'youtube'
                  ? 'We fetch each transcript and index it.'
                  : 'We fetch and clean each page.'}
              </p>
            </div>
          )}

          {method === 'text' && (
            <div className="space-y-1.5">
              <Label>Text</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Paste any text — notes, an article, a transcript…"
                className="min-h-[120px]"
              />
            </div>
          )}
        </div>

        {/* metadata */}
        <div className="space-y-3 border-t border-[rgb(var(--hairline)/0.08)] pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Name{' '}
                {!single && (
                  <span className="normal-case text-muted-foreground">
                    (auto per item for bulk)
                  </span>
                )}
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={single ? 'Give it a title' : 'Names set automatically'}
                disabled={!single}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              Description <span className="normal-case text-muted-foreground">(optional)</span>
            </Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short note about this source"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="accent" disabled={!canSubmit} onClick={submit}>
            Add {count > 1 ? `${count} sources` : 'source'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
