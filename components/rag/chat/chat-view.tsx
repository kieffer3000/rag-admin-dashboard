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
    <div className="flex h-full">
      {/* Left: sources */}
      {sourcesOpen ? (
        <div className="hidden w-[300px] shrink-0 border-r border-border/70 bg-card/40 md:block">
          <SourcesPanel onCollapse={() => setSourcesOpen(false)} />
        </div>
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
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Panel toolbar */}
        <div className="hidden h-11 shrink-0 items-center border-b border-border/70 px-2 md:flex">
          <div className="hidden md:block">
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
              className="hidden items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:inline-flex"
            >
              {allOpen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
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
            <div className="py-4">
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
        <Composer onSend={handleSend} busy={busy} />
      </div>

      {/* Right: studio */}
      {studioOpen ? (
        <div className="hidden w-[280px] shrink-0 border-l border-border/70 bg-card/40 xl:block">
          <StudioPanel onCollapse={() => setStudioOpen(false)} />
        </div>
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
            'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
            active
              ? 'text-foreground hover:bg-secondary'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
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
        'w-11 shrink-0 flex-col items-center gap-3 bg-card/40 py-4 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        side === 'left' ? 'border-r border-border/70' : 'border-l border-border/70',
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
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-float">
        <Boxes className="h-8 w-8" strokeWidth={2} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Chat with your knowledge</h1>
      <p className="mt-2 max-w-md text-center text-[15px] leading-relaxed text-muted-foreground">
        {hasContext
          ? 'Ask a question and Atlas answers from your selected sources — with citations to the exact page or timestamp.'
          : 'Select sources on the left, pick a prompt, then ask. Or attach a file to answer it against your library.'}
      </p>

      <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button
              key={i}
              onClick={() => onPick(s.text)}
              className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 text-left shadow-soft transition-all duration-150 hover:-translate-y-0.5 hover:shadow-float"
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
