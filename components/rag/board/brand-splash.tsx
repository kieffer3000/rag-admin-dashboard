'use client';

// ───────────────────────────────────────────────────────────────────────────
// Branded loading splash — shown over the board until the saved board has
// finished loading, so a refresh never flashes the bare/empty canvas.
//
// The AnswersDoc mark is recreated here as crisp SVG (sharp at any size, and
// animatable) in the brand cream + charcoal. It breathes gently while loading.
//
// 👉 PREFER YOUR EXACT FILE (or a fully animated logo — GIF / Lottie / video)?
//   1. Drop it into /public  (e.g. public/answersdoc-logo.gif)
//   2. Set LOGO_SRC below to its path (e.g. '/answersdoc-logo.gif')
// When LOGO_SRC is set it replaces the SVG mark.
// ───────────────────────────────────────────────────────────────────────────
const LOGO_SRC: string | null = null;

const CREAM = '#efe9da';
const CHARCOAL = '#2b2d33';

export function BrandSplash({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={
        'absolute inset-0 z-[60] flex flex-col items-center justify-center gap-6 ' +
        'transition-opacity duration-500 ' +
        (visible ? 'opacity-100' : 'pointer-events-none opacity-0')
      }
      style={{ background: CREAM }}
    >
      <style>{`
        @keyframes ad-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        @keyframes ad-fade   { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
        @keyframes ad-dot    { 0%,80%,100% { opacity:.25; transform: translateY(0);} 40% { opacity:1; transform: translateY(-4px);} }
      `}</style>

      <div style={{ animation: 'ad-fade .6s ease-out both' }}>
        <div style={{ animation: 'ad-breathe 3.2s ease-in-out infinite' }}>
          {LOGO_SRC ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={LOGO_SRC} alt="AnswersDoc" width={148} height={148} draggable={false} />
          ) : (
            <svg width={148} height={148} viewBox="0 0 100 100" role="img" aria-label="AnswersDoc">
              {/* ring */}
              <circle cx="50" cy="50" r="45" fill="none" stroke={CHARCOAL} strokeWidth="2.4" />
              {/* comma mark (head + sweeping tail) */}
              <g fill={CHARCOAL}>
                <circle cx="52" cy="39" r="15" />
                <path d="M40 46 C 37.5 57, 41.5 67.5, 45 74 C 48.5 67, 53.5 59.5, 61 53.5 C 56.5 48.5, 47.5 44.5, 40 46 Z" />
                {/* dot */}
                <circle cx="61" cy="64.5" r="5.6" />
              </g>
            </svg>
          )}
        </div>
      </div>

      {/* loading dots */}
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: CHARCOAL,
              animation: `ad-dot 1.2s ease-in-out ${i * 0.16}s infinite`
            }}
          />
        ))}
      </div>
    </div>
  );
}
