'use client';

import { useEffect, useRef, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { ChatMessage, ChatAttachment, Citation } from '@/lib/rag/types';
import { streamText } from '@/lib/rag/mock-answer';
import { askBrain } from '@/lib/rag/board/ask';
import { SourcesPanel } from './sources-panel';
import { StudioPanel } from './studio-panel';
import { Composer } from './composer';
import { Message, TypingIndicator } from './message';
import { cn } from '@/lib/utils';
import {
  Sparkles,
  ScrollText,
  GitCompareArrows,
  GraduationCap,
  PanelLeft,
  PanelRight,
  Minimize2,
  Maximize2,
  Layers,
  History,
  Plus,
  Pin,
  Trash2,
  ChevronDown,
  ImagePlus
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

let msgId = 0;
const newId = () => `msg${++msgId}`;

const SUGGESTIONS = [
  { icon: ScrollText, text: 'Summarize the key ideas across my selected sources' },
  { icon: GitCompareArrows, text: 'Compare how my sources treat this topic' },
  { icon: GraduationCap, text: 'Quiz me on the most important concepts' },
  { icon: Sparkles, text: 'What are the 3 most surprising insights here?' }
];

export function ChatView() {
  const {
    activeProject,
    activeConversation,
    projectConversations,
    newConversation,
    setActiveConversation,
    togglePinConversation,
    deleteConversation,
    addMessage,
    addMedia,
    contextItems,
  } = useRag();
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<ChatMessage | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [studioOpen, setStudioOpen] = useState(true);
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = activeConversation?.messages ?? [];
  const allOpen = sourcesOpen && studioOpen;
  function toggleAll() {
    const next = !allOpen;
    setSourcesOpen(next);
    setStudioOpen(next);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streaming]);

  async function handleSend(text: string, attachment?: ChatAttachment) {
    // "Add to library" attachments also become permanent indexed sources.
    if (attachment?.mode === 'index') {
      addMedia({
        type: attachment.kind === 'image' ? 'image' : 'document',
        name: attachment.name.replace(/\.[^.]+$/, ''),
        description: 'Added from chat',
        date: new Date().toISOString().slice(0, 10),
        content: `Extracted content from ${attachment.name}…`,
        source: attachment.name
      });
    }

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

    // Recent turns (plain text, last 30) → lets the server resolve follow-up
    // references into a standalone retrieval query.
    const history = messages
      .filter((m) => m.content && m.content.trim())
      .slice(-30)
      .map((m) => ({
        role: m.role,
        content: m.content
          .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
          .replace(/\[\d+\](?:\s*\[\d+\])*/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }));

    // Live RAG against the selected context sources — NO mock answers.
    let content: string;
    let citations: Citation[] = [];
    let noMatch = false;
    let suggestedQuestions: string[] = [];
    try {
      const r = await askBrain(
        text,
        contextItems,
        [],
        undefined,
        'cited',
        [],
        history,
        '',
        'detailed'
      );
      content = r.answer;
      citations = r.citations;
      noMatch = r.noMatch;
      suggestedQuestions = r.suggestedQuestions;
    } catch (e) {
      // Honest failure — never fabricate a mock answer in a citation app.
      // Surface Make's actual error-handler message when one comes through
      // (see ask.ts) instead of always showing a generic string.
      content =
        e instanceof Error && e.message
          ? `The answer service failed: ${e.message}`
          : 'The answer service is temporarily unreachable. Please try again in a moment.';
      noMatch = true;
    }

    const base: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      citations,
      noMatch,
      suggestedQuestions,
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
  }

  function handleGenerateImage(prompt: string, model: 'nanobanana' | 'kling') {
    addMessage({
      id: newId(),
      role: 'user',
      content: `Generate an image: ${prompt}`,
      createdAt: new Date().toISOString()
    });
    setBusy(true);
    setTimeout(() => {
      addMessage({
        id: newId(),
        role: 'assistant',
        content:
          'Here is a preview of your generated image. Once the backend is wired, this will render the actual output — grounded in your selected sources when you reference them.',
        image: { prompt, model },
        createdAt: new Date().toISOString()
      });
      setBusy(false);
    }, 1200);
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
        <div className="hidden h-20 shrink-0 items-center gap-2 px-4 md:flex">
          <PanelButton
            active={sourcesOpen}
            label={sourcesOpen ? 'Hide sources' : 'Show sources'}
            icon={PanelLeft}
            onClick={() => setSourcesOpen((v) => !v)}
          />

          {/* Conversation switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex max-w-[260px] items-center gap-1.5 rounded-full bg-[hsl(240_16%_96.5%)] px-3 py-1.5 text-[12px] font-medium text-foreground transition-all hover:brightness-95 dark:bg-[rgb(255_255_255_/_0.05)] dark:hover:bg-[rgb(255_255_255_/_0.08)]">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">
                  {activeConversation ? activeConversation.title : 'New chat'}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuItem onClick={() => newConversation()} className="gap-2 text-accent">
                <Plus className="h-3.5 w-3.5" /> New chat
              </DropdownMenuItem>
              {projectConversations.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {activeProject.name} — history
                  </DropdownMenuLabel>
                  {projectConversations.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => setActiveConversation(c.id)}
                      className={cn(
                        'group/conv gap-2',
                        c.id === activeConversation?.id && 'bg-secondary'
                      )}
                    >
                      {c.pinned ? (
                        <Pin className="h-3 w-3 shrink-0 text-accent" />
                      ) : (
                        <History className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePinConversation(c.id);
                        }}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-accent group-hover/conv:opacity-100"
                      >
                        <Pin className="h-3 w-3" />
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(c.id);
                        }}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover/conv:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

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
            <EmptyState
              onPick={handleSend}
              hasContext={contextItems.length > 0}
              projectName={activeProject.name}
            />
          ) : (
            <div className="py-4 pb-40">
              {messages.map((m) => (
                <Message key={m.id} msg={m} />
              ))}
              {streaming &&
                (streaming.content ? <Message msg={streaming} /> : <TypingIndicator />)}
            </div>
          )}
        </div>

        {/* Floating composer */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <div className="pointer-events-auto bg-gradient-to-t from-[rgb(var(--glass-bg)/0.9)] via-[rgb(var(--glass-bg)/0.6)] to-transparent pt-8">
            <Composer onSend={handleSend} busy={busy} />
          </div>
        </div>
      </div>

      {/* Right: studio */}
      {studioOpen ? (
        <aside className="panel hidden w-[284px] shrink-0 overflow-hidden rounded-[26px] xl:block">
          <StudioPanel
            onCollapse={() => setStudioOpen(false)}
            onGenerateImage={() => setImageGenOpen(true)}
          />
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

      {/* Image generation dialog */}
      <ImageGenDialog
        open={imageGenOpen}
        onOpenChange={setImageGenOpen}
        onGenerate={handleGenerateImage}
      />
    </div>
  );
}

function ImageGenDialog({
  open,
  onOpenChange,
  onGenerate
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onGenerate: (prompt: string, model: 'nanobanana' | 'kling') => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<'nanobanana' | 'kling'>('nanobanana');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-4 w-4 text-accent" /> Generate an image
          </DialogTitle>
          <DialogDescription>
            Describe what you want. Reference your sources and the generation will be
            grounded in them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A clean diagram of the habit loop as described in Atomic Habits"
              className="min-h-[90px]"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'nanobanana', name: 'NanoBanana', desc: 'Images & infographics' },
                  { id: 'kling', name: 'Kling', desc: 'Short video clips' }
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={cn(
                    'card-glass rounded-[14px] p-3 text-left transition-all',
                    model === m.id && 'ring-1 ring-accent'
                  )}
                >
                  <div className="text-[13px] font-semibold">{m.name}</div>
                  <div className="text-[11px] text-muted-foreground">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={!prompt.trim()}
            onClick={() => {
              onGenerate(prompt.trim(), model);
              setPrompt('');
              onOpenChange(false);
            }}
          >
            Generate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  hasContext,
  projectName
}: {
  onPick: (t: string) => void;
  hasContext: boolean;
  projectName: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-24">
      <div className="relative mb-6">
        <div className="absolute inset-0 -z-10 rounded-[28px] bg-accent/30 blur-2xl" />
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[22px] bg-[#efe9da] shadow-float">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/answersdoc-logo.png" alt="answersDoc" className="h-full w-full object-contain p-1" draggable={false} />
        </div>
      </div>
      <h1 className="text-gradient text-[32px] font-semibold leading-tight tracking-tight">
        Chat with {projectName}
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
