import { SignIn } from '@clerk/nextjs';
import { Boxes } from 'lucide-react';

export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-6">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-400/30 to-violet-500/20 blur-3xl" />

      <div className="relative mb-8 flex flex-col items-center text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-float">
          <Boxes className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Atlas</h1>
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          Your team&apos;s knowledge base. Chat with your documents, videos and
          notes — with citations.
        </p>
      </div>

      <SignIn />
    </div>
  );
}
