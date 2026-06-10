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
  const { addMedia } = useRag();
  const [method, setMethod] = useState<Method>('file');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today());
  const [urls, setUrls] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
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
  }

  function pickFiles(list: FileList | File[]) {
    const names = Array.from(list).map((f) => f.name);
    setFiles((prev) => Array.from(new Set([...prev, ...names])));
    if (names.length === 1 && !name) setName(names[0].replace(/\.[^.]+$/, ''));
  }

  const canSubmit =
    (method === 'file' && files.length > 0) ||
    ((method === 'youtube' || method === 'website') && urlList.length > 0) ||
    (method === 'text' && body.trim().length > 0 && name.trim().length > 0);

  function submit() {
    if (!canSubmit) return;

    if (method === 'file') {
      files.forEach((f) => {
        addMedia({
          type: inferFileType(f),
          name: single && name.trim() ? name.trim() : f.replace(/\.[^.]+$/, ''),
          description: description.trim(),
          date,
          content: `Extracted content from ${f}…`,
          source: f
        });
      });
    } else if (method === 'youtube' || method === 'website') {
      urlList.forEach((u) => {
        addMedia({
          type: method === 'youtube' ? 'youtube' : 'website',
          name: single && name.trim() ? name.trim() : nameFromUrl(u),
          description: description.trim(),
          date,
          content: `Content fetched from ${u}…`,
          source: u
        });
      });
    } else {
      addMedia({
        type: 'text',
        name: name.trim(),
        description: description.trim(),
        date,
        content: body.slice(0, 400)
      });
    }
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
                  {files.map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent"
                    >
                      <FileText className="h-3 w-3" />
                      {f}
                      <button
                        onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                        className="opacity-70 hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
