// Deterministic mermaid → Excalidraw layout engine.
//
// Inherits the design language of the Madison Excalidraw agents: rounded,
// role-colored boxes + bound text + bound arrows, laid out with ELK (better
// crossing-minimization than mermaid-to-excalidraw's dagre). Pipeline:
//   parse flowchart → ELK layered layout → styled Excalidraw skeleton →
//   convertToExcalidrawElements (auto-binds) → exportToSvg.
// Used as the PRIMARY diagram renderer; callers fall back to mermaid-to-excalidraw
// then mermaid.js if this throws (non-flowchart, parse failure, etc.).

type Shape = 'rect' | 'round' | 'stadium' | 'diamond';
interface GNode { id: string; label: string; shape: Shape; cls?: string }
interface GEdge { from: string; to: string; label?: string; bidir: boolean; dashed: boolean }
interface GClass { fill?: string; stroke?: string }
interface Graph {
  dir: 'RIGHT' | 'DOWN';
  nodes: Map<string, GNode>;
  edges: GEdge[];
  classes: Map<string, GClass>;
}

// Madison palette default for un-classed nodes (light fill, readable on white).
const DEFAULT_FILL = '#e7f5ff';
const DEFAULT_STROKE = '#1971c2';
const EDGE_COLOR = '#495057';

const EDGE_RE =
  /^(.+?)\s*(<-->|-->|---|-\.->|-\.-|==>|===)\s*(?:\|([^|]*)\|)?\s*(.+)$/;

/** Pull the id + display label + shape out of a node token like
 *  `A["Commercial Target (Money) Page"]`, `B(rounded)`, `C{decision}`. */
function extractNode(tokenRaw: string): GNode | null {
  let token = tokenRaw.trim();
  let cls: string | undefined;
  const cm = token.match(/:::(\w+)\s*$/);
  if (cm) {
    cls = cm[1];
    token = token.slice(0, cm.index).trim();
  }
  const m = token.match(/^([A-Za-z0-9_]+)\s*(.*)$/);
  if (!m) return null;
  const id = m[1];
  let rest = m[2].trim();
  let shape: Shape = 'rect';
  let label = id;
  if (rest) {
    if (/^\(\[.*\]\)$/.test(rest)) shape = 'stadium';
    else if (/^\{.*\}$/.test(rest)) shape = 'diamond';
    else if (/^\(.*\)$/.test(rest)) shape = 'round';
    let inner = rest
      .replace(/^\(\[/, '')
      .replace(/\]\)$/, '')
      .replace(/^\[\[/, '')
      .replace(/\]\]$/, '')
      .replace(/^[[({]/, '')
      .replace(/[\])}]$/, '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (inner) label = inner;
  }
  return { id, label, shape, cls };
}

function upsertNode(g: Graph, n: GNode | null) {
  if (!n) return;
  const existing = g.nodes.get(n.id);
  if (!existing) {
    g.nodes.set(n.id, n);
  } else {
    // a later shaped definition wins over a bare id reference
    if (n.label !== n.id) existing.label = n.label;
    if (n.shape !== 'rect') existing.shape = n.shape;
    if (n.cls) existing.cls = n.cls;
  }
}

export function parseFlowchart(code: string): Graph | null {
  const lines = code.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const dirMatch = lines[0].match(/^(?:flowchart|graph)\s+(LR|RL|TB|TD|BT)/i);
  if (!dirMatch) return null; // only flowcharts; let caller fall back
  const dir: Graph['dir'] = /LR|RL/i.test(dirMatch[1]) ? 'RIGHT' : 'DOWN';
  const g: Graph = { dir, nodes: new Map(), edges: [], classes: new Map() };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^(subgraph\b|end$)/i.test(line)) continue; // flatten subgraphs
    if (line.startsWith('%%')) continue; // comment / directive

    const cd = line.match(/^classDef\s+(\w+)\s+(.+?);?$/i);
    if (cd) {
      const props: GClass = {};
      for (const part of cd[2].split(',')) {
        const [k, v] = part.split(':').map((s) => s.trim());
        if (k === 'fill') props.fill = v;
        if (k === 'stroke') props.stroke = v;
      }
      g.classes.set(cd[1], props);
      continue;
    }
    const ca = line.match(/^class\s+([\w,]+)\s+(\w+)\s*;?$/i);
    if (ca) {
      for (const id of ca[1].split(',')) {
        const n = g.nodes.get(id.trim());
        if (n) n.cls = ca[2];
        else g.nodes.set(id.trim(), { id: id.trim(), label: id.trim(), shape: 'rect', cls: ca[2] });
      }
      continue;
    }

    const em = line.match(EDGE_RE);
    if (em) {
      const src = extractNode(em[1]);
      const tgt = extractNode(em[4]);
      if (src && tgt) {
        upsertNode(g, src);
        upsertNode(g, tgt);
        g.edges.push({
          from: src.id,
          to: tgt.id,
          label: (em[3] || '').trim() || undefined,
          bidir: em[2] === '<-->',
          dashed: em[2].includes('.')
        });
        continue;
      }
    }
    // standalone node definition
    upsertNode(g, extractNode(line));
  }

  if (g.nodes.size === 0) return null;
  return g;
}

function nodeSize(label: string): { w: number; h: number } {
  const longest = label
    .split(/\s+/)
    .reduce((a, b) => Math.max(a, b.length), label.length > 24 ? 24 : label.length);
  const w = Math.min(300, Math.max(150, longest * 9.6 + 40));
  const lines = Math.ceil(label.length / (w / 9.6));
  const h = Math.max(62, 26 + lines * 26);
  return { w, h };
}

type Pt = { x: number; y: number };

/** Build the styled Excalidraw skeleton from a laid-out graph. Arrows are drawn
 *  from ELK's routed polyline (explicit points) — auto-binding alone collapses
 *  them to the origin. */
function toSkeleton(
  g: Graph,
  pos: Map<string, { x: number; y: number; w: number; h: number }>,
  routes: (Pt[] | null)[],
  labels: ({ x: number; y: number; w: number; h: number } | null)[]
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const n of g.nodes.values()) {
    const p = pos.get(n.id);
    if (!p) continue;
    const cls = n.cls ? g.classes.get(n.cls) : undefined;
    out.push({
      type: n.shape === 'diamond' ? 'diamond' : 'rectangle',
      id: n.id,
      x: p.x,
      y: p.y,
      width: p.w,
      height: p.h,
      backgroundColor: cls?.fill || DEFAULT_FILL,
      strokeColor: cls?.stroke || DEFAULT_STROKE,
      strokeWidth: 2,
      roughness: 1, // hand-drawn
      roundness: n.shape === 'rect' ? { type: 3 } : undefined,
      label: { text: n.label, fontSize: 18, strokeColor: '#1e1e1e' }
    });
  }
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i];
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    // ELK routed polyline if available, else straight center→center.
    let abs: Pt[] = routes[i] ?? [];
    if (abs.length < 2) {
      abs = [
        { x: a.x + a.w / 2, y: a.y + a.h / 2 },
        { x: b.x + b.w / 2, y: b.y + b.h / 2 }
      ];
    }
    const ox = abs[0].x;
    const oy = abs[0].y;
    const points = abs.map((p) => [p.x - ox, p.y - oy]);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    out.push({
      type: 'arrow',
      id: `edge-${i}`,
      x: ox,
      y: oy,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      points,
      strokeColor: EDGE_COLOR,
      strokeWidth: 2,
      strokeStyle: e.dashed ? 'dashed' : 'solid',
      roughness: 1,
      startArrowhead: e.bidir ? 'arrow' : null,
      endArrowhead: 'arrow'
    });
  }
  // Edge labels as filled "pills" placed by ELK — pushed LAST so they paint ON
  // TOP of the arrows (masking the line behind them) and never overlap.
  for (let i = 0; i < g.edges.length; i++) {
    const e = g.edges[i];
    const lp = labels[i];
    if (!e.label || !lp) continue;
    out.push({
      type: 'rectangle',
      id: `lbl-${i}`,
      x: lp.x,
      y: lp.y,
      width: lp.w,
      height: lp.h,
      backgroundColor: '#ffffff', // dark-mode export inverts this to the canvas
      strokeColor: '#ffffff',
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
      label: { text: e.label, fontSize: 14, strokeColor: '#1e1e1e' }
    });
  }
  return out;
}

let elkSingleton: { layout: (g: unknown) => Promise<unknown> } | null = null;
async function getElk() {
  if (!elkSingleton) {
    const mod = await import('elkjs/lib/elk.bundled.js');
    const ELK = mod.default;
    elkSingleton = new ELK() as { layout: (g: unknown) => Promise<unknown> };
  }
  return elkSingleton;
}

/** Full pipeline: mermaid string → rendered Excalidraw SVG string. `dark`
 *  renders in Excalidraw's dark theme to match the app's mode. Throws on
 *  non-flowchart / parse failure so the caller can fall back. */
export async function renderMermaidViaEngine(
  code: string,
  dark = false
): Promise<string> {
  const g = parseFlowchart(code);
  if (!g) throw new Error('not a parseable flowchart');

  // ELK layered layout.
  const elk = await getElk();
  const sizes = new Map<string, { w: number; h: number }>();
  for (const n of g.nodes.values()) sizes.set(n.id, nodeSize(n.label));
  // Size each edge label so ELK can reserve space + place it without overlap.
  const labelSize = (t: string) => ({
    width: Math.max(34, Math.round(t.length * 7.8 + 20)),
    height: 26
  });
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': g.dir,
      // Compact spacing: keep the diagram small enough to read at column width
      // without zooming. ELK already places labels collision-free, so big gaps
      // are no longer needed.
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.edgeNode': '26',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.spacing.edgeLabel': '8',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP'
    },
    children: [...g.nodes.values()].map((n) => ({
      id: n.id,
      width: sizes.get(n.id)!.w,
      height: sizes.get(n.id)!.h
    })),
    edges: g.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.from],
      targets: [e.to],
      ...(e.label ? { labels: [{ text: e.label, ...labelSize(e.label) }] } : {})
    }))
  };
  const laid = (await elk.layout(elkGraph)) as {
    children?: { id: string; x: number; y: number; width: number; height: number }[];
    edges?: {
      id: string;
      sections?: { startPoint: Pt; endPoint: Pt; bendPoints?: Pt[] }[];
      labels?: { x: number; y: number; width: number; height: number }[];
    }[];
  };
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const c of laid.children ?? []) {
    pos.set(c.id, { x: c.x, y: c.y, w: c.width, h: c.height });
  }
  if (pos.size === 0) throw new Error('layout produced no nodes');

  // Pull ELK's routed polyline + placed label box for each edge.
  const routes: (Pt[] | null)[] = [];
  const labelBoxes: ({ x: number; y: number; w: number; h: number } | null)[] = [];
  g.edges.forEach((_, i) => {
    const ed = (laid.edges ?? []).find((x) => x.id === `e${i}`);
    const sec = ed?.sections?.[0];
    routes.push(sec ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint] : null);
    const l = ed?.labels?.[0];
    labelBoxes.push(l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null);
  });

  const skeleton = toSkeleton(g, pos, routes, labelBoxes);

  // Convert skeleton → full elements (auto-binds arrows + text) → SVG.
  const exc = await import('@excalidraw/excalidraw');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements = exc.convertToExcalidrawElements(skeleton as any);
  const svg = await exc.exportToSvg({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elements: elements as any,
    files: null,
    appState: { exportBackground: false, exportWithDarkMode: dark, exportPadding: 16 }
  });
  // Keep the intrinsic width/height + viewBox; the caller sizes it responsively
  // with CSS classes (an inline max-width fights zero-width flex/grid wrappers).
  return svg.outerHTML;
}
