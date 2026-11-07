import { usesLocalGeoip } from "@/lib/billing/geoip";
import { cn } from "@/lib/utils";

// DB-IP's Lite licence (CC BY 4.0) requires a link back to DB-IP on pages
// that use its results — here, prices and checkout options that depend on
// the visitor's country. Rendered only when that data is actually in use.
export function GeoipAttribution({ className }: { className?: string }) {
  if (!usesLocalGeoip()) return null;

  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      <a href="https://db-ip.com" className="underline underline-offset-2 hover:text-foreground">
        IP Geolocation by DB-IP
      </a>
    </p>
  );
}
