import { Skeleton } from "@/components/ui/skeleton";

export default function CampaignCompareLoading() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={`side-skeleton-${index}`} className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((__, cardIndex) => (
              <Skeleton key={`side-${index}-card-${cardIndex}`} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ))}
      </div>

      <Skeleton className="h-64 w-full rounded-xl" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}
