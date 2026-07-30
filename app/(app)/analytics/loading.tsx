import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <Skeleton className="h-10 w-64 rounded-lg" />

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`stat-skeleton-${index}`} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={`chart-skeleton-${index}`} className="h-52 w-full rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-72 w-full rounded-xl" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
