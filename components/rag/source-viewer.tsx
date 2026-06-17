'use client';

import type { ReactNode } from 'react';
import { useRag } from '@/lib/rag/store';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { MediaIcon } from '@/components/rag/shared';
import { ExternalLink, Play, Clock } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';

/** Strip [M:SS] timestamp markers from a snippet for clean reading. */
function cleanSnippet(s: string): string {
  return s.replace(/\[\d+:\d{2}\]/g, '').replace(/\s+/g, ' ').trim();
}

const HL_STOP = new Set(
  ('the and that this with from they them their what when where which while about'
    + ' have has had will would could should been being your you our are was were'
    + ' into over under than then there here also some such only just more most'
    + ' because cannot onto upon does did done very much many said says according'
    + ' source sources').split(/\s+/)
);
const words = (t: string) =>
  (t.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !HL_STOP.has(w));

/**
 * Highlight the sentence(s) of the cited passage that the ANSWER actually rests
 * on — same IDF-overlap idea as the citation filter, applied per-sentence. Lets
 * the user see WHERE in a long chunk the answer lives. Returns React nodes with
 * the matching sentences wrapped in <mark>.
 */
function highlightPassage(passage: string, answer: string): ReactNode {
  const plainAnswer = answer
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\[\d+:\d{2}\]/g, ' ');
  const answerWords = new Set(words(plainAnswer));
  if (answerWords.size === 0) return passage;

  // split into sentences, keeping the delimiters attached
  const sentences = passage.match(/[^.!?]+[.!?]*\s*/g) ?? [passage];
  // IDF across sentences: a word in few sentences is more distinctive
  const N = sentences.length;
  const sentWords = sentences.map((s) => new Set(words(s)));
  const df = new Map<string, number>();
  for (const w of answerWords) {
    let d = 0;
    for (const sw of sentWords) if (sw.has(w)) d++;
    if (d > 0) df.set(w, d);
  }
  const scoreOf = (i: number) => {
    let s = 0;
    for (const w of answerWords)
      if (sentWords[i].has(w)) s += Math.log(1 + N / (df.get(w) ?? N));
    return s;
  };
  const scores = sentences.map((_, i) => scoreOf(i));
  const max = Math.max(...scores);
  if (max <= 0) return passage;
  // mark sentences within 45% of the best supporter (the answer-bearing ones)
  const cutoff = Math.max(0.45 * max, 0.0001);

  return sentences.map((s, i) =>
    scores[i] >= cutoff ? (
      <mark
        key={i}
        className="rounded bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-300/30"
      >
        {s}
      </mark>
    ) : (
      <span key={i}>{s}</span>
    )
  );
}

/** Global citation-jump sheet: opens from any citation chip (chat, notes…). */
export function SourceViewer() {
  const { viewerCitation, viewerHighlight, closeViewer, media } = useRag();
  const source = viewerCitation
    ? media.find((m) => m.id === viewerCitation.mediaId)
    : null;
  // Timestamped jump link (youtube ?t=) — prefer the citation's jumpUrl, which
  // carries the seek offset; fall back to the bare source URL.
  const jumpUrl = viewerCitation?.jumpUrl ?? null;
  const isTimed =
    viewerCitation?.type === 'youtube' || viewerCitation?.type === 'audio';

  return (
    <Sheet open={!!viewerCitation} onOpenChange={(o) => !o && closeViewer()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        {viewerCitation && (
          <>
            <SheetHeader className="shrink-0">
              <div className="flex items-center gap-3">
                <MediaIcon type={viewerCitation.type} />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-left text-[15px]">
                    {viewerCitation.mediaName}
                  </SheetTitle>
                  <SheetDescription className="flex items-center gap-2 text-left text-[12px]">
                    <span>{MEDIA_TYPES[viewerCitation.type].label}</span>
                    {viewerCitation.locator && (
                      <span className="inline-flex items-center gap-0.5">
                        {isTimed && <Clock className="h-3 w-3" />}
                        {viewerCitation.locator}
                      </span>
                    )}
                    {viewerCitation.score !== undefined && (
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        {Math.round(viewerCitation.score * 100)}% match
                      </span>
                    )}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="mt-5 flex-1 space-y-4 overflow-y-auto">
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cited passage
                </div>
                <div className="rounded-[14px] bg-accent/[0.07] p-3.5 text-[13px] leading-relaxed ring-1 ring-inset ring-accent/20">
                  “
                  {viewerHighlight
                    ? highlightPassage(
                        cleanSnippet(viewerCitation.snippet),
                        viewerHighlight
                      )
                    : cleanSnippet(viewerCitation.snippet)}
                  ”
                </div>
                {viewerHighlight && (
                  <p className="mt-1.5 text-[10.5px] text-muted-foreground/55">
                    Highlighted: where this answer draws from the passage.
                  </p>
                )}
              </div>

              {source && source.content && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Source content
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {source.content}
                  </p>
                  <div className="mt-3 text-[11px] text-muted-foreground">
                    {source.chunks} chunks indexed
                  </div>
                </div>
              )}
            </div>

            {/* Bottom action: jump to the exact moment / open the original. */}
            {(jumpUrl || source?.source?.startsWith('http')) && (
              <div className="shrink-0 border-t border-[rgb(var(--hairline)/0.16)] pt-4">
                <a
                  href={jumpUrl ?? source?.source ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-foreground transition-all hover:opacity-90"
                >
                  {isTimed && jumpUrl ? (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Play from {viewerCitation.locator}
                    </>
                  ) : (
                    <>
                      Open original <ExternalLink className="h-3.5 w-3.5" />
                    </>
                  )}
                </a>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
