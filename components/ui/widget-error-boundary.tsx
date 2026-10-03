"use client";

import { catchError, type ErrorInfo } from "next/error";

// Component-level boundary (U3) for a single widget on a page that composes
// several independent ones (e.g. the dashboard) — a route-level error.tsx
// only stops a crash from taking down segments above it, not a sibling
// widget on the same page, so one failing section would otherwise blank the
// whole page. label identifies which widget failed in the fallback text.
function WidgetErrorFallback({ label }: { label?: string }, { error, retry }: ErrorInfo) {
  // ErrorInfo.error is `unknown` as of Next 16.3 (anything can be thrown).
  const err = error instanceof Error ? error : undefined;
  const message = err?.message ?? String(error);

  // Explicit, structured log — an intermittent empty-message error was
  // observed reaching this boundary in production traffic (dashboard,
  // digest 3118085539@E394) with no stack captured, so the built-in
  // catchError logging alone wasn't enough to diagnose it. This doesn't fix
  // that bug (no root cause was established) — it's here so a recurrence is
  // actually diagnosable instead of showing up as another bare `{message:
  // ""}` line with no name, stack, or which widget failed.
  console.error("[WidgetErrorBoundary]", label ?? "(unlabeled)", {
    name: err?.name,
    message,
    stack: err?.stack,
  });

  return (
    <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
      <p>{label ? `${label} couldn't load.` : "This section couldn't load."}</p>
      <p className="mt-1 text-xs">{message}</p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-3 text-sm font-medium text-foreground underline underline-offset-2"
      >
        Try again
      </button>
    </div>
  );
}

export const WidgetErrorBoundary = catchError(WidgetErrorFallback);
