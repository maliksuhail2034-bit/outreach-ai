import Image from "next/image";

import { cn } from "@/lib/utils";

// Official Polimatiq wordmark: public/branding/polimatiq-logo-{dark,light}.svg
// are the brand owner's exact artwork and must not be edited or redrawn.
// On surfaces that are light in light mode and dark in dark mode (auth
// panel, marketing header and footer) the dark wordmark shows in light mode
// and the light wordmark in dark mode, switched by the next-themes `.dark`
// class — CSS only, so there's no hydration flash. `onDark` is for surfaces
// that are dark in both modes (the product's ink navigation): the light
// wordmark only. `unoptimized` serves the SVG as-is (next/image won't
// optimize SVGs).
const ASPECT_RATIO = 107 / 466;

export function PolimatiqLogo({
  width = 180,
  className,
  onDark = false,
}: {
  width?: number;
  className?: string;
  onDark?: boolean;
}) {
  const height = Math.round(width * ASPECT_RATIO);

  if (onDark) {
    return (
      <span className={cn("inline-flex shrink-0", className)}>
        <Image
          src="/branding/polimatiq-logo-light.svg"
          alt="Polimatiq"
          width={width}
          height={height}
          unoptimized
          className="block h-auto"
          style={{ width }}
        />
      </span>
    );
  }

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
