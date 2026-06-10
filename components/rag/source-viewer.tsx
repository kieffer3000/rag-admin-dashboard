'use client';

import { useRag } from '@/lib/rag/store';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { MediaIcon } from '@/components/rag/shared';
import { ExternalLink } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';

/** Global citation-jump sheet: opens from any citation chip (chat, notes…). */
export function SourceViewer() {
  const { viewerCitation, closeViewer, media } = useRag();
  const source = viewerCitation
    ? media.find((m) => m.id === viewerCitation.mediaId)
    : null;

  return (
    <Sheet open={!!viewerCitation} onOpenChange={(o) => !o && closeViewer()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {viewerCitation && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <MediaIcon type={viewerCitation.type} />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-left text-[15px]">
                    {viewerCitation.mediaName}
                  </SheetTitle>
                  <SheetDescription className="text-left text-[12px]">
                    {MEDIA_TYPES[viewerCitation.type].label} · {viewerCitation.locator}
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
                  “{viewerCitation.snippet}”
                </div>
              </div>

              {source && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Source content
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {source.content}
                  </p>
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{source.chunks} chunks indexed</span>
                    {source.source?.startsWith('http') && (
                      <a
                        href={source.source}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        Open original <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
