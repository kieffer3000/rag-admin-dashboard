'use client';

import { useState, useRef } from 'react';
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
import { UploadCloud, Globe, Type, FileText, X, Loader2, AlertCircle } from 'lucide-react';

export interface NewArtifact {
  title?: string;
  url?: string;
  content: string;
  image?: string;
  screenshot?: string;
}

type Method = 'file' | 'website' | 'text';

const METHODS: { key: Method; label: string; icon: any }[] = [
  { key: 'file', label: 'Upload file', icon: UploadCloud },
  { key: 'website', label: 'Website', icon: Globe },
  { key: 'text', label: 'Paste text', icon: Type }
];

/**
 * Add an ARTIFACT (right plug) — the doc the corpus opines on. Mirrors the media
 * upload popup, but INDIGO (artifacts are never indexed) and it builds an
 * artifact node instead of a knowledge source.
 */
export function ArtifactDialog({
  open,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (a: NewArtifact) => void;
}) {
  const [method, setMethod] = useState<Method>('file');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [ocr, setOcr] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setMethod('file');
    setTitle('');
    setUrl('');
    setBody('');
    setFile(null);
    setOcr(false);
    setErr(null);
    setBusy(false);
  }

  const canSubmit =
    (method === 'file' && !!file) ||
    (method === 'website' && url.trim().length > 0) ||
    (method === 'text' && body.trim().length > 0);

  async function submit() {
    if (!canSubmit || busy) return;
    setErr(null);
    setBusy(true);
    try {
      if (method === 'text') {
        onCreate({ title: title.trim() || undefined, content: body });
        done();
      } else if (method === 'website') {
        const res = await fetch('/api/fetch-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() })
        });
        const j = await res.json();
        if (!j.ok && !j.text) {
          setErr(j.note || 'Could not load that page.');
          setBusy(false);
          return;
        }
        // screenshot is captured by the artifact node on mount (CloudConvert).
        onCreate({
          title: title.trim() || j.title,
          url: url.trim(),
          content: j.text ?? '',
          image: j.image
        });
        done();
      } else if (file) {
        const fd = new FormData();
        fd.append('file', file);
        if (ocr) fd.append('ocr', 'true');
        const res = await fetch('/api/extract-file', { method: 'POST', body: fd });
        const j = await res.json();
        if (!j.ok) {
          setErr(j.note || 'Could not read that file.');
          setBusy(false);
          return;
        }
        onCreate({
          title: title.trim() || file.name.replace(/\.[^.]+$/, ''),
          content: j.text ?? ''
        });
        done();
      }
    } catch {
      setErr('Something went wrong. Try again.');
      setBusy(false);
    }
  }

  function done() {
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl border-indigo-500/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-500" />
            Add an artifact
          </DialogTitle>
          <DialogDescription>
            Your working doc — the corpus reasons <em>about</em> this. Carried whole and{' '}
            <strong>never indexed</strong>. Upload a file, load a webpage, or paste text.
          </DialogDescription>
        </DialogHeader>

        {/* method tabs (indigo) */}
        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-indigo-500/[0.06] p-1">
          {METHODS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => {
                  setMethod(m.key);
                  setErr(null);
                }}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-all',
                  method === m.key
                    ? 'bg-card text-indigo-600 shadow-soft dark:text-indigo-400'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {m.label}
              </button>
            );
          })}
        </div>

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
                  const f = e.dataTransfer.files?.[0];
                  if (f) {
                    setFile(f);
                    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
                  }
                }}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors',
                  dragOver
                    ? 'border-indigo-500 bg-indigo-500/5'
                    : 'border-border hover:border-indigo-500/50'
                )}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.epub,.txt,.md,text/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
                    }
                    e.target.value = '';
                  }}
                />
                <UploadCloud className="mb-2 h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium">Drop a file or click to browse</p>
                <p className="mt-1 text-[11px] text-muted-foreground">PDF · DOCX · EPUB · TXT · MD</p>
              </div>
              {file && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-indigo-500/10 px-3 py-1.5 text-[12px] font-medium text-indigo-600 dark:text-indigo-400">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <button onClick={() => setFile(null)} className="opacity-70 hover:opacity-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <label className="flex cursor-pointer select-none items-start gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={ocr}
                  onChange={(e) => setOcr(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-indigo-500"
                />
                <span>OCR scanned PDFs (slower, uses more credits)</span>
              </label>
            </div>
          )}

          {method === 'website' && (
            <div className="space-y-1.5">
              <Label>Webpage URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className="font-mono text-[12px]"
              />
              <p className="text-[11px] text-muted-foreground">
                We fetch the readable text + a screenshot. Public pages only; never indexed.
              </p>
            </div>
          )}

          {method === 'text' && (
            <div className="space-y-1.5">
              <Label>Text</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Paste the article / draft / page to critique or improve…"
                className="min-h-[120px]"
              />
            </div>
          )}
        </div>

        <div className="space-y-1.5 border-t border-[rgb(var(--hairline)/0.08)] pt-4">
          <Label>
            Title <span className="normal-case text-muted-foreground">(optional)</span>
          </Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Give it a title (auto-filled from the file/page)"
          />
        </div>

        {err && (
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || busy}
            onClick={submit}
            className="bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {busy ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading…
              </span>
            ) : (
              'Add artifact'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
