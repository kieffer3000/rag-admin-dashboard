'use client';

import { cn } from '@/lib/utils';
import { MediaType, MediaStatus } from '@/lib/rag/types';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { Loader2, CircleCheck, CircleAlert } from 'lucide-react';

export function MediaIcon({
  type,
  size = 'md',
  className
}: {
  type: MediaType;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const meta = MEDIA_TYPES[type];
  const Icon = meta.icon;
  const dims =
    size === 'sm' ? 'h-7 w-7 rounded-lg' : size === 'lg' ? 'h-11 w-11 rounded-2xl' : 'h-9 w-9 rounded-xl';
  const iconDims = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center',
        meta.tint,
        meta.text,
        dims,
        className
      )}
    >
      <Icon className={iconDims} strokeWidth={2.25} />
    </div>
  );
}

export function StatusBadge({ status }: { status: MediaStatus }) {
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#FF9F0A]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#9A6B00] dark:text-[#FFD60A]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Processing
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#FF3B30]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#C0271D] dark:text-[#FF6961]">
        <CircleAlert className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#34C759]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#248A3D] dark:text-[#30D158]">
      <CircleCheck className="h-3 w-3" />
      Indexed
    </span>
  );
}

export function TypeChip({ type }: { type: MediaType }) {
  const meta = MEDIA_TYPES[type];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        meta.tint,
        meta.text
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}
