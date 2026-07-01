import { SignIn } from '@clerk/nextjs';

// AnswersDoc brand — kept in sync with components/rag/board/brand-splash.tsx
const CREAM = '#efe9da';
const CHARCOAL = '#2b2d33';

// The AnswersDoc mark (comma head + sweeping tail inside a ring), crisp at any size.
function AnswersDocMark({ size = 132, color = CHARCOAL }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="AnswersDoc"
    >
      <circle cx="50" cy="50" r="45" fill="none" stroke={color} strokeWidth="2.4" />
      <g fill={color}>
        <circle cx="52" cy="39" r="15" />
        <path d="M40 46 C 37.5 57, 41.5 67.5, 45 74 C 48.5 67, 53.5 59.5, 61 53.5 C 56.5 48.5, 47.5 44.5, 40 46 Z" />
        <circle cx="61" cy="64.5" r="5.6" />
      </g>
    </svg>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-screen w-full">
      {/* ── Left: sign-in ───────────────────────────────────────────── */}
      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-background p-6 lg:w-1/2">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-400/20 to-violet-500/10 blur-3xl" />

        {/* Compact brand header — only shows on small screens (the right panel carries it on desktop) */}
        <div className="relative mb-8 flex flex-col items-center text-center lg:hidden">
          <div className="mb-4">
            <AnswersDocMark size={64} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to <span className="text-accent">answersDoc</span>
          </h1>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            Your team&apos;s knowledge base. Chat with your documents, videos and
            notes — with citations.
          </p>
        </div>

        <div className="relative">
          <SignIn />
        </div>
      </div>

      {/* ── Right: branded logo panel (desktop only) ────────────────── */}
      <div
        className="relative hidden w-1/2 flex-col items-center justify-center overflow-hidden lg:flex"
        style={{ background: CREAM }}
      >
        <div className="pointer-events-none absolute -bottom-32 -right-24 h-[520px] w-[520px] rounded-full bg-black/[0.03] blur-2xl" />
        <div className="pointer-events-none absolute -top-24 -left-20 h-[420px] w-[420px] rounded-full bg-black/[0.03] blur-2xl" />

        <div className="relative flex flex-col items-center text-center">
          <AnswersDocMark size={148} />
          <h2
            className="mt-8 text-4xl font-semibold tracking-tight"
            style={{ color: CHARCOAL }}
          >
            answersDoc
          </h2>
          <p
            className="mt-4 max-w-sm text-[15px] leading-relaxed"
            style={{ color: 'rgba(43,45,51,0.72)' }}
          >
            Your team&apos;s knowledge base. Chat with your documents, videos and
            notes — every answer cited to its source.
          </p>
        </div>
      </div>
    </div>
  );
}
