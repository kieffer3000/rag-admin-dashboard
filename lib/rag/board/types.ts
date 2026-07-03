// Board canvas data model. See BOARD_SPEC.md.
import type { Node, Edge } from '@xyflow/react';
import { MediaType } from '../types';

/**
 * Hub flavor — 'cluster' is the primary kind: a user-named box holding ANY
 * mix of media (a sub-project / cluster of intelligence — "SEO", "PPC",
 * "Conference 2026"). Wire the box → the whole family is queried; unplug it
 * → the whole family goes silent. Legacy single-type hubs still render.
 * 'everything' is the implicit all-sources hub.
 */
export type HubType = MediaType | 'everything' | 'cluster';

export interface ChipData extends Record<string, unknown> {
  mediaId: string;
  /** True while a compatible chip is being dragged over a hub. */
  glow?: boolean;
}

export interface HubData extends Record<string, unknown> {
  name: string;
  mediaType: HubType;
  glow?: boolean;
  /** Minimize state — tri-state so big boxes can default to minimized without
   *  fighting an explicit user choice: `true` = forced minimized, `false` =
   *  forced expanded, `undefined` = AUTO (minimized once it passes
   *  HUB_AUTOCOLLAPSE_AT members). See hubCollapsed(). */
  collapsed?: boolean;
  /** FACE VIEW — represent the box as a portrait instead of a tray (an
   *  "Einstein box" wears Einstein's face). `face` = 'preset:male' |
   *  'preset:female' | a downscaled image data-URL (transparent PNGs float
   *  best); `faceOn` toggles the view. Purely visual — contents, wiring and
   *  the plug are untouched, and a button flips back to the box anytime. */
  face?: string;
  faceOn?: boolean;
}

export interface BrainData extends Record<string, unknown> {
  name: string;
  /** Opine citations toggle. When an artifact is wired, ON (default) shows inline
   *  [n] footnotes; OFF returns clean prose still grounded in the corpus. */
  citations?: boolean;
}

export interface TextNodeData extends Record<string, unknown> {
  text: string;
}

/** A reusable INSTRUCTION piece — guides HOW a brain answers (tone, format,
 *  stance). Wired/boxed into a brain it rides into the prompt as guidance;
 *  it is never a source and never indexed. */
export interface PromptData extends Record<string, unknown> {
  text: string;
}

/** A reusable ANSWERING PERSONA piece — guides HOW a brain answers (its
 *  whole voice/stance). Wired/boxed into a brain its `text` (the agent's
 *  system prompt) rides into the prompt as guidance, exactly like a Prompt
 *  piece; it is never a source and never indexed. */
export interface AgentData extends Record<string, unknown> {
  /** Library Agent id this node was spawned from. */
  agentId: string;
  /** The agent's display name (shown as the node title). */
  name: string;
  /** The agent's emoji/icon (defaults to 🤖). Ignored when `avatar` is set. */
  icon?: string;
  /** A custom face image (data URL or remote URL) — a preset robot or the
   *  user's own upload, optionally background-removed. Takes priority over icon. */
  avatar?: string;
  /** The agent's system prompt — flows into the brain's guides[]. */
  text: string;
}

export interface AnnotationData extends Record<string, unknown> {
  text: string;
}

/** The ARTIFACT (right plug) — the user's own working doc (a draft, an article,
 *  a webpage) that the wired corpus reasons ABOUT in Opine mode. Carried WHOLE
 *  into the prompt, NEVER indexed (it must not pollute the knowledge base). One
 *  artifact per brain. */
export interface ArtifactData extends Record<string, unknown> {
  title?: string;
  url?: string;
  content: string;
  /** Hero/preview image (the page's og:image), loaded with the URL. UI only. */
  image?: string;
  /** Pixel-accurate rendered screenshot URL (preferred over `image`). UI only. */
  screenshot?: string;
}

/** A REFERENCE (top plug) — an exemplar to imitate or a clue to consider
 *  ("make it like this", "weigh these leads"). Guides Opine judgment; carried
 *  whole, NEVER indexed and never cited. Multiple may be wired. */
export interface ReferenceData extends Record<string, unknown> {
  title?: string;
  content: string;
}

export type BoardNode = Node<Record<string, any>>;
export type BoardEdge = Edge;

/** A brain temporarily removed from the canvas (stashed in the Chest) — its
 *  node + the edges that touched it, so recall restores it with its wiring. */
export interface StashedBrain {
  node: BoardNode;
  edges: BoardEdge[];
}

/** A box (hub) parked in the Chest dock — its hub node, the child pieces docked
 *  inside it, and the edges that touched it, so recall restores it intact. */
export interface StashedBox {
  node: BoardNode;
  children: BoardNode[];
  edges: BoardEdge[];
}

export interface BoardState {
  nodes: BoardNode[];
  edges: BoardEdge[];
  /** Brains parked in the Chest dock (off-canvas), recallable later. */
  stashedBrains?: StashedBrain[];
  /** Boxes parked in the Chest dock (off-canvas), recallable later. */
  stashedBoxes?: StashedBox[];
}

// ---- chip / hub geometry (compact "puzzle" tiling, 2 columns) ----
// Roomy enough for two comfortable lines of a longer title without reading
// gaudy; the clip-paths below derive every coordinate from these constants so
// the puzzle notch/tab survives any resize.
export const CHIP_W = 216;
/** Free agent piece footprint — compact so it hugs the robot graphic. A tight
 *  box keeps the source connector beside the robot AND leaves the edge's cut
 *  scissors outside the node, so it stays hoverable/clickable like every other
 *  piece (a wide transparent box would sit over the scissors and swallow it). */
export const AGENT_W = 132;
export const AGENT_H = 156;
// Tall enough for a card: a ~16:9 thumbnail/preview banner on top + a two-line
// title bar below. Text/doc pieces reuse the banner area for a big type glyph,
// so every piece is the same size. The clip-path below derives from this.
export const CHIP_H = 150;
/** Height of the title bar at the bottom of the card (banner takes the rest). */
export const CHIP_TITLE_H = 50;
/** Depth of the Scratch-style puzzle tab below the chip body. */
export const CHIP_TAB = 7;
/** Corner radius of the rounded chip body. */
export const CHIP_R = 12;
/** Vertical pitch when same-type chips click together (tab fills the notch). */
export const STACK_PITCH = CHIP_H;
/** Snap radius for chip-to-chip puzzle docking. */
export const STACK_SNAP = 38;
/** Yank-to-peel: horizontal pull past this and a piece pops out of its stack. */
export const PEEL_BREAK = 40;
/** Vertical movement past this "grabs" the whole stack (sibling-sync drag). */
export const STACK_GRAB = 8;

/** code.org/Scratch-style block outline: slanted notch on top, matching tab
 *  on the bottom — stacked same-type chips visually interlock. */
export const CHIP_CLIP = `path('M ${CHIP_R} 0 L 26 0 L 30 ${CHIP_TAB} L 48 ${CHIP_TAB} L 52 0 L ${CHIP_W - CHIP_R} 0 Q ${CHIP_W} 0 ${CHIP_W} ${CHIP_R} L ${CHIP_W} ${CHIP_H - CHIP_R} Q ${CHIP_W} ${CHIP_H} ${CHIP_W - CHIP_R} ${CHIP_H} L 52 ${CHIP_H} L 48 ${CHIP_H + CHIP_TAB} L 30 ${CHIP_H + CHIP_TAB} L 26 ${CHIP_H} L ${CHIP_R} ${CHIP_H} Q 0 ${CHIP_H} 0 ${CHIP_H - CHIP_R} L 0 ${CHIP_R} Q 0 0 ${CHIP_R} 0 Z')`;
/** Same notch on top, but a FLAT bottom — the last piece of a welded column,
 *  so the stack's bottom edge reads clean (no dangling tab). */
export const CHIP_CLIP_FLATBOTTOM = `path('M ${CHIP_R} 0 L 26 0 L 30 ${CHIP_TAB} L 48 ${CHIP_TAB} L 52 0 L ${CHIP_W - CHIP_R} 0 Q ${CHIP_W} 0 ${CHIP_W} ${CHIP_R} L ${CHIP_W} ${CHIP_H - CHIP_R} Q ${CHIP_W} ${CHIP_H} ${CHIP_W - CHIP_R} ${CHIP_H} L ${CHIP_R} ${CHIP_H} Q 0 ${CHIP_H} 0 ${CHIP_H - CHIP_R} L 0 ${CHIP_R} Q 0 0 ${CHIP_R} 0 Z')`;
// Inner padding/gaps: chips rest comfortably inside the recessed well, not
// wedged against its walls.
export const HUB_PAD_X = 16;
export const HUB_HEADER_H = 42;
export const HUB_GAP = 12;
export const HUB_COLS = 2;

/** Columns a box uses for its grid — widens with item count so a big box (e.g.
 *  50 imported videos) is a tidy grid, not a 25-row vertical strip. */
export function hubCols(memberCount: number) {
  if (memberCount <= 6) return HUB_COLS; // 2
  if (memberCount <= 12) return 3;
  if (memberCount <= 24) return 4;
  if (memberCount <= 40) return 5;
  return 6;
}

export function hubSize(memberCount: number) {
  const cols = hubCols(memberCount);
  const rows = Math.max(1, Math.ceil(memberCount / cols));
  return {
    width: HUB_PAD_X * 2 + cols * CHIP_W + (cols - 1) * HUB_GAP,
    height:
      memberCount === 0
        ? HUB_HEADER_H + CHIP_H + HUB_GAP * 2
        : HUB_HEADER_H + rows * (CHIP_H + HUB_GAP) + HUB_GAP
  };
}

/** Fixed footprint of a MINIMIZED cluster box — a header + a 3-col scrollable
 *  thumbnail preview rendered in the hub's own DOM (not as canvas child nodes).
 *  Big boxes collapse to this so they stop flickering and "flying away" when
 *  grabbed (a 100-item expanded box is enormous; dragging its header drags a
 *  mostly-off-screen giant). */
export const HUB_MINI_SIZE = { width: 300, height: 232 } as const;

/** "Expanded" size of a big cluster box — roughly DOUBLE the mini height, then
 *  scroll. A box never grows into a 1000-tile wall: it's mini (~9 visible) or
 *  this capped, scrollable preview. */
export const HUB_EXPANDED_SIZE = { width: 360, height: 470 } as const;

/** A cluster box AUTO-minimizes past this many pieces. The minimized renderer
 *  (a scrollable DOM grid) is fixed-size and always fully on-screen, which is
 *  what makes big boxes manageable. Kept low so the common "import 100 videos
 *  into one box" case never produces an unwieldy canvas object. */
export const HUB_AUTOCOLLAPSE_AT = 12;

/** Is this hub rendered minimized? Tri-state `data.collapsed` (explicit
 *  true/false) overrides; otherwise auto by member count. Only cluster boxes
 *  minimize — the Everything hub and legacy typed hubs never do. */
export function hubCollapsed(
  data: { mediaType?: HubType; collapsed?: boolean },
  memberCount: number
): boolean {
  if (data.mediaType !== 'cluster') return false;
  if (data.collapsed === true) return true;
  if (data.collapsed === false) return false;
  return memberCount > HUB_AUTOCOLLAPSE_AT;
}

/** A cluster box renders as the FIXED, scrollable DOM grid (not unbounded canvas
 *  children) when it is minimized OR simply holds a lot of pieces — so a giant
 *  box is never a wall of tiles. Small expanded boxes still use the canvas grid
 *  (draggable chips). */
export function hubUsesGrid(
  data: { mediaType?: HubType; collapsed?: boolean },
  memberCount: number
): boolean {
  if (data.mediaType !== 'cluster') return false;
  return hubCollapsed(data, memberCount) || memberCount > HUB_AUTOCOLLAPSE_AT;
}

/** Within a grid box, is it in the EXPANDED (2x, scrollable) state vs mini? */
export function hubGridExpanded(
  data: { mediaType?: HubType; collapsed?: boolean },
  memberCount: number
): boolean {
  return hubUsesGrid(data, memberCount) && !hubCollapsed(data, memberCount);
}

/** FACE VIEW footprint — a portrait card (header + image + name strip). */
export const HUB_FACE_SIZE = { width: 172, height: 236 } as const;

/** Is this hub wearing its face? (cluster boxes only) */
export function hubFaced(data: {
  mediaType?: HubType;
  face?: string;
  faceOn?: boolean;
}): boolean {
  return data.mediaType === 'cluster' && !!data.faceOn && !!data.face;
}

/** Real on-canvas size of a hub (collapse-aware). Overlap math + Clean Desk
 *  must reserve the ACTUAL footprint — a grid box is HUB_MINI/EXPANDED_SIZE, not
 *  its full grid — or auto-minimized boxes leave huge gaps / mis-overlap. */
export function hubFootprint(
  data: { mediaType?: HubType; collapsed?: boolean; face?: string; faceOn?: boolean },
  memberCount: number
): { width: number; height: number } {
  if (data.mediaType === 'everything') return { width: 230, height: 86 };
  if (hubFaced(data)) return { ...HUB_FACE_SIZE };
  if (hubUsesGrid(data, memberCount))
    return hubGridExpanded(data, memberCount) ? { ...HUB_EXPANDED_SIZE } : { ...HUB_MINI_SIZE };
  return hubSize(memberCount);
}

/**
 * A puzzle STACK is one piece: free same-type chips interlocked at
 * STACK_PITCH. Walk up+down from `start` and return every member (incl.
 * start). Wiring ANY member to a brain wires the whole stack.
 */
export function stackOf(
  start: BoardNode,
  nodes: BoardNode[],
  typeOf: (n: BoardNode) => string | undefined
): BoardNode[] {
  const t = typeOf(start);
  const column = nodes.filter(
    (n) =>
      n.type === 'chip' &&
      !n.parentId &&
      typeOf(n) === t &&
      Math.abs(n.position.x - start.position.x) < 2
  );
  const byY = new Map(column.map((n) => [Math.round(n.position.y), n]));
  const out: BoardNode[] = [start];
  for (const dir of [-1, 1]) {
    let y = Math.round(start.position.y) + dir * STACK_PITCH;
    while (byY.has(y)) {
      out.push(byY.get(y)!);
      y += dir * STACK_PITCH;
    }
  }
  return out;
}

/** Grid slot for the i-th docked chip (relative to the hub). `cols` should be
 *  hubCols(totalMembers) so slots match the box's adaptive width. */
export function hubSlot(i: number, cols: number = HUB_COLS) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    x: HUB_PAD_X + col * (CHIP_W + HUB_GAP),
    y: HUB_HEADER_H + HUB_GAP + row * (CHIP_H + HUB_GAP)
  };
}
