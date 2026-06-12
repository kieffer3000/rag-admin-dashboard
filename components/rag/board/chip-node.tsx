'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { MediaIcon } from '@/components/rag/shared';
import { Loader2, StickyNote } from 'lucide-react';
import {
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
  CHIP_CLIP,
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
  if (!item) return null;

  const note = item.userNote;

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
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-accent/70"
      />
    </div>
  );
}

export const ChipNode = memo(ChipNodeInner);
