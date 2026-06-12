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
}

export interface BrainData extends Record<string, unknown> {
  name: string;
}

export interface TextNodeData extends Record<string, unknown> {
  text: string;
}

export interface AnnotationData extends Record<string, unknown> {
  text: string;
}

export type BoardNode = Node<Record<string, any>>;
export type BoardEdge = Edge;

export interface BoardState {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

// ---- chip / hub geometry (compact "puzzle" tiling, 2 columns) ----
export const CHIP_W = 172;
export const CHIP_H = 56;
/** Depth of the Scratch-style puzzle tab below the chip body. */
export const CHIP_TAB = 7;
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
export const CHIP_CLIP = `path('M 12 0 L 26 0 L 30 ${CHIP_TAB} L 48 ${CHIP_TAB} L 52 0 L 160 0 Q 172 0 172 12 L 172 44 Q 172 56 160 56 L 52 56 L 48 ${CHIP_H + CHIP_TAB} L 30 ${CHIP_H + CHIP_TAB} L 26 56 L 12 56 Q 0 56 0 44 L 0 12 Q 0 0 12 0 Z')`;
/** Same notch on top, but a FLAT bottom — the last piece of a welded column,
 *  so the stack's bottom edge reads clean (no dangling tab). */
export const CHIP_CLIP_FLATBOTTOM = `path('M 12 0 L 26 0 L 30 ${CHIP_TAB} L 48 ${CHIP_TAB} L 52 0 L 160 0 Q 172 0 172 12 L 172 44 Q 172 56 160 56 L 12 56 Q 0 56 0 44 L 0 12 Q 0 0 12 0 Z')`;
// Inner padding/gaps: chips rest comfortably inside the recessed well, not
// wedged against its walls.
export const HUB_PAD_X = 16;
export const HUB_HEADER_H = 42;
export const HUB_GAP = 12;
export const HUB_COLS = 2;

export function hubSize(memberCount: number) {
  const rows = Math.max(1, Math.ceil(memberCount / HUB_COLS));
  return {
    width: HUB_PAD_X * 2 + HUB_COLS * CHIP_W + (HUB_COLS - 1) * HUB_GAP,
    height:
      memberCount === 0
        ? HUB_HEADER_H + CHIP_H + HUB_GAP * 2
        : HUB_HEADER_H + rows * (CHIP_H + HUB_GAP) + HUB_GAP
  };
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

/** Grid slot for the i-th docked chip (relative to the hub). */
export function hubSlot(i: number) {
  const col = i % HUB_COLS;
  const row = Math.floor(i / HUB_COLS);
  return {
    x: HUB_PAD_X + col * (CHIP_W + HUB_GAP),
    y: HUB_HEADER_H + HUB_GAP + row * (CHIP_H + HUB_GAP)
  };
}
