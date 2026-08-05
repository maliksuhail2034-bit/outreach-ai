"use client";

import { useEffect } from "react";

import { ErrorFallback } from "@/components/ui/error-fallback";

// Nested boundary (U3) for the whole authenticated app shell — a crash
// rendering any page under app/(app)/... is caught here instead of bubbling
// up to the root app/error.tsx, so the marketing/(auth) routes never share
// a fate with an authenticated-page error and vice versa.
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorFallback
      title="Something went wrong loading this page"
      message={error.message}
      onRetry={() => unstable_retry()}
    />
  );
}
