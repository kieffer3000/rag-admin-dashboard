'use client';

import { ChatMessage } from '@/lib/rag/types';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { MediaIcon } from '@/components/rag/shared';
import { cn } from '@/lib/utils';
import { Boxes, Paperclip } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/** Render assistant text with [n] turned into citation chips. */
function renderWithCitations(text: string, msg: ChatMessage) {
  const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const cite = part.match(/^\[(\d+)\]$/);
    if (cite) {
      const idx = parseInt(cite[1], 10) - 1;
      const c = msg.citations?.[idx];
      if (!c) return <span key={i}>{part}</span>;
      const meta = MEDIA_TYPES[c.type];
      const Icon = meta.icon;
      return (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <sup
              className={cn(
                'mx-0.5 inline-flex cursor-pointer items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] font-semibold align-middle transition-colors',
                meta.tint,
                meta.text,
                'hover:brightness-95'
              )}
            >
              <Icon className="h-2.5 w-2.5" />
              {cite[1]}
            </sup>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs p-0 overflow-hidden">
            <div className="flex items-center gap-2 border-b bg-secondary/50 px-3 py-2">
              <MediaIcon type={c.type} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">{c.mediaName}</div>
                <div className="text-[11px] text-muted-foreground">{c.locator}</div>
              </div>
            </div>
            <p className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              “{c.snippet}”
            </p>
          </TooltipContent>
        </Tooltip>
      );
    }
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i} className="font-semibold text-foreground">{bold[1]}</strong>;
    return <span key={i}>{part}</span>;
  });
}

export function Message({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';

  return (
    <div className="animate-fade-up px-4 py-5 sm:px-8">
      <div className="mx-auto flex max-w-3xl gap-4">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
            isUser
              ? 'bg-zinc-900 text-white'
              : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
          )}
        >
          {isUser ? 'You' : <Boxes className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="mb-1 text-[13px] font-semibold">
            {isUser ? 'You' : 'Atlas'}
          </div>

          {msg.attachment && (
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Paperclip className="h-3 w-3" />
              {msg.attachment}
            </div>
          )}

          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
            {isUser ? msg.content : renderWithCitations(msg.content, msg)}
          </div>

          {/* References */}
          {!isUser && msg.citations && msg.citations.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sources
              </div>
              <div className="flex flex-wrap gap-2">
                {msg.citations.map((c, i) => {
                  const meta = MEDIA_TYPES[c.type];
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-xl border border-border/70 bg-card px-2.5 py-1.5 shadow-soft"
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold',
                          meta.tint,
                          meta.text
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="max-w-[180px] truncate text-xs font-medium">
                        {c.mediaName}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {c.locator}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="px-4 py-5 sm:px-8">
      <div className="mx-auto flex max-w-3xl gap-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
          <Boxes className="h-4 w-4" />
        </div>
        <div className="flex items-center gap-1 pt-2.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" />
        </div>
      </div>
    </div>
  );
}
