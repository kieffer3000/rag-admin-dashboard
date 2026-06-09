import { Button } from '@/components/ui/button';
import { signIn } from '@/lib/auth';
import { Boxes, Github } from 'lucide-react';

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-gradient-to-br from-blue-400/30 to-indigo-500/20 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-float">
            <Boxes className="h-7 w-7" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Atlas</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Your private knowledge base. Chat with your documents, videos and
            notes — with citations.
          </p>
        </div>

        <div className="mt-8 rounded-3xl border border-border/70 bg-white p-6 shadow-float">
          <form
            action={async () => {
              'use server';
              await signIn('github', { redirectTo: '/' });
            }}
          >
            <Button className="h-11 w-full gap-2 rounded-xl text-[15px]">
              <Github className="h-[18px] w-[18px]" />
              Sign in with GitHub
            </Button>
          </form>
          <p className="mt-4 text-center text-[12px] leading-relaxed text-muted-foreground">
            Secure sign-in via GitHub OAuth. We only read your basic profile.
          </p>
        </div>
      </div>
    </div>
  );
}
