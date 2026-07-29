import type { ReactNode } from "react";

// Shared visual shell for every auth screen. Deliberately has no auth logic
// of its own — app/(auth)/layout.tsx redirects authenticated users away,
// but app/reset-password/page.tsx *requires* an authenticated (recovery)
// session, so the redirect rule can't live here.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,_hsl(var(--primary)/0.25),_transparent_55%)]"
        />
        <div className="relative z-10 flex items-center gap-2 text-lg font-semibold">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
            O
          </span>
          OutReach AI
        </div>
        <blockquote className="relative z-10 space-y-2">
          <p className="text-lg leading-relaxed">
            &ldquo;Find, qualify, and engage the right leads &mdash; automatically.&rdquo;
          </p>
          <footer className="text-sm text-sidebar-foreground/60">Your AI SDR, working around the clock.</footer>
        </blockquote>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
