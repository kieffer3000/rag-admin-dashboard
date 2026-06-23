import { Analytics } from '@vercel/analytics/react';
import { Sidebar } from '@/components/rag/sidebar';
import { MobileNav } from '@/components/rag/mobile-nav';
import { ThemeToggle } from '@/components/rag/theme-toggle';
import { StreamStyleToggle } from '@/components/rag/stream-style-toggle';
import { SourceViewer } from '@/components/rag/source-viewer';
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
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 bg-transparent px-4">
            <MobileNav />
            <div className="flex-1" />
            <StreamStyleToggle />
            <ThemeToggle />
            <User />
          </header>
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
        <SourceViewer />
      </div>
      <Analytics />
    </Providers>
  );
}
