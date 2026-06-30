import { Analytics } from '@vercel/analytics/react';
import { Sidebar } from '@/components/rag/sidebar';
import { MobileNav } from '@/components/rag/mobile-nav';
import { ThemeToggle } from '@/components/rag/theme-toggle';
import { StreamStyleToggle } from '@/components/rag/stream-style-toggle';
import { ScrollStyleToggle } from '@/components/rag/scroll-style-toggle';
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
      {/* h-screen (100vh) overshoots on iOS/iPad Safari — it includes the
          address bar, pushing the bottom (composer/menu) off-screen under
          overflow-hidden. height:100dvh = the VISIBLE viewport; the h-screen
          class stays as the 100vh fallback for browsers without dvh. */}
      <div
        className="flex h-screen w-full overflow-hidden bg-background"
        style={{ height: '100dvh' }}
      >
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 bg-transparent px-4">
            <MobileNav />
            <div className="flex-1" />
            <ScrollStyleToggle />
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
