import { RouteLoading } from "@/components/ui/brand-loader";
import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoading() {
  return (
    <RouteLoading label="Loading inbox…">
      <div className="space-y-6 sm:space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="divide-y divide-border rounded-xl border border-border">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`inbox-skeleton-${index}`} className="space-y-2 px-4 py-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </RouteLoading>
  );
}
