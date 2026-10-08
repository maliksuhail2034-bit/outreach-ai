import { useId } from "react";

import { cn } from "@/lib/utils";

// The approved Polimatiq P mark — app/icon.svg, served at /icon.svg by the
// App Router icon convention. Shown through an SVG <image>, so the mark's
// own file is what renders: never redrawn, recoloured or approximated.
const MARK_SRC = "/icon.svg";

// A pen line through the middle of the P, in the mark's own 512×512 space:
// the top-left flourish, across the top, around the bowl, then down the
// stem. It never renders — it's only the mask that reveals the mark, so the
// P is written into existence in the order a hand would draw it. At this
// width it covers every pixel of the mark (checked against the asset).
const PEN_PATH =
  "M 46 44 C 95 88, 150 84, 210 84 L 318 96 C 400 108, 432 150, 432 196 C 432 252, 384 296, 318 296 L 236 296 C 190 296, 163 326, 163 372 L 163 474";
const PEN_WIDTH = 140;

// Both animations rest on the finished mark: with motion reduced (no
// animation at all) the pen is fully drawn and the full-mask rect is
// opaque, so the mark shows exactly as the asset, statically. The rect is
// also what guarantees the drawn P settles pixel-identical to the asset.
export function BrandMarkReveal({ size = 64, className }: { size?: number; className?: string }) {
  const maskId = `brand-reveal-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cn("block shrink-0", className)}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          <path
            d={PEN_PATH}
            pathLength={1}
            fill="none"
            stroke="white"
            strokeWidth={PEN_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={1}
            className="animate-brand-draw motion-reduce:animate-none"
          />
          <rect width="512" height="512" fill="white" className="animate-brand-settle motion-reduce:animate-none" />
        </mask>
      </defs>
      <image href={MARK_SRC} width="512" height="512" mask={`url(#${maskId})`} />
    </svg>
  );
}

// Route-level loading for app/(app)/**/loading.tsx: the mark alone, centred
// in the content area beside the sidebar and below the top nav. The height
// is that area exactly — the viewport minus TopNav's h-16 and <main>'s own
// vertical padding at each breakpoint (app/(app)/layout.tsx) — so the mark
// sits at its true centre. No visible text; the status is announced to
// assistive tech once.
//
// The mark's pale lavender stem and bowl are drawn for dark surfaces and
// all but vanish on white, so light mode sets it on a dark tile (the
// production app-icon treatment); dark mode shows it bare. The tile is
// static: only the mark itself is drawn in.
export function RouteLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className="grid min-h-[calc(100svh-4rem-2rem)] place-items-center sm:min-h-[calc(100svh-4rem-3rem)] lg:min-h-[calc(100svh-4rem-4rem)]"
    >
      <span className="rounded-2xl bg-foreground p-2.5 dark:bg-transparent">
        <BrandMarkReveal size={64} />
      </span>
    </div>
  );
}
