'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/rag/board/store';
import { useRag } from '@/lib/rag/store';
import { askBrain } from '@/lib/rag/board/ask';
import { generateMockAnswer, streamText } from '@/lib/rag/mock-answer';
import { startHum, stopHum, playChime } from '@/lib/rag/board/sound';
import { BrainMessage, nextMsgId } from '@/components/rag/board/brain-node';
import { ChatMessage } from '@/lib/rag/types';
import {
  ArrowUp,
  Loader2,
  Minimize2,
  Brain,
  Zap,
  Search,
  Telescope
} from 'lucide-react';

/**
 * RESEARCH MODE — a clean, full-screen chat for one brain (Claude-style:
 * centered column, generous whitespace, floating composer). Sources are already
 * wired on the canvas; this is just distraction-free Q&A. Reuses the brain's
 * message renderer (BrainMessage → answers, footnotes, citations) and the same
 * /api/query path; citations open the global SourceViewer sheet (z-50, above
 * this z-40 overlay).
 */
export function ResearchOverlay({
  brainId,
  onExit
}: {
  brainId: string;
  onExit: () => void;
}) {
  const {
    board,
    brainMessages,
    resolveBrainScope,
    addBrainMessage,
    updateBrainMessage,
    setBrainBusy,
    setBoard,
    updateBoardNodeData,
    nextBoardId
  } = useBoard();
  const { openViewer, activeProjectId } = useRag();

  const node = board.nodes.find((n) => n.id === brainId);
  const data = (node?.data ?? {}) as Record<string, unknown>;
  const name = (data.name as string) || 'Research';
  const modelId = (data.modelId as string) || 'gemini-2.5-flash';
  const answerMode: 'cited' | 'hybrid' =
    data.answerMode === 'hybrid' ? 'hybrid' : 'cited';
  const summary = (data.summary as string) ?? '';
  const speed: 'fast' | 'detailed' | 'research' =
    data.speed === 'detailed'
      ? 'detailed'
      : data.speed === 'research'
        ? 'research'
        : 'fast';
  const messages = brainMessages[brainId] ?? [];
  const scopeCount = resolveBrainScope(brainId).items.length;

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [voicingId, setVoicingId] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Per-message actions — the same ones the brain card offers, so research mode
  // isn't a downgrade. Voiceover: ephemeral synth + play (regenerable). Edit:
  // drop the answer into an editable text piece on the canvas (there on exit).
  async function handleVoiceover(msg: ChatMessage) {
    if (!msg.content || voicingId) return;
    setVoicingId(msg.id);
    try {
      const res = await fetch('/api/voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg.content })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? 'voiceover failed');
      const playUrl: string = j.url ?? j.dataUrl;
      if (playUrl) await new Audio(playUrl).play();
    } catch {
      /* clicking 🔈 again re-synthesizes */
    } finally {
      setVoicingId(null);
    }
  }

  function handleEditInText(msg: ChatMessage) {
    if (!msg.content) return;
    const self = board.nodes.find((n) => n.id === brainId);
    const pos = self
      ? { x: self.position.x + (self.width ?? 380) + 40, y: self.position.y + 90 }
      : { x: 0, y: 0 };
    setBoard((prev) => ({
      ...prev,
      nodes: [
        ...prev.nodes,
        {
          id: nextBoardId('text'),
          type: 'textNode',
          position: pos,
          width: 300,
          height: 200,
          data: { text: msg.content }
        }
      ]
    }));
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // auto-grow the composer
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [question]);

  // keep the latest answer in view as it streams
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  // Escape exits research mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  function send() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    void runQuery(q);
  }

  async function runQuery(q: string) {
    if (!q || busy) return;
    addBrainMessage(brainId, {
      id: nextMsgId(),
      role: 'user',
      content: q,
      createdAt: new Date().toISOString()
    });
    setBusy(true);
    setBrainBusy(brainId, true);
    startHum();
    const asstId = nextMsgId();
    addBrainMessage(brainId, {
      id: asstId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString()
    });

    const scope = resolveBrainScope(brainId);
    let content: string;
    let citations;
    let noMatch = false;
    let suggestedQuestions: string[] = [];
    try {
      // Last 30 turns (≈15 Q + 15 A) verbatim, in full; older turns ride in via
      // the brain's entity-preserving rolling summary. Matches HISTORY_WINDOW.
      const history = messages
        .filter((mm) => mm.content && mm.content.trim())
        .slice(-30)
        .map((mm) => ({
          role: mm.role,
          content: mm.content
            // drop this turn's own footnote refs + [n] markers (stale next turn)
            .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
            .replace(/\[\d+\](?:\s*\[\d+\])*/g, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        }));
      const r = await askBrain(
        q,
        scope.items,
        scope.contextTexts,
        modelId,
        answerMode,
        scope.guides,
        history,
        summary,
        speed,
        scope.clusterIds,
        scope.everything,
        activeProjectId
      );
      content = r.answer;
      citations = r.citations;
      noMatch = r.noMatch;
      suggestedQuestions = r.suggestedQuestions;
    } catch {
      const mock = generateMockAnswer(q, scope.items);
      content = `⚠︎ Live RAG unreachable — mock answer.\n\n${mock.content}`;
      citations = mock.citations;
    }

    streamText(
      content,
      (soFar) => updateBrainMessage(brainId, asstId, { content: soFar }),
      () => {
        updateBrainMessage(brainId, asstId, {
          citations,
          noMatch,
          suggestedQuestions
        });
        setBusy(false);
        setBrainBusy(brainId, false);
        stopHum();
        playChime();
        if (content && !noMatch) {
          void fetch('/api/memory/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q, answer: content })
          }).catch(() => {});
        }
      }
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      {/* minimal top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <Brain className="h-4 w-4 text-accent" />
          <span className="truncate">{name}</span>
          <span className="ml-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
            {scopeCount} source{scopeCount === 1 ? '' : 's'} wired
          </span>
        </div>
        <button
          onClick={onExit}
          title="Exit research mode (Esc)"
          className="ml-auto flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-3.5 py-1.5 text-[13px] font-semibold text-foreground/80 transition-colors hover:bg-foreground/[0.1]"
        >
          <Minimize2 className="h-4 w-4 text-accent" />
          Exit Research
        </button>
      </header>

      {/* messages — centered reading column, generous whitespace */}
      <div ref={scrollRef} className="scroll-brain min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-5 py-10">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-24 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
                <Brain className="h-6 w-6 text-accent" />
              </div>
              <h2 className="text-[20px] font-semibold tracking-tight">
                Research with {name}
              </h2>
              <p className="mt-1.5 max-w-md text-[14px] text-muted-foreground">
                {scopeCount > 0
                  ? `Ask anything across your ${scopeCount} wired source${scopeCount === 1 ? '' : 's'}. Every answer is cited.`
                  : 'No sources wired yet — exit and connect sources to this brain first.'}
              </p>
            </div>
          ) : (
            messages.map((m, mi) => (
              <BrainMessage
                key={m.id}
                m={m}
                large
                busy={busy}
                onCitation={openViewer}
                onCiteHover={() => {}}
                onAsk={runQuery}
                onRewrite={
                  m.role === 'assistant'
                    ? () => {
                        const prev = [...messages.slice(0, mi)]
                          .reverse()
                          .find((x) => x.role === 'user');
                        if (prev) runQuery(prev.content);
                      }
                    : undefined
                }
                onVoiceover={handleVoiceover}
                voicing={voicingId === m.id}
                onEdit={handleEditInText}
                modelLabel={m.role === 'assistant' ? modelId : undefined}
              />
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* composer — floating, centered */}
      <div className="shrink-0 px-5 pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-[22px] border border-[rgb(var(--hairline)/0.18)] bg-card px-4 py-3 shadow-[0_4px_24px_rgb(0_0_0/0.08)] transition-shadow focus-within:shadow-[0_6px_30px_rgb(0_0_0/0.12)] focus-within:ring-2 focus-within:ring-accent/30">
            <textarea
              ref={taRef}
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Ask your wired sources…"
              className="max-h-52 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
            />
            <button
              onClick={send}
              disabled={!question.trim() || busy}
              title="Send"
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all',
                question.trim() && !busy
                  ? 'bg-accent text-white shadow-[0_2px_8px_hsl(var(--accent)/0.4)] hover:opacity-90'
                  : 'bg-black/[0.05] text-muted-foreground/40 dark:bg-white/[0.06]'
              )}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
          {/* speed: Fast / Detailed / Research — same control as the brain card */}
          <div className="mt-3 flex justify-center">
            <div
              role="group"
              aria-label="Answer speed"
              className="flex items-center rounded-full bg-black/[0.05] p-0.5 dark:bg-white/[0.06]"
            >
              <button
                onClick={() => updateBoardNodeData(brainId, { speed: 'fast' })}
                title="Fast — a quick, lightning answer (fewer steps, no extra checks)."
                className={cn(
                  'flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide transition-colors',
                  speed === 'fast'
                    ? 'bg-amber-400 text-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]'
                    : 'text-muted-foreground/70 hover:text-foreground'
                )}
              >
                <Zap className="h-3.5 w-3.5" /> Fast
              </button>
              <button
                onClick={() =>
                  updateBoardNodeData(brainId, { speed: 'detailed' })
                }
                title="Detailed — the full pipeline: query expansion, validation, and per-claim citations. Slower, more thorough."
                className={cn(
                  'flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide transition-colors',
                  speed === 'detailed'
                    ? 'bg-accent text-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]'
                    : 'text-muted-foreground/70 hover:text-foreground'
                )}
              >
                <Search className="h-3.5 w-3.5" /> Detailed
              </button>
              <button
                onClick={() =>
                  updateBoardNodeData(brainId, { speed: 'research' })
                }
                title="Research — the deepest answer: the full pipeline plus a heavier reasoning model that organizes findings across many sources and bridges to related concepts. Slowest, most thorough."
                className={cn(
                  'flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide transition-colors',
                  speed === 'research'
                    ? 'bg-violet-500 text-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]'
                    : 'text-muted-foreground/70 hover:text-foreground'
                )}
              >
                <Telescope className="h-3.5 w-3.5" /> Research
              </button>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/55">
            answersDoc cites every claim. Press Esc to exit research mode.
          </p>
        </div>
      </div>
    </div>
  );
}
