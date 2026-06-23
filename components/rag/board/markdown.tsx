'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { useStreamStyle } from '@/lib/rag/stream-style';

// Lazy-loaded so mermaid.js / recharts never land in the main bundle — they
// load only when an answer actually contains a diagram or chart block.
const MermaidBlock = dynamic(
  () => import('./mermaid-block').then((m) => m.MermaidBlock),
  { ssr: false }
);
const ChartBlock = dynamic(
  () => import('./chart-block').then((m) => m.ChartBlock),
  { ssr: false }
);

// A mermaid diagram's first line names its type. Models often fence diagrams as
// a plain ``` or ```flowchart instead of ```mermaid — so we sniff the content,
// not just the language tag, or the diagram renders as a raw code block.
const MERMAID_FIRST =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|gitGraph|timeline|quadrantChart|requirementDiagram|C4Context|sankey(?:-beta)?|xychart(?:-beta)?|block-beta|packet-beta|kanban|architecture(?:-beta)?)\b/i;

/** Classify a fenced block by its language tag, falling back to a content sniff
 *  for mermaid. Returns null for ordinary code blocks (left in the prose). */
function classifyFence(tag: string, body: string): 'mermaid' | 'chart' | null {
  const t = tag.trim().toLowerCase();
  if (t === 'chart') return 'chart';
  if (t === 'mermaid' || MERMAID_FIRST.test(t)) return 'mermaid';
  // No / generic tag: sniff the first non-empty line for a mermaid diagram type.
  if (!t || t === 'text' || t === 'plaintext') {
    const firstLine = body.split('\n').find((l) => l.trim());
    if (firstLine && MERMAID_FIRST.test(firstLine)) return 'mermaid';
  }
  return null;
}

/** Split an answer into prose + fenced graphic blocks (mermaid / chart). Mermaid
 *  is detected by tag OR by content, so a plain/```flowchart fence still renders
 *  as a diagram. Non-graphic code blocks are left in the prose untouched. */
export function splitGraphicBlocks(
  content: string
): { type: 'prose' | 'mermaid' | 'chart'; text: string }[] {
  const re = /```([a-zA-Z0-9_-]*)[ \t]*\n([\s\S]*?)```/g;
  const out: { type: 'prose' | 'mermaid' | 'chart'; text: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const kind = classifyFence(m[1], m[2]);
    if (!kind) continue; // ordinary code block — keep it in the prose slice
    if (m.index > last)
      out.push({ type: 'prose', text: content.slice(last, m.index) });
    out.push({ type: kind, text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push({ type: 'prose', text: content.slice(last) });
  return out;
}

/** Strip a single line's per-line wrapping — surrounding backticks and inline
 *  <code>/<p>/<span>/<li> tags — so we can test if it belongs to a diagram. */
function unwrapDiagramLine(line: string): string {
  let s = line.replace(/<\/?(code|p|span|li|strong|em)[^>]*>/gi, '').trim();
  if (s.startsWith('`') && s.endsWith('`') && s.length > 1) s = s.slice(1, -1).trim();
  return s;
}

// A line that belongs to a mermaid diagram body (edges, nodes, subgraph/end).
const MERMAID_BODY_LINE = /-->|---|<--|==>|-\.->|\.->|\bsubgraph\b|^end$|[[\]{}()]|\|/;

/** Models sometimes emit a diagram WITHOUT a ```mermaid fence — each line wrapped
 *  in backticks or <code>, or left as bare lines — so it renders as raw code
 *  pills instead of a diagram. Detect such a loose diagram (a line naming a
 *  mermaid type followed by diagram-looking lines) and re-wrap it in a
 *  ```mermaid fence so splitGraphicBlocks renders it. */
export function coerceLooseMermaid(content: string): string {
  if (/```\s*mermaid/i.test(content)) return content; // already properly fenced
  const lines = content.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (MERMAID_FIRST.test(unwrapDiagramLine(lines[i]))) {
      start = i;
      break;
    }
  }
  if (start === -1) return content;
  let end = start;
  for (let j = start + 1; j < lines.length; j++) {
    const u = unwrapDiagramLine(lines[j]);
    if (!u) break; // blank line ends the diagram
    if (MERMAID_BODY_LINE.test(u) || MERMAID_FIRST.test(u)) end = j;
    else break;
  }
  if (end === start) return content; // lone keyword line — not a real diagram
  const body = lines
    .slice(start, end + 1)
    .map(unwrapDiagramLine)
    .join('\n');
  return (
    lines.slice(0, start).join('\n') +
    '\n\n```mermaid\n' +
    body +
    '\n```\n\n' +
    lines.slice(end + 1).join('\n')
  );
}

/** Looks like an HTML answer (Make returns HTML; we also inject <sup> footnote
 *  refs). Detect a block/inline tag ANYWHERE — answers often open with plain
 *  text ("Yes, …") before the first <mark>/<p>, and footnote <sup> refs must
 *  route here to render rather than show as literal text. */
function looksLikeHtml(s: string): boolean {
  return /<\/?(p|div|h[1-6]|ul|ol|li|table|br|strong|em|a|span|mark|section|article|sup)\b[^>]*>/i.test(s);
}

/** Minimal sanitizer for model-returned HTML: strips scripts/styles, event
 *  handlers, and javascript: URLs. Our answer pipeline is trusted (Make ->
 *  our own LLM), but we never inject raw on* handlers or <script> regardless. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2')
    // Belt-and-suspenders: the model occasionally leaks markdown **bold** into
    // an HTML answer — render it as <strong> rather than literal asterisks.
    .replace(/\*\*(?=\S)([\s\S]+?\S)\*\*/g, '<strong>$1</strong>');
}

/** While an answer is still streaming, hold back anything that would thrash if
 *  re-rendered every frame against a growing partial: an unterminated trailing
 *  ```mermaid / ```chart fence (re-laying-out a half-built diagram is what
 *  janked the board), and a half-typed trailing HTML tag (which innerHTML would
 *  garble). Returns the safe-to-render body + the kind of any pending graphic. */
function clipStreaming(content: string): {
  body: string;
  pending: 'mermaid' | 'chart' | null;
} {
  let body = content;
  let pending: 'mermaid' | 'chart' | null = null;

  const fences = content.match(/```/g);
  if (fences && fences.length % 2 === 1) {
    // odd number of fences → the last one is still open (block not finished)
    const idx = content.lastIndexOf('```');
    const open = content.slice(idx + 3);
    const tag = (open.split('\n', 1)[0] || '').trim().toLowerCase();
    const firstBodyLine = open.split('\n').slice(1).find((l) => l.trim()) || '';
    if (tag === 'chart') {
      pending = 'chart';
      body = content.slice(0, idx);
    } else if (tag === 'mermaid' || MERMAID_FIRST.test(tag) || MERMAID_FIRST.test(firstBodyLine)) {
      pending = 'mermaid';
      body = content.slice(0, idx);
    }
    // an ordinary code fence is left in the body — it streams fine as a code block
  }

  // drop a dangling, half-typed trailing tag ("…<ta") so HTML doesn't render junk
  const lt = body.lastIndexOf('<');
  if (lt > body.lastIndexOf('>')) body = body.slice(0, lt);

  return { body, pending };
}

/** Placeholder shown in place of a diagram/chart that hasn't finished streaming. */
function GraphicSkeleton({ kind }: { kind: 'mermaid' | 'chart' }) {
  return (
    <div className="my-3 flex h-24 items-center gap-2 rounded-xl border border-[rgb(var(--hairline)/0.16)] bg-card px-4 text-[12.5px] text-muted-foreground">
      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      {kind === 'mermaid' ? 'Building diagram…' : 'Building chart…'}
    </div>
  );
}

/**
 * Renders an assistant answer. Splits out ```mermaid (diagrams) and ```chart
 * (data charts, JSON spec) blocks into rich renderers; the prose around them
 * renders as HTML (when Make returns HTML) or markdown. While `streaming`, a
 * not-yet-closed diagram/chart shows a placeholder instead of being re-laid-out
 * each frame, so the prose can flow in smoothly.
 */
export function AnswerBody({
  content,
  large = false,
  streaming = false
}: {
  content: string;
  large?: boolean;
  streaming?: boolean;
}) {
  if (streaming) {
    return <StreamingBody content={content} large={large} />;
  }

  // Re-wrap a loosely-emitted diagram (no ```mermaid fence) so it renders.
  const coerced = coerceLooseMermaid(content);
  const segs = splitGraphicBlocks(coerced);
  if (segs.length === 1 && segs[0].type === 'prose') {
    return <Prose content={coerced} large={large} />;
  }
  return (
    <>
      {segs.map((s, i) => {
        if (s.type === 'mermaid') return <MermaidBlock key={i} code={s.text} />;
        if (s.type === 'chart') return <ChartBlock key={i} code={s.text} />;
        return s.text.trim() ? (
          <Prose key={i} content={s.text} large={large} />
        ) : null;
      })}
    </>
  );
}

/**
 * The streaming view of an answer. Honors the reader's reveal style (per-word
 * fade vs leading-edge mask — see lib/rag/stream-style). In BOTH styles a
 * not-yet-closed diagram/chart is held back (clipStreaming) so a half-built
 * graphic never re-lays-out each frame.
 */
function StreamingBody({
  content,
  large
}: {
  content: string;
  large?: boolean;
}) {
  const style = useStreamStyle();
  const { body, pending } = clipStreaming(content);
  const segs = splitGraphicBlocks(body); // only COMPLETE fences match

  const blocks = segs.map((s, i) => {
    if (s.type === 'mermaid') return <MermaidBlock key={i} code={s.text} />;
    if (s.type === 'chart') return <ChartBlock key={i} code={s.text} />;
    if (!s.text.trim()) return null;
    // 'word' → per-word fade over plain text (formatting snaps in on completion);
    // 'mask' → live formatted HTML/markdown, softened by the edge gradient.
    return style === 'word' ? (
      <WordFade key={i} text={s.text} large={large} />
    ) : (
      <Prose key={i} content={s.text} large={large} />
    );
  });

  return (
    <div className={style === 'mask' ? 'stream-fade' : undefined}>
      {blocks}
      {pending && <GraphicSkeleton kind={pending} />}
    </div>
  );
}

/**
 * Per-word reveal (Anthropic-style). Each word is its own <span>; React keys by
 * index and streamText only ever feeds a growing PREFIX, so an existing word
 * never remounts — its fade plays exactly once, on arrival. The word-boundary
 * reveal cadence staggers them into a gentle materializing wave. Whitespace
 * (incl. the line breaks toPlainWords inserts for block tags) is preserved via
 * white-space:pre-wrap so paragraphs stay readable while streaming; the crisp
 * formatted render takes over the instant streaming ends.
 */
function WordFade({ text, large }: { text: string; large?: boolean }) {
  const tokens = useMemo(() => toPlainWords(text).split(/(\s+)/), [text]);
  return (
    <div
      className={cn(
        'word-fade text-foreground/90',
        large ? 'text-[16.5px] leading-[1.72]' : 'text-[15px] leading-[1.6]'
      )}
    >
      {tokens.map((tok, i) =>
        tok === '' ? null : (
          <span key={i} className={/^\s+$/.test(tok) ? undefined : 'wf-word'}>
            {tok}
          </span>
        )
      )}
    </div>
  );
}

/** Flatten HTML-ish answer text to readable plain text for the per-word reveal:
 *  block tags → line breaks, list items → bullets, then strip remaining tags and
 *  decode the few entities the model emits. Markdown passes through mostly as-is
 *  (its symbols briefly show, then the formatted render replaces them on done). */
function toPlainWords(s: string): string {
  return s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(p|div|h[1-6]|li|tr|ul|ol|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trimStart();
}

/** Prose body — HTML when Make returns HTML (for richer layouts), else markdown. */
function Prose({
  content,
  large = false
}: {
  content: string;
  large?: boolean;
}) {
  if (looksLikeHtml(content)) {
    return (
      <div
        className={cn(
          'rag-html text-foreground/90 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          '[&_a]:text-accent [&_a]:underline [&_a]:decoration-accent/40 [&_a]:underline-offset-2',
          '[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-[17px] [&_h1]:font-semibold',
          '[&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-[16px] [&_h2]:font-semibold',
          '[&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:text-[15px] [&_h3]:font-semibold',
          '[&_p]:mb-2.5 [&_ul]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1',
          '[&_blockquote]:my-2.5 [&_blockquote]:border-l-[3px] [&_blockquote]:border-accent/45 [&_blockquote]:pl-3.5 [&_blockquote]:text-foreground/80',
          '[&_table]:my-2.5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13.5px] [&_th]:border [&_th]:border-[rgb(var(--hairline)/0.16)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-[rgb(var(--hairline)/0.12)] [&_td]:px-3 [&_td]:py-2',
          '[&_code]:rounded-[5px] [&_code]:bg-black/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] dark:[&_code]:bg-white/[0.09]',
          '[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-[10px]',
          large ? 'text-[16.5px] leading-[1.72]' : 'text-[15px] leading-[1.6]'
        )}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    );
  }
  return <Markdown large={large}>{content}</Markdown>;
}

/**
 * Renders an assistant answer as rich markdown — tables, bold, italics,
 * headings, blockquotes, lists, code — styled to match the Poppy reference
 * (comfortable 15px body, bordered striped tables, accent blockquote).
 */
export function Markdown({
  children,
  className,
  large = false
}: {
  children: string;
  className?: string;
  /** Reading mode: scale the body up + relax the leading for long answers. */
  large?: boolean;
}) {
  return (
    <div
      className={cn(
        'text-foreground/90 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        large ? 'text-[16.5px] leading-[1.72]' : 'text-[15px] leading-[1.6]',
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node, ...p }) => <p className="mb-2.5" {...p} />,
          strong: ({ node, ...p }) => (
            <strong className="font-semibold text-foreground" {...p} />
          ),
          h1: ({ node, ...p }) => (
            <h1 className="mb-2 mt-3 text-[17px] font-semibold tracking-tight" {...p} />
          ),
          h2: ({ node, ...p }) => (
            <h2 className="mb-2 mt-3 text-[16px] font-semibold tracking-tight" {...p} />
          ),
          h3: ({ node, ...p }) => (
            <h3 className="mb-1.5 mt-2.5 text-[15px] font-semibold" {...p} />
          ),
          ul: ({ node, ...p }) => (
            <ul className="mb-2.5 ml-1 list-disc space-y-1 pl-4" {...p} />
          ),
          ol: ({ node, ...p }) => (
            <ol className="mb-2.5 ml-1 list-decimal space-y-1 pl-4" {...p} />
          ),
          li: ({ node, ...p }) => <li className="pl-0.5 leading-[1.55]" {...p} />,
          a: ({ node, ...p }) => (
            <a
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
              target="_blank"
              rel="noreferrer"
              {...p}
            />
          ),
          blockquote: ({ node, ...p }) => (
            <blockquote
              className="my-2.5 border-l-[3px] border-accent/45 pl-3.5 text-foreground/80"
              {...p}
            />
          ),
          hr: () => <hr className="my-3 border-[rgb(var(--hairline)/0.12)]" />,
          code: ({ node, ...p }) => (
            <code
              className="rounded-[5px] bg-black/[0.06] px-1 py-0.5 text-[13px] dark:bg-white/[0.09]"
              {...p}
            />
          ),
          pre: ({ node, ...p }) => (
            <pre
              className="mb-2.5 overflow-x-auto rounded-[10px] bg-black/[0.05] p-3 text-[13px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0 dark:bg-white/[0.06]"
              {...p}
            />
          ),
          table: ({ node, ...p }) => (
            <div className="my-2.5 overflow-x-auto rounded-[10px] border border-[rgb(var(--hairline)/0.16)]">
              <table className="w-full border-collapse text-[13.5px]" {...p} />
            </div>
          ),
          thead: ({ node, ...p }) => (
            <thead className="bg-[hsl(240_16%_97%)] dark:bg-white/[0.05]" {...p} />
          ),
          tr: ({ node, ...p }) => (
            <tr
              className="border-b border-[rgb(var(--hairline)/0.10)] last:border-0 even:bg-black/[0.015] dark:even:bg-white/[0.02]"
              {...p}
            />
          ),
          th: ({ node, ...p }) => (
            <th
              className="px-3 py-2 text-left font-semibold text-foreground"
              {...p}
            />
          ),
          td: ({ node, ...p }) => <td className="px-3 py-2 align-top" {...p} />
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
