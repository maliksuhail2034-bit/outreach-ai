import { Skeleton } from "@/components/ui/skeleton";

// Reusable skeleton block sized like a dashboard card — used in a route's
// loading.tsx so a new dashboard section doesn't need its own bespoke
// Skeleton sizing every time.
export function LoadingState({
  count = 1,
  className = "h-28 w-full rounded-xl",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={`loading-state-${index}`} className={className} />
      ))}
    </>
  );
}
