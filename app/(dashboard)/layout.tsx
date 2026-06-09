import { Analytics } from '@vercel/analytics/react';
import { Sidebar } from '@/components/rag/sidebar';
import { MobileNav } from '@/components/rag/mobile-nav';
import { User } from './user';
import Providers from './providers';

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/70 px-4">
            <MobileNav />
            <div className="flex-1" />
            <User />
          </header>
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
      <Analytics />
    </Providers>
  );
}
