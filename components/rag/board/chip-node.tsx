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
  const inStack = above || below;
  const isTop = inStack && !above;
  const meta = MEDIA_TYPES[item.type];

  return (
    <div
      style={{
        width: CHIP_W,
        height: CHIP_H + CHIP_TAB,
        filter: selected
          ? 'drop-shadow(0 0 0.5px hsl(var(--accent))) drop-shadow(0 2px 8px hsl(var(--accent)/0.45))'
          : 'drop-shadow(0 1px 2px rgb(0 0 0/0.08)) drop-shadow(0 4px 10px rgb(0 0 0/0.07))'
      }}
      className="group relative transition-all"
    >
      {/* puzzle-piece body (code.org/Scratch block): notch top, tab bottom */}
      <div
        style={{ width: CHIP_W, height: CHIP_H + CHIP_TAB, clipPath: CHIP_CLIP }}
        className="absolute inset-0 bg-card dark:bg-[hsl(240_8%_14%)]"
      />
      {/* welded-stack spine: a type-colored rail running the full column —
          interlocked pieces read as ONE block */}
      {inStack && (
        <div
          style={{
            clipPath: CHIP_CLIP,
            width: CHIP_W,
            height: CHIP_H + CHIP_TAB
          }}
          className="pointer-events-none absolute inset-0"
        >
          <div className={cn('absolute bottom-0 left-0 top-0 w-[5px]', meta.solid)} />
          <div className={cn('absolute inset-0 opacity-[0.045]', meta.solid)} />
        </div>
      )}
      <div
        style={{ height: CHIP_H }}
        className="relative flex items-center gap-2.5 px-2.5 pt-1"
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
        {/* one-piece badge on the stack's top piece: wire THIS, get them all */}
        {isTop && stackSize > 1 && (
          <span
            title={`A stack of ${stackSize} — wiring any piece wires them all`}
            className={cn(
              'flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold text-white shadow-sm',
              meta.solid
            )}
          >
            <Layers className="h-2.5 w-2.5" />
            {stackSize}
          </span>
        )}
      </div>

      {/* user note (schema v2 user_note) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              'nodrag absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full',
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
          // Lower stack members: the stack is one piece — nudge wiring to the top.
          above && '!opacity-30'
        )}
      />
    </div>
  );
}

export const ChipNode = memo(ChipNodeInner);
