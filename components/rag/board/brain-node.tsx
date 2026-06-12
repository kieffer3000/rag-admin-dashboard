'use client';

import { memo, useRef, useState, useEffect } from 'react';
import {
  Handle,
  Position,
  NodeResizer,
  useReactFlow,
  type NodeProps
} from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/rag/board/store';
import { useRag } from '@/lib/rag/store';
import { generateMockAnswer, streamText } from '@/lib/rag/mock-answer';
import { askBrain } from '@/lib/rag/board/ask';
import { startHum, stopHum, playChime } from '@/lib/rag/board/sound';
import { WavRecorder, transcribeAudio } from '@/lib/rag/board/dictation';
import { ChatMessage } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import { Markdown } from '@/components/rag/board/markdown';
import { LLM_MODELS, PROVIDER_META } from '@/lib/rag/models';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Boxes,
  ArrowUp,
  Loader2,
  Unplug,
  Mic,
  Check,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  BookOpen,
  Globe,
  Image as ImageIcon,
  Share2,
  PanelTop,
  Presentation,
  GalleryHorizontalEnd,
  SlidersHorizontal
} from 'lucide-react';
import type { BrainData } from '@/lib/rag/board/types';

/** v1 generation runs on Gemini in Make — the Board defaults to it. */
const BOARD_DEFAULT_MODEL = 'gemini-2.5-flash';

/** Poppy-style Tools menu — each sends a grounded prompt over the wired sources. */
const BRAIN_TOOLS: { label: string; icon: any; prompt: string }[] = [
  {
    label: 'Deep Research',
    icon: Globe,
    prompt:
      'Do a deep, structured analysis of the wired sources: themes, contradictions, gaps, and open questions — with citations.'
  },
  {
    label: 'Create Image',
    icon: ImageIcon,
    prompt:
      'Write a detailed image-generation prompt that visualizes the central idea from the wired sources.'
  },
  {
    label: 'MindMap',
    icon: Share2,
    prompt:
      'Create a hierarchical mind map of the key concepts and how they relate, using only the wired sources. Output as a markdown nested bullet list.'
  },
  {
    label: 'Landing Page',
    icon: PanelTop,
    prompt:
      'Draft landing-page copy from the wired sources: a headline, a subheadline, 3 benefit bullets, and a call to action.'
  },
  {
    label: 'Presentation',
    icon: Presentation,
    prompt:
      'Outline a slide-by-slide presentation from the wired sources — a title plus 3–5 bullets per slide.'
  },
  {
    label: 'Carousel',
    icon: GalleryHorizontalEnd,
    prompt:
      'Write a 6-slide social carousel from the wired sources — one punchy line per slide.'
  }
];

let msgCounter = 9000;
const nextMsgId = () => `bm${++msgCounter}`;

/**
 * The Brain — answersDoc's query node. Its knowledge basis is whatever is
 * WIRED to it: direct chips, typed hubs, the Everything hub. Text nodes add
 * ephemeral prompt context. This is the visual face of the Query webhook.
 */
function BrainNodeInner({ id, data, selected }: NodeProps) {
  const d = data as BrainData;
  const {
    board,
    brainMessages,
    addBrainMessage,
    updateBrainMessage,
    resolveBrainScope,
    updateBoardNodeData,
    resizeBoardNode,
    setBrainBusy
  } = useBoard();
  const { openViewer } = useRag();
  const { getViewport, fitView } = useReactFlow();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  /** False once we learn MAI-Transcribe isn't configured → use Web Speech. */
  const [maiMode, setMaiMode] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<any>(null);
  const wavRef = useRef<WavRecorder | null>(null);
  /** Composer text at the moment dictation started — interim results append to it. */
  const dictBaseRef = useRef('');

  const messages = brainMessages[id] ?? [];
  const scope = resolveBrainScope(id);

  // Auto-grow the composer as text fills it (capped; overflow scrolls).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  }, [question]);

  /**
   * Cycle the brain through three sizes:
   * default (400×480) → half-screen → READING MODE (near-fullscreen, for
   * reading long answers/charts like a doc) → back to default.
   * Each step re-frames the viewport onto the brain so it fills the screen.
   */
  const sizeMode: 'default' | 'half' | 'full' =
    (d.sizeMode as any) ?? (d.expanded ? 'half' : 'default');

  function cycleSize() {
    const { zoom } = getViewport();
    const px = (fw: number, fh: number) => ({
      w: Math.round((window.innerWidth * fw) / zoom),
      h: Math.round((window.innerHeight * fh) / zoom)
    });
    if (sizeMode === 'default') {
      const { w, h } = px(0.48, 0.82);
      resizeBoardNode(id, w, h, { sizeMode: 'half', expanded: true });
    } else if (sizeMode === 'half') {
      const { w, h } = px(0.92, 0.9);
      resizeBoardNode(id, w, h, { sizeMode: 'full', expanded: true });
    } else {
      resizeBoardNode(id, 400, 480, { sizeMode: 'default', expanded: false });
    }
    // Re-frame after the node re-renders at its new dimensions.
    setTimeout(
      () => fitView({ nodes: [{ id }], duration: 420, padding: 0.04, maxZoom: 1.2 }),
      30
    );
  }
  const modelId = (d.modelId as string) ?? BOARD_DEFAULT_MODEL;
  const model = LLM_MODELS.find((m) => m.id === modelId) ?? LLM_MODELS[3];

  function appendToComposer(text: string) {
    if (!text) return;
    setQuestion((q) => (q ? q.trimEnd() + ' ' : '') + text);
  }

  /**
   * Mic dispatcher: MAI-Transcribe (record WAV → high-accuracy transcript,
   * biased toward wired source names) when available; auto-falls back to the
   * browser's Web Speech API if MAI isn't configured.
   */
  async function toggleMic() {
    if (transcribing) return;
    if (!maiMode) return toggleWebSpeech();

    if (listening) {
      // Stop recording → transcribe.
      setListening(false);
      setTranscribing(true);
      try {
        const blob = await wavRef.current!.stop();
        const phrases = scope.items.map((i) => i.name);
        appendToComposer(await transcribeAudio(blob, phrases));
      } catch (e: any) {
        if (e?.status === 503 || e?.status === 501) {
          // Not configured yet — drop to free browser dictation for the session.
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
      return;
    }

    // Start recording.
    try {
      const rec = new WavRecorder();
      await rec.start();
      wavRef.current = rec;
      setListening(true);
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
      window.alert('Dictation needs Chrome/Edge/Safari, or configure MAI-Transcribe.');
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
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function send() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    runQuery(q);
  }

  async function runQuery(q: string) {
    if (!q || busy) return;
    if (listening) recRef.current?.stop();
    addBrainMessage(id, {
      id: nextMsgId(),
      role: 'user',
      content: q,
      createdAt: new Date().toISOString()
    });

    setBusy(true);
    setBrainBusy(id, true); // inbound edges pulse while thinking
    startHum(); // muted processing hum (refcounted across brains)
    const asstId = nextMsgId();
    addBrainMessage(id, {
      id: asstId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString()
    });

    // Live RAG: the wired graph IS the scope. Falls back to a clearly
    // labelled mock if the webhook proxy is unreachable (e.g. local dev
    // without MAKE_QUERY_WEBHOOK_URL).
    let content: string;
    let citations;
    try {
      const r = await askBrain(q, scope.items, scope.contextTexts, modelId);
      content = r.answer;
      citations = r.citations;
    } catch {
      const mock = generateMockAnswer(q, scope.items);
      content = `⚠︎ Live RAG unreachable — mock answer.\n\n${mock.content}`;
      citations = mock.citations;
    }

    streamText(
      content,
      (soFar) => updateBrainMessage(id, asstId, { content: soFar }),
      () => {
        updateBrainMessage(id, asstId, { citations });
        setBusy(false);
        setBrainBusy(id, false);
        stopHum();
        playChime(); // the answer landed
      }
    );
  }

  /**
   * Citation → canvas: hovering a citation chip pulses the exact source
   * piece on the board — the text visibly points back at the physical
   * object that proved it.
   */
  function pulseSource(mediaId: string, on: boolean) {
    for (const n of board.nodes) {
      if (n.type === 'chip' && n.data.mediaId === mediaId && !!n.data.pulse !== on)
        updateBoardNodeData(n.id, { pulse: on });
    }
  }

  return (
    <div className="relative h-full w-full">
      <NodeResizer
        minWidth={340}
        minHeight={300}
        isVisible={selected}
        lineClassName="!border-accent/40"
        handleClassName="!h-2.5 !w-2.5 !rounded-[3px] !border-accent !bg-card"
      />
      <div
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-[20px] bg-card',
          'shadow-[0_2px_6px_rgb(0_0_0/0.05),0_18px_50px_rgb(0_0_0/0.10)]',
          'dark:ring-1 dark:ring-white/[0.08]',
          selected && 'ring-2 ring-accent/60 dark:ring-accent/60'
        )}
      >
        {/* header */}
        <div className="flex shrink-0 items-center gap-2.5 bg-gradient-to-r from-indigo-500/[0.07] to-violet-500/[0.10] px-3.5 py-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_2px_10px_hsl(var(--accent)/0.45)]">
            <Boxes className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold tracking-tight">
              {d.name}
            </div>
            <div className="text-[10.5px] text-muted-foreground/70">
              {scope.everything
                ? 'Everything in project'
                : `${scope.items.length} source${scope.items.length === 1 ? '' : 's'} wired`}
              {scope.contextTexts.length > 0 && ` · ${scope.contextTexts.length} note`}
            </div>
          </div>
          <button
            onClick={cycleSize}
            title={
              sizeMode === 'default'
                ? 'Expand to half screen'
                : sizeMode === 'half'
                  ? 'Reading mode (full screen)'
                  : 'Restore size'
            }
            className="nodrag flex h-6 w-6 items-center justify-center rounded-[8px] text-muted-foreground/70 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]"
          >
            {sizeMode === 'default' ? (
              <Maximize2 className="h-3.5 w-3.5" />
            ) : sizeMode === 'half' ? (
              <BookOpen className="h-3.5 w-3.5" />
            ) : (
              <Minimize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              scope.items.length > 0 ? 'bg-emerald-500' : 'bg-amber-400'
            )}
          />
        </div>

      {/* messages */}
      <div
        ref={scrollRef}
        className={cn(
          'nodrag nowheel select-text flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto py-3',
          // Reading mode: doc-like centered measure instead of full-bleed lines.
          sizeMode === 'full'
            ? 'px-[max(1.5rem,calc((100%-760px)/2))]'
            : 'px-3.5'
        )}
      >
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-4 text-center">
            {scope.items.length === 0 ? (
              <>
                <Unplug className="h-5 w-5 text-muted-foreground/40" />
                <p className="max-w-[280px] text-[13px] leading-relaxed text-muted-foreground/70">
                  Nothing wired yet — connect a chip, a hub, or the Everything
                  hub to give this brain its knowledge basis.
                </p>
              </>
            ) : (
              <p className="max-w-[280px] text-[13px] leading-relaxed text-muted-foreground/70">
                Ask anything — answers come only from the {scope.items.length}{' '}
                wired source{scope.items.length === 1 ? '' : 's'}, with
                citations.
              </p>
            )}
          </div>
        )}
        {messages.map((m) => (
          <BrainMessage
            key={m.id}
            m={m}
            onCitation={openViewer}
            onCiteHover={pulseSource}
          />
        ))}
      </div>

      {/* composer */}
      <div className="shrink-0 px-3 pb-3">
        <div className="nodrag flex items-end gap-1.5 rounded-[14px] bg-[hsl(240_14%_96.5%)] px-2.5 py-1.5 dark:bg-white/[0.05]">
          <textarea
            ref={taRef}
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
            className="max-h-44 min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[14px] outline-none placeholder:text-muted-foreground/50"
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
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] transition-all',
              listening
                ? 'bg-red-500 text-white shadow-[0_2px_10px_rgb(239_68_68/0.5)] animate-pulse'
                : 'text-muted-foreground/60 hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.06]'
            )}
          >
            {transcribing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={send}
            disabled={!question.trim() || busy}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] transition-all',
              question.trim() && !busy
                ? 'bg-accent text-white shadow-[0_2px_8px_hsl(var(--accent)/0.4)]'
                : 'bg-black/[0.05] text-muted-foreground/40 dark:bg-white/[0.06]'
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* tools + model picker */}
        <div className="mt-1.5 flex items-center justify-between px-1">
          <div className="flex items-center gap-1">
            {/* Tools dropdown — Poppy-style grounded actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={busy || scope.items.length === 0}
                  className="nodrag flex items-center gap-1.5 rounded-full bg-accent/[0.07] px-2.5 py-1 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/[0.13] disabled:opacity-40"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  Tools
                  <ChevronUp className="h-2.5 w-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                {BRAIN_TOOLS.map((t) => {
                  const TIcon = t.icon;
                  return (
                    <DropdownMenuItem
                      key={t.label}
                      onClick={() => runQuery(t.prompt)}
                      className="gap-3 py-2.5"
                    >
                      <TIcon className="h-4 w-4 text-foreground/70" />
                      <span className="text-[13.5px] font-medium">{t.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="nodrag flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground/80 transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    PROVIDER_META[model.provider].dot
                  )}
                />
                {model.label}
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {LLM_MODELS.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => updateBoardNodeData(id, { modelId: m.id })}
                  className="gap-2.5"
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      PROVIDER_META[m.provider].dot
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium">
                      {m.label}
                    </span>
                    <span className="block text-[10.5px] text-muted-foreground">
                      {m.blurb}
                      {m.provider !== 'gemini' && ' · routes to Gemini for now'}
                    </span>
                  </span>
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 text-accent',
                      m.id === modelId ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground/40">
            cited answers only
          </span>
        </div>
      </div>

      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3.5 !w-3.5 !border-2 !border-card !bg-accent"
      />
    </div>
  );
}

function BrainMessage({
  m,
  onCitation,
  onCiteHover
}: {
  m: ChatMessage;
  onCitation: (c: any) => void;
  onCiteHover: (mediaId: string, on: boolean) => void;
}) {
  if (m.role === 'user') {
    return (
      <div className="max-w-[88%] self-end whitespace-pre-wrap rounded-[14px] rounded-br-[5px] bg-accent px-3.5 py-2 text-[14px] leading-relaxed text-white shadow-[0_2px_8px_hsl(var(--accent)/0.3)]">
        {m.content}
      </div>
    );
  }
  return (
    <div className="self-start">
      {m.content ? (
        <Markdown>{m.content}</Markdown>
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />
      )}
      {m.citations && m.citations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.citations.map((c, i) => (
            <button
              key={i}
              onClick={() => onCitation(c)}
              onMouseEnter={() => onCiteHover(c.mediaId, true)}
              onMouseLeave={() => onCiteHover(c.mediaId, false)}
              className="flex items-center gap-1 rounded-md bg-accent/[0.07] px-2 py-1 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/[0.13]"
            >
              <MediaIcon type={c.type} size="sm" className="h-3.5 w-3.5 rounded" />
              <span className="max-w-[110px] truncate">{c.mediaName}</span>
              <span className="text-accent/60">{c.locator}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const BrainNode = memo(BrainNodeInner);
