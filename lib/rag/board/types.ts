// Board canvas data model. See BOARD_SPEC.md.
import type { Node, Edge } from '@xyflow/react';
import { MediaType } from '../types';

/** Hub media type — a real type, or the implicit "everything" hub. */
export type HubType = MediaType | 'everything';

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
export const HUB_PAD_X = 12;
export const HUB_HEADER_H = 42;
export const HUB_GAP = 10;
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

/** Grid slot for the i-th docked chip (relative to the hub). */
export function hubSlot(i: number) {
  const col = i % HUB_COLS;
  const row = Math.floor(i / HUB_COLS);
  return {
    x: HUB_PAD_X + col * (CHIP_W + HUB_GAP),
    y: HUB_HEADER_H + HUB_GAP + row * (CHIP_H + HUB_GAP)
  };
}
