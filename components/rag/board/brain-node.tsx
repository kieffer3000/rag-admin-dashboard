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
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { AnswerBody } from '@/components/rag/board/markdown';
import { LLM_MODELS, PROVIDER_META } from '@/lib/rag/models';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  SlidersHorizontal,
  MoreVertical,
  Trash2,
  Download,
  Printer,
  Pencil,
  Quote,
  Sparkles
} from 'lucide-react';
import type { BrainData } from '@/lib/rag/board/types';

/** Header accent presets so several brains in one project read as distinct. */
const BRAIN_COLORS: Record<string, { from: string; to: string; chip: string }> = {
  indigo: { from: 'from-indigo-500/[0.07]', to: 'to-violet-500/[0.10]', chip: 'from-indigo-500 to-violet-600' },
  emerald: { from: 'from-emerald-500/[0.08]', to: 'to-teal-500/[0.10]', chip: 'from-emerald-500 to-teal-600' },
  rose: { from: 'from-rose-500/[0.08]', to: 'to-pink-500/[0.10]', chip: 'from-rose-500 to-pink-600' },
  amber: { from: 'from-amber-500/[0.09]', to: 'to-orange-500/[0.11]', chip: 'from-amber-500 to-orange-600' },
  sky: { from: 'from-sky-500/[0.08]', to: 'to-cyan-500/[0.10]', chip: 'from-sky-500 to-cyan-600' }
};

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

/** Zero-state starter prompts — clicking one populates the composer (it does
 *  not auto-send), so the user can tweak before asking. */
const SUGGESTED_PROMPTS = [
  'Summarize the key points',
  'What are the main contradictions?',
  'Give me 3 actionable takeaways'
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let msgCounter = 9000;
const nextMsgId = () => `bm${++msgCounter}`;

/**
 * The Brain — answersDoc's query node. Its knowledge basis is whatever is
 * WIRED to it: direct chips, typed hubs, the Everything hub. Text nodes add
 * ephemeral prompt context. This is the visual face of the Query webhook.
 */
function BrainNodeInner({ id, data, selected }: NodeProps) {
  const d = data as BrainData & { color?: string; answerMode?: 'cited' | 'hybrid' };
  const {
    board,
    brainMessages,
    addBrainMessage,
    updateBrainMessage,
    clearBrainMessages,
    resolveBrainScope,
    updateBoardNodeData,
    resizeBoardNode,
    setBrainBusy
  } = useBoard();
  const { openViewer } = useRag();
  const { getViewport, fitView } = useReactFlow();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const answerMode: 'cited' | 'hybrid' = d.answerMode ?? 'cited';
  const headerColor = BRAIN_COLORS[d.color ?? 'indigo'] ?? BRAIN_COLORS.indigo;
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
  /** Any cable plugged into this brain's receptacle? */
  const wired = board.edges.some((e) => e.target === id);
  const scopeLabel =
    (scope.everything
      ? 'Everything in project'
      : `${scope.items.length} source${scope.items.length === 1 ? '' : 's'} wired`) +
    (scope.contextTexts.length > 0
      ? ` · ${scope.contextTexts.length} note${scope.contextTexts.length === 1 ? '' : 's'}`
      : '') +
    (scope.guides.length > 0
      ? ` · ${scope.guides.length} guide${scope.guides.length === 1 ? '' : 's'}`
      : '');

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
      const r = await askBrain(
        q,
        scope.items,
        scope.contextTexts,
        modelId,
        answerMode,
        scope.guides
      );
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

  function clearConversation() {
    if (messages.length === 0) return;
    if (window.confirm('Clear this entire conversation? This cannot be undone.'))
      clearBrainMessages(id);
  }

  /** Export the transcript. Markdown (.md), plain text (.txt), Word (.doc via
   *  an HTML blob), or Print → the browser's Save-as-PDF. */
  function exportConversation(format: 'md' | 'txt' | 'doc' | 'pdf') {
    const title = d.name || 'answersDoc Brain';
    const lines = messages
      .filter((m) => m.content)
      .map((m) => {
        if (m.role === 'user') return `**You:** ${m.content}`;
        const cites = m.citations?.length
          ? '\n\n_Sources: ' +
            m.citations.map((c) => `${c.mediaName} (${c.locator})`).join(', ') +
            '_'
          : '';
        return `**${title}:** ${m.content}${cites}`;
      });

    if (format === 'pdf') {
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(
        `<html><head><title>${title}</title><meta charset="utf-8">` +
          `<style>body{font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:40px auto;padding:0 24px;color:#1a1a2e}h1{font-size:20px}.u{font-weight:600;color:#4f46e5;margin-top:18px}.a{margin:6px 0 4px}.s{color:#666;font-size:12px}</style></head><body>` +
          `<h1>${escapeHtml(title)}</h1>` +
          messages
            .filter((m) => m.content)
            .map((m) =>
              m.role === 'user'
                ? `<p class="u">You: ${escapeHtml(m.content)}</p>`
                : `<p class="a">${escapeHtml(m.content).replace(/\n/g, '<br>')}</p>` +
                  (m.citations?.length
                    ? `<p class="s">Sources: ${m.citations
                        .map((c) => escapeHtml(`${c.mediaName} (${c.locator})`))
                        .join(', ')}</p>`
                    : '')
            )
            .join('') +
          `</body></html>`
      );
      w.document.close();
      setTimeout(() => w.print(), 300);
      return;
    }

    let blob: Blob;
    let ext = format;
    if (format === 'doc') {
      const html =
        `<html><head><meta charset="utf-8"></head><body><h2>${escapeHtml(
          title
        )}</h2>` +
        messages
          .filter((m) => m.content)
          .map(
            (m) =>
              `<p><b>${m.role === 'user' ? 'You' : escapeHtml(title)}:</b> ${escapeHtml(
                m.content
              ).replace(/\n/g, '<br>')}</p>`
          )
          .join('') +
        `</body></html>`;
      blob = new Blob([html], { type: 'application/msword' });
    } else {
      const text =
        format === 'md'
          ? `# ${title}\n\n${lines.join('\n\n')}`
          : `${title}\n\n` +
            messages
              .filter((m) => m.content)
              .map(
                (m) => `${m.role === 'user' ? 'You' : title}: ${m.content}`
              )
              .join('\n\n');
      blob = new Blob([text], {
        type: format === 'md' ? 'text/markdown' : 'text/plain'
      });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\w-]+/g, '_')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="relative h-full w-full">
      <NodeResizer
        minWidth={340}
        minHeight={300}
        isVisible={selected}
        lineClassName="!border-accent/30"
        // Frosted-glass grips, not generic blue squares.
        handleClassName="!h-3 !w-3 !rounded-full !border !border-white/70 !bg-white/60 !shadow-[0_1px_3px_rgb(0_0_0/0.25)] !backdrop-blur-md"
      />
      <div
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-[20px] bg-card',
          // The brain is the destination — it sits physically ABOVE the
          // sources: a tight contact shadow + a wide, soft ambient one.
          'shadow-[0_1px_2px_rgb(0_0_0/0.10),0_8px_16px_rgb(0_0_0/0.10),0_30px_64px_-12px_rgb(0_0_0/0.22)]',
          'dark:ring-1 dark:ring-white/[0.08]',
          selected && 'ring-2 ring-accent/60 dark:ring-accent/60'
        )}
      >
        {/* header */}
        <div
          className={cn(
            'flex shrink-0 items-center gap-2.5 bg-gradient-to-r px-3.5 py-2.5',
            headerColor.from,
            headerColor.to
          )}
        >
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br text-white shadow-[0_2px_10px_hsl(var(--accent)/0.45)]',
              headerColor.chip
            )}
          >
            <Boxes className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            {renaming ? (
              <input
                autoFocus
                defaultValue={d.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) updateBoardNodeData(id, { name: v });
                  setRenaming(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                className="nodrag w-full rounded-md bg-white/70 px-1.5 py-0.5 text-[13px] font-semibold tracking-tight outline-none ring-1 ring-accent/40 dark:bg-white/10"
              />
            ) : (
              <div
                title="Double-click to rename"
                onDoubleClick={() => setRenaming(true)}
                className="cursor-text truncate text-[13px] font-semibold tracking-tight"
              >
                {d.name}
              </div>
            )}
            {/* Live scope readout — a hardware-style pill that POPS whenever the
                wired-source count changes (key remounts → re-runs the pop). */}
            <span
              key={scopeLabel}
              className="mt-0.5 inline-flex animate-count-pop items-center gap-1 rounded-full bg-accent/[0.08] py-0.5 pl-1 pr-1.5 text-[10px] font-medium text-accent/90"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  scope.items.length > 0 || scope.everything
                    ? 'bg-emerald-500'
                    : 'bg-amber-400'
                )}
              />
              {scopeLabel}
            </span>
          </div>
          {/* recolor — distinguish several brains in one project */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="Header colour"
                className="nodrag flex h-6 w-6 items-center justify-center rounded-[8px] text-muted-foreground/70 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]"
              >
                <span
                  className={cn(
                    'h-3 w-3 rounded-full bg-gradient-to-br',
                    headerColor.chip
                  )}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="flex gap-1 p-1.5">
              {Object.entries(BRAIN_COLORS).map(([key, v]) => (
                <button
                  key={key}
                  onClick={() => updateBoardNodeData(id, { color: key })}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br ring-1 ring-black/10',
                    v.chip
                  )}
                >
                  {(d.color ?? 'indigo') === key && (
                    <Check className="h-3 w-3 text-white" />
                  )}
                </button>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

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

          {/* actions: rename / clear / export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                title="More"
                className="nodrag flex h-6 w-6 items-center justify-center rounded-[8px] text-muted-foreground/70 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-52 border-black/10 bg-popover/90 shadow-[0_10px_34px_-6px_rgb(0_0_0/0.28)] backdrop-blur-xl dark:border-white/10"
            >
              <DropdownMenuItem onClick={() => setRenaming(true)} className="gap-2.5">
                <Pencil className="h-4 w-4 text-foreground/70" /> Rename brain
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => exportConversation('pdf')}
                disabled={messages.length === 0}
                className="gap-2.5"
              >
                <Printer className="h-4 w-4 text-foreground/70" /> Print / Save PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => exportConversation('doc')}
                disabled={messages.length === 0}
                className="gap-2.5"
              >
                <Download className="h-4 w-4 text-foreground/70" /> Export Word (.doc)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => exportConversation('md')}
                disabled={messages.length === 0}
                className="gap-2.5"
              >
                <Download className="h-4 w-4 text-foreground/70" /> Export Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => exportConversation('txt')}
                disabled={messages.length === 0}
                className="gap-2.5"
              >
                <Download className="h-4 w-4 text-foreground/70" /> Export Text
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
        </div>

      {/* messages */}
      <div
        ref={scrollRef}
        className={cn(
          'nodrag nowheel select-text scroll-brain flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto py-3',
          // Reading mode: a comfortable ~70ch centered measure (not full-bleed)
          // plus larger type — a premium reading column, not a stretched page.
          sizeMode === 'full'
            ? 'px-[max(1.5rem,calc((100%-620px)/2))] py-5'
            : 'px-3.5'
        )}
      >
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/[0.07] text-accent/70">
              {wired ? (
                <Boxes className="h-5 w-5" />
              ) : (
                <Unplug className="h-5 w-5" />
              )}
            </div>
            <p className="max-w-[280px] text-[13.5px] font-medium leading-relaxed text-muted-foreground/80">
              {wired
                ? `Ask your ${scope.items.length || ''} wired source${
                    scope.items.length === 1 ? '' : 's'
                  } anything — every answer is cited.`.replace('  ', ' ')
                : 'Wire sources to begin.'}
            </p>
            {!wired && (
              <p className="-mt-1.5 max-w-[260px] text-[11.5px] leading-relaxed text-muted-foreground/55">
                Drag a wire from a chip, a box, or the Everything hub into this
                brain. You can still draft a question below.
              </p>
            )}
            {/* suggested starter prompts — fill the composer (don't auto-send) */}
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setQuestion(p);
                    taRef.current?.focus();
                  }}
                  className="nodrag rounded-full border border-[rgb(var(--hairline)/0.18)] bg-card px-3 py-1 text-[11.5px] font-medium text-muted-foreground/80 transition-all hover:-translate-y-px hover:border-accent/40 hover:text-accent hover:shadow-sm"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <BrainMessage
            key={m.id}
            m={m}
            large={sizeMode === 'full'}
            onCitation={openViewer}
            onCiteHover={pulseSource}
          />
        ))}
      </div>

      {/* composer */}
      <div className="shrink-0 px-3 pb-3">
        {/* a physical indentation that lights up when you click into it */}
        <div className="nodrag flex items-end gap-1.5 rounded-[14px] bg-[hsl(240_14%_96.5%)] px-2.5 py-1.5 shadow-[inset_0_1px_3px_rgb(0_0_0/0.07)] ring-1 ring-black/[0.04] transition-shadow focus-within:ring-2 focus-within:ring-accent/45 dark:bg-white/[0.05] dark:shadow-[inset_0_1px_3px_rgb(0_0_0/0.3)] dark:ring-white/[0.05]">
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
                  className="nodrag flex items-center gap-1.5 rounded-full bg-accent/[0.10] px-2.5 py-1 text-[11.5px] font-medium text-accent shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-accent/15 transition-all hover:bg-accent/[0.16] hover:shadow-sm disabled:opacity-40"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  Tools
                  <ChevronUp className="h-2.5 w-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                className="w-56 border-black/10 bg-popover/90 shadow-[0_10px_34px_-6px_rgb(0_0_0/0.28)] backdrop-blur-xl dark:border-white/10"
              >
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
          {/* answer mode: cited-only vs cited + the model's own knowledge */}
          <button
            onClick={() =>
              updateBoardNodeData(id, {
                answerMode: answerMode === 'cited' ? 'hybrid' : 'cited'
              })
            }
            title={
              answerMode === 'cited'
                ? 'Cited only — answers strictly from wired sources. Click to let the model add its own knowledge for gaps.'
                : 'Cited + AI — sources first, then the model fills gaps (marked “Beyond your sources”). Click for cited-only.'
            }
            className={cn(
              'nodrag flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors',
              answerMode === 'cited'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-accent/12 text-accent'
            )}
          >
            {answerMode === 'cited' ? (
              <>
                <Quote className="h-2.5 w-2.5" /> Cited only
              </>
            ) : (
              <>
                <Sparkles className="h-2.5 w-2.5" /> Cited + AI
              </>
            )}
          </button>
        </div>
      </div>

      </div>

      {/* input RECEPTACLE — a visible port set into the brain's left edge. It
          comes alive when cables are plugged in (soft inner glow) and pulses
          in time with the wires while the brain is thinking. */}
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          '!h-7 !w-3.5 !-left-1 !rounded-full !border-2 !border-card !bg-gradient-to-b !from-accent !to-violet-600',
          wired
            ? '!shadow-[inset_0_1px_2px_rgb(0_0_0/0.3),0_0_10px_2px_hsl(var(--accent)/0.5)]'
            : '!shadow-[inset_0_1px_2px_rgb(0_0_0/0.3),0_1px_4px_hsl(var(--accent)/0.45)]',
          busy && 'animate-pulse'
        )}
      />
    </div>
  );
}

function BrainMessage({
  m,
  large = false,
  onCitation,
  onCiteHover
}: {
  m: ChatMessage;
  large?: boolean;
  onCitation: (c: any) => void;
  onCiteHover: (mediaId: string, on: boolean) => void;
}) {
  if (m.role === 'user') {
    return (
      // "Gel" bubble: a bright vertical gradient + a translucent white top
      // inner-edge make it pop off the canvas like a premium iMessage bubble.
      <div
        className={cn(
          'max-w-[88%] self-end whitespace-pre-wrap rounded-[14px] rounded-br-[5px] bg-gradient-to-b from-indigo-500 to-indigo-600 px-3.5 py-2 leading-relaxed text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_2px_8px_hsl(var(--accent)/0.32)]',
          large ? 'text-[15px]' : 'text-[14px]'
        )}
      >
        {m.content}
      </div>
    );
  }
  return (
    <div className="self-start">
      {m.content ? (
        <AnswerBody content={m.content} large={large} />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />
      )}
      {m.citations && m.citations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.citations.map((c, i) => (
            // a physical "data tag": a media-colored left edge ties it back to
            // the exact source chip on the board; lifts on hover.
            <button
              key={i}
              onClick={() => onCitation(c)}
              onMouseEnter={() => onCiteHover(c.mediaId, true)}
              onMouseLeave={() => onCiteHover(c.mediaId, false)}
              className="relative flex items-center gap-1.5 overflow-hidden rounded-md bg-black/[0.03] py-1 pl-2.5 pr-2 text-[11.5px] font-medium transition-all hover:-translate-y-px hover:bg-black/[0.06] hover:shadow-sm dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
            >
              <span
                className={cn(
                  'absolute inset-y-0 left-0 w-[2.5px]',
                  MEDIA_TYPES[c.type].solid
                )}
              />
              <MediaIcon type={c.type} size="sm" className="h-3.5 w-3.5 rounded" />
              <span className="max-w-[110px] truncate text-foreground/80">
                {c.mediaName}
              </span>
              <span className="text-muted-foreground/55">{c.locator}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const BrainNode = memo(BrainNodeInner);
