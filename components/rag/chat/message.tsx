'use client';

import { useState } from 'react';
import { ChatMessage } from '@/lib/rag/types';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { MediaIcon } from '@/components/rag/shared';
import { useRag } from '@/lib/rag/store';
import { cn } from '@/lib/utils';
import {
  Boxes,
  Paperclip,
  Pin,
  Check,
  Download,
  Copy,
  MoreHorizontal,
  MessageSquareDashed,
  ImagePlus,
  Sparkles
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

function toMarkdown(msg: ChatMessage) {
  let md = msg.content;
  if (msg.citations?.length) {
    md += '\n\n---\nSources:\n';
    msg.citations.forEach((c, i) => {
      md += `${i + 1}. ${c.mediaName} (${c.locator}) — “${c.snippet}”\n`;
    });
  }
  return md;
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Render assistant text with [n] turned into citation chips. */
function RenderWithCitations({ msg }: { msg: ChatMessage }) {
  const { openViewer } = useRag();
  const parts = msg.content.split(/(\[\d+\]|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
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
                  onClick={() => openViewer(c)}
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
              <TooltipContent side="top" className="max-w-xs overflow-hidden p-0">
                <div className="flex items-center gap-2 border-b bg-secondary/50 px-3 py-2">
                  <MediaIcon type={c.type} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">{c.mediaName}</div>
                    <div className="text-[11px] text-muted-foreground">{c.locator}</div>
                  </div>
                </div>
                <p className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  “{c.snippet}” — click to open source
                </p>
              </TooltipContent>
            </Tooltip>
          );
        }
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold)
          return (
            <strong key={i} className="font-semibold text-foreground">
              {bold[1]}
            </strong>
          );
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function Message({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const { addNote, openViewer } = useRag();
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState(false);

  function pin() {
    addNote(msg.content, msg.citations);
    setPinned(true);
    setTimeout(() => setPinned(false), 1800);
  }

  async function copyMd() {
    try {
      await navigator.clipboard.writeText(toMarkdown(msg));
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group/msg animate-fade-up px-4 py-5 sm:px-8">
      <div className="mx-auto flex max-w-3xl gap-4">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
            isUser
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'bg-gradient-to-br from-[#84923F] to-[#525C20] text-white'
          )}
        >
          {isUser ? 'You' : <Boxes className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[13px] font-semibold">{isUser ? 'You' : 'Atlas'}</span>

            {/* hover actions on assistant messages */}
            {!isUser && (
              <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={pin}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
                    >
                      {pinned ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Pin className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Save to Notes</TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={copyMd} className="gap-2">
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copy as Markdown
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => download('atlas-answer.md', toMarkdown(msg))}
                      className="gap-2"
                    >
                      <Download className="h-3.5 w-3.5" /> Download .md
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            )}
          </div>

          {msg.attachment && (
            <div
              className={cn(
                'mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                msg.attachment.mode === 'discuss'
                  ? 'bg-[hsl(240_16%_96.5%)] text-muted-foreground dark:bg-[rgb(255_255_255_/_0.06)]'
                  : 'bg-accent/10 text-accent'
              )}
            >
              {msg.attachment.mode === 'discuss' ? (
                <MessageSquareDashed className="h-3 w-3" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
              {msg.attachment.name}
              <span className="opacity-60">
                · {msg.attachment.mode === 'discuss' ? 'discussed only' : 'added to library'}
              </span>
            </div>
          )}

          {/* generated image card */}
          {msg.image && (
            <div className="card-glass mb-3 max-w-sm overflow-hidden rounded-[18px]">
              <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-indigo-400/60 via-violet-500/50 to-fuchsia-400/40">
                <ImagePlus className="h-8 w-8 text-white/80" />
                <span className="absolute bottom-2 right-2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                  {msg.image.model === 'nanobanana' ? 'NanoBanana' : 'Kling'} · preview
                </span>
              </div>
              <div className="flex items-start gap-2 p-3">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {msg.image.prompt}
                </p>
              </div>
            </div>
          )}

          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
            {isUser ? msg.content : <RenderWithCitations msg={msg} />}
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
                    <button
                      key={i}
                      onClick={() => openViewer(c)}
                      className="card-glass hover-glow flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left"
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
                      <span className="text-[11px] text-muted-foreground">{c.locator}</span>
                    </button>
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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#84923F] to-[#525C20] text-white">
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
