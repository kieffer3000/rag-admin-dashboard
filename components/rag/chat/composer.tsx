'use client';

import { useRef, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { cn } from '@/lib/utils';
import { LLM_MODELS, PROVIDER_META, LlmProvider } from '@/lib/rag/models';
import { ArrowUp, Paperclip, Sparkles, X, ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface ComposerProps {
  onSend: (text: string, attachment?: string) => void;
  busy: boolean;
}

const PILL_BTN =
  'flex h-9 items-center gap-1.5 rounded-full border border-[rgb(var(--hairline)/0.08)] bg-[rgb(var(--glass-bg)/0.5)] px-3 text-[13px] font-medium text-foreground transition-all hover:border-[rgb(var(--hairline)/0.18)] hover:bg-[rgb(var(--glass-bg)/0.8)]';

export function Composer({ onSend, busy }: ComposerProps) {
  const { prompts, activePromptId, setActivePrompt, contextItems, modelId, setModel } =
    useRag();
  const activeModel = LLM_MODELS.find((m) => m.id === modelId) ?? LLM_MODELS[0];
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
    <div className="px-4 pb-5 pt-2 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            'glass rounded-[28px] border border-[rgb(var(--hairline)/0.1)] transition-all duration-200',
            'shadow-[inset_0_2px_8px_rgba(0,0,0,0.14),0_10px_36px_rgba(0,0,0,0.16)]',
            'dark:shadow-[inset_0_2px_10px_rgba(0,0,0,0.6),0_16px_48px_rgba(0,0,0,0.5)]',
            'focus-within:border-[rgb(var(--hairline)/0.22)]'
          )}
        >
          {attachment && (
            <div className="flex items-center justify-between px-5 pt-3.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                <Paperclip className="h-3 w-3" />
                {attachment}
                <button onClick={() => setAttachment(undefined)} className="ml-1 opacity-70 hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </span>
              <span className="text-[11px] text-muted-foreground">
                answered against your sources
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
            className="scroll-clean max-h-[200px] w-full resize-none bg-transparent px-5 pt-4 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
          />

          <div className="flex items-center gap-2 px-3 pb-3 pt-1.5">
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
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(var(--hairline)/0.08)] bg-[rgb(var(--glass-bg)/0.5)] text-muted-foreground transition-all hover:border-[rgb(var(--hairline)/0.18)] hover:text-foreground"
              title="Attach a file to answer against your sources"
            >
              <Paperclip className="h-[17px] w-[17px]" />
            </button>

            {/* prompt picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={PILL_BTN}>
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <span className="max-w-[130px] truncate">
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

            {/* model picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={PILL_BTN}>
                  <span className={cn('h-2 w-2 rounded-full', PROVIDER_META[activeModel.provider].dot)} />
                  <span className="hidden max-w-[120px] truncate sm:inline">{activeModel.label}</span>
                  <span className="sm:hidden">{activeModel.short}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                {(['claude', 'gemini'] as LlmProvider[]).map((prov) => (
                  <div key={prov}>
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span className={cn('h-2 w-2 rounded-full', PROVIDER_META[prov].dot)} />
                      {PROVIDER_META[prov].label}
                    </DropdownMenuLabel>
                    {LLM_MODELS.filter((m) => m.provider === prov).map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => setModel(m.id)}
                        className="flex items-start gap-2"
                      >
                        <Check
                          className={cn(
                            'mt-0.5 h-3.5 w-3.5 shrink-0',
                            modelId === m.id ? 'opacity-100 text-accent' : 'opacity-0'
                          )}
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium">{m.label}</div>
                          <div className="text-[11px] text-muted-foreground">{m.blurb}</div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    {prov === 'claude' && <DropdownMenuSeparator />}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1" />

            <button
              onClick={submit}
              disabled={!canSend}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200',
                canSend
                  ? 'bg-accent text-white shadow-[0_0_22px_hsl(var(--accent)/0.55)] hover:brightness-110'
                  : 'border border-[rgb(var(--hairline)/0.08)] bg-[rgb(var(--glass-bg)/0.5)] text-muted-foreground'
              )}
            >
              <ArrowUp className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
        <p className="mt-2.5 text-center text-[11px] text-muted-foreground/70">
          Atlas answers only from your selected sources, with citations.
        </p>
      </div>
    </div>
  );
}
