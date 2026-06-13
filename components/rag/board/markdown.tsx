'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/** Looks like an HTML document fragment (Make can now return HTML answers). */
function looksLikeHtml(s: string): boolean {
  const t = s.trimStart();
  return t.startsWith('<') && /<\/?(p|div|h[1-6]|ul|ol|li|table|br|strong|em|a|span|section|article)\b/i.test(t);
}

/** Minimal sanitizer for model-returned HTML: strips scripts/styles, event
 *  handlers, and javascript: URLs. Our answer pipeline is trusted (Make ->
 *  our own LLM), but we never inject raw on* handlers or <script> regardless. */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

/**
 * Renders an assistant answer — HTML when Make returns HTML (for richer
 * layouts), otherwise markdown. HTML is sanitized and styled to match.
 */
export function AnswerBody({
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
