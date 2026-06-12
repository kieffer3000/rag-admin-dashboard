'use client';

import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { MediaIcon } from '@/components/rag/shared';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { Loader2, StickyNote, Layers } from 'lucide-react';
import {
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
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
  const item = media.find((m) => m.id === d.mediaId);

  // Stack awareness: interlocked same-type neighbors weld into ONE piece.
  const { above, below, stackSize } = useStore((s) => {
    const self = s.nodes.find((n) => n.id === id) as BoardNode | undefined;
    if (!self || self.parentId || !item)
      return { above: false, below: false, stackSize: 1 };
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
      stackSize: size
    };
  }, (a, b) => a.above === b.above && a.below === b.below && a.stackSize === b.stackSize);

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
  const tug = !!d.tug;
  const peel = !!d.peel;
  const pulse = !!d.pulse; // a citation in some brain is pointing at this piece
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
  // ONE object. Tug = warm "about to pop" seam glow; peel = floating lift;
  // pulse = a hovered citation proving an answer against THIS piece.
  const filter = pulse
    ? 'drop-shadow(0 0 10px hsl(var(--accent)/0.9)) drop-shadow(0 2px 8px hsl(var(--accent)/0.4))'
    : selected
    ? 'drop-shadow(0 0 0.5px hsl(var(--accent))) drop-shadow(0 2px 8px hsl(var(--accent)/0.45))'
    : peel
    ? 'drop-shadow(0 2px 4px rgb(0 0 0/0.10)) drop-shadow(0 16px 28px rgb(0 0 0/0.20))'
    : tug
    ? 'drop-shadow(0 0 7px rgb(251 146 60/0.75)) drop-shadow(0 2px 6px rgb(0 0 0/0.10))'
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
        peel && 'scale-[1.03] animate-peel-pop'
      )}
    >
      {/* citation pulse: an expanding ripple anchors the cited text to this
          physical piece on the board */}
      {pulse && (
        <span className="pointer-events-none absolute -inset-1.5 animate-cite-ripple rounded-[16px] border-2 border-accent" />
      )}
      {/* body — puzzle piece when free, clean tile when seated in a tray */}
      <div
        style={{ width: CHIP_W, height: bodyH, clipPath }}
        className={cn(
          'absolute inset-0 bg-card dark:bg-[hsl(240_8%_14%)]',
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
      <div
        style={{ height: CHIP_H }}
        className={cn(
          'relative flex items-center gap-2.5 px-2.5',
          docked ? 'pl-3' : 'pt-1'
        )}
      >
        <MediaIcon type={item.type} size="sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[12px] font-semibold">{item.name}</div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            {item.status === 'processing' ? (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin" /> Processing
              </>
            ) : item.status === 'failed' ? (
              <span className="text-red-500">Failed</span>
            ) : (
              <>{item.chunks} chunks</>
            )}
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

      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!h-2.5 !w-2.5 !border-2 !border-card !bg-accent/70',
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
