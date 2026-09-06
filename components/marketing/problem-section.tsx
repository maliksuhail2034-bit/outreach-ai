import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { Container } from "./container";

const FRAGMENTS = ["Leads", "Mailboxes", "Campaigns", "Follow-ups", "Replies", "Analytics"];

export function ProblemSection() {
  return (
    <section className="border-b border-border bg-sidebar/40 py-20 sm:py-28">
      <Container>
        <FadeIn>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Cold email outreach shouldn&apos;t require five different tools.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Most outreach setups stitch together a mailbox provider, a spreadsheet for leads, a sending tool, a
              separate inbox for replies, and another dashboard for results. Switching between them is where
              momentum gets lost.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
            {FRAGMENTS.map((item, index) => (
              <span key={item} className="flex items-center gap-2">
                <span className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
                  {item}
                </span>
                {index < FRAGMENTS.length - 1 && (
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/40" />
                )}
              </span>
            ))}
          </div>

          <div className="mt-5 flex justify-center">
            <ChevronDownIcon aria-hidden className="size-5 text-muted-foreground/40" />
          </div>

          <div className="mt-5 flex justify-center">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-5 py-2.5 text-sm font-medium text-primary">
              One workspace
            </span>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
