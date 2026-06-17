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
import { generateMockAnswer, streamText } from '@/lib/rag/mock-answer';
import { askBrain } from '@/lib/rag/board/ask';
import { startHum, stopHum, playChime } from '@/lib/rag/board/sound';
import { WavRecorder, transcribeAudio } from '@/lib/rag/board/dictation';
import { ChatMessage } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
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
  ExternalLink,
  Clock
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
/** Last-N verbatim window; older turns get folded into the rolling summary. */
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
  const d = data as BrainData & { color?: string; answerMode?: 'cited' | 'hybrid' };
  const {
    board,
    setBoard,
    brainMessages,
    addBrainMessage,
    updateBrainMessage,
    clearBrainMessages,
    resolveBrainScope,
    updateBoardNodeData,
    resizeBoardNode,
    setBrainBusy,
    nextBoardId
  } = useBoard();
  const { openViewer, addMedia, updateMedia } = useRag();
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
  /** Message id currently being voiced (spinner on its 🔈 button). */
  const [voicingId, setVoicingId] = useState<string | null>(null);
  /** Session-only audio URLs keyed by the produced audio media id. Never
   *  persisted — WAV bytes would blow the localStorage quota; the artifact's
   *  text is re-indexable so audio is always regenerable on demand. */
  const audioCache = useRef<Map<string, string>>(new Map());
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
   * Create Voiceover: synthesize the answer via Gemini native TTS (→ /api/voiceover),
   * then drop the result onto the canvas as a re-indexable AUDIO chip — the answer
   * text is the embedded content, the audio is the playable artifact. Mirrors the
   * voice-memo flow (addMedia → chip → /api/index). Audio plays immediately and is
   * cached for the session.
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

        const brainName = (d.name as string) || 'Brain';
        const preview = msg.content.replace(/\s+/g, ' ').trim().slice(0, 40);
        const name = `Voiceover — ${brainName} · ${preview}…`;
        const durationLabel = j.seconds
          ? `${Math.floor(j.seconds / 60)}:${String(j.seconds % 60).padStart(2, '0')}`
          : undefined;

        // re-indexable audio artifact: content = the answer text
        const mediaId = addMedia(
          {
            type: 'audio',
            name,
            description: `Voiceover (Gemini TTS · ${j.voice ?? 'Leda'})`,
            date: new Date().toISOString().slice(0, 10),
            content: msg.content,
            source: j.durable ? j.url : undefined,
            durationLabel
          },
          { simulate: false }
        );
        audioCache.current.set(mediaId, playUrl);

        // spawn a chip just to the right of this brain
        const self = board.nodes.find((n) => n.id === id);
        const pos = self
          ? { x: self.position.x + (self.width ?? 380) + 40, y: self.position.y }
          : { x: 0, y: 0 };
        setBoard((prev) => ({
          ...prev,
          nodes: [
            ...prev.nodes,
            {
              id: nextBoardId('chip'),
              type: 'chip',
              position: pos,
              data: { mediaId }
            }
          ]
        }));

        // embed the answer text so the audio piece is retrievable
        fetch('/api/index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: mediaId,
            name,
            type: 'audio',
            text: msg.content
          })
        })
          .then((r) => {
            if (!r.ok) throw new Error();
            updateMedia(mediaId, { status: 'indexed' });
          })
          .catch(() => updateMedia(mediaId, { status: 'failed' }));

        // play it now
        try {
          await new Audio(playUrl).play();
        } catch {
          /* autoplay may be blocked; the chip can still play it */
        }
      } catch {
        /* surfaced via the button returning to idle; artifact text is regenerable */
      } finally {
        setVoicingId(null);
      }
    },
    [voicingId, d.name, board, id, addMedia, updateMedia, setBoard, nextBoardId]
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
    let citations;
    let noMatch = false;
    let suggestedQuestions: string[] = [];
    try {
      // Recent turns → lets the server rewrite a follow-up ("his street")
      // into a standalone retrieval query. Strip HTML (answers are HTML for
      // charts) to plain text, truncate, cap at the last 30 messages.
      const history = messages
        .filter((mm) => mm.content && mm.content.trim())
        .slice(-30)
        .map((mm) => ({
          role: mm.role,
          content: mm.content
            .replace(/<[^>]+>/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500)
        }));
      const r = await askBrain(
        q,
        scope.items,
        scope.contextTexts,
        modelId,
        answerMode,
        scope.guides,
        history,
        (d.summary as string) ?? ''
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
      (soFar) => updateBrainMessage(id, asstId, { content: soFar }),
      () => {
        updateBrainMessage(id, asstId, {
          citations,
          noMatch,
          suggestedQuestions
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
        className={cn(
          // NOT `nodrag`: the message area is a drag surface so the brain can be
          // grabbed from its whole body, not just the header. The answer text
          // bubbles below opt back out (nodrag + select-text) so reading and
          // selecting still work; buttons click fine (a click isn't a drag).
          'nowheel scroll-brain flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto py-3',
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
        {messages.map((m) => (
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
  onCiteHover,
  modelLabel,
  onVoiceover,
  voicing = false,
  onEdit,
  onAsk,
  busy = false
}: {
  m: ChatMessage;
  large?: boolean;
  onCitation: (c: any) => void;
  onCiteHover: (mediaId: string, on: boolean) => void;
  modelLabel?: string;
  onVoiceover?: (m: ChatMessage) => void;
  voicing?: boolean;
  onEdit?: (m: ChatMessage) => void;
  onAsk?: (q: string) => void;
  busy?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copyMenu, setCopyMenu] = useState(false);
  const [copied, setCopied] = useState<'rich' | 'plain' | null>(null);

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
        <div ref={bodyRef} className="nodrag select-text">
          <AnswerBody content={m.content} large={large} />
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
        // footer: model attribution + per-message actions (revealed on hover)
        <div className="mt-1.5 flex items-center gap-2">
          {modelLabel && (
            <span className="text-[11px] text-muted-foreground/55">{modelLabel}</span>
          )}
          <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
          </div>
        </div>
      )}
      {m.citations && m.citations.length > 0 && (
        <div className="mt-2.5 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/45">
            Sources
          </p>
          <div className="flex flex-wrap gap-1.5">
            {m.citations.map((c, i) => {
              // For youtube/audio with a timestamp: clicking opens the URL at
              // the right second. For everything else: opens the source viewer.
              const isJump = !!(c.jumpUrl);
              const handleClick = () => {
                if (isJump && c.jumpUrl) {
                  window.open(c.jumpUrl, '_blank', 'noopener,noreferrer');
                } else {
                  onCitation(c);
                }
              };
              const scoreLabel = c.score !== undefined
                ? `${Math.round(c.score * 100)}%`
                : null;
              // Trim [M:SS] markers from the snippet before showing as tooltip.
              const cleanSnippet = (c.snippet ?? '')
                .replace(/\[\d+:\d{2}\]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 140);
              const isTimestamp = c.type === 'youtube' || c.type === 'audio';

              return (
                // data-tag: media-colored left edge + score badge + timestamp
                <button
                  key={i}
                  title={cleanSnippet || c.mediaName}
                  onClick={handleClick}
                  onMouseEnter={() => onCiteHover(c.mediaId, true)}
                  onMouseLeave={() => onCiteHover(c.mediaId, false)}
                  className="group/cit relative flex items-center gap-1.5 overflow-hidden rounded-md bg-black/[0.03] py-1 pl-3 pr-2 text-[11.5px] font-medium transition-all hover:-translate-y-px hover:bg-black/[0.06] hover:shadow-sm active:translate-y-0 dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                >
                  {/* media-type colored left edge — ties chip to the source color */}
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0 w-[2.5px]',
                      MEDIA_TYPES[c.type].solid
                    )}
                  />
                  <MediaIcon type={c.type} size="sm" className="h-3 w-3 shrink-0 rounded" />
                  <span className="max-w-[100px] truncate text-foreground/80">
                    {c.mediaName}
                  </span>
                  {/* locator: timestamp or page number */}
                  {c.locator && (
                    <span className="flex items-center gap-0.5 text-muted-foreground/60">
                      {isTimestamp ? (
                        <Clock className="h-2.5 w-2.5 shrink-0" />
                      ) : null}
                      {c.locator}
                    </span>
                  )}
                  {/* score badge — shows confidence */}
                  {scoreLabel && (
                    <span className="rounded bg-accent/10 px-1 py-0.5 text-[10px] font-semibold text-accent">
                      {scoreLabel}
                    </span>
                  )}
                  {/* external-link icon for youtube jump */}
                  {isJump && (
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover/cit:text-accent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {m.suggestedQuestions && m.suggestedQuestions.length > 0 && onAsk && (
        // follow-up chips (questions generated by Make) — click to re-ask
        <div className="mt-2.5 flex flex-col gap-1">
          {m.suggestedQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => !busy && onAsk(q)}
              disabled={busy}
              className="nodrag group/sg flex items-start gap-1.5 rounded-lg border border-[rgb(var(--hairline)/0.16)] bg-card px-2.5 py-1.5 text-left text-[12.5px] leading-snug text-foreground/80 transition-all hover:-translate-y-px hover:border-accent/40 hover:text-accent hover:shadow-sm disabled:opacity-50"
            >
              <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover/sg:text-accent" />
              <span>{q}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const BrainNode = memo(BrainNodeInner);
