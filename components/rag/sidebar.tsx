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
    <aside className="glass hidden w-[228px] shrink-0 flex-col border-r border-[rgb(var(--hairline)/0.08)] px-3 py-4 lg:flex">
      <Link href="/" className="mb-7 flex items-center gap-2.5 px-2">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-[12px] bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_4px_16px_hsl(var(--accent)/0.4)]">
          <Boxes className="h-[19px] w-[19px]" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">Atlas</div>
          <div className="text-[11px] text-muted-foreground/70">Knowledge Base</div>
        </div>
      </Link>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-sm font-medium transition-all duration-150',
                active
                  ? 'border border-[rgb(var(--hairline)/0.1)] bg-[rgb(var(--hairline)/0.06)] text-foreground shadow-[inset_0_1px_0_rgb(var(--hairline)/0.08)]'
                  : 'border border-transparent text-muted-foreground hover:bg-[rgb(var(--hairline)/0.04)] hover:text-foreground'
              )}
            >
              <Icon
                className={cn(
                  'h-[18px] w-[18px] transition-colors',
                  active ? 'text-accent' : 'text-muted-foreground group-hover:text-foreground'
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="card-glass mt-auto rounded-[18px] p-3.5">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Vector store
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/70">
          Gemini Embedding · Pinecone
        </p>
      </div>
    </aside>
  );
}
