'use client';

import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { useBoard } from '@/lib/rag/board/store';
import { MediaIcon } from '@/components/rag/shared';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { Loader2, StickyNote, Layers, RotateCcw, Scissors, Play } from 'lucide-react';
import {
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
  CHIP_TITLE_H,
  CHIP_CLIP,
  CHIP_CLIP_FLATBOTTOM,
  STACK_PITCH,
  type BoardNode,
  type ChipData
} from '@/lib/rag/board/types';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/** A single source on the canvas — the "puzzle piece". */
function ChipNodeInner({ id, data, selected, parentId }: NodeProps) {
  const d = data as ChipData;
  const { media, updateMedia } = useRag();
  const { removeBoardNode, unsnapPiece } = useBoard();
  const item = media.find((m) => m.id === d.mediaId);

  // Stack awareness: interlocked same-type neighbors weld into ONE piece.
  // Also detect DUPLICATES — the same source placed more than once. The first
  // one is canonical; later copies are dimmed (they're redundant — a brain
  // dedupes them, so they never double-ping the vector store).
  const { above, below, stackSize, duplicate } = useStore((s) => {
    const self = s.nodes.find((n) => n.id === id) as BoardNode | undefined;
    if (!self || !item)
      return { above: false, below: false, stackSize: 1, duplicate: false };
    const sameSource = (s.nodes as BoardNode[]).filter(
      (n) => n.type === 'chip' && n.data?.mediaId === item.id
    );
    const duplicate = sameSource.length > 1 && sameSource[0].id !== id;
    if (self.parentId)
      return { above: false, below: false, stackSize: 1, duplicate };
    const typeOf = (n: BoardNode) =>
      media.find((m) => m.id === n.data?.mediaId)?.type;
    const column = (s.nodes as BoardNode[]).filter(
      (n) =>
        n.type === 'chip' &&
        !n.parentId &&
        typeOf(n) === item.type &&
        Math.abs(n.position.x - self.position.x) < 2
    );
    const byY = new Map(column.map((n) => [Math.round(n.position.y), n]));
    const y = Math.round(self.position.y);
    let size = 1;
    for (const dir of [-1, 1]) {
      let yy = y + dir * STACK_PITCH;
      while (byY.has(yy)) {
        size++;
        yy += dir * STACK_PITCH;
      }
    }
    return {
      above: byY.has(y - STACK_PITCH),
      below: byY.has(y + STACK_PITCH),
      stackSize: size,
      duplicate
    };
  }, (a, b) => a.above === b.above && a.below === b.below && a.stackSize === b.stackSize && a.duplicate === b.duplicate);

  if (!item) return null;

  const note = item.userNote;
  // Pieces seated in a tray are organized TILES (flat rounded rects), not
  // loose puzzle pieces — so the tray reads like a tidy bento box and no
  // notch/tab ever dangles inside it. Only FREE chips wear the puzzle shape.
  const docked = !!parentId;
  const inStack = !docked && (above || below);
  const isTop = inStack && !above;
  const isBottom = inStack && !below;
  const meta = MEDIA_TYPES[item.type];
  // Banner image: YouTube/image thumbnail (image sources keep their hosted URL
  // in `source`). Other types have none → the banner shows a type glyph.
  const thumb =
    item.thumbnail || (item.type === 'image' ? item.source : undefined);
  const pulse = !!d.pulse; // a citation in some brain is pointing at this piece
  const snapTarget = !!d.snapTarget; // a dragged piece is about to click onto this
  const settle = (d.settle as number) ?? 0;

  // Free chip = full puzzle shape; bottom of a welded column = flat bottom
  // (no dangling tab); docked tile = clean rounded rectangle (no clip).
  const clipPath = docked
    ? undefined
    : isBottom
    ? CHIP_CLIP_FLATBOTTOM
    : CHIP_CLIP;
  const bodyH = docked ? CHIP_H : CHIP_H + CHIP_TAB;

  // Seamless monolith: in-stack pieces drop their individual card shadows —
  // only the block's exposed top/bottom edges cast, so the stack reads as
  // ONE object. snapTarget = about to weld; pulse = a hovered citation.
  const filter = snapTarget
    ? 'drop-shadow(0 0 0.5px hsl(var(--accent))) drop-shadow(0 0 12px hsl(var(--accent)/0.85))'
    : pulse
    ? 'drop-shadow(0 0 10px hsl(var(--accent)/0.9)) drop-shadow(0 2px 8px hsl(var(--accent)/0.4))'
    : selected
    ? 'drop-shadow(0 0 0.5px hsl(var(--accent))) drop-shadow(0 2px 8px hsl(var(--accent)/0.45))'
    : docked
    ? 'drop-shadow(0 1px 2px rgb(0 0 0/0.10))'
    : inStack
    ? [
        'drop-shadow(0 0 1px rgb(0 0 0/0.05))',
        isTop ? 'drop-shadow(0 -1px 3px rgb(0 0 0/0.04))' : '',
        isBottom ? 'drop-shadow(0 4px 10px rgb(0 0 0/0.10))' : ''
      ]
        .filter(Boolean)
        .join(' ')
    : 'drop-shadow(0 1px 2px rgb(0 0 0/0.08)) drop-shadow(0 4px 10px rgb(0 0 0/0.07))';

  return (
    <div
      key={`settle-${settle}`}
      style={{
        width: CHIP_W,
        height: bodyH,
        filter
      }}
      className={cn(
        'group relative transition-all',
        settle > 0 && 'animate-stack-settle',
        snapTarget && 'animate-pulse',
        // a duplicate copy reads as redundant — desaturated + faded
        duplicate && !snapTarget && 'opacity-55 grayscale'
      )}
    >
      {/* un-snap (✂) — sits in the seam between this piece and the one above;
          click to split the stack here (this piece + below detach). Always
          faintly visible so it's discoverable, solid on hover. Pieces stay
          welded otherwise, so dragging never accidentally disconnects. */}
      {above && (
        <button
          title="Un-snap here"
          onClick={(e) => {
            e.stopPropagation();
            unsnapPiece(id);
          }}
          className="nodrag absolute -top-2.5 left-1/2 z-20 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-card bg-card text-muted-foreground/70 opacity-55 shadow-[0_1px_5px_rgb(0_0_0/0.18)] transition-all hover:scale-110 hover:text-accent hover:opacity-100 group-hover:opacity-100"
        >
          <Scissors className="h-2.5 w-2.5" />
        </button>
      )}
      {duplicate && (
        <span
          title="Duplicate — this source is already on the board. An Answers Bank only counts it once."
          className="absolute -right-2 -top-2 z-10 rounded-full bg-foreground px-2 py-0.5 text-[9px] font-black uppercase tracking-tighter text-background shadow-md ring-1 ring-white/10"
        >
          dup
        </span>
      )}
      {/* citation pulse: an expanding ripple anchors the cited text to this
          physical piece on the board */}
      {pulse && (
        <span className="pointer-events-none absolute -inset-1.5 animate-cite-ripple rounded-[16px] border-2 border-accent" />
      )}
      {/* body — puzzle piece when free, clean tile when seated in a tray */}
      <div
        style={{ width: CHIP_W, height: bodyH, clipPath }}
        className={cn(
          'absolute inset-0 bg-card dark:bg-card',
          docked && 'rounded-[11px] ring-1 ring-black/[0.04] dark:ring-white/[0.06]'
        )}
      />
      {/* docked tile: a slim type-colored spine on the left edge keeps the
          family colour-coded without the puzzle silhouette */}
      {docked && (
        <div
          className={cn(
            'pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] rounded-l-[11px]',
            meta.solid
          )}
        />
      )}
      {/* welded-stack treatment: glowing spine rail binding the layers,
          laser-cut seams where pieces meet, faint type wash — and a hover
          illumination on the individual piece (telegraphs separability) */}
      {inStack && (
        <div
          style={{
            clipPath,
            width: CHIP_W,
            height: CHIP_H + CHIP_TAB
          }}
          className="pointer-events-none absolute inset-0"
        >
          {/* spine glow bleed */}
          <div
            className={cn(
              'absolute bottom-0 left-0 top-0 w-[7px] opacity-50 blur-[5px]',
              meta.solid
            )}
          />
          {/* the rail itself — flashes once when a snap lands */}
          <div
            className={cn(
              'absolute bottom-0 left-0 top-0 w-[5px]',
              meta.solid,
              settle > 0 && 'animate-spine-flash'
            )}
          />
          {/* faint type wash over the whole piece */}
          <div className={cn('absolute inset-0 opacity-[0.05]', meta.solid)} />
          {/* laser-cut seam where this piece meets the one above */}
          {above && (
            <div className="absolute left-0 right-0 top-0 h-px bg-black/[0.08] dark:bg-white/[0.10]" />
          )}
          {/* hover: illuminate THIS piece within the welded block */}
          <div
            className={cn(
              'absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-[0.08]',
              meta.solid
            )}
          />
        </div>
      )}
      {/* CARD: a thumbnail/preview banner on top, a title bar below. YouTube +
          image pieces show their picture; everything else shows a big type
          glyph in the banner so all pieces stay the SAME size. Clipped to the
          puzzle silhouette so the banner takes the notch/tab shape too. */}
      <div
        style={{ height: CHIP_H, ...(clipPath ? { clipPath } : {}) }}
        className={cn(
          'relative flex flex-col overflow-hidden',
          docked && 'rounded-[11px]'
        )}
      >
        {/* banner */}
        <div
          style={{ height: CHIP_H - CHIP_TITLE_H }}
          className="relative shrink-0 overflow-hidden"
        >
          {thumb ? (
            <>
              <img
                src={thumb}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
              />
              {item.type === 'youtube' && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-[1px]">
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                  </span>
                </span>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-black/[0.035] dark:bg-white/[0.05]">
              <MediaIcon type={item.type} size="lg" />
            </div>
          )}
          {item.status === 'processing' && (
            <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Indexing
            </span>
          )}
          {item.status === 'failed' && (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
              Failed
            </span>
          )}
        </div>
        {/* title bar */}
        <div
          style={{ height: CHIP_TITLE_H }}
          className="relative flex items-center gap-2 px-2.5"
        >
          <MediaIcon type={item.type} size="sm" />
          <div
            title={item.status === 'indexed' ? `${item.chunks} chunks` : undefined}
            className="line-clamp-2 min-w-0 flex-1 text-[12px] font-semibold leading-[1.18]"
          >
            {item.name}
          </div>
        </div>
      </div>

      {/* one-piece badge: frosted glass, floating on the stack's top-right
          perimeter — metadata for the whole physical object, not printed on
          the top chip. Wire ANY piece, get them all. */}
      {isTop && stackSize > 1 && (
        <span
          title={`A stack of ${stackSize} — wiring any piece wires them all. Drag up/down to move the whole stack; yank a piece sideways to pop it out.`}
          className={cn(
            'absolute -right-2 -top-2.5 z-10 flex items-center gap-1 rounded-full border border-white/50 bg-white/70 px-1.5 py-0.5 text-[9.5px] font-bold shadow-[0_2px_8px_rgb(0_0_0/0.14)] backdrop-blur-md dark:border-white/15 dark:bg-white/10',
            meta.text
          )}
        >
          <Layers className="h-2.5 w-2.5" />
          {stackSize}
        </span>
      )}

      {/* user note (schema v2 user_note) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              'nodrag absolute -top-1.5 flex h-5 w-5 items-center justify-center rounded-full',
              // the frosted ⧉N badge owns the top-right corner on a stack top
              isTop && stackSize > 1 ? '-left-1.5' : '-right-1.5',
              'bg-card shadow-[0_1px_4px_rgb(0_0_0/0.12)] transition-opacity',
              note
                ? 'text-amber-500 opacity-100'
                : 'text-muted-foreground/50 opacity-0 group-hover:opacity-100'
            )}
            onClick={(e) => {
              e.stopPropagation();
              const next = window.prompt('Note on this source:', note ?? '');
              if (next !== null) updateMedia(item.id, { userNote: next });
            }}
          >
            <StickyNote className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        {note && (
          <TooltipContent side="top" className="max-w-[220px] text-[11px]">
            {note}
          </TooltipContent>
        )}
      </Tooltip>

      {/* send back to the Chest (remove from board) */}
      <button
        title="Send back to the Chest (remove from board)"
        onClick={(e) => {
          e.stopPropagation();
          removeBoardNode(id);
        }}
        className="nodrag absolute -bottom-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground/60 opacity-0 shadow-[0_1px_4px_rgb(0_0_0/0.12)] transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <RotateCcw className="h-2.5 w-2.5" />
      </button>

      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!h-4 !w-4 !border-2 !border-card !bg-accent/70',
          // Docked in a box: the BOX is the plug — one wire per family, so a
          // piece "in the box but not wired" can never exist.
          parentId && '!pointer-events-none !opacity-0',
          // Lower stack members: the stack is one piece — nudge wiring to the
          // top, but pulse awake when this piece is hovered (any piece works).
          !parentId && above && '!opacity-30 group-hover:!opacity-100',
          !parentId && inStack && 'group-hover:animate-pulse'
        )}
      />
    </div>
  );
}

export const ChipNode = memo(ChipNodeInner);
