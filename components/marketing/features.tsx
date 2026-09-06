import {
  BadgeCheckIcon,
  BarChart3Icon,
  MailIcon,
  MegaphoneIcon,
  MessageCircleReplyIcon,
  SendIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { Container } from "./container";

// Only capabilities that genuinely exist in the product today, based on the
// engineering audit this page was built from. No CRM/Zapier integrations,
// no automated personalization, no guaranteed deliverability claims.
const FEATURES: { title: string; description: string; icon: LucideIcon }[] = [
  {
    title: "Mailbox management",
    description:
      "Connect Gmail, Microsoft 365, or any SMTP/IMAP mailbox, and manage your sending infrastructure, including warmup, from one workspace.",
    icon: MailIcon,
  },
  {
    title: "Lead management",
    description: "Import leads by CSV, organize them into lists, and manage your outreach pipeline in one view.",
    icon: UsersIcon,
  },
  {
    title: "Campaigns & sequences",
    description: "Build multi-step email sequences with configurable timing, follow-ups, and mailbox assignment.",
    icon: MegaphoneIcon,
  },
  {
    title: "Email sending",
    description:
      "Send cold email campaigns through your connected mailboxes, with retries, suppression handling, and one-click unsubscribe built in.",
    icon: SendIcon,
  },
  {
    title: "Reply management",
    description:
      "Automatically detect replies across your connected mailboxes and keep conversations tied to the right lead and campaign.",
    icon: MessageCircleReplyIcon,
  },
  {
    title: "Analytics",
    description:
      "Track sends, replies, bounces, and failures across campaigns, mailboxes, and domains, with trends and forecasting.",
    icon: BarChart3Icon,
  },
  {
    title: "Email verification",
    description: "Verify lead email addresses before you send, using your own email verification provider key.",
    icon: BadgeCheckIcon,
  },
  {
    title: "AI recommendations",
    description:
      "Connect your own AI provider key to generate recommendations based on your campaign, mailbox, and deliverability performance.",
    icon: SparklesIcon,
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-b border-border bg-sidebar/40 py-20 sm:py-28">
      <Container>
        <FadeIn>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              One workspace for the entire outreach workflow
            </h2>
            <p className="mt-4 text-muted-foreground">
              Every core piece of cold email outreach, without switching between tools.
            </p>
          </div>
        </FadeIn>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="size-4" aria-hidden />
              </span>
              <h3 className="mt-4 text-sm font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
