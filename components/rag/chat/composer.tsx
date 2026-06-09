'use client';

import { useRef, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { cn } from '@/lib/utils';
import { ArrowUp, Paperclip, Sparkles, X, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface ComposerProps {
  onSend: (text: string, attachment?: string) => void;
  busy: boolean;
}

export function Composer({ onSend, busy }: ComposerProps) {
  const { prompts, activePromptId, setActivePrompt, contextItems } = useRag();
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<string | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const activePrompt = prompts.find((p) => p.id === activePromptId);
  const canSend = text.trim().length > 0 && !busy;

  function submit() {
    if (!canSend) return;
    onSend(text.trim(), attachment);
    setText('');
    setAttachment(undefined);
    if (taRef.current) taRef.current.style.height = 'auto';
  }

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  return (
    <div className="px-4 pb-4 pt-2 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-[22px] border border-border/80 bg-white shadow-float transition-shadow focus-within:border-accent/50">
          {/* attachment chip */}
          {attachment && (
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                <Paperclip className="h-3 w-3" />
                {attachment}
                <button onClick={() => setAttachment(undefined)} className="ml-1 hover:text-blue-900">
                  <X className="h-3 w-3" />
                </button>
              </span>
              <span className="text-[11px] text-muted-foreground">
                will be answered against your sources
              </span>
            </div>
          )}

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              contextItems.length
                ? 'Ask anything about your sources…'
                : 'Select sources, then ask anything…'
            }
            className="scroll-clean max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
          />

          <div className="flex items-center gap-2 px-3 pb-3 pt-1">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setAttachment(f.name);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title="Attach a file to answer against your sources"
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </button>

            {/* prompt picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-9 items-center gap-1.5 rounded-xl border border-border/70 px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <span className="max-w-[140px] truncate">
                    {activePrompt ? activePrompt.title : 'No prompt'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuItem
                  onClick={() => setActivePrompt(null)}
                  className={cn(!activePromptId && 'bg-secondary')}
                >
                  <span className="text-muted-foreground">No prompt</span>
                </DropdownMenuItem>
                {prompts.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setActivePrompt(p.id)}
                    className={cn('gap-2', activePromptId === p.id && 'bg-secondary')}
                  >
                    <span>{p.icon ?? '✨'}</span>
                    <span className="truncate">{p.title}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1" />

            <button
              onClick={submit}
              disabled={!canSend}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150',
                canSend
                  ? 'bg-accent text-white shadow-sm hover:brightness-105'
                  : 'bg-secondary text-muted-foreground'
              )}
            >
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Atlas answers only from your selected sources, with citations.
        </p>
      </div>
    </div>
  );
}
