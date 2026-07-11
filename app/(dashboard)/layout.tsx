import { Analytics } from '@vercel/analytics/react';
import { Sidebar } from '@/components/rag/sidebar';
import { MobileNav } from '@/components/rag/mobile-nav';
import { ThemeToggle } from '@/components/rag/theme-toggle';
import { SoundToggle } from '@/components/rag/sound-toggle';
import { HelpBot } from '@/components/rag/help-bot';
import { SourceViewer } from '@/components/rag/source-viewer';
import { SelectCopy } from '@/components/rag/select-copy';
import { User } from '@/components/rag/user';
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
          {/* 3.30: the desktop top bar is GONE — its controls (help / sound /
              theme / account) live at the bottom of the rail, the wordmark
              under the rail logo. This header survives ONLY on mobile, where
              the rail is hidden and something must hold the menu + account. */}
          <header className="sticky top-0 z-30 flex h-11 shrink-0 items-center gap-3 bg-transparent px-4 pt-1.5 lg:hidden">
            <MobileNav />
            <div className="flex-1" />
            <HelpBot />
            <SoundToggle />
            <ThemeToggle />
            <User />
          </header>
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
        <SelectCopy />
        <SourceViewer />
      </div>
      <Analytics />
    </Providers>
  );
}
