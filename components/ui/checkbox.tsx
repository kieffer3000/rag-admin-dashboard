'use client';

import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * Renders a <span>, not a <button>: rows often place this inside their own
 * <button>, and nested buttons are invalid HTML (hydration errors). With
 * `onCheckedChange` it is its own interactive checkbox (role + keyboard);
 * without it, it's a purely decorative indicator driven by the parent.
 */
export function Checkbox({
  checked = false,
  indeterminate = false,
  onCheckedChange,
  className,
  ...props
}: CheckboxProps) {
  const interactive = !!onCheckedChange;
  return (
    <span
      {...(interactive
        ? {
            role: 'checkbox',
            'aria-checked': indeterminate ? ('mixed' as const) : checked,
            tabIndex: 0,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              onCheckedChange!(!checked);
            },
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                onCheckedChange!(!checked);
              }
            }
          }
        : { 'aria-hidden': true })}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-all duration-150',
        interactive && 'cursor-pointer',
        checked || indeterminate
          ? 'border-accent bg-accent text-accent-foreground shadow-sm'
          : 'border-input bg-white hover:border-accent/60',
        className
      )}
      {...props}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </span>
  );
}
