"use client";

import { unstable_catchError as catchError, type ErrorInfo } from "next/error";

// Component-level boundary (U3) for a single widget on a page that composes
// several independent ones (e.g. the dashboard) — a route-level error.tsx
// only stops a crash from taking down segments above it, not a sibling
// widget on the same page, so one failing section would otherwise blank the
// whole page. label identifies which widget failed in the fallback text.
function WidgetErrorFallback({ label }: { label?: string }, { error, unstable_retry }: ErrorInfo) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
      <p>{label ? `${label} couldn't load.` : "This section couldn't load."}</p>
      <p className="mt-1 text-xs">{error.message}</p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="mt-3 text-sm font-medium text-foreground underline underline-offset-2"
      >
        Try again
      </button>
    </div>
  );
}

export const WidgetErrorBoundary = catchError(WidgetErrorFallback);
