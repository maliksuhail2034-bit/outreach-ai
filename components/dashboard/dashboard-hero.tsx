import { SparklesIcon } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";

export function DashboardHero({ displayName, greeting }: { displayName: string; greeting: string }) {
  return (
    <FadeIn>
      <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-sm sm:p-8 lg:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -left-16 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute right-1/3 top-1/2 size-40 -translate-y-1/2 rounded-full bg-primary/10 blur-2xl"
        />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            <SparklesIcon className="size-3.5" />
            {greeting}
          </span>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Welcome back, {displayName}</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Here&apos;s a quick look at your account. Finish the setup steps below to start turning cold leads
            into booked meetings.
          </p>
        </div>
      </section>
    </FadeIn>
  );
}
