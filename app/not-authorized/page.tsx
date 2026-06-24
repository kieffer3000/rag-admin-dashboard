import { SignOutButton } from '@clerk/nextjs';

// Where non-allowlisted signed-in users land (this app is currently private).
export default function NotAuthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="text-[15px] font-semibold tracking-wide text-accent">answersDoc</div>
      <h1 className="text-2xl font-bold text-foreground">This workspace is private</h1>
      <p className="max-w-md text-[14px] text-muted-foreground">
        Your account doesn’t have access yet. If you believe this is a mistake, please
        contact the owner.
      </p>
      <SignOutButton>
        <button className="mt-2 rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-white transition-all hover:brightness-110">
          Sign out
        </button>
      </SignOutButton>
    </div>
  );
}
