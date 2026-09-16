import { useId } from "react";

// Official brand mark — SVG paths, gradient stops, typography, and viewBox
// are the exact source provided by the brand owner and must not be edited
// here. The only addition on top of that source is useId()-scoped
// gradient/filter ids: the sidebar and mobile nav can both render this at
// once, and a hardcoded id="polimatiqPurple"/"polimatiqGlow" would collide
// across those two simultaneous instances (the second instance's <defs>
// would win, but both <path>/<circle> "url(#...)" references end up
// pointing at whichever one is currently in the DOM — visually harmless
// today since both defs are identical, but fragile) — unique ids remove
// that footgun without changing anything visual.
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

      <text
        x="170"
        y="132"
        fontFamily="'Satoshi', 'Geist', 'Inter', sans-serif"
        fontSize="92"
        fontWeight="500"
        letterSpacing="-4"
        fill="#F7F7F8"
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
