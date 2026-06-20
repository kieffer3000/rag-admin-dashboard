'use client';

import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps
} from '@xyflow/react';
import { Scissors } from 'lucide-react';
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
  const [edgePath, labelX, labelY] = getBezierPath({
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

  // Cut button at the cable's MIDPOINT — out in open space between the piece and
  // the brain, so it never sits over a node (which was swallowing the click).
  // The whole wire is ALSO clickable to cut, so you don't even need the button.
  const cutX = labelX;
  const cutY = labelY;
  const cut = () => removeBoardEdge(id);

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
      {/* fat transparent hit-area: hover highlights, and a CLICK anywhere on the
          wire cuts it (no need to hit the little scissors). */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          cut();
        }}
      />
      <EdgeLabelRenderer>
        {/* A scissor sits on EVERY cable, always visible (so each connection is
            individually snippable at a glance — no hover-hunting). It rests
            subtle and lifts to full red on hover. Anchored beside its own
            source (cutX/cutY) so many cables don't stack their scissors. */}
        <button
          title="Cut this connection"
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
            'nodrag nopan flex h-[22px] w-[22px] items-center justify-center rounded-full ring-2 ring-card transition-all duration-150',
            hover
              ? 'scale-110 bg-red-500 text-white shadow-[0_2px_8px_rgb(239_68_68/0.5)]'
              : 'scale-100 bg-card text-red-500/80 opacity-85 shadow-[0_1px_5px_rgb(0_0_0/0.22)]'
          )}
        >
          <Scissors className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
