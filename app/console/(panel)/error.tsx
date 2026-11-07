"use client";

import { useEffect } from "react";

import { ErrorFallback } from "@/components/ui/error-fallback";

// Keeps a failing console page inside the console shell (navigation stays
// usable) instead of falling through to the root error page.
export default function ConsoleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorFallback title="This console page couldn't load" message={error.message} onRetry={() => retry()} />;
}
