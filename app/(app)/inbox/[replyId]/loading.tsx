import { RouteLoading } from "@/components/ui/brand-loader";
import { Skeleton } from "@/components/ui/skeleton";

export default function InboxConversationLoading() {
  return (
    <RouteLoading label="Loading conversation…">
      <div className="space-y-6 sm:space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={`reply-skeleton-${index}`} className="space-y-3 rounded-xl border border-border p-5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    </RouteLoading>
  );
}
