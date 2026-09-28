import Image from "next/image";

import { cn } from "@/lib/utils";

// Official Polimatiq wordmark: public/branding/polimatiq-logo-{dark,light}.svg
// are the brand owner's exact artwork and must not be edited or redrawn.
// Every surface this renders on (sidebar, auth panel, marketing header and
// footer) is light in light mode and dark in dark mode, so the dark wordmark
// shows in light mode and the light wordmark in dark mode, switched by the
// existing next-themes `.dark` class — CSS only, so there's no hydration
// flash. `unoptimized` serves the SVG as-is (next/image won't optimize SVGs).
const ASPECT_RATIO = 107 / 466;

export function PolimatiqLogo({ width = 180, className }: { width?: number; className?: string }) {
  const height = Math.round(width * ASPECT_RATIO);

  return (
    <span className={cn("inline-flex shrink-0", className)}>
      <Image
        src="/branding/polimatiq-logo-dark.svg"
        alt="Polimatiq"
        width={width}
        height={height}
        unoptimized
        className="block h-auto dark:hidden"
        style={{ width }}
      />
      <Image
        src="/branding/polimatiq-logo-light.svg"
        alt="Polimatiq"
        width={width}
        height={height}
        unoptimized
        className="hidden h-auto dark:block"
        style={{ width }}
      />
    </span>
  );
}
