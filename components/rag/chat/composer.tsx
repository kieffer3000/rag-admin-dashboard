'use client';

import { useRef, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { cn } from '@/lib/utils';
import { LLM_MODELS, PROVIDER_META, LlmProvider } from '@/lib/rag/models';
import { ChatAttachment, AttachmentMode } from '@/lib/rag/types';
import {
  ArrowUp,
  Paperclip,
  Sparkles,
  X,
  ChevronDown,
  Check,
  MessageSquareDashed,
  DatabaseZap
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface ComposerProps {
  onSend: (text: string, attachment?: ChatAttachment) => void;
  busy: boolean;
}

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'];

const PILL_BTN =
  'flex h-9 items-center gap-1.5 rounded-full bg-card px-3 text-[13px] font-medium text-foreground shadow-soft transition-all hover:brightness-95 dark:bg-[rgb(255_255_255_/_0.06)] dark:shadow-none dark:hover:bg-[rgb(255_255_255_/_0.1)]';

export function Composer({ onSend, busy }: ComposerProps) {
  const { contextItems, modelId, setModel } = useRag();
  const activeModel = LLM_MODELS.find((m) => m.id === modelId) ?? LLM_MODELS[0];
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<ChatAttachment | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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
            'rounded-[26px] border border-transparent transition-all duration-200',
            'bg-[hsl(240_16%_96.5%)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]',
            'dark:bg-[rgb(255_255_255_/_0.03)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
            'focus-within:bg-[hsl(240_14%_94%)] dark:focus-within:bg-[rgb(255_255_255_/_0.05)]'
          )}
        >
          {attachment && (
            <div className="flex flex-wrap items-center gap-2 px-5 pt-3.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                <Paperclip className="h-3 w-3" />
                {attachment.name}
                <button
                  onClick={() => setAttachment(undefined)}
                  className="ml-1 opacity-70 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>

              {/* discuss vs index segmented toggle */}
              <span className="ml-auto flex rounded-full bg-card p-0.5 text-[11px] font-medium shadow-soft dark:bg-[rgb(255_255_255_/_0.06)] dark:shadow-none">
                {(
                  [
                    { mode: 'discuss', label: 'Just discuss', icon: MessageSquareDashed },
                    { mode: 'index', label: 'Add to library', icon: DatabaseZap }
                  ] as { mode: AttachmentMode; label: string; icon: any }[]
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = attachment.mode === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      onClick={() => setAttachment({ ...attachment, mode: opt.mode })}
                      className={cn(
                        'flex items-center gap-1 rounded-full px-2.5 py-1 transition-all',
                        active
                          ? 'bg-accent text-white shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {opt.label}
                    </button>
                  );
                })}
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
                if (f) {
                  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
                  setAttachment({
                    name: f.name,
                    mode: 'discuss',
                    kind: IMG_EXT.includes(ext) ? 'image' : 'file'
                  });
                }
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-muted-foreground shadow-soft transition-all hover:text-foreground hover:brightness-95 dark:bg-[rgb(255_255_255_/_0.06)] dark:shadow-none dark:hover:bg-[rgb(255_255_255_/_0.1)]"
              title="Attach a file to answer against your sources"
            >
              <Paperclip className="h-[17px] w-[17px]" />
            </button>

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
                  : 'bg-card text-muted-foreground shadow-soft dark:bg-[rgb(255_255_255_/_0.06)] dark:shadow-none'
              )}
            >
              <ArrowUp className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
        <p className="mt-2.5 text-center text-[11px] text-muted-foreground/70">
          answersDoc answers only from your selected sources, with citations.
        </p>
      </div>
    </div>
  );
}
