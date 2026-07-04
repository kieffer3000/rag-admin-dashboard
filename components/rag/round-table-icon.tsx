'use client';

/**
 * Boardroom icon — a round table seen from above with six seats around it.
 * Custom because lucide has no "meeting table" glyph and the bank (Landmark)
 * icon now belongs to the DataBank nodes.
 */
export function RoundTableIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* the table */}
      <circle cx="12" cy="12" r="4.5" />
      {/* six seats */}
      <circle cx="12" cy="3.2" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19.6" cy="7.6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19.6" cy="16.4" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="20.8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="16.4" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="7.6" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
