type LogoProps = {
  size?: number;
  withWordmark?: boolean;
  className?: string;
};

/**
 * TokenShelf mark + wordmark.
 *
 * The mark is a three-bar stack — abstract receipts on a shelf, decreasing
 * in size, ending on the amber accent (the certified-badge tier). Uses the
 * brand HSL tokens directly so it themes automatically.
 *
 * When `withWordmark` is true, the wordmark "TokenShelf." is rendered next
 * to it in the serif display font with the period in the accent color.
 */
export function TokenShelfLogo({
  size = 28,
  withWordmark = true,
  className,
}: LogoProps) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className ?? ""}`}
      aria-label="TokenShelf"
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        role="img"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="ts-mark-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--tokenshelf-400))" />
            <stop offset="100%" stopColor="hsl(var(--tokenshelf-700))" />
          </linearGradient>
        </defs>
        {/* Top bar — the "shelf" */}
        <rect x="2" y="4"  width="20" height="3" rx="1.5" fill="url(#ts-mark-grad)" />
        {/* Middle bar — a receipt */}
        <rect x="5" y="10" width="14" height="3" rx="1.5"
              fill="hsl(var(--primary))" opacity="0.85" />
        {/* Bottom bar — the certified badge (amber) */}
        <rect x="8" y="16" width="8"  height="3" rx="1.5" fill="hsl(var(--accent))" />
      </svg>
      {withWordmark && (
        <span className="font-serif text-[17px] font-bold tracking-tight">
          TokenShelf<span className="text-tokenshelf">.</span>
        </span>
      )}
    </span>
  );
}
