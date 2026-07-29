"use client";

import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              {error.message || "A critical error occurred."}
            </p>
            <Button type="button" onClick={() => unstable_retry()}>
              Try again
            </Button>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
