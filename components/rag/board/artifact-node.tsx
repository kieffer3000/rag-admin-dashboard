'use client';

import { memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { FileText, X } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import { CHIP_W, CHIP_H, type ArtifactData } from '@/lib/rag/board/types';

/**
 * ARTIFACT (right plug) — the user's own working doc the wired corpus reasons
 * ABOUT in Opine mode (critique / improve / continue). Carried WHOLE into the
 * prompt, NEVER indexed (it must not pollute the knowledge base). Wire it to a
 * brain alongside a corpus → the brain opines on it. One artifact per brain.
 */
function ArtifactNodeInner({ id, data, selected, parentId }: NodeProps) {
  const d = data as ArtifactData;
  const { updateBoardNodeData, removeBoardNode } = useBoard();

  // Docked in a box → compact tile.
  if (parentId) {
    return (
      <div
        style={{ width: CHIP_W, height: CHIP_H }}
        title={d.title || 'Artifact'}
        className={cn(
          'relative flex items-center gap-2 overflow-hidden rounded-[11px] bg-card px-3 ring-1 ring-black/[0.04] dark:ring-white/[0.06]',
          'shadow-[0_1px_2px_rgb(0_0_0/0.10)]',
          selected && 'ring-2 ring-indigo-400/60'
        )}
      >
        <span className="pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] rounded-l-[11px] bg-indigo-500" />
        <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
            Artifact
          </span>
          <span className="block truncate text-[10px] text-muted-foreground/70">
            {d.title?.trim() || d.content?.trim()?.slice(0, 40) || 'empty'}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-[150px] w-full min-w-[220px] flex-col overflow-hidden rounded-[16px] bg-card',
        'shadow-[0_1px_3px_rgb(0_0_0/0.05),0_8px_24px_rgb(0_0_0/0.06)]',
        'dark:ring-1 dark:ring-white/[0.07]',
        selected && 'ring-2 ring-indigo-400/60'
      )}
    >
      <NodeResizer
        minWidth={210}
        minHeight={150}
        isVisible={selected}
        lineClassName="!border-indigo-400/40"
        handleClassName="!h-2.5 !w-2.5 !rounded-full !border !border-white/70 !bg-indigo-500"
      />
      <div className="flex shrink-0 cursor-grab items-center gap-1.5 bg-indigo-500/[0.08] px-3 py-1.5 active:cursor-grabbing">
        <FileText className="h-3 w-3 text-indigo-600" />
        <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
          Artifact
        </span>
        <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground/50">
          not indexed
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeBoardNode(id);
          }}
          title="Remove this artifact"
          className="nodrag ml-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        value={d.title ?? ''}
        onChange={(e) => updateBoardNodeData(id, { title: e.target.value })}
        placeholder="Title (e.g. Best Running Shoes 2026)"
        className="nodrag block w-full shrink-0 border-b border-black/[0.04] bg-transparent px-3 py-1.5 text-[12px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/40 dark:border-white/[0.06]"
      />
      <input
        value={d.url ?? ''}
        onChange={(e) => updateBoardNodeData(id, { url: e.target.value })}
        placeholder="URL (optional)"
        className="nodrag block w-full shrink-0 border-b border-black/[0.04] bg-transparent px-3 py-1 text-[10px] text-muted-foreground outline-none placeholder:text-muted-foreground/40 dark:border-white/[0.06]"
      />
      <textarea
        value={d.content ?? ''}
        onChange={(e) => updateBoardNodeData(id, { content: e.target.value })}
        placeholder="Paste the article / webpage / draft to critique or improve…"
        className="nodrag block min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-2 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/40"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-indigo-500"
      />
    </div>
  );
}

export const ArtifactNode = memo(ArtifactNodeInner);
