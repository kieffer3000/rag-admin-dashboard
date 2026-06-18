'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-[rgb(var(--hairline)/0.16)] bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An error occurred rendering this view. Your board is saved locally —
          try again, or head back to the board.
        </p>
        {(error?.message || error?.digest) && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/[0.04] p-3 text-left text-[11px] leading-relaxed text-muted-foreground dark:bg-white/[0.06]">
            {error?.message || 'Unknown error'}
            {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
        )}
        <div className="flex justify-center gap-2 pt-1">
          <button
            onClick={() => reset()}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/board"
            className="rounded-full bg-foreground/[0.06] px-4 py-2 text-sm font-semibold transition-colors hover:bg-foreground/[0.1]"
          >
            Back to board
          </a>
        </div>
      </div>
    </main>
  );
}
