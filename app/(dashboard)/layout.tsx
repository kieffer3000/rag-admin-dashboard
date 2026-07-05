import { Analytics } from '@vercel/analytics/react';
import { Sidebar } from '@/components/rag/sidebar';
import { MobileNav } from '@/components/rag/mobile-nav';
import { ThemeToggle } from '@/components/rag/theme-toggle';
import { SoundToggle } from '@/components/rag/sound-toggle';
import { HelpBot } from '@/components/rag/help-bot';
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
          <header className="sticky top-0 z-30 flex shrink-0 flex-col bg-transparent px-4 pt-1.5">
            <div className="flex h-11 items-center gap-3">
              <MobileNav />
              <div className="flex-1" />
              <HelpBot />
              <SoundToggle />
              <ThemeToggle />
              <User />
            </div>
            {/* Brand wordmark — quietly anchors the top-right, beneath the menu. */}
            <div className="pointer-events-none -mt-0.5 pb-1 pr-1 text-right">
              <span className="select-none text-[12.5px] font-bold tracking-tight text-accent/85">
                answers<span className="text-foreground/70">Doc</span>
              </span>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
        <SourceViewer />
      </div>
      <Analytics />
    </Providers>
  );
}
