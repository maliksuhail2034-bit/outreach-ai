import { MailIcon, MegaphoneIcon, SendIcon, UsersIcon, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/motion/fade-in";
import { Container } from "./container";

// All sample data below is illustrative only — never fetched, never real.
// Shapes mirror the real dashboard/campaigns/mailboxes/analytics screens
// (see app/(app)/dashboard, components/campaigns, components/mailboxes,
// components/analytics) without embedding an authenticated component here.
const STATS: { label: string; value: string; icon: LucideIcon }[] = [
  { label: "Total leads", value: "1,248", icon: UsersIcon },
  { label: "Mailboxes", value: "4", icon: MailIcon },
  { label: "Emails sent", value: "3,502", icon: SendIcon },
  { label: "Active campaigns", value: "3", icon: MegaphoneIcon },
];

const CAMPAIGNS: { name: string; leads: number; status: string; tone: "default" | "success" | "secondary" }[] = [
  { name: "SaaS founders outbound", leads: 412, status: "Sending", tone: "default" },
  { name: "Warm intro follow-up", leads: 96, status: "Sending", tone: "default" },
  { name: "Agency partner outreach", leads: 210, status: "Completed", tone: "secondary" },
];

const RECENT_ACTIVITY = [
  { text: "Sent to jane@acme.co", tone: "bg-muted-foreground/40" },
  { text: "Reply from m.owen@initech.co", tone: "bg-success" },
  { text: "Sequence step 2 sent to 48 leads", tone: "bg-muted-foreground/40" },
  { text: "Reply from d.lang@globex.co", tone: "bg-success" },
  { text: "Mailbox paused after a bounce", tone: "bg-warning" },
];

const MAILBOXES: { email: string; status: string }[] = [
  { email: "alex@yourcompany.co", status: "Healthy" },
  { email: "sam@yourcompany.co", status: "Healthy" },
  { email: "outbound@yourcompany.co", status: "Warming" },
];

const REPLY_BARS = [20, 35, 28, 48, 40, 60, 52];

export function ProductShowcase() {
  return (
    <section className="border-b border-border py-20 sm:py-28">
      <Container>
        <FadeIn>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              See your outreach at a glance
            </h2>
            <p className="mt-4 text-muted-foreground">
              Mailboxes, campaigns, replies, and results, all in the same workspace you&apos;ll use every day.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {STATS.map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
                      <stat.icon className="size-3.5 text-primary" aria-hidden />
                    </div>
                    <p className="mt-1.5 text-xl font-semibold tabular-nums">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="text-sm font-semibold">Active campaigns</p>
                <ul className="mt-3 divide-y divide-border">
                  {CAMPAIGNS.map((campaign) => (
                    <li key={campaign.name} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">{campaign.leads} leads enrolled</p>
                      </div>
                      <Badge variant={campaign.tone} className="shrink-0">
                        {campaign.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="text-sm font-semibold">Recent activity</p>
                <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
                  {RECENT_ACTIVITY.map((item) => (
                    <li key={item.text} className="flex items-center gap-2.5">
                      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${item.tone}`} />
                      <span className="truncate">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="text-sm font-semibold">Mailbox health</p>
                <ul className="mt-3 space-y-3">
                  {MAILBOXES.map((mailbox) => (
                    <li key={mailbox.email} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <MailIcon className="size-3.5" aria-hidden />
                        </span>
                        <span className="truncate">{mailbox.email}</span>
                      </div>
                      <Badge variant={mailbox.status === "Healthy" ? "success" : "warning"} className="shrink-0">
                        {mailbox.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="text-sm font-semibold">Replies this week</p>
                <div className="mt-4 flex h-24 items-end gap-1.5">
                  {REPLY_BARS.map((height, index) => (
                    <div
                      key={index}
                      className="min-h-[2px] flex-1 rounded-t-sm bg-primary/30"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">Illustrative preview using sample data.</p>
        </FadeIn>
      </Container>
    </section>
  );
}
