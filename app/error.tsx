"use client";

import { useEffect } from "react";

import { ErrorFallback } from "@/components/ui/error-fallback";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorFallback message={error.message} onRetry={() => retry()} />;
}
