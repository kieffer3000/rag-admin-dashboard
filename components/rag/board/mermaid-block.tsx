'use client';

import { useEffect, useRef, useState } from 'react';
import { renderMermaidViaEngine } from '@/lib/rag/board/excalidraw-engine';

// Renders an LLM-emitted mermaid diagram. PREFERRED path: convert the mermaid to
// Excalidraw elements and export a static SVG — same hand-drawn look as the
// Excalidraw whiteboard, but a lightweight static render (no editor mount).
// mermaid-to-excalidraw only supports FLOWCHARTS, so anything else (sequence,
// gantt, pie, ER, mindmap, …) falls back to mermaid.js. Both libs are imported
// lazily so neither lands in the main bundle. Last resort: show the source.

// --- mermaid.js (fallback renderer) ---
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

// --- Excalidraw (preferred renderer) ---
let excalidrawReady: Promise<{
  parse: typeof import('@excalidraw/mermaid-to-excalidraw').parseMermaidToExcalidraw;
  convert: typeof import('@excalidraw/excalidraw').convertToExcalidrawElements;
  toSvg: typeof import('@excalidraw/excalidraw').exportToSvg;
}> | null = null;
function getExcalidraw() {
  if (!excalidrawReady) {
    excalidrawReady = Promise.all([
      import('@excalidraw/mermaid-to-excalidraw'),
      import('@excalidraw/excalidraw')
    ]).then(([m2e, exc]) => ({
      parse: m2e.parseMermaidToExcalidraw,
      convert: exc.convertToExcalidrawElements,
      toSvg: exc.exportToSvg
    }));
  }
  return excalidrawReady;
}

// Mermaid fails to parse special characters (parentheses, #, &, <, >) inside an
// unquoted node label — e.g. `A[Commercial Target (Money) Page]`. Models forget
// the quotes constantly, which silently kills the whole diagram. Auto-wrap any
// bracket label that contains a breaker in double quotes (quoting is always
// valid mermaid). Leaves already-quoted labels and plain labels untouched.
function normalizeMermaid(code: string): string {
  return code.replace(
    /([A-Za-z0-9_])\[([^\]\n]*[()#&<>][^\]\n]*)\]/g,
    (full, lead: string, label: string) => {
      const t = label.trim();
      if (t.startsWith('"') && t.endsWith('"')) return full; // already quoted
      return `${lead}["${label.replace(/"/g, "'")}"]`;
    }
  );
}

async function renderViaExcalidraw(code: string): Promise<string> {
  const { parse, convert, toSvg } = await getExcalidraw();
  // Throws for non-flowchart diagrams → caller falls back to mermaid.js.
  const { elements, files } = await parse(normalizeMermaid(code.trim()));
  const full = convert(elements);
  const svg = await toSvg({
    elements: full,
    files: files ?? null,
    appState: {
      exportBackground: false,
      exportWithDarkMode: false,
      exportPadding: 16
    }
  });
  // Make it responsive: drop the fixed pixel size, keep the viewBox aspect.
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('style', 'max-width:100%;height:auto;');
  return svg.outerHTML;
}

let counter = 0;

export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mmd-${(counter += 1)}`);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 0) Our deterministic engine: ELK layout + role-colored boxes + bound
      //    elbow arrows (Madison-agent design language). Best layout + styling.
      try {
        const out = await renderMermaidViaEngine(normalizeMermaid(code.trim()));
        if (alive) setSvg(out);
        return;
      } catch {
        /* non-flowchart / parse issue → try the stock converter */
      }
      // 1) mermaid-to-excalidraw (stock converter) → hand-drawn SVG.
      try {
        const out = await renderViaExcalidraw(code);
        if (alive) setSvg(out);
        return;
      } catch {
        /* not a flowchart / parse issue → try mermaid.js */
      }
      // 2) mermaid.js (every other diagram type).
      try {
        const mermaid = await getMermaid();
        const { svg: out } = await mermaid.render(
          idRef.current,
          normalizeMermaid(code.trim())
        );
        if (alive) setSvg(out);
        return;
      } catch {
        if (alive) setFailed(true);
      }
    })();
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
  // Light "paper" surface so the dark diagram strokes read in any app theme.
  return (
    <figure
      data-graphic="mermaid"
      className="my-3 flex justify-center overflow-auto rounded-xl border border-[rgb(var(--hairline)/0.16)] bg-white p-3 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default MermaidBlock;
