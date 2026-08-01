import { Skeleton } from "@/components/ui/skeleton";

export default function DomainAnalyticsLoading() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={`dns-skeleton-${index}`} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={`overview-skeleton-${index}`} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>

      <div className="@container">
        <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={`trend-skeleton-${index}`} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={`chart-skeleton-${index}`} className="h-52 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
