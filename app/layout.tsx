import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import { ClerkProvider } from '@clerk/nextjs';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
});

export const metadata: Metadata = {
  title: 'answersDoc — Knowledge Base',
  description:
    'A beautiful RAG knowledge base. Chat with your documents, videos, audio and notes — grounded answers with citations.'
};

// iOS/iPad Safari: maximumScale 1 stops the jarring auto-zoom when a small input
// is focused (the app has its own A+ text scaling for accessibility, so manual
// readability isn't lost).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&m)){document.documentElement.classList.add('dark');}}catch(e){}})();`
          }}
        />
      </head>
      <body className="min-h-screen font-sans">
        {/* Clerk rule: provider inside <body>, not wrapping <html> */}
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: '#5E5CE6',
              borderRadius: '0.875rem',
              fontFamily: 'var(--font-inter), system-ui, sans-serif'
            }
          }}
        >
          {children}
        </ClerkProvider>
      </body>
      <Analytics />
    </html>
  );
}
