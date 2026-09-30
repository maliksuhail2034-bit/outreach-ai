import Image from "next/image";

import { cn } from "@/lib/utils";

// The approved Polimatiq P mark — app/icon.svg, served at /icon.svg by the
// App Router icon convention. Rendered as-is (never redrawn or recoloured).
// Its pale lavender body reads on dark surfaces but washes out on light ones,
// so light mode sets it on a small neutral tile (sized off the mark, outside
// layout); dark mode shows it bare. `unoptimized` serves the SVG untouched
// (next/image won't optimize SVGs), and `eager` because a loader mark that
// appears late defeats its purpose.
const MARK_SRC = "/icon.svg";

export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <span aria-hidden="true" className="absolute -inset-1 rounded-lg bg-foreground dark:hidden" />
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-primary/40 blur-md animate-brand-glow motion-reduce:hidden"
      />
      <Image
        src={MARK_SRC}
        alt=""
        width={size}
        height={size}
        unoptimized
        loading="eager"
        className="relative animate-brand-breathe motion-reduce:animate-none"
      />
    </span>
  );
}

// Route-level loading for app/(app)/**/loading.tsx. The route's own skeleton
// stays underneath (dimmed in dark mode only — light skeletons are already
// faint — and hidden from assistive tech) so the page's layout
// is previewed and nothing jumps when content streams in; the branded status
// chip floats over it, pinned a third of the way down the viewport even on
// long skeletons. One role="status" per boundary keeps screen-reader output
// to a single polite announcement.
export function RouteLoading({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <div aria-busy="true" className="relative">
      <div aria-hidden="true" className="dark:opacity-60">
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0 flex justify-center">
        <div
          role="status"
          className="sticky top-[30vh] flex h-fit items-center gap-3 rounded-full border bg-background/85 py-2 pr-4 pl-3 shadow-lg backdrop-blur-sm"
        >
          <BrandMark size={24} />
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
      </div>
    </div>
  );
}
