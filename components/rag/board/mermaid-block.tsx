'use client';

import { useEffect, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
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

async function renderViaExcalidraw(code: string, dark = false): Promise<string> {
  const { parse, convert, toSvg } = await getExcalidraw();
  // Throws for non-flowchart diagrams → caller falls back to mermaid.js.
  const { elements, files } = await parse(normalizeMermaid(code.trim()));
  const full = convert(elements);
  const svg = await toSvg({
    elements: full,
    files: files ?? null,
    appState: {
      exportBackground: false,
      exportWithDarkMode: dark,
      exportPadding: 16
    }
  });
  // Keep intrinsic size + viewBox; sized responsively via CSS classes by caller.
  return svg.outerHTML;
}

let counter = 0;

export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Esc closes the full-screen diagram view.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Track the app's theme (toggles the `dark` class on <html>) so the diagram
  // re-renders in the matching mode when the user flips dark/light.
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setIsDark(root.classList.contains('dark'));
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 0) Our deterministic engine: ELK layout + role-colored boxes + bound
      //    elbow arrows (Madison-agent design language). Best layout + styling.
      try {
        const out = await renderMermaidViaEngine(normalizeMermaid(code.trim()), isDark);
        if (alive) setSvg(out);
        return;
      } catch {
        /* non-flowchart / parse issue → try the stock converter */
      }
      // 1) mermaid-to-excalidraw (stock converter) → hand-drawn SVG.
      try {
        const out = await renderViaExcalidraw(code, isDark);
        if (alive) setSvg(out);
        return;
      } catch {
        /* not a flowchart / parse issue → try mermaid.js */
      }
      // 2) mermaid.js (every other diagram type).
      try {
        const mermaid = await getMermaid();
        const src = normalizeMermaid(code.trim());
        const themed = isDark ? `%%{init: {"theme":"dark"}}%%\n${src}` : src;
        const { svg: out } = await mermaid.render(`mmd-${(counter += 1)}`, themed);
        if (alive) setSvg(out);
        return;
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, isDark]);

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
  // Surface matches the app theme: light "paper" in light mode, dark canvas in
  // dark mode (the SVG itself is rendered in the matching Excalidraw theme).
  return (
    <>
      <figure
        data-graphic="mermaid"
        className="group relative my-3 max-h-[80vh] overflow-auto rounded-xl border border-[rgb(var(--hairline)/0.16)] bg-white p-3 dark:bg-[#161618]"
      >
        <button
          onClick={() => setExpanded(true)}
          title="Expand to full screen"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/[0.06] text-foreground/60 opacity-0 transition-opacity hover:bg-black/[0.12] hover:text-foreground group-hover:opacity-100 dark:bg-white/[0.1] dark:hover:bg-white/[0.18]"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <div
          className="w-full [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </figure>

      {expanded && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative max-h-[94vh] max-w-[96vw] overflow-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#161618]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setExpanded(false)}
              title="Close (Esc)"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-black/[0.06] text-foreground/70 transition-colors hover:bg-black/[0.12] hover:text-foreground dark:bg-white/[0.1] dark:hover:bg-white/[0.18]"
            >
              <X className="h-4 w-4" />
            </button>
            <div
              className="[&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-auto [&_svg]:max-h-[86vh] [&_svg]:max-w-[90vw]"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default MermaidBlock;
