import { Button } from "@/components/ui/button";

// Shared fallback UI for every error boundary in the app (route-level
// error.tsx files and component-level WidgetErrorBoundary) so they all read
// as the same design instead of drifting into slightly different copies.
export function ErrorFallback({
  message,
  onRetry,
  title = "Something went wrong",
}: {
  message?: string;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <div className="flex min-h-[50svh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{message || "An unexpected error occurred."}</p>
      <Button type="button" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
