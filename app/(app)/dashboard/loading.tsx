import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <Skeleton className="h-40 w-full rounded-2xl sm:h-48" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-96 w-full rounded-xl" />

          <div className="@container">
            <div className="grid gap-4 @sm:grid-cols-2 @xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={`stat-skeleton-${index}`} className="h-28 w-full rounded-xl" />
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`action-skeleton-${index}`} className="h-32 w-full rounded-xl" />
            ))}
          </div>

          <Skeleton className="h-24 w-full rounded-xl" />
        </div>

        <Skeleton className="h-80 w-full rounded-xl lg:col-span-1" />
      </div>
    </div>
  );
}
