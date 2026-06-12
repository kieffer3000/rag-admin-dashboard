'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

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
