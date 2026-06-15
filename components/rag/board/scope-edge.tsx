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
  markerEnd,
  animated
}: EdgeProps) {
  const { removeBoardEdge } = useBoard();
  const [hover, setHover] = useState(false);
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    // Lower curvature → shorter control arms → a tauter, more intentional
    // cable that doesn't dip into a loose "U".
    curvature: 0.18
  });

  // Disconnect button position: a FIXED distance OUT from the source handle,
  // not the shared midpoint. Many cables converging on one brain all cross the
  // same midpoint — their ✕ buttons stack there and only the top one is
  // clickable. Anchoring each cut point beside its OWN source fans them apart,
  // so every wire stays individually reachable. Clamped so short cables still
  // place the button off the endpoints.
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const f = Math.min(0.42, Math.max(0.12, 54 / len));
  const cutX = sourceX + dx * f;
  const cutY = sourceY + dy * f;

  return (
    <>
      {/* soft underglow so the cable feels like it rests ON the desk */}
      <path
        d={edgePath}
        fill="none"
        stroke="hsl(var(--accent) / 0.22)"
        strokeWidth={5}
        strokeLinecap="round"
        style={{ filter: 'blur(2px)' }}
      />
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {/* thinking: energy flows source → brain like an illuminated fiber-optic
          cable — a soft glow under a travelling pulse of light. Renders ONLY
          while this edge's brain has a query in flight (idle = still). */}
      {animated && (
        <>
          <path
            d={edgePath}
            fill="none"
            stroke="hsl(var(--accent) / 0.45)"
            strokeWidth={4}
            strokeLinecap="round"
            style={{ filter: 'blur(3px)' }}
          />
          <path
            d={edgePath}
            fill="none"
            stroke="hsl(var(--accent))"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeDasharray="14 118"
            className="edge-flow"
          />
        </>
      )}
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
            transform: `translate(-50%, -50%) translate(${cutX}px, ${cutY}px)`,
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
