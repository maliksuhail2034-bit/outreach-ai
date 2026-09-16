import { Skeleton } from "@/components/ui/skeleton";

// Generic fallback for app/(app)/ segments that don't define their own,
// more specific loading.tsx (every current top-level route already does —
// see app/(app)/dashboard/loading.tsx and its siblings). Kept deliberately
// small: it renders inside <main>, alongside the already-interactive
// Sidebar/TopNav, not as a full-screen overlay that blocks the rest of the
// shell while a page streams in.
export default function AppLoading() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
