'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessagesSquare, Library, Sparkles, Menu, Boxes } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Chat', icon: MessagesSquare },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/prompts', label: 'Prompts', icon: Sparkles }
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="icon" variant="ghost" className="lg:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-4">
        <Link href="/" className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
            <Boxes className="h-[18px] w-[18px]" />
          </div>
          <span className="text-[15px] font-semibold">Atlas</span>
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
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium',
                  active ? 'bg-secondary text-foreground' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
