import { useId } from "react";

// Official brand mark — SVG paths, gradient stops, glow, viewBox, and every
// wordmark metric (fontSize/fontWeight/letterSpacing/x/y) are the exact
// source provided by the brand owner and must not be edited here. Two
// deliberate adaptations on top of that source, both confirmed necessary by
// live inspection (see git history for the diagnosis) rather than redesign:
//
// - useId()-scoped gradient/filter ids: the sidebar and mobile nav can both
//   render this at once, and a hardcoded id="polimatiqPurple"/"polimatiqGlow"
//   would collide across those two simultaneous instances — unique ids
//   remove that footgun without changing anything visual.
// - The wordmark's fill and fontFamily (see below) are theme/mechanism
//   adaptations, not design changes — see their own comments.
export function PolimatiqLogo({
  width = 180,
  className = "",
}: {
  width?: number;
  className?: string;
}) {
  const height = width * 0.24;
  const id = useId();
  const gradientId = `polimatiqPurple-${id}`;
  const glowId = `polimatiqGlow-${id}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 760 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Polimatiq"
    >
      <defs>
        {/* Polimatiq purple gradient */}
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="45%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>

        {/* Very subtle glow */}
        <filter
          id={glowId}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur
            stdDeviation="5"
            result="blur"
          />

          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ========================= */}
      {/* CUSTOM P */}
      {/* ========================= */}

      <path
        d="
          M 28 132
          V 63
          C 28 38 47 22 73 22
          H 111
          C 139 22 157 39 157 63
          C 157 87 139 103 112 103
          H 64
          V 132
        "
        stroke={`url(#${gradientId})`}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${glowId})`}
      />

      {/* ========================= */}
      {/* WORDMARK */}
      {/* ========================= */}

      {/* Font: the source design specifies Satoshi, but this project never
          loads it (no next/font import, no @font-face, no asset) — confirmed
          by grepping the repo and by document.fonts on the live page.
          Falling through a 'Satoshi','Geist','Inter' stack left the actual
          rendered font an accident of which of those three happened to be
          registered (only Geist was). Referencing the app's real Geist
          variable directly makes that an intentional choice instead. */}
      {/* Fill: the source design hardcodes #F7F7F8 (near-white), which reads
          fine on the app's dark-mode sidebar but is nearly invisible against
          the light-mode sidebar background (--sidebar ~99% lightness in
          light mode) — confirmed visually. --color-sidebar-foreground is the
          existing token this app already uses for "text on the sidebar
          background" in both themes (0 0% 98%, ~equivalent to the original
          #F7F7F8, in dark mode; 240 10% 3.9% in light mode), so it fixes
          contrast without inventing a new color. */}
      <text
        x="170"
        y="132"
        fontFamily="var(--font-geist-sans), sans-serif"
        fontSize="92"
        fontWeight="500"
        letterSpacing="-4"
        fill="var(--color-sidebar-foreground)"
      >
        olimati
      </text>

      {/* ========================= */}
      {/* CUSTOM Q */}
      {/* ========================= */}

      <circle
        cx="677"
        cy="91"
        r="38"
        stroke={`url(#${gradientId})`}
        strokeWidth="11"
      />

      <path
        d="
          M 700 116
          L 731 147
        "
        stroke={`url(#${gradientId})`}
        strokeWidth="12"
        strokeLinecap="round"
      />
    </svg>
  );
}
