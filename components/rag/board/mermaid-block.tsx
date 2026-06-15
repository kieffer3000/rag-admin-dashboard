'use client';

import { useEffect, useRef, useState } from 'react';

// Renders a Mermaid diagram (flowchart, sequence, gantt, pie, mindmap,
// timeline, ER, …) from LLM-emitted mermaid source. mermaid.js is imported
// lazily inside the effect so it never lands in the main bundle. On a parse
// error we fall back to showing the source.

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;
function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        fontFamily: 'inherit'
      });
      return m.default;
    });
  }
  return mermaidReady;
}

let counter = 0;

export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mmd-${(counter += 1)}`);

  useEffect(() => {
    let alive = true;
    getMermaid()
      .then((mermaid) => mermaid.render(idRef.current, code.trim()))
      .then(({ svg }) => {
        if (alive) setSvg(svg);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  if (failed) {
    return (
      <pre className="my-2 overflow-auto rounded-lg bg-black/[0.05] p-2 text-[12px] dark:bg-white/[0.06]">
        {code}
      </pre>
    );
  }
  if (!svg) {
    return (
      <div className="my-3 h-24 animate-pulse rounded-xl border border-[rgb(var(--hairline)/0.16)] bg-card" />
    );
  }
  return (
    <figure
      data-graphic="mermaid"
      className="my-3 flex justify-center overflow-auto rounded-xl border border-[rgb(var(--hairline)/0.16)] bg-card p-3 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default MermaidBlock;
