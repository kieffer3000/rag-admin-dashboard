import { MediaItem, Citation, ChatAttachment } from './types';

const LOCATORS: Record<string, () => string> = {
  document: () => `p. ${Math.floor(10 + Math.random() * 280)}`,
  youtube: () => fmtTime(),
  audio: () => fmtTime(),
  website: () => `¶ ${Math.floor(1 + Math.random() * 12)}`,
  image: () => 'fig. 1',
  text: () => `line ${Math.floor(1 + Math.random() * 20)}`
};

function fmtTime() {
  const m = Math.floor(Math.random() * 50);
  const s = Math.floor(Math.random() * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Build a plausible grounded answer + citations from the in-context sources. */
export function generateMockAnswer(
  query: string,
  context: MediaItem[],
  attachment?: ChatAttachment
): { content: string; citations: Citation[] } {
  const indexed = context.filter((c) => c.status === 'indexed');

  // Ephemeral discussion of an image — multimodal chat, no retrieval needed.
  if (attachment?.mode === 'discuss' && attachment.kind === 'image') {
    return {
      content:
        `I looked at **${attachment.name}** directly — nothing was added to your knowledge base.\n\n` +
        `The image shows a clear central subject with supporting detail around it. I can describe any region in more depth, extract any visible text, or compare it against your indexed sources` +
        (indexed.length ? ` (you have ${indexed.length} in context)` : '') +
        `. What would you like to know about it?`,
      citations: []
    };
  }

  if (indexed.length === 0) {
    return {
      content:
        "I don't have any indexed sources in context yet. Select one or more sources on the left (or switch scope to **Everything**) and ask again.",
      citations: []
    };
  }

  const used = indexed.slice(0, Math.min(3, indexed.length));
  const citations: Citation[] = used.map((m) => ({
    mediaId: m.id,
    mediaName: m.name,
    type: m.type,
    locator: (LOCATORS[m.type] ?? (() => '—'))(),
    snippet: m.content.slice(0, 160) + (m.content.length > 160 ? '…' : '')
  }));

  const names = used.map((m) => m.name);

  let content: string;
  if (attachment) {
    content =
      `I read **${attachment.name}** and answered each item against ${indexed.length} selected source${indexed.length > 1 ? 's' : ''}.\n\n` +
      `**Q1.** The concept maps directly to the framework described in ${names[0]} ${cite(1)} — the answer is grounded in that passage.\n\n` +
      `**Q2.** Comparing across your sources, ${names[0]}${names[1] ? ` and ${names[1]}` : ''} ${cite(2)} converge on the same conclusion, so this one is well-supported.\n\n` +
      (names[2]
        ? `**Q3.** Only ${names[2]} ${cite(3)} touches this directly; the others don't address it, so I'd rely on that source.\n\n`
        : '') +
      `Every answer above is traceable to a citation. Where the attached file asks something the sources don't cover, I've flagged it rather than guessing.`;
  } else {
    content =
      `Based on your selected source${indexed.length > 1 ? 's' : ''}, here's what I found:\n\n` +
      `The core idea in **${names[0]}** ${cite(1)} establishes the foundation for your question. ` +
      (names[1]
        ? `**${names[1]}** ${cite(2)} reinforces this with a complementary angle, and the two together give a fuller picture.\n\n`
        : '\n\n') +
      `In short: the sources agree on the central point, and the supporting detail is cited inline so you can verify each claim at its exact location.` +
      (names[2] ? ` ${names[2]} ${cite(3)} adds one more nuance worth noting.` : '');
  }

  return { content, citations };
}

function cite(n: number) {
  return `[${n}]`;
}

/**
 * Reveal an answer like a real LLM — a smooth, continuous character flow
 * (ChatGPT-style), not a word-by-word stutter.
 *
 * Two things make it smooth rather than jittery:
 *  1. CHARACTER reveal on a TIME-driven requestAnimationFrame loop — the visible
 *     length is a function of elapsed wall-clock time, so it advances a few
 *     characters per frame at the display's refresh rate instead of popping a
 *     whole token per fixed tick. The rate scales with length so long answers
 *     finish in bounded time without feeling slow.
 *  2. The renderer (AnswerBody, when given `streaming`) holds back any heavy
 *     diagram/chart block until its fence closes — so we never re-layout a
 *     half-built mermaid SVG every frame, which is what actually choked the
 *     board. Prose (HTML/markdown) is cheap to re-render per frame.
 *
 * Signature unchanged — all callers (chat-view, brain-node, research-overlay)
 * work untouched.
 */
export function streamText(
  full: string,
  onChunk: (soFar: string) => void,
  onDone: () => void
): () => void {
  // chars/sec: short answers ~380, scaling up so a long one still wraps up in a
  // few seconds. ~6–14 chars/frame at 60fps — small enough to read as a flow.
  const rate = Math.min(900, Math.max(380, full.length / 4));
  // THROTTLE the intermediate emits. onChunk → setState → the brainMessages
  // context changes → the WHOLE board re-renders. At ~60fps that's a re-render
  // storm = the "jitter while an answer streams". Emitting at most ~once/55ms
  // (~18fps) still reads as smooth word-by-word typing but cuts board
  // re-renders 3-5×. The FINAL full text is always flushed (below), unthrottled.
  const EMIT_MS = 55;
  let raf = 0;
  let start = 0;
  let finished = false;
  let prevN = 0;
  let lastEmit = 0;

  const step = (t: number) => {
    if (!start) start = t;
    const target = Math.min(full.length, Math.ceil(((t - start) / 1000) * rate));
    if (target >= full.length) {
      onChunk(full); // final reveal — always emitted in full
      finished = true;
      onDone();
      return;
    }
    // Reveal WHOLE WORDS only: drop the trailing partial word so a word never
    // appears half-typed. The reveal still advances on the time-driven clock —
    // a word surfaces once the clock moves past it into the next word.
    const trailingWordStart = full.slice(0, target).search(/\S+$/);
    const n = trailingWordStart > prevN ? trailingWordStart : prevN;
    if (n > prevN && t - lastEmit >= EMIT_MS) {
      prevN = n;
      lastEmit = t;
      onChunk(full.slice(0, n));
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  return () => {
    if (!finished) cancelAnimationFrame(raf);
  };
}
