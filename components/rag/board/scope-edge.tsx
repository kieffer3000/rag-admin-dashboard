'use client';

import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps
} from '@xyflow/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/rag/board/store';

/**
 * Scope connection (source/hub → brain). Hovering the line reveals a red ✕ at
 * its midpoint; click it to disconnect. (Selecting + Delete still works too.)
 */
export function ScopeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd
}: EdgeProps) {
  const { removeBoardEdge } = useBoard();
  const [hover, setHover] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {/* brighten the line while it's armed for disconnect */}
      {hover && (
        <path
          d={edgePath}
          fill="none"
          stroke="hsl(var(--accent))"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      )}
      {/* fat transparent hit-area so the line is easy to hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <EdgeLabelRenderer>
        <button
          title="Disconnect"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={(e) => {
            e.stopPropagation();
            removeBoardEdge(id);
          }}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all'
          }}
          className={cn(
            'nodrag nopan flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_2px_6px_rgb(0_0_0/0.25)] ring-2 ring-card transition-all duration-150',
            hover ? 'scale-100 opacity-100' : 'pointer-events-none scale-50 opacity-0'
          )}
        >
          <X className="h-3 w-3" strokeWidth={3} />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
