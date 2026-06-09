'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessagesSquare, Library, Sparkles, Boxes } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Chat', icon: MessagesSquare },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/prompts', label: 'Prompts', icon: Sparkles }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[228px] shrink-0 flex-col border-r border-border/70 bg-white/40 px-3 py-4 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
          <Boxes className="h-[18px] w-[18px]" strokeWidth={2.25} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">Atlas</div>
          <div className="text-[11px] text-muted-foreground">Knowledge Base</div>
        </div>
      </Link>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-white text-foreground shadow-soft'
                  : 'text-muted-foreground hover:bg-white/70 hover:text-foreground'
              )}
            >
              <Icon
                className={cn(
                  'h-[18px] w-[18px] transition-colors',
                  active ? 'text-accent' : 'text-muted-foreground group-hover:text-foreground'
                )}
                strokeWidth={2.1}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-border/70 bg-white/60 p-3.5">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
          Vector store
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Gemini Embedding 2 · Pinecone
        </p>
      </div>
    </aside>
  );
}
