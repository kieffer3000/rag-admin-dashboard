'use client';

import { useEffect, useRef, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { ChatMessage } from '@/lib/rag/types';
import { generateMockAnswer, streamText } from '@/lib/rag/mock-answer';
import { SourcesPanel } from './sources-panel';
import { StudioPanel } from './studio-panel';
import { Composer } from './composer';
import { Message, TypingIndicator } from './message';
import { cn } from '@/lib/utils';
import {
  Boxes,
  Sparkles,
  ScrollText,
  GitCompareArrows,
  GraduationCap,
  PanelLeft,
  PanelRight,
  Minimize2,
  Maximize2,
  Layers
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

let msgId = 0;
const newId = () => `msg${++msgId}`;

const SUGGESTIONS = [
  { icon: ScrollText, text: 'Summarize the key ideas across my selected sources' },
  { icon: GitCompareArrows, text: 'Compare how my sources treat this topic' },
  { icon: GraduationCap, text: 'Quiz me on the most important concepts' },
  { icon: Sparkles, text: 'What are the 3 most surprising insights here?' }
];

export function ChatView() {
  const { messages, addMessage, contextItems, prompts, activePromptId } = useRag();
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<ChatMessage | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [studioOpen, setStudioOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allOpen = sourcesOpen && studioOpen;
  function toggleAll() {
    const next = !allOpen;
    setSourcesOpen(next);
    setStudioOpen(next);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  function handleSend(text: string, attachment?: string) {
    const activePrompt = prompts.find((p) => p.id === activePromptId);
    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      content: text,
      attachment,
      contextIds: contextItems.map((c) => c.id),
      createdAt: new Date().toISOString()
    };
    addMessage(userMsg);
    setBusy(true);

    const { content, citations } = generateMockAnswer(
      activePrompt ? `${activePrompt.body}\n\n${text}` : text,
      contextItems,
      attachment
    );

    setTimeout(() => {
      const base: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: '',
        citations,
        createdAt: new Date().toISOString()
      };
      setStreaming(base);
      streamText(
        content,
        (soFar) => setStreaming({ ...base, content: soFar }),
        () => {
          addMessage({ ...base, content });
          setStreaming(null);
          setBusy(false);
        }
      );
    }, 550);
  }

  const empty = messages.length === 0 && !streaming;

  return (
    <div className="flex h-full gap-2.5 p-2.5">
      {/* Left: sources */}
      {sourcesOpen ? (
        <aside className="panel hidden w-[300px] shrink-0 overflow-hidden rounded-[26px] md:block">
          <SourcesPanel onCollapse={() => setSourcesOpen(false)} />
        </aside>
      ) : (
        <CollapsedRail
          side="left"
          label="Sources"
          icon={Layers}
          onClick={() => setSourcesOpen(true)}
          className="hidden md:flex"
        />
      )}

      {/* Center: chat */}
      <div className="panel relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[26px]">
        {/* Panel toolbar */}
        <div className="hidden h-20 shrink-0 items-center px-4 md:flex">
          <div>
            <PanelButton
              active={sourcesOpen}
              label={sourcesOpen ? 'Hide sources' : 'Show sources'}
              icon={PanelLeft}
              onClick={() => setSourcesOpen((v) => !v)}
            />
          </div>

          <div className="flex flex-1 justify-center">
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--hairline)/0.1)] bg-[rgb(var(--glass-bg)/0.4)] px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-all hover:text-foreground hover:border-[rgb(var(--hairline)/0.2)]"
            >
              {allOpen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {allOpen ? 'Collapse panels' : 'Expand panels'}
            </button>
          </div>

          <div className="hidden xl:block">
            <PanelButton
              active={studioOpen}
              label={studioOpen ? 'Hide studio' : 'Show studio'}
              icon={PanelRight}
              onClick={() => setStudioOpen((v) => !v)}
            />
          </div>
        </div>

        <div ref={scrollRef} className="scroll-clean min-h-0 flex-1 overflow-y-auto">
          {empty ? (
            <EmptyState onPick={handleSend} hasContext={contextItems.length > 0} />
          ) : (
            <div className="py-4 pb-40">
              {messages.map((m) => (
                <Message key={m.id} msg={m} />
              ))}
              {streaming &&
                (streaming.content ? (
                  <Message msg={streaming} />
                ) : (
                  <TypingIndicator />
                ))}
            </div>
          )}
        </div>

        {/* Floating composer — detached pill over the glass */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="pointer-events-auto bg-gradient-to-t from-[rgb(var(--glass-bg)/0.9)] via-[rgb(var(--glass-bg)/0.6)] to-transparent pt-8">
            <Composer onSend={handleSend} busy={busy} />
          </div>
        </div>
      </div>

      {/* Right: studio */}
      {studioOpen ? (
        <aside className="panel hidden w-[284px] shrink-0 overflow-hidden rounded-[26px] xl:block">
          <StudioPanel onCollapse={() => setStudioOpen(false)} />
        </aside>
      ) : (
        <CollapsedRail
          side="right"
          label="Studio"
          icon={Sparkles}
          onClick={() => setStudioOpen(true)}
          className="hidden xl:flex"
        />
      )}
    </div>
  );
}

function PanelButton({
  active,
  label,
  icon: Icon,
  onClick
}: {
  active: boolean;
  label: string;
  icon: any;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-xl transition-all',
            active
              ? 'text-foreground hover:bg-[rgb(var(--hairline)/0.06)]'
              : 'text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground'
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function CollapsedRail({
  side,
  label,
  icon: Icon,
  onClick,
  className
}: {
  side: 'left' | 'right';
  label: string;
  icon: any;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={`Expand ${label}`}
      className={cn(
        'panel w-12 shrink-0 flex-col items-center gap-3 rounded-[22px] py-4 text-muted-foreground transition-all hover:text-foreground',
        className
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
      <span
        className="text-[11px] font-medium uppercase tracking-wide"
        style={{ writingMode: 'vertical-rl' }}
      >
        {label}
      </span>
    </button>
  );
}

function EmptyState({
  onPick,
  hasContext
}: {
  onPick: (t: string) => void;
  hasContext: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-24">
      <div className="relative mb-6">
        <div className="absolute inset-0 -z-10 rounded-[28px] bg-accent/30 blur-2xl" />
        <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-float">
          <Boxes className="h-8 w-8" />
        </div>
      </div>
      <h1 className="text-gradient text-[32px] font-semibold leading-tight tracking-tight">
        Chat with your knowledge
      </h1>
      <p className="mt-3 max-w-md text-center text-[15px] leading-relaxed text-muted-foreground">
        {hasContext
          ? 'Ask anything — answered only from your selected sources, with citations to the exact page or timestamp.'
          : 'Select sources, pick a prompt, then ask. Or attach a file to answer it against your library.'}
      </p>

      <div className="mt-10 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button
              key={i}
              onClick={() => onPick(s.text)}
              className="card-glass hover-glow group flex items-start gap-3 rounded-[18px] p-4 text-left"
            >
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent" />
              <span className="text-[13px] font-medium leading-snug text-foreground/90">
                {s.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
