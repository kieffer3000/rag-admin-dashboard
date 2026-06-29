'use client';

import { memo, useState, useEffect, useRef } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { FileText, X, Download, Loader2, AlertCircle, Check } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import { CHIP_W, CHIP_H, type ArtifactData } from '@/lib/rag/board/types';

/**
 * ARTIFACT (right plug) — the user's own working doc the wired corpus reasons
 * ABOUT in Opine mode (critique / improve / continue). Carried WHOLE into the
 * prompt, NEVER indexed. Paste text, or type a URL and hit Load — /api/fetch-page
 * pulls the readable text + the page's hero image (og:image) WITHOUT indexing it.
 */
function ArtifactNodeInner({ id, data, selected, parentId }: NodeProps) {
  const d = data as ArtifactData;
  const { updateBoardNodeData, removeBoardNode } = useBoard();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(true);
  // Prefer the pixel-accurate screenshot; if it fails to load, fall back to the
  // og:image, then hide entirely.
  const [shotFailed, setShotFailed] = useState(false);
  const [shotPending, setShotPending] = useState(false);
  const shotReq = useRef<string | undefined>(undefined);
  const preview = !shotFailed && d.screenshot ? d.screenshot : d.image;
  // Truth indicator: does the brain actually have text to opine on? (<200 chars
  // = effectively empty — the same threshold the server uses to re-load.)
  const contentLen = (d.content ?? '').trim().length;
  const hasText = contentLen >= 200;

  // Capture a pixel-accurate screenshot via CloudConvert (persisted to Blob),
  // in the BACKGROUND — the og:image shows instantly and swaps when this lands.
  async function captureScreenshot(rawUrl: string) {
    const u = rawUrl.trim();
    if (!u || shotReq.current === u) return;
    shotReq.current = u;
    setShotPending(true);
    try {
      const r = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u })
      });
      const j = await r.json();
      if (j.ok && j.url) {
        setShotFailed(false);
        updateBoardNodeData(id, { screenshot: j.url });
      }
    } catch {
      /* keep the og:image fallback */
    } finally {
      setShotPending(false);
    }
  }

  // On mount: a URL-only artifact auto-loads its text (so Opine has content even
  // if you never clicked Load); a loaded-but-unshot artifact grabs its screenshot.
  useEffect(() => {
    const u = (d.url ?? '').trim();
    if (u && !(d.content ?? '').trim()) {
      void loadUrl(); // fetches text, then captures the screenshot
    } else if (u && (d.content ?? '').trim() && !d.screenshot) {
      void captureScreenshot(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUrl() {
    const url = (d.url ?? '').trim();
    if (!url || loading) return;
    setErr(null);
    setLoading(true);
    setShotFailed(false);
    setImgOk(true);
    try {
      const res = await fetch('/api/fetch-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const j = await res.json();
      if (!j.ok) {
        setErr(j.note || 'Could not load that page.');
        if (j.image) updateBoardNodeData(id, { image: j.image });
        // a JS-only page still renders in a browser → try the screenshot anyway
        void captureScreenshot(url);
      } else {
        updateBoardNodeData(id, {
          content: j.text ?? d.content,
          title: d.title?.trim() ? d.title : j.title ?? '',
          image: j.image ?? d.image
        });
        void captureScreenshot(url);
      }
    } catch {
      setErr('Could not reach that page.');
    } finally {
      setLoading(false);
    }
  }

  // Docked in a box → compact tile.
  if (parentId) {
    return (
      <div
        style={{ width: CHIP_W, height: CHIP_H }}
        title={d.title || 'Artifact'}
        className={cn(
          'relative flex items-center gap-2 overflow-hidden rounded-[11px] bg-card px-3 ring-1 ring-black/[0.04] dark:ring-white/[0.06]',
          'shadow-[0_1px_2px_rgb(0_0_0/0.10)]',
          selected && 'ring-2 ring-indigo-400/60'
        )}
      >
        <span className="pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] rounded-l-[11px] bg-indigo-500" />
        <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
            Artifact
          </span>
          <span className="block truncate text-[10px] text-muted-foreground/70">
            {d.title?.trim() || d.content?.trim()?.slice(0, 40) || 'empty'}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-[210px] w-full min-w-[240px] flex-col overflow-hidden rounded-[16px] bg-card',
        'shadow-[0_1px_3px_rgb(0_0_0/0.05),0_8px_24px_rgb(0_0_0/0.06)]',
        'dark:ring-1 dark:ring-white/[0.07]',
        selected && 'ring-2 ring-indigo-400/60'
      )}
    >
      <NodeResizer
        minWidth={230}
        minHeight={210}
        isVisible={selected}
        lineClassName="!border-indigo-400/40"
        handleClassName="!h-2.5 !w-2.5 !rounded-full !border !border-white/70 !bg-indigo-500"
      />
      <div className="flex shrink-0 cursor-grab items-center gap-1.5 bg-indigo-500/[0.08] px-3 py-1.5 active:cursor-grabbing">
        <FileText className="h-3 w-3 text-indigo-600" />
        <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
          Artifact
        </span>
        {/* Truth indicator — is there text for the brain to opine on? */}
        {loading ? (
          <span className="flex items-center gap-0.5 text-[9px] font-medium text-muted-foreground">
            <Loader2 className="h-2.5 w-2.5 animate-spin" /> loading…
          </span>
        ) : hasText ? (
          <span
            title={`${contentLen.toLocaleString()} characters loaded — the brain can opine on this`}
            className="flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400"
          >
            <Check className="h-2.5 w-2.5" />
            {contentLen >= 1000 ? `${Math.round(contentLen / 1000)}k` : contentLen} chars
          </span>
        ) : (
          <span
            title="No readable text yet — Load a URL or paste text, or the brain will fall back to generic answers"
            className="flex items-center gap-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400"
          >
            <AlertCircle className="h-2.5 w-2.5" /> empty
          </span>
        )}
        <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground/50">
          not indexed
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeBoardNode(id);
          }}
          title="Remove this artifact"
          className="nodrag ml-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Page preview — pixel-accurate CloudConvert screenshot. Shows the
          og:image instantly with a "capturing…" badge, then swaps to the
          screenshot. Falls back to og:image, then a placeholder, then hides. */}
      {(preview || shotPending) && imgOk && (
        <div className="relative shrink-0">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Page preview"
              onError={() => {
                if (!shotFailed && d.screenshot) setShotFailed(true);
                else setImgOk(false);
              }}
              className="h-28 w-full object-cover object-top"
            />
          ) : (
            <div className="flex h-28 w-full items-center justify-center gap-1.5 bg-indigo-500/[0.06] text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Capturing screenshot…
            </div>
          )}
          {shotPending && !d.screenshot && preview && (
            <span className="absolute right-1 top-1 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-medium text-white">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> screenshot…
            </span>
          )}
        </div>
      )}

      <input
        value={d.title ?? ''}
        onChange={(e) => updateBoardNodeData(id, { title: e.target.value })}
        placeholder="Title (e.g. Best Running Shoes 2026)"
        className="nodrag block w-full shrink-0 border-b border-black/[0.04] bg-transparent px-3 py-1.5 text-[12px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/40 dark:border-white/[0.06]"
      />

      {/* URL + Load: fetch readable text + hero image, never indexed. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-black/[0.04] px-2 py-1 dark:border-white/[0.06]">
        <input
          value={d.url ?? ''}
          onChange={(e) => updateBoardNodeData(id, { url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void loadUrl();
            }
          }}
          placeholder="https://… then Load"
          className="nodrag min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[10px] text-muted-foreground outline-none placeholder:text-muted-foreground/40"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            void loadUrl();
          }}
          disabled={loading || !(d.url ?? '').trim()}
          title="Fetch the page text + hero image (not indexed)"
          className="nodrag flex shrink-0 items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-500/20 disabled:opacity-40 dark:text-indigo-400"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {loading ? 'Loading' : 'Load'}
        </button>
      </div>

      {err && (
        <div className="flex shrink-0 items-start gap-1 bg-amber-500/[0.08] px-3 py-1 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      <textarea
        value={d.content ?? ''}
        onChange={(e) => updateBoardNodeData(id, { content: e.target.value })}
        placeholder="Paste the article / webpage / draft to critique or improve — or load a URL above…"
        className="nodrag block min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/40"
      />
      {/* Connector on the LEFT — the artifact sits to the right of the brain, so
          a left-facing plug runs the wire straight into the brain's right side. */}
      <Handle
        type="source"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-card !bg-indigo-500"
      />
    </div>
  );
}

export const ArtifactNode = memo(ArtifactNodeInner);
