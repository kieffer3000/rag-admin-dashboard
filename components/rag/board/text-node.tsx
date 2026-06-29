'use client';

import { memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Type, X } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import { CHIP_W, CHIP_H, type TextNodeData } from '@/lib/rag/board/types';

/**
 * Ephemeral context node ("Your Goal or Offer"). Wired text rides into the
 * brain's PROMPT — it is never indexed into the knowledge base. Drag by the
 * header; resize from the corners when selected. When docked inside a box it
 * renders as a compact context tile (the box becomes its plug).
 */
function TextNodeInner({ id, data, selected, parentId }: NodeProps) {
  const d = data as TextNodeData;
  const { updateBoardNodeData, removeBoardNode } = useBoard();

  // Docked in a box → compact context tile that fits the grid.
  if (parentId) {
    return (
      <div
        style={{ width: CHIP_W, height: CHIP_H }}
        title={d.text || 'Context note'}
        className={cn(
          'relative flex items-center gap-2 overflow-hidden rounded-[11px] bg-card px-3 ring-1 ring-black/[0.04] dark:ring-white/[0.06]',
          'shadow-[0_1px_2px_rgb(0_0_0/0.10)]',
          selected && 'ring-2 ring-sky-400/60'
        )}
      >
        <span className="pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] rounded-l-[11px] bg-sky-500" />
        <Type className="h-3.5 w-3.5 shrink-0 text-sky-600" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[11px] font-semibold text-sky-700 dark:text-sky-400">
            Context note
          </span>
          <span className="block truncate text-[10px] text-muted-foreground/70">
            {d.text?.trim() || 'empty'}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-[112px] w-full min-w-[200px] flex-col overflow-hidden rounded-[16px] bg-card',
        'shadow-[0_1px_3px_rgb(0_0_0/0.05),0_8px_24px_rgb(0_0_0/0.06)]',
        'dark:ring-1 dark:ring-white/[0.07]',
        selected && 'ring-2 ring-accent/60 dark:ring-accent/60'
      )}
    >
      <NodeResizer
        minWidth={190}
        minHeight={96}
        isVisible={selected}
        lineClassName="!border-sky-400/40"
        handleClassName="!h-2.5 !w-2.5 !rounded-full !border !border-white/70 !bg-sky-500"
      />
      <div className="flex shrink-0 cursor-grab items-center gap-1.5 bg-sky-500/[0.08] px-3 py-1.5 active:cursor-grabbing">
        <Type className="h-3 w-3 text-sky-600" />
        <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-400">
          Context note
        </span>
        <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground/50">
          not indexed
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeBoardNode(id);
          }}
          title="Remove this note"
          className="nodrag ml-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea
        value={d.text}
        onChange={(e) => updateBoardNodeData(id, { text: e.target.value })}
        placeholder="Goal, instructions, extra context for the brain…"
        className="nodrag block min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/40"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-4 !w-4 !border-2 !border-card !bg-sky-500"
      />
    </div>
  );
}

export const TextNode = memo(TextNodeInner);
