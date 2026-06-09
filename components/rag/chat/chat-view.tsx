'use client';

import { useEffect, useRef, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { ChatMessage } from '@/lib/rag/types';
import { generateMockAnswer, streamText } from '@/lib/rag/mock-answer';
import { SourcesPanel } from './sources-panel';
import { StudioPanel } from './studio-panel';
import { Composer } from './composer';
import { Message, TypingIndicator } from './message';
import { Boxes, Sparkles, ScrollText, GitCompareArrows, GraduationCap } from 'lucide-react';

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
  const scrollRef = useRef<HTMLDivElement>(null);

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

    // brief "thinking" delay, then stream
    setTimeout(() => {
      const assistantId = newId();
      const base: ChatMessage = {
        id: assistantId,
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
      <div className="hidden w-[300px] shrink-0 border-r border-border/70 bg-white/40 md:block">
        <SourcesPanel />
      </div>

      {/* Center: chat */}
      <div className="flex min-w-0 flex-1 flex-col">
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
      <div className="hidden w-[280px] shrink-0 border-l border-border/70 bg-white/40 xl:block">
        <StudioPanel />
      </div>
    </div>
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
              className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-white p-4 text-left shadow-soft transition-all duration-150 hover:-translate-y-0.5 hover:shadow-float"
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
