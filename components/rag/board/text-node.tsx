'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Type } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import type { TextNodeData } from '@/lib/rag/board/types';

/**
 * Ephemeral context node ("Your Goal or Offer"). Wired text rides into the
 * brain's PROMPT — it is never indexed into the knowledge base.
 */
function TextNodeInner({ id, data, selected }: NodeProps) {
  const d = data as TextNodeData;
  const { updateBoardNodeData } = useBoard();

  return (
    <div
      className={cn(
        'w-[230px] overflow-hidden rounded-[16px] bg-card',
        'shadow-[0_1px_3px_rgb(0_0_0/0.05),0_8px_24px_rgb(0_0_0/0.06)]',
        'dark:ring-1 dark:ring-white/[0.07]',
        selected && 'ring-2 ring-accent/60 dark:ring-accent/60'
      )}
    >
      <div className="flex items-center gap-1.5 bg-sky-500/[0.08] px-3 py-1.5">
        <Type className="h-3 w-3 text-sky-600" />
        <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-400">
          Context note
        </span>
        <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground/50">
          not indexed
        </span>
      </div>
      <textarea
        value={d.text}
        onChange={(e) => updateBoardNodeData(id, { text: e.target.value })}
        placeholder="Goal, instructions, extra context for the brain…"
        rows={3}
        className="nodrag block w-full resize-none bg-transparent px-3 py-2 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/40"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-sky-500"
      />
    </div>
  );
}

export const TextNode = memo(TextNodeInner);
