'use client';

import { memo, useRef, useState, useEffect, useCallback } from 'react';
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
import { streamText } from '@/lib/rag/mock-answer';
import { askBrain } from '@/lib/rag/board/ask';
import { startHum, stopHum, playChime } from '@/lib/rag/board/sound';
import { WavRecorder, transcribeAudio } from '@/lib/rag/board/dictation';
import { ChatMessage } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import { SourcesSheet } from '@/components/rag/board/sources-sheet';
import {
  AnswerBody,
  splitGraphicBlocks,
  sanitizeHtml
} from '@/components/rag/board/markdown';
import { LLM_MODELS, PROVIDER_META } from '@/lib/rag/models';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Brain,
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
  Sparkles,
  Volume2,
  Copy,
  FileText,
  Type as TypeIcon,
  AlertTriangle,
  CornerDownRight,
  Archive,
  Zap,
  Search,
  Telescope,
  ThumbsUp,
  ThumbsDown,
  RefreshCw
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

// A unique per-page-load prefix so freshly-created message ids can NEVER
// collide with ids restored from a previously persisted conversation. A
// collision used to make updateBrainMessage patch BOTH the old and the new
// message (it maps by id) → the same answer rendered twice ("duplicate
// answer"). The board node/edge counter is bumped on load, but this message
// counter wasn't, so a reloaded brain's next send reused bm9001/bm9002.
const MSG_SESSION = Math.random().toString(36).slice(2, 8);
let msgCounter = 0;
export const nextMsgId = () => `bm_${MSG_SESSION}_${++msgCounter}`;

/**
 * The Brain — answersDoc's query node. Its knowledge basis is whatever is
 * WIRED to it: direct chips, typed hubs, the Everything hub. Text nodes add
 * ephemeral prompt context. This is the visual face of the Query webhook.
 */
/** Last-N verbatim window; older turns get folded into the rolling summary. */
// Keep the last 30 turns (≈15 Q + 15 A) verbatim; fold everything older into the
// rolling summary. Matches the server's HISTORY_MAX_MESSAGES so the verbatim
// window and the summary boundary line up exactly (no gap, no overlap).
const HISTORY_WINDOW = 30;
/** Answers are HTML (charts/tables); the rewriter + summarizer only need words. */
function toPlainText(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function BrainNodeInner({ id, data, selected }: NodeProps) {
  const d = data as BrainData & {
    color?: string;
    answerMode?: 'cited' | 'hybrid';
    speed?: 'fast' | 'detailed' | 'research';
  };
  const {
    board,
    setBoard,
    brainMessages,
    addBrainMessage,
    updateBrainMessage,
    removeBrainMessage,
    clearBrainMessages,
    resolveBrainScope,
    updateBoardNodeData,
    resizeBoardNode,
    setBrainBusy,
    stashBrain,
    setResearchBrainId,
    nextBoardId
  } = useBoard();
  const { openViewer, activeProjectId } = useRag();
  const { getViewport, fitView } = useReactFlow();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const answerMode: 'cited' | 'hybrid' = d.answerMode ?? 'cited';
  // ⚡ Fast (lightning, fewer round-trips) vs 🔍 Detailed (full pipeline).
  // Defaults to Fast and persists with the brain (stays on across sessions).
  const speed: 'fast' | 'detailed' | 'research' = d.speed ?? 'fast';
  const headerColor = BRAIN_COLORS[d.color ?? 'indigo'] ?? BRAIN_COLORS.indigo;
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  /** False once we learn MAI-Transcribe isn't configured → use Web Speech. */
  const [maiMode, setMaiMode] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<any>(null);
  const wavRef = useRef<WavRecorder | null>(null);
  // hard cap a single recording so the mic never runs forever; auto-stops +
  // transcribes what was captured.
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
  /** Message id currently being voiced (spinner on its 🔈 button). */
  const [voicingId, setVoicingId] = useState<string | null>(null);
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
  // Accessibility text size: zooms the whole answer column so low-vision users
  // can read comfortably. Cycles 100% → 115% → 130% → 150% → back. Independent
  // of the size-mode (window dimensions) above. Persisted on the brain.
  const TEXT_STEPS = [1, 1.15, 1.3, 1.5];
  const textScale = (d.textScale as number) ?? 1;
  function cycleTextScale() {
    const i = TEXT_STEPS.indexOf(textScale);
    const next = TEXT_STEPS[(i + 1) % TEXT_STEPS.length] ?? 1.15;
    updateBoardNodeData(id, { textScale: next });
  }

  const modelId = (d.modelId as string) ?? BOARD_DEFAULT_MODEL;
  const model = LLM_MODELS.find((m) => m.id === modelId) ?? LLM_MODELS[3];

  /**
   * Create Voiceover: synthesize the answer via Gemini native TTS (→ /api/voiceover)
   * and play it. Deliberately ephemeral — it does NOT drop a chip on the canvas or
   * re-index the audio as a source. A voiceover is just the spoken form of an answer
   * that already lives in the conversation, so it's regenerable on demand (click 🔈
   * again) and shouldn't clutter the board or the corpus.
   */
  const handleVoiceover = useCallback(
    async (msg: ChatMessage) => {
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
        if (!playUrl) throw new Error('no audio returned');

        // play it now (regenerable, so nothing is persisted)
        try {
          await new Audio(playUrl).play();
        } catch {
          /* autoplay may be blocked; clicking 🔈 again re-synthesizes and plays */
        }
      } catch {
        /* surfaced via the button returning to idle; artifact text is regenerable */
      } finally {
        setVoicingId(null);
      }
    },
    [voicingId]
  );

  /**
   * Edit in Text Block: pop the answer out as an editable text node on the
   * canvas — a reusable artifact you can refine and re-wire as context. Places
   * it just below-right of the brain.
   */
  const handleEditInText = useCallback(
    (msg: ChatMessage) => {
      if (!msg.content) return;
      const self = board.nodes.find((n) => n.id === id);
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
    },
    [board, id, setBoard, nextBoardId]
  );

  function appendToComposer(text: string) {
    if (!text) return;
    setQuestion((q) => (q ? q.trimEnd() + ' ' : '') + text);
  }

  /**
   * Mic dispatcher: MAI-Transcribe (record WAV → high-accuracy transcript,
   * biased toward wired source names) when available; auto-falls back to the
   * browser's Web Speech API if MAI isn't configured.
   */
  /** Stop the active recording and transcribe what was captured. Idempotent —
   *  claims `wavRef` up front so the 2-min cap and a manual tap can't double-run.
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
      const phrases = scope.items.map((i) => i.name);
      appendToComposer(await transcribeAudio(blob, phrases));
      if (auto) {
        window.alert(
          'Reached the 2-minute recording limit — I stopped and saved what you said. Tap the mic to record more and keep transcribing.'
        );
      }
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
  }

  async function toggleMic() {
    if (transcribing) return;
    if (!maiMode) return toggleWebSpeech();
    if (wavRef.current) return finishMaiRecording(false);

    // Start recording.
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // instant pin (no smooth) so streaming doesn't jitter; only follow when the
    // user is already near the bottom, so scrolling up to read isn't overridden.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // never let the recording cap/warn timers fire after the card unmounts
  useEffect(
    () => () => {
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    },
    []
  );

  // Wheel over the brain: pinch / ctrl-wheel ALWAYS zooms the canvas (we don't
  // touch it); a plain wheel scrolls the chat ONLY when there's overflow, and
  // we stop it (NATIVELY — a React synthetic stopPropagation can't) from also
  // reaching React Flow's zoom. No overflow → it falls through and zooms too.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch / zoom gesture → let the canvas zoom
      if (el.scrollHeight > el.clientHeight + 1) e.stopPropagation();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Rolling summary: once the conversation exceeds the verbatim window, fold the
  // messages that scrolled out into a running summary (via /api/summarize → Make)
  // and store it on the brain so far-back facts survive for the query rewrite.
  // Stored in brain data → persists with the conversation, cleared automatically
  // when the conversation is cleared.
  async function maybeUpdateSummary(q: string, answer: string) {
    const all = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: q },
      { role: 'assistant' as const, content: answer }
    ];
    if (all.length <= HISTORY_WINDOW) return;
    const through = (d.summarizedThrough as number) ?? 0;
    const foldEnd = all.length - HISTORY_WINDOW;
    if (foldEnd <= through) return;
    const toFold = all
      .slice(through, foldEnd)
      .filter((m) => m.content && m.content.trim())
      .map((m) => ({ role: m.role, content: toPlainText(m.content).slice(0, 800) }));
    if (toFold.length === 0) return;
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: (d.summary as string) ?? '', messages: toFold })
      });
      const j = await res.json();
      if (typeof j.summary === 'string') {
        updateBoardNodeData(id, { summary: j.summary, summarizedThrough: foldEnd });
      }
    } catch {
      /* keep the existing summary on failure */
    }
  }

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
    let citations: Awaited<ReturnType<typeof askBrain>>['citations'] = [];
    let noMatch = false;
    let suggestedQuestions: string[] = [];
    try {
      // Recent turns → lets the server rewrite a follow-up ("his street")
      // into a standalone retrieval query. Strip HTML (answers are HTML for
      // charts) to plain text, truncate, cap at the last 30 messages.
      const history = messages
        .filter((mm) => mm.content && mm.content.trim())
        .slice(-HISTORY_WINDOW)
        .map((mm) => ({
          role: mm.role,
          content: mm.content
            // drop this turn's own footnote refs + [n] citation markers — they
            // point at a DIFFERENT turn's sources and only confuse follow-ups
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
        (d.summary as string) ?? '',
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
      // Honest failure — NEVER fabricate a "mock answer" in a citation app.
      content =
        'The answer service is temporarily unreachable. Please try again in a moment.';
      citations = [];
      noMatch = true;
    }

    streamText(
      content,
      (soFar) => updateBrainMessage(id, asstId, { content: soFar, streaming: true }),
      () => {
        updateBrainMessage(id, asstId, {
          citations,
          noMatch,
          suggestedQuestions,
          streaming: false
        });
        setBusy(false);
        setBrainBusy(id, false);
        stopHum();
        playChime(); // the answer landed
        void maybeUpdateSummary(q, content); // fold far-back turns (long convos)
        // long-term memory: remember this Q&A across sessions (skip no-match)
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
    if (window.confirm('Clear this entire conversation? This cannot be undone.')) {
      clearBrainMessages(id);
      // drop the rolling summary too — it's part of this conversation
      updateBoardNodeData(id, { summary: '', summarizedThrough: 0 });
    }
  }

  /** Export the transcript. Markdown (.md), plain text (.txt), Word (.doc via
   *  an HTML blob), or Print → the browser's Save-as-PDF. */
  function exportConversation(format: 'md' | 'txt' | 'doc' | 'pdf') {
    const title = d.name || 'answersDoc Brain';
    // The already-rendered chart/diagram SVGs, in DOM (= message) order, so the
    // export shows real charts instead of raw ```chart JSON.
    const graphics = scrollRef.current
      ? Array.from(scrollRef.current.querySelectorAll('[data-graphic]'))
      : [];
    let gi = 0;

    // Assistant answer → HTML: prose rendered as HTML, each graphic block
    // replaced by its captured rendered SVG.
    const answerHtml = (content: string): string =>
      splitGraphicBlocks(content)
        .map((s) => {
          if (s.type === 'prose')
            return s.text.trim() ? sanitizeHtml(s.text) : '';
          // Use the captured rendered SVG if present…
          const el = graphics[gi++] as HTMLElement | undefined;
          if (el) return el.outerHTML;
          // …otherwise fall back to a data table for charts (never raw code).
          if (s.type === 'chart') {
            try {
              const spec = JSON.parse(s.text);
              const rows = (spec.data ?? [])
                .map(
                  (d: Record<string, unknown>) =>
                    `<tr><td>${escapeHtml(String(d.name ?? ''))}</td>` +
                    Object.entries(d)
                      .filter(([k]) => k !== 'name')
                      .map(([, v]) => `<td>${escapeHtml(String(v))}</td>`)
                      .join('') +
                    `</tr>`
                )
                .join('');
              return `<figure><figcaption>${escapeHtml(
                spec.title ?? 'Chart'
              )}</figcaption><table>${rows}</table></figure>`;
            } catch {
              return '';
            }
          }
          return '';
        })
        .join('\n');

    // Assistant answer → plain text (charts collapse to a data line).
    const answerText = (content: string): string =>
      splitGraphicBlocks(content)
        .map((s) => {
          if (s.type === 'prose')
            return s.text
              .replace(/<[^>]+>/g, '')
              .replace(/&[a-z]+;/gi, ' ')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
          if (s.type === 'chart') {
            try {
              const spec = JSON.parse(s.text);
              const rows = (spec.data ?? [])
                .map(
                  (d: Record<string, unknown>) =>
                    `${d.name}: ${Object.entries(d)
                      .filter(([k]) => k !== 'name')
                      .map(([, v]) => v)
                      .join(', ')}`
                )
                .join('; ');
              return `[Chart: ${spec.title ?? spec.type}] ${rows}`;
            } catch {
              return s.text;
            }
          }
          return '[Diagram]';
        })
        .filter(Boolean)
        .join('\n\n');

    if (format === 'pdf' || format === 'doc') {
      const body =
        `<h1>${escapeHtml(title)}</h1>` +
        messages
          .filter((m) => m.content)
          .map((m) =>
            m.role === 'user'
              ? `<p class="u">You: ${escapeHtml(m.content)}</p>`
              : `<div class="a">${answerHtml(m.content)}</div>` +
                (m.citations?.length
                  ? `<p class="s">Sources: ${m.citations
                      .map((c) => escapeHtml(`${c.mediaName} (${c.locator})`))
                      .join(', ')}</p>`
                  : '')
          )
          .join('');
      const doc =
        `<html><head><title>${escapeHtml(title)}</title><meta charset="utf-8">` +
        `<style>body{font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#1a1a2e}` +
        `h1{font-size:20px}.u{font-weight:600;color:#4f46e5;margin-top:18px}.a{margin:6px 0 4px}.s{color:#666;font-size:12px}` +
        `svg{max-width:100%;height:auto}figure{border:1px solid #eee;border-radius:10px;padding:10px;margin:10px 0}figcaption{font-weight:600;margin-bottom:6px}` +
        `mark{background:#fef08a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}</style></head><body>` +
        body +
        `</body></html>`;
      if (format === 'pdf') {
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(doc);
        w.document.close();
        setTimeout(() => w.print(), 400);
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(
        new Blob([doc], { type: 'application/msword' })
      );
      a.download = `${title.replace(/[^\w-]+/g, '_')}.doc`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }

    // md / txt
    const text =
      `${format === 'md' ? '# ' : ''}${title}\n\n` +
      messages
        .filter((m) => m.content)
        .map((m) =>
          m.role === 'user'
            ? `${format === 'md' ? '**You:**' : 'You:'} ${m.content}`
            : `${answerText(m.content)}${
                m.citations?.length
                  ? `\n\n${format === 'md' ? '_Sources: ' : 'Sources: '}${m.citations
                      .map((c) => `${c.mediaName} (${c.locator})`)
                      .join(', ')}${format === 'md' ? '_' : ''}`
                  : ''
              }`
        )
        .join('\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([text], {
        type: format === 'md' ? 'text/markdown' : 'text/plain'
      })
    );
    a.download = `${title.replace(/[^\w-]+/g, '_')}.${format}`;
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
            <Brain className="h-4 w-4" />
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

          {/* Research Mode — sources are wired; go full-screen, distraction-free */}
          <button
            onClick={() => setResearchBrainId(id)}
            title="Research mode — full-screen, distraction-free (sources stay wired)"
            className="nodrag flex h-6 items-center justify-center gap-1 rounded-full bg-accent/10 px-2 text-accent ring-1 ring-accent/20 transition-all hover:bg-accent hover:text-white hover:shadow-[0_2px_8px_hsl(var(--accent)/0.4)]"
          >
            <span className="text-[12px] font-extrabold leading-none">R</span>
          </button>

          {/* accessibility text size — cycles the answer column's zoom */}
          <button
            onClick={cycleTextScale}
            title={`Text size: ${Math.round(textScale * 100)}% — click to enlarge (for easier reading)`}
            className={cn(
              'nodrag flex h-6 items-center justify-center gap-0.5 rounded-[8px] px-1 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.07]',
              textScale > 1
                ? 'text-accent'
                : 'text-muted-foreground/70 hover:text-foreground'
            )}
          >
            <TypeIcon className="h-3.5 w-3.5" />
            <span className="text-[9px] font-bold tabular-nums">
              {textScale > 1 ? `${Math.round(textScale * 100)}` : 'A'}
            </span>
          </button>

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
              <DropdownMenuItem onClick={() => stashBrain(id)} className="gap-2.5">
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
        </div>

      {/* messages */}
      <div
        ref={scrollRef}
        // `zoom` scales the whole answer column (text, tables, charts, spacing)
        // for the accessibility text-size control, so larger type genuinely
        // takes more room — exactly what low-vision reading needs.
        style={textScale !== 1 ? { zoom: textScale } : undefined}
        // Wheel handling lives in a NATIVE listener (effect above) so pinch/zoom
        // still works over the brain while a plain wheel scrolls a long chat.
        className={cn(
          // NOT `nodrag`: the message area is a drag surface so the brain can be
          // grabbed from its whole body, not just the header. The answer text
          // bubbles below opt back out (nodrag + select-text) so reading and
          // selecting still work; buttons click fine (a click isn't a drag).
          'scroll-brain flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto py-3',
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
                <Brain className="h-5 w-5" />
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
        {messages.map((m, mi) => (
          <BrainMessage
            key={m.id}
            m={m}
            large={sizeMode === 'full'}
            onCitation={openViewer}
            onCiteHover={pulseSource}
            modelLabel={model.label}
            onVoiceover={handleVoiceover}
            voicing={voicingId === m.id}
            onEdit={handleEditInText}
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
            onDelete={() => removeBrainMessage(id, m.id)}
            busy={busy}
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
                ? recWarn
                  ? 'recording-warn text-white'
                  : 'bg-red-500 text-white shadow-[0_2px_10px_rgb(239_68_68/0.5)] animate-pulse'
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

            {/* ⚡/🔍 speed: Fast = lightning (fewer round-trips, no extra LLM
                passes); Normal = full pipeline (internal value stays 'detailed'
                so the Make router still matches). Persists with the brain. */}
            <div
              role="group"
              aria-label="Answer speed"
              className="nodrag flex items-center rounded-full bg-black/[0.05] p-0.5 dark:bg-white/[0.06]"
            >
              <button
                onClick={() => updateBoardNodeData(id, { speed: 'fast' })}
                title="Fast — a quick, lightning answer (fewer steps, no per-claim citations or extra checks)."
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-[15px] font-semibold uppercase tracking-wide transition-colors',
                  speed === 'fast'
                    ? 'bg-amber-400 text-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]'
                    : 'text-muted-foreground/70 hover:text-foreground'
                )}
              >
                <Zap className="h-[15px] w-[15px]" /> Fast
              </button>
              <button
                onClick={() => updateBoardNodeData(id, { speed: 'detailed' })}
                title="Normal — the full pipeline: query expansion and per-claim citations. Slower, more thorough."
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-[15px] font-semibold uppercase tracking-wide transition-colors',
                  speed === 'detailed'
                    ? 'bg-accent text-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]'
                    : 'text-muted-foreground/70 hover:text-foreground'
                )}
              >
                <Search className="h-[15px] w-[15px]" /> Normal
              </button>
              <button
                onClick={() => updateBoardNodeData(id, { speed: 'research' })}
                title="Research — the deepest answer: the full pipeline plus a heavier reasoning model that organizes findings across many sources and bridges to related concepts. Slowest, most thorough."
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-[15px] font-semibold uppercase tracking-wide transition-colors',
                  speed === 'research'
                    ? 'bg-violet-500 text-white shadow-[0_1px_3px_rgb(0_0_0/0.18)]'
                    : 'text-muted-foreground/70 hover:text-foreground'
                )}
              >
                <Telescope className="h-[15px] w-[15px]" /> Research
              </button>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="nodrag flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[16px] font-medium text-muted-foreground/80 transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    PROVIDER_META[model.provider].dot
                  )}
                />
                {model.label}
                <ChevronDown className="h-[15px] w-[15px]" />
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
              'nodrag flex items-center gap-1 rounded-full px-2 py-0.5 text-[15px] font-semibold uppercase tracking-wide transition-colors',
              answerMode === 'cited'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-accent/12 text-accent'
            )}
          >
            {answerMode === 'cited' ? (
              <>
                <Quote className="h-[15px] w-[15px]" /> Cited only
              </>
            ) : (
              <>
                <Sparkles className="h-[15px] w-[15px]" /> Cited + AI
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

export function BrainMessage({
  m,
  large = false,
  onCitation,
  onCiteHover,
  modelLabel,
  onVoiceover,
  voicing = false,
  onEdit,
  onAsk,
  onRewrite,
  onDelete,
  busy = false
}: {
  m: ChatMessage;
  large?: boolean;
  onCitation: (c: any, highlight?: string) => void;
  onCiteHover: (mediaId: string, on: boolean) => void;
  modelLabel?: string;
  onVoiceover?: (m: ChatMessage) => void;
  voicing?: boolean;
  onEdit?: (m: ChatMessage) => void;
  onAsk?: (q: string) => void;
  /** Re-ask the question that produced this answer (Perplexity "Rewrite"). */
  onRewrite?: () => void;
  /** Delete this answer (and its question) from the conversation. */
  onDelete?: () => void;
  busy?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copyMenu, setCopyMenu] = useState(false);
  const [copied, setCopied] = useState<'rich' | 'plain' | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const copyRich = async () => {
    const el = bodyRef.current;
    if (!el) return;
    const html = el.innerHTML;
    const text = el.innerText;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })
      ]);
    } catch {
      await navigator.clipboard.writeText(text); // fallback if ClipboardItem unsupported
    }
    setCopied('rich');
    setTimeout(() => setCopied(null), 1400);
    setCopyMenu(false);
  };

  const copyPlain = async () => {
    const text = bodyRef.current?.innerText ?? m.content;
    await navigator.clipboard.writeText(text);
    setCopied('plain');
    setTimeout(() => setCopied(null), 1400);
    setCopyMenu(false);
  };
  if (m.role === 'user') {
    return (
      // "Gel" bubble: a bright vertical gradient + a translucent white top
      // inner-edge make it pop off the canvas like a premium iMessage bubble.
      <div
        className={cn(
          'nodrag select-text max-w-[88%] self-end whitespace-pre-wrap rounded-[14px] rounded-br-[5px] bg-gradient-to-b from-indigo-500 to-indigo-600 px-3.5 py-2 leading-relaxed text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_2px_8px_hsl(var(--accent)/0.32)]',
          large ? 'text-[15px]' : 'text-[14px]'
        )}
      >
        {m.content}
      </div>
    );
  }
  return (
    <div className="group self-start">
      {m.content ? (
        <div
          ref={bodyRef}
          className="nodrag select-text"
          onClick={(e) => {
            // inline footnote ref clicked → open that footnote's source panel
            const ref = (e.target as HTMLElement).closest('.fn-ref');
            if (!ref) return;
            const n = parseInt(ref.getAttribute('data-fn') ?? '', 10);
            const c = m.citations?.[n - 1];
            if (c) onCitation(c, m.content);
          }}
          onMouseOver={(e) => {
            const ref = (e.target as HTMLElement).closest('.fn-ref');
            if (!ref) return;
            const n = parseInt(ref.getAttribute('data-fn') ?? '', 10);
            const c = m.citations?.[n - 1];
            if (c) onCiteHover(c.mediaId, true);
          }}
          onMouseOut={(e) => {
            const ref = (e.target as HTMLElement).closest('.fn-ref');
            if (!ref) return;
            const n = parseInt(ref.getAttribute('data-fn') ?? '', 10);
            const c = m.citations?.[n - 1];
            if (c) onCiteHover(c.mediaId, false);
          }}
        >
          <AnswerBody content={m.content} large={large} streaming={m.streaming} />
        </div>
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/50" />
      )}
      {m.content && m.noMatch && (
        // no-match honesty guardrail: retrieval was weak/empty, so the answer
        // may not be grounded in the wired sources.
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-50 px-2.5 py-2 text-[12px] leading-snug text-amber-900 dark:border-amber-400/25 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Weak match in your wired sources — this may not be grounded in your
            knowledge base. Wire more sources, rephrase, or switch the brain to
            Cited + AI.
          </span>
        </div>
      )}
      {m.content && (
        // footer: stacked sources pill + model attribution + per-message actions
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {m.citations && m.citations.length > 0 && (
            <button
              onClick={() => setSourcesOpen((v) => !v)}
              title={`${m.citations.length} source${m.citations.length === 1 ? '' : 's'} — click to ${sourcesOpen ? 'hide' : 'show'}`}
              className={cn(
                'nodrag flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12px] font-medium transition-colors',
                sourcesOpen
                  ? 'bg-accent/12 text-accent'
                  : 'bg-black/[0.04] text-foreground/75 hover:bg-black/[0.07] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]'
              )}
            >
              <span className="flex -space-x-1.5">
                {m.citations.slice(0, 3).map((c, i) => (
                  <MediaIcon
                    key={i}
                    type={c.type}
                    size="sm"
                    className="h-4 w-4 rounded-full ring-2 ring-card"
                  />
                ))}
              </span>
              {m.citations.length} source{m.citations.length === 1 ? '' : 's'}
            </button>
          )}
          {modelLabel && (
            <span className="text-[11px] text-muted-foreground/55">{modelLabel}</span>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {onRewrite && (
              <button
                onClick={() => !busy && onRewrite()}
                disabled={busy}
                title="Rewrite — ask this question again"
                className="nodrag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => onEdit(m)}
                title="Open as editable note"
                className="nodrag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/10 hover:text-accent"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {onVoiceover && (
              <button
                onClick={() => !voicing && onVoiceover(m)}
                disabled={voicing}
                title="Read aloud"
                className="nodrag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-60"
              >
                {voicing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setCopyMenu((v) => !v)}
                title="Copy"
                className="nodrag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/10 hover:text-accent"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              {copyMenu && (
                <>
                  {/* click-away catcher */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setCopyMenu(false)}
                  />
                  <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[rgb(var(--hairline)/0.16)] bg-card p-1 shadow-xl">
                    <button
                      onClick={copyRich}
                      className="nodrag flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/10"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
                      <span className="leading-tight">
                        <span className="block text-[13px] font-semibold">
                          Copy formatted
                        </span>
                        <span className="block text-[11px] text-muted-foreground/70">
                          Keeps headings, bold &amp; links — drops cleanly into docs and editors
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={copyPlain}
                      className="nodrag flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/10"
                    >
                      <TypeIcon className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
                      <span className="leading-tight">
                        <span className="block text-[13px] font-semibold">
                          Copy plain
                        </span>
                        <span className="block text-[11px] text-muted-foreground/70">
                          Strips all styling to bare text — best for posts and quick pastes
                        </span>
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
            <span className="mx-0.5 h-4 w-px bg-[rgb(var(--hairline)/0.2)]" />
            <button
              onClick={() => setFeedback((f) => (f === 'up' ? null : 'up'))}
              title="Good answer"
              className={cn(
                'nodrag flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                feedback === 'up'
                  ? 'text-emerald-500'
                  : 'text-muted-foreground/70 hover:bg-accent/10 hover:text-accent'
              )}
            >
              <ThumbsUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => setFeedback((f) => (f === 'down' ? null : 'down'))}
              title="Needs work"
              className={cn(
                'nodrag flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                feedback === 'down'
                  ? 'text-rose-500'
                  : 'text-muted-foreground/70 hover:bg-accent/10 hover:text-accent'
              )}
            >
              <ThumbsDown className="h-4 w-4" />
            </button>
            {onDelete && (
              <>
                <span className="mx-0.5 h-4 w-px bg-[rgb(var(--hairline)/0.2)]" />
                <button
                  onClick={() => onDelete()}
                  title="Delete this answer (and its question) from the conversation"
                  className="nodrag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-red-500/10 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {m.citations && m.citations.length > 0 && (
        // Slide-in sources panel (Perplexity-style), opened by the pill above.
        // A row closes the sheet and opens that single source in the viewer.
        <SourcesSheet
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
          citations={m.citations}
          onCitation={(c) => {
            setSourcesOpen(false);
            onCitation(c, m.content);
          }}
        />
      )}
      {m.suggestedQuestions && m.suggestedQuestions.length > 0 && onAsk && (
        // Follow-ups — Perplexity-style labelled section of divider rows.
        <div className="mt-3 border-t border-[rgb(var(--hairline)/0.12)] pt-2">
          <p className="mb-0.5 text-[13px] font-semibold text-foreground/85">
            Follow-ups
          </p>
          <div className="flex flex-col">
            {m.suggestedQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => !busy && onAsk(q)}
                disabled={busy}
                className="nodrag group/sg flex items-start gap-2 border-t border-[rgb(var(--hairline)/0.08)] py-2 text-left text-[13.5px] leading-snug text-foreground/85 transition-colors first:border-t-0 hover:text-accent disabled:opacity-50"
              >
                <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/45 group-hover/sg:text-accent" />
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const BrainNode = memo(BrainNodeInner);
