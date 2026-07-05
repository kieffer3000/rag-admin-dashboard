'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Bot, Upload, Eraser, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/rag/board/store';
import type { AgentData } from '@/lib/rag/board/types';

// A spread of ready-made faces so a robot can read as a distinct "who" without
// any upload. Tap one (or type your own emoji, or upload an image).
const PRESET_FACES = [
  '🤖', '👽', '👾', '🦾', '🧠', '🛸', '⚙️', '💡',
  '🐱', '🦊', '🦉', '🐲', '🐙', '🐼', '🦄', '🐧',
  '🧑‍🚀', '🕵️', '🧙', '🦸', '👩‍🔬', '👨‍💻', '🤓', '😺'
];

/** Read a File/Blob into a data URL. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/** Downscale an image data URL so every face stays small + uniform (board state
 *  stays light, and the canvas renders them all at one size). Keeps aspect; PNG
 *  preserves any transparency from background removal. */
async function downscale(dataUrl: string, max = 224): Promise<string> {
  const img = new window.Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png');
}

/** Edit a robot/agent — face, name, and the system prompt that steers how the
 *  brain answers. Opened from the agent node's ✏️ button or the right-click menu
 *  (the store's `agentEditor` holds the node id). */
export function AgentEditDialog() {
  const { agentEditor, setAgentEditor, board, updateBoardNodeData } = useBoard();
  const node = agentEditor ? board.nodes.find((n) => n.id === agentEditor) : null;
  const d = (node?.data ?? {}) as AgentData;

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [avatar, setAvatar] = useState('');
  const [text, setText] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reload the fields whenever a different agent opens.
  useEffect(() => {
    if (node) {
      setName(d.name ?? '');
      setIcon(d.icon ?? '');
      setAvatar(d.avatar ?? '');
      setText(d.text ?? '');
      setUploadBusy(false);
      setBgBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentEditor]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploadBusy(true);
    try {
      const small = await downscale(await blobToDataUrl(f));
      setAvatar(small);
      setIcon('');
    } catch {
      window.alert("Couldn't read that image — try another file.");
    } finally {
      setUploadBusy(false);
    }
  }

  // Lazy-loads the in-browser remover ONLY on click (no bundle / load-time cost).
  async function removeBg() {
    if (!avatar) return;
    setBgBusy(true);
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      const srcBlob = await (await fetch(avatar)).blob();
      const out = await removeBackground(srcBlob);
      const small = await downscale(await blobToDataUrl(out));
      setAvatar(small);
    } catch (err) {
      console.error('remove-bg', err);
      window.alert('Background removal failed — keeping the original image.');
    } finally {
      setBgBusy(false);
    }
  }

  function save() {
    if (!agentEditor) return;
    updateBoardNodeData(agentEditor, {
      name: name.trim() || 'Agent',
      icon: avatar ? '' : icon.trim(),
      avatar,
      text
    });
    setAgentEditor(null);
  }

  return (
    <Sheet open={!!agentEditor} onOpenChange={(o) => !o && setAgentEditor(null)}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]"
      >
        {/* ── HERO HEADER — like a Make.com module panel: the module's own face
              and identity up top, an accent rule beneath, then the fields. ── */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-emerald-500/12 via-emerald-500/[0.05] to-transparent px-6 pb-5 pt-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-card shadow-[0_2px_10px_rgb(16_185_129/0.20)] ring-1 ring-emerald-400/30">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" className="h-full w-full object-contain" />
              ) : icon ? (
                <span className="text-[38px] leading-none">{icon}</span>
              ) : (
                <Bot className="h-9 w-9 text-emerald-500" strokeWidth={1.6} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-[17px] font-semibold text-foreground">
                {name.trim() || 'Edit agent'}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                The persona that steers <em>how</em> this Answers Bank answers.
                Never a source, never indexed.
              </SheetDescription>
            </div>
          </div>
          <div className="mt-4 h-[3px] w-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-500/0" />
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* ---- Face ---- */}
          <div className="space-y-2.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Robot face
            </Label>
            {/* preset faces */}
            <div className="grid grid-cols-8 gap-1">
              {PRESET_FACES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setIcon(f);
                    setAvatar('');
                  }}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg text-[19px] leading-none transition-colors hover:bg-emerald-500/10',
                    icon === f && !avatar && 'bg-emerald-500/15 ring-1 ring-emerald-400/50'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* upload / remove-bg / clear / type-any */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploadBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-2.5 py-1 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/[0.12] disabled:opacity-50 dark:text-emerald-300"
              >
                {uploadBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Upload your own
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onUpload}
              />
              {avatar && (
                <>
                  <button
                    type="button"
                    onClick={removeBg}
                    disabled={bgBusy}
                    title="Cut out the subject and make the background transparent (runs in your browser; the first run downloads the model)."
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] px-2.5 py-1 text-[12px] font-medium text-violet-700 transition-colors hover:bg-violet-500/[0.12] disabled:opacity-50 dark:text-violet-300"
                  >
                    {bgBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Eraser className="h-3.5 w-3.5" />
                    )}
                    {bgBusy ? 'Removing…' : 'Remove background'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAvatar('')}
                    title="Clear the image and go back to an emoji face"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                </>
              )}
              {/* type any emoji */}
              <Input
                value={avatar ? '' : icon}
                onChange={(e) => {
                  setIcon(e.target.value);
                  setAvatar('');
                }}
                placeholder="or 🙂"
                maxLength={4}
                disabled={!!avatar}
                className="h-7 w-16 text-center text-[15px]"
              />
            </div>
          </div>

          {/* ---- Name ---- */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              Name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dan Kennedy copywriter"
            />
          </div>

          {/* ---- System prompt ---- */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              System prompt
            </Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="How should the Answers Bank answer? Tone, priorities, persona, format…"
              className="min-h-[200px] font-mono text-[12.5px] leading-relaxed"
            />
          </div>
        </div>

        {/* ── STICKY FOOTER ── */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-card/60 px-6 py-3.5 backdrop-blur-sm">
          <Button variant="ghost" onClick={() => setAgentEditor(null)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
