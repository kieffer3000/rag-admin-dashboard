'use client';

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

/** Global citation-jump sheet: opens from any citation chip (chat, notes…). */
export function SourceViewer() {
  const { viewerCitation, closeViewer, media } = useRag();
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
        className="relative w-full overflow-y-auto pb-24 sm:max-w-md"
      >
        {viewerCitation && (
          <>
            <SheetHeader>
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

            <div className="mt-5 space-y-4">
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cited passage
                </div>
                <div className="rounded-[14px] bg-accent/[0.07] p-3.5 text-[13px] leading-relaxed ring-1 ring-inset ring-accent/20">
                  “{cleanSnippet(viewerCitation.snippet)}”
                </div>
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
              <div className="absolute inset-x-0 bottom-0 border-t border-[rgb(var(--hairline)/0.16)] bg-background/95 p-4 backdrop-blur">
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
