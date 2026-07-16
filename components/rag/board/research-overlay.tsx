'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { normalizeModelId } from '@/lib/rag/models';
import { useBoard } from '@/lib/rag/board/store';
import {
  useBrainMessages,
  addBrainMessage,
  updateBrainMessage,
  removeBrainMessage,
  clearBrainMessages
} from '@/lib/rag/board/brain-messages-store';
import { useRag } from '@/lib/rag/store';
import { askBrain, opineBrain } from '@/lib/rag/board/ask';
import { playVoiceover, type VoiceoverController } from '@/lib/rag/board/voiceover';
import { streamText } from '@/lib/rag/mock-answer';
import { useScrollStyle } from '@/lib/rag/scroll-style';
import { startHum, stopHum, playChime } from '@/lib/rag/board/sound';
import { WavRecorder, transcribeAudio } from '@/lib/rag/board/dictation';
import { BrainMessage, nextMsgId } from '@/components/rag/board/brain-node';
import { ChatMessage } from '@/lib/rag/types';
import {
  ArrowUp,
  Loader2,
  Minimize2,
  Landmark,
  Zap,
  Search,
  Telescope,
  Mic,
  MoreHorizontal,
  Pencil,
  Plug,
  Printer,
  Download,
  Archive,
  Trash2
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { ConnectDialog } from './connect-dialog';
import { exportConversation } from '@/lib/rag/board/conversation-export';

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
    resolveBrainScope,
    setBrainBusy,
    setBoard,
    updateBoardNodeData,
    nextBoardId,
    stashBrain
  } = useBoard();
  const { openViewer, activeProjectId } = useRag();

  const node = board.nodes.find((n) => n.id === brainId);
  const data = (node?.data ?? {}) as Record<string, unknown>;
  const name = (data.name as string) || 'Research';
  const modelId = normalizeModelId((data.modelId as string) || 'octopussy-12');
  const answerMode: 'cited' | 'hybrid' =
    data.answerMode === 'hybrid' ? 'hybrid' : 'cited';
  const summary = (data.summary as string) ?? '';
  const speed: 'fast' | 'detailed' | 'research' =
    data.speed === 'detailed'
      ? 'detailed'
      : data.speed === 'research'
        ? 'research'
        : 'fast';
  const messages = useBrainMessages(brainId);
  const scopeCount = resolveBrainScope(brainId).items.length;

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  // Top-menu affordances (mirror the brain card's ⋯ menu)
  const [connectOpen, setConnectOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  function commitRename() {
    const next = draftName.trim();
    if (next && next !== name) updateBoardNodeData(brainId, { name: next });
    setRenaming(false);
  }
  function clearConversation() {
    if (messages.length === 0) return;
    if (window.confirm('Clear this entire conversation? This cannot be undone.')) {
      clearBrainMessages(brainId);
      updateBoardNodeData(brainId, { summary: '', summarizedThrough: 0 });
    }
  }
  const [voicingId, setVoicingId] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Dictation — mirrors the brain card: MAI-Transcribe (record WAV → accurate
  // transcript biased to wired source names) with a Web Speech API fallback.
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [maiMode, setMaiMode] = useState(true);
  const recRef = useRef<any>(null);
  const wavRef = useRef<WavRecorder | null>(null);
  const dictBaseRef = useRef('');
  // hard cap a single recording so the mic never runs forever (and the WAV/MP3
  // never grows unbounded). Auto-stops + transcribes what was captured.
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // mic flashes red in the final ~10s before the 2-min cap
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recWarn, setRecWarn] = useState(false);

  function clearRecTimers() {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (warnTimerRef.current) {
      clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
    }
    setRecWarn(false);
  }

  // Per-message actions — the same ones the brain card offers, so research mode
  // isn't a downgrade. Voiceover: ephemeral synth + play (regenerable). Edit:
  // drop the answer into an editable text piece on the canvas (there on exit).
  // Progressive playback (starts in seconds, not after the whole answer); click
  // the active message again to stop + cancel pending chunk synths.
  const voiceCtl = useRef<VoiceoverController | null>(null);
  function handleVoiceover(msg: ChatMessage) {
    if (voicingId === msg.id) {
      voiceCtl.current?.stop();
      voiceCtl.current = null;
      setVoicingId(null);
      return;
    }
    if (!msg.content) return;
    voiceCtl.current?.stop();
    setVoicingId(msg.id);
    voiceCtl.current = playVoiceover(msg.content, {
      onEnd: () => {
        voiceCtl.current = null;
        setVoicingId(null);
      },
      onError: () => {
        voiceCtl.current = null;
        setVoicingId(null);
      }
    });
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
  const scrollStyle = useScrollStyle();

  // auto-grow the composer
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [question]);

  // keep the latest answer in view as it streams (behavior is user-toggleable).
  // NEVER smooth-scroll mid-stream — smooth fires ~60×/s during token reveal and
  // "earthquakes" the viewport (which also makes citations un-clickable). Smooth
  // glide only on a SETTLED message; during streaming, instant near-bottom pin.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const streaming = messages[messages.length - 1]?.streaming;
    if (scrollStyle === 'smooth' && !streaming) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      if (nearBottom) el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages.length, messages[messages.length - 1]?.content, scrollStyle]);

  // Escape exits research mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  // stop any live recording when research mode unmounts (release the mic)
  useEffect(
    () => () => {
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      try {
        recRef.current?.stop?.();
      } catch {}
      void wavRef.current?.stop?.().catch(() => {});
    },
    []
  );

  function appendToComposer(text: string) {
    if (!text) return;
    setQuestion((q) => (q ? q.trimEnd() + ' ' : '') + text);
  }

  /**
   * Mic: MAI-Transcribe (record WAV → accurate transcript biased toward wired
   * source names) when available; auto-falls back to the browser Web Speech API.
   * Identical behaviour to the brain card so dictation feels the same everywhere.
   */
  /** Stop the active recording and transcribe what was captured. Idempotent —
   *  claims `wavRef` up front so the 2-min timer and a manual tap can't double-run.
   *  `auto` = stopped by the cap (we then nudge the user to record again). */
  async function finishMaiRecording(auto = false) {
    const rec = wavRef.current;
    if (!rec) return;
    wavRef.current = null;
    clearRecTimers();
    setListening(false);
    setTranscribing(true);
    try {
      const blob = await rec.stop();
      const phrases = resolveBrainScope(brainId).items.map((i) => i.name);
      appendToComposer(await transcribeAudio(blob, phrases));
      if (auto) {
        window.alert(
          'Reached the 2-minute recording limit — I stopped and saved what you said. Tap the mic to record more and keep transcribing.'
        );
      }
    } catch (e: any) {
      if (e?.status === 503 || e?.status === 501) {
        setMaiMode(false);
        window.alert(
          'High-accuracy transcription isn’t configured yet — using browser dictation. Tap the mic again.'
        );
      } else {
        window.alert(e?.message ?? 'Transcription failed.');
      }
    } finally {
      setTranscribing(false);
    }
  }

  async function toggleMic() {
    if (transcribing) return;
    if (!maiMode) return toggleWebSpeech();
    if (wavRef.current) return finishMaiRecording(false);

    try {
      const rec = new WavRecorder();
      await rec.start();
      wavRef.current = rec;
      setRecWarn(false);
      setListening(true);
      // flash red in the last ~10s, then hard-stop + transcribe at 2 min.
      warnTimerRef.current = setTimeout(() => setRecWarn(true), 110_000);
      maxTimerRef.current = setTimeout(() => void finishMaiRecording(true), 120_000);
    } catch {
      window.alert('Microphone permission is needed to dictate.');
    }
  }

  /** Free browser dictation (Web Speech API) — fallback engine. */
  function toggleWebSpeech() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      window.alert(
        'Dictation needs Chrome/Edge/Safari, or high-accuracy transcription configured on the server (OPENAI_API_KEY).'
      );
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    dictBaseRef.current = question ? question.trimEnd() + ' ' : '';
    rec.onresult = (e: any) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++)
        transcript += e.results[i][0].transcript;
      setQuestion(dictBaseRef.current + transcript);
    };
    rec.onend = () => {
      setListening(false);
      clearRecTimers();
    };
    rec.onerror = () => {
      setListening(false);
      clearRecTimers();
    };
    recRef.current = rec;
    setRecWarn(false);
    setListening(true);
    rec.start();
    // flash in the final ~10s, then hard-stop at 2 min. Web Speech appends live,
    // so the text is already saved; we just stop and nudge them to record again.
    warnTimerRef.current = setTimeout(() => setRecWarn(true), 110_000);
    maxTimerRef.current = setTimeout(() => {
      recRef.current?.stop();
      window.alert(
        'Reached the 2-minute recording limit — your words were saved. Tap the mic to keep dictating.'
      );
    }, 120_000);
  }

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
    let citations: Awaited<ReturnType<typeof askBrain>>['citations'] = [];
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
      // OPINE PATH: an artifact (right plug) is wired → reason ABOUT it via the
      // Make opine scenario — in research mode too, not just the brain card.
      // Otherwise the normal query path. (Mode-specific models come later.)
      const r = scope.artifact
        ? await opineBrain(
            q,
            scope.items,
            scope.artifact,
            scope.references,
            scope.guides,
            data.citations === false ? 'off' : 'on',
            answerMode,
            history,
            activeProjectId,
            brainId // Bank id → server injects its stored doctrine
          )
        : await askBrain(
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
            activeProjectId,
            brainId // Bank id → server injects its stored doctrine
          );
      content = r.answer;
      citations = r.citations;
      noMatch = r.noMatch;
      suggestedQuestions = r.suggestedQuestions;
    } catch (e) {
      // Honest failure — NEVER fabricate a "mock answer" in a citation app.
      // Surface Make's actual error-handler message when one comes through
      // (see ask.ts) instead of always showing a generic string.
      content =
        e instanceof Error && e.message
          ? `The answer service failed: ${e.message}`
          : 'The answer service is temporarily unreachable. Please try again in a moment.';
      citations = [];
      noMatch = true;
    }

    streamText(
      content,
      (soFar) => updateBrainMessage(brainId, asstId, { content: soFar, streaming: true }),
      () => {
        updateBrainMessage(brainId, asstId, {
          citations,
          noMatch,
          suggestedQuestions,
          streaming: false
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
    // Own opaque GPU layer + isolated stacking/paint context: without this the
    // overlay isn't composited separately, so a board repaint behind it (during
    // a query/stream) or a fast scroll briefly bleeds the board through. The
    // translateZ(0)+isolation+contain pins it to its own layer = no flash.
    <div
      // top-anchored + height:100dvh (not inset-0 / 100vh) so the bottom composer
      // stays visible on iPad/iOS Safari, where a fixed full-height box otherwise
      // runs under the address bar. The own GPU/stacking layer (translateZ +
      // isolation) stops the board flashing through; see the streaming-jitter fix.
      className="fixed inset-x-0 top-0 z-40 flex h-screen flex-col overflow-hidden bg-[#efece4] dark:bg-[#0c0c0e]"
      style={{ height: '100dvh', transform: 'translateZ(0)', isolation: 'isolate' }}
    >
      {/* minimal top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 px-5">
        <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
          <Landmark className="h-4 w-4 shrink-0 text-accent" />
          {renaming ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="min-w-0 rounded-md border border-accent/30 bg-transparent px-2 py-0.5 text-[14px] font-semibold outline-none focus:border-accent"
            />
          ) : (
            <span className="truncate">{name}</span>
          )}
          <span className="ml-1 shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
            {scopeCount} source{scopeCount === 1 ? '' : 's'} wired
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Overflow menu — the same actions as the brain card's ⋯ menu, surfaced
              here because Research mode is a full-screen surface. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="More"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 border-black/10 bg-popover/90 shadow-[0_10px_34px_-6px_rgb(0_0_0/0.28)] backdrop-blur-xl dark:border-white/10"
            >
              <DropdownMenuItem
                onClick={() => {
                  setDraftName(name);
                  setRenaming(true);
                }}
                className="gap-2.5"
              >
                <Pencil className="h-4 w-4 text-foreground/70" /> Rename Answers Bank
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setConnectOpen(true)} className="gap-2.5">
                <Plug className="h-4 w-4 text-accent" /> Connect to another app
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  exportConversation({ messages, title: name, format: 'pdf', scrollEl: scrollRef.current })
                }
                disabled={messages.length === 0}
                className="gap-2.5"
              >
                <Printer className="h-4 w-4 text-foreground/70" /> Print / Save PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  exportConversation({ messages, title: name, format: 'doc', scrollEl: scrollRef.current })
                }
                disabled={messages.length === 0}
                className="gap-2.5"
              >
                <Download className="h-4 w-4 text-foreground/70" /> Export Word (.doc)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  exportConversation({ messages, title: name, format: 'md', scrollEl: scrollRef.current })
                }
                disabled={messages.length === 0}
                className="gap-2.5"
              >
                <Download className="h-4 w-4 text-foreground/70" /> Export Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  exportConversation({ messages, title: name, format: 'txt', scrollEl: scrollRef.current })
                }
                disabled={messages.length === 0}
                className="gap-2.5"
              >
                <Download className="h-4 w-4 text-foreground/70" /> Export Text
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  stashBrain(brainId);
                  onExit();
                }}
                className="gap-2.5"
              >
                <Archive className="h-4 w-4 text-foreground/70" /> Send to Chest
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={clearConversation}
                disabled={messages.length === 0}
                className="gap-2.5 text-red-600 focus:text-red-600"
              >
                <Trash2 className="h-4 w-4" /> Clear conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={onExit}
            title="Minimize research mode (Esc)"
            className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-white shadow-[0_2px_10px_hsl(var(--accent)/0.4)] transition-all hover:brightness-110"
          >
            <Minimize2 className="h-4 w-4" />
            Minimize
          </button>
        </div>
      </header>

      {/* messages — a "document page" floating on a desk (Word/Docs feel) */}
      {/* translateZ(0) promotes the scroll area to its own GPU layer so scrolling
          COMPOSITES instead of repainting the tall card's 44px shadow every frame
          (the cause of the read-mode flicker). */}
      <div
        ref={scrollRef}
        className="scroll-brain min-h-0 flex-1 overflow-y-auto px-4 py-8 [transform:translateZ(0)]"
      >
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 rounded-2xl border border-[rgb(var(--hairline)/0.1)] bg-card px-6 py-9 shadow-[0_10px_44px_rgb(0_0_0/0.13)] sm:px-12 sm:py-11 [&_.rag-html]:font-serif [&_.rag-html]:text-[16.5px] [&_.rag-html]:leading-[1.7]">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-24 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
                <Landmark className="h-6 w-6 text-accent" />
              </div>
              <h2 className="text-[20px] font-semibold tracking-tight">
                Research with {name}
              </h2>
              <p className="mt-1.5 max-w-md text-[14px] text-muted-foreground">
                {scopeCount > 0
                  ? `Ask anything across your ${scopeCount} wired source${scopeCount === 1 ? '' : 's'}. Every answer is cited.`
                  : 'No sources wired yet — exit and connect sources to this Answers Bank first.'}
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
                onDelete={() => removeBrainMessage(brainId, m.id)}
                onVoiceover={handleVoiceover}
                voicing={voicingId === m.id}
                onEdit={handleEditInText}
                /* Model name intentionally hidden in research output (per request) */
              />
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* composer — floating, centered (matches the reading column width) */}
      <div className="shrink-0 px-5 pb-6">
        <div className="mx-auto w-full max-w-[820px]">
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
              placeholder={
                transcribing
                  ? 'Transcribing…'
                  : listening
                    ? 'Listening…'
                    : 'Ask your wired sources…'
              }
              className="max-h-52 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
            />
            <button
              onClick={toggleMic}
              disabled={transcribing}
              title={
                listening
                  ? 'Stop & transcribe'
                  : maiMode
                    ? 'Dictate (MAI-Transcribe)'
                    : 'Dictate your question'
              }
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all',
                listening
                  ? recWarn
                    ? 'recording-warn text-white'
                    : 'animate-pulse bg-red-500 text-white shadow-[0_2px_10px_rgb(239_68_68/0.5)]'
                  : 'text-muted-foreground/60 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]'
              )}
            >
              {transcribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
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
                title="Normal — the full pipeline: query expansion and per-claim citations. Slower, more thorough."
                className={cn(
                  'flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide transition-colors',
                  speed === 'detailed'
                    ? 'bg-accent text-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]'
                    : 'text-muted-foreground/70 hover:text-foreground'
                )}
              >
                <Search className="h-3.5 w-3.5" /> Normal
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

      <ConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        bankLabel={name}
        bankId={brainId}
        projectId={activeProjectId}
        sourceIds={resolveBrainScope(brainId).items.map((m) => m.id)}
        answerMode={answerMode}
        model={modelId}
        speed={speed}
      />
    </div>
  );
}
