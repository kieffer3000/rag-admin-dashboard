'use client';

import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/rag/board/store';
import type { AnnotationData } from '@/lib/rag/board/types';

/** Sticky note — purely visual, never wired, never queried. */
function AnnotationNodeInner({ id, data, selected }: NodeProps) {
  const d = data as AnnotationData;
  const { updateBoardNodeData } = useBoard();

  return (
    <div
      className={cn(
        'w-[200px] rounded-[14px] bg-amber-100/90 p-2.5 shadow-[0_2px_10px_rgb(0_0_0/0.08)] dark:bg-amber-300/15',
        selected && 'ring-2 ring-amber-400/70'
      )}
    >
      <textarea
        value={d.text}
        onChange={(e) => updateBoardNodeData(id, { text: e.target.value })}
        placeholder="Note to self…"
        rows={3}
        className="nodrag block w-full resize-none bg-transparent text-[12px] leading-relaxed text-amber-900 outline-none placeholder:text-amber-900/40 dark:text-amber-200"
      />
    </div>
  );
}

export const AnnotationNode = memo(AnnotationNodeInner);
