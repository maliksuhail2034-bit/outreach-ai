import { BarChart3Icon, MailIcon, MegaphoneIcon, UsersIcon, type LucideIcon } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { Container } from "./container";

const STEPS: { number: string; title: string; description: string; icon: LucideIcon }[] = [
  {
    number: "01",
    title: "Connect",
    description: "Connect Gmail, Microsoft 365, or any SMTP/IMAP mailbox, and manage them from one place.",
    icon: MailIcon,
  },
  {
    number: "02",
    title: "Add leads",
    description: "Import leads by CSV and organize them into lists you can enroll into campaigns.",
    icon: UsersIcon,
  },
  {
    number: "03",
    title: "Build campaigns",
    description: "Create multi-step sequences with follow-ups, timing, and mailbox assignment.",
    icon: MegaphoneIcon,
  },
  {
    number: "04",
    title: "Launch & manage",
    description: "Launch, then track sends, replies, and performance as it happens.",
    icon: BarChart3Icon,
  },
];

export function Workflow() {
  return (
    <section id="how-it-works" className="scroll-mt-16 py-20 sm:py-28">
      <Container>
        <FadeIn>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">How it works</h2>
            <p className="mt-4 text-muted-foreground">From a connected mailbox to a running campaign, in four steps.</p>
          </div>
        </FadeIn>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <FadeIn key={step.number} delay={index * 0.05}>
              <div className="flex h-full flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-muted-foreground">{step.number}</span>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <step.icon className="size-4" aria-hidden />
                  </span>
                </div>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </Container>
    </section>
  );
}
