import { SignUp } from '@clerk/nextjs';

// AnswersDoc brand — kept in sync with the sign-in page + brand-splash.tsx
const CREAM = '#efe9da';
const CHARCOAL = '#2b2d33';
const LOGO_SRC = '/answersdoc-logo.png';

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen w-full">
      {/* ── Left: sign-up ───────────────────────────────────────────── */}
      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-background p-6 lg:w-1/2">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-400/20 to-violet-500/10 blur-3xl" />

        <div className="relative mb-8 flex flex-col items-center text-center lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_SRC} alt="AnswersDoc" width={72} height={72} className="mb-4" draggable={false} />
          <h1 className="text-2xl font-semibold tracking-tight">
            Join <span className="text-accent">answersDoc</span>
          </h1>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            Create your account — or accept your team&apos;s invitation.
          </p>
        </div>

        <div className="relative">
          <SignUp signInUrl="/sign-in" />
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_SRC} alt="AnswersDoc" width={180} height={180} draggable={false} />
          <h2 className="mt-8 text-4xl font-semibold tracking-tight" style={{ color: CHARCOAL }}>
            answersDoc
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed" style={{ color: 'rgba(43,45,51,0.72)' }}>
            Your team&apos;s knowledge base. Chat with your documents, videos and
            notes — every answer cited to its source.
          </p>
        </div>
      </div>
    </div>
  );
}
