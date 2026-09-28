"use client";

import { useEffect } from "react";

import { ErrorFallback } from "@/components/ui/error-fallback";

// Same shape as app/(app)/error.tsx, scoped to the inbox so a failed read
// here keeps the app shell and says what couldn't load.
export default function InboxError({
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
    <ErrorFallback title="Couldn't load your inbox" message={error.message} onRetry={() => unstable_retry()} />
  );
}
