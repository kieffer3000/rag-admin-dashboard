'use client';

import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { hubSize, type HubData } from '@/lib/rag/board/types';
import { MediaType } from '@/lib/rag/types';
import { Sparkles, Magnet } from 'lucide-react';
import { useRag } from '@/lib/rag/store';

/**
 * Magnetic typed hub — slim same-type container. Chips dock by proximity;
 * one edge from the hub wires every docked chip into a brain's scope.
 * The "everything" variant implicitly carries ALL indexed project sources.
 */
function HubNodeInner({ id, data, selected }: NodeProps) {
  const d = data as HubData;
  const { projectMedia } = useRag();
  const memberCount = useStore((s) =>
    d.mediaType === 'everything'
      ? 0
      : s.nodes.filter((n) => n.parentId === id).length
  );

  const everything = d.mediaType === 'everything';
  const meta = everything ? null : MEDIA_TYPES[d.mediaType as MediaType];
  const Icon = everything ? Sparkles : meta!.icon;
  const size = everything
    ? { width: 230, height: 86 }
    : hubSize(memberCount);
  const indexedAll = projectMedia.filter((m) => m.status === 'indexed').length;

  return (
    <div
      style={size}
      className={cn(
        // Glassmorphic tray: translucent, frosted, resting ON the dot grid.
        'relative rounded-[18px] backdrop-blur-xl transition-all',
        everything
          ? 'bg-gradient-to-br from-indigo-500/[0.09] to-violet-500/[0.13] ring-1 ring-accent/25'
          : 'bg-white/55 ring-1 ring-white/40 shadow-[0_1px_3px_rgb(0_0_0/0.04),0_8px_28px_rgb(0_0_0/0.05)] dark:bg-white/[0.045] dark:ring-white/[0.08]',
        selected && 'ring-2 ring-accent/60',
        d.glow &&
          'ring-2 ring-accent shadow-[0_0_0_5px_hsl(var(--accent)/0.14),0_8px_28px_rgb(0_0_0/0.08)]'
      )}
    >
      {/* magnetic drag-over: the tray lights up from within, in the type's hue */}
      {!everything && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[18px] transition-opacity duration-200',
            meta!.solid,
            d.glow ? 'opacity-[0.10]' : 'opacity-0'
          )}
        />
      )}
      {/* header */}
      <div className="flex h-[42px] items-center gap-2 px-3">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-lg',
            everything ? 'bg-accent/15 text-accent' : cn(meta!.tint, meta!.text)
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-tight">
          {d.name}
        </span>
        <span className="rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/[0.07]">
          {everything ? `${indexedAll} sources` : memberCount}
        </span>
      </div>

      {everything ? (
        <div className="px-3 text-[10.5px] leading-snug text-muted-foreground/70">
          Wires every indexed source in this project to the brain.
        </div>
      ) : memberCount === 0 ? (
        <div className="mx-3 flex h-[56px] items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-[rgb(var(--hairline)/0.16)] text-[10.5px] text-muted-foreground/60">
          <Magnet className="h-3 w-3" />
          drag {meta!.plural.toLowerCase()} here to dock
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-card !bg-accent"
      />
    </div>
  );
}

export const HubNode = memo(HubNodeInner);
