'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ThemeToggle({ rail = false }: { rail?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const root = document.documentElement;
    root.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
        rail
          ? 'text-white/75 hover:bg-white/10 hover:text-white'
          : 'text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground'
      )}
    >
      <Sun
        className={cn(
          'absolute h-[18px] w-[18px] transition-all duration-300',
          dark ? 'scale-0 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'
        )}
      />
      <Moon
        className={cn(
          'absolute h-[18px] w-[18px] transition-all duration-300',
          dark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 rotate-90 opacity-0'
        )}
      />
    </button>
  );
}
