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
  Image as ImageIcon
} from 'lucide-react';

type Method = 'file' | 'youtube' | 'website' | 'text';

const METHODS: { key: Method; label: string; icon: any }[] = [
  { key: 'file', label: 'Upload file', icon: UploadCloud },
  { key: 'youtube', label: 'YouTube', icon: Youtube },
  { key: 'website', label: 'Website', icon: Globe },
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
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState<MediaType>('document');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName('');
    setDescription('');
    setDate(today());
    setUrl('');
    setBody('');
    setFileName('');
    setMethod('file');
  }

  function pickFile(f: File) {
    setFileName(f.name);
    setFileType(inferFileType(f.name));
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
  }

  const canSubmit =
    name.trim().length > 0 &&
    ((method === 'file' && fileName) ||
      (method === 'youtube' && url) ||
      (method === 'website' && url) ||
      (method === 'text' && body));

  function submit() {
    if (!canSubmit) return;
    const type: MediaType =
      method === 'youtube'
        ? 'youtube'
        : method === 'website'
          ? 'website'
          : method === 'text'
            ? 'text'
            : fileType;
    addMedia({
      type,
      name: name.trim(),
      description: description.trim(),
      date,
      content:
        method === 'text'
          ? body.slice(0, 400)
          : method === 'file'
            ? `Extracted content from ${fileName}…`
            : `Content fetched from ${url}…`,
      source: method === 'file' ? fileName : url || undefined
    });
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add to your knowledge base</DialogTitle>
          <DialogDescription>
            Upload media or paste a link. Gemini extracts and indexes it automatically.
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
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) pickFile(f);
              }}
              onClick={() => fileRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors',
                dragOver ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
              )}
            >
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                }}
              />
              {fileName ? (
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4 text-accent" />
                  {fileName}
                </div>
              ) : (
                <>
                  <UploadCloud className="mb-2 h-7 w-7 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop a file or click to browse</p>
                  <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />PDF · DOCX · TXT</span>
                    <span className="inline-flex items-center gap-1"><AudioLines className="h-3 w-3" />MP3 · M4A</span>
                    <span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" />PNG · JPG</span>
                  </p>
                </>
              )}
            </div>
          )}

          {(method === 'youtube' || method === 'website') && (
            <div className="space-y-1.5">
              <Label>{method === 'youtube' ? 'YouTube URL' : 'Website URL'}</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  method === 'youtube'
                    ? 'https://youtube.com/watch?v=…'
                    : 'https://…'
                }
              />
              <p className="text-[11px] text-muted-foreground">
                {method === 'youtube'
                  ? 'We fetch the transcript and index it.'
                  : 'We fetch and clean the page content.'}
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
        <div className="space-y-3 border-t border-border/70 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Give it a title" />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="normal-case text-muted-foreground">(optional)</span></Label>
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
            Add source
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
