import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRightIcon } from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { MailboxSafe } from "@/lib/db";
import { getMailbox, getUserOrganization, listMailboxes } from "@/lib/db";
import { compareMailboxMetrics } from "@/lib/analytics/mailbox-metrics";
import { loadMailboxAnalyticsSnapshot } from "@/lib/mailboxes/mailbox-analytics";
import { mailboxCompareQuerySchema } from "@/lib/validations/mailboxes";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MailboxMetricsOverviewCards } from "@/components/analytics/mailbox-metrics-overview";
import { ComparisonTable, type ComparisonMetricRow } from "@/components/analytics/comparison-table";
import { MailboxHealthSummary } from "@/components/mailboxes/mailbox-health-summary";

const SELECT_CLASSNAME =
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function MailboxPicker({
  mailboxes,
  selectedA,
  selectedB,
}: {
  mailboxes: MailboxSafe[];
  selectedA?: string;
  selectedB?: string;
}) {
  if (mailboxes.length < 2) {
    return (
      <EmptyState
        icon={<ArrowLeftRightIcon className="size-5" />}
        title="Need at least two mailboxes to compare"
        description="Connect another mailbox to compare performance side by side."
      />
    );
  }

  return (
    <form className="rounded-xl border border-border bg-card/60 p-5 shadow-sm backdrop-blur-sm" action="/mailboxes/compare" method="get">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="a">Mailbox A</Label>
          <select id="a" name="a" defaultValue={selectedA ?? ""} className={SELECT_CLASSNAME} required>
            <option value="" disabled>
              Choose a mailbox
            </option>
            {mailboxes.map((mailbox) => (
              <option key={mailbox.id} value={mailbox.id}>
                {mailbox.display_name || mailbox.email}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b">Mailbox B</Label>
          <select id="b" name="b" defaultValue={selectedB ?? ""} className={SELECT_CLASSNAME} required>
            <option value="" disabled>
              Choose a mailbox
            </option>
            {mailboxes.map((mailbox) => (
              <option key={mailbox.id} value={mailbox.id}>
                {mailbox.display_name || mailbox.email}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Compare</Button>
      </div>
    </form>
  );
}

export default async function MailboxComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const mailboxes = await listMailboxes(supabase, user.id);
  const mailboxList = mailboxes ?? [];

  const query = await searchParams;
  const parsedQuery = mailboxCompareQuerySchema.safeParse(query);
  const requestedA = parsedQuery.success ? parsedQuery.data.a : undefined;
  const requestedB = parsedQuery.success ? parsedQuery.data.b : undefined;
  const readyToCompare = Boolean(requestedA && requestedB && requestedA !== requestedB);

  if (!readyToCompare) {
    return (
      <div className="space-y-6 sm:space-y-8">
        <FadeIn>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare mailboxes</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Pick two mailboxes to compare their performance side by side.
            </p>
          </div>
        </FadeIn>
        <FadeIn delay={0.05}>
          <MailboxPicker mailboxes={mailboxList} selectedA={requestedA} selectedB={requestedB} />
        </FadeIn>
      </div>
    );
  }

  const organization = await getUserOrganization(supabase, user);

  let mailboxA: MailboxSafe;
  let mailboxB: MailboxSafe;
  try {
    [mailboxA, mailboxB] = await Promise.all([
      getMailbox(supabase, user.id, requestedA as string),
      getMailbox(supabase, user.id, requestedB as string),
    ]);
  } catch {
    notFound();
  }

  const [snapshotA, snapshotB] = await Promise.all([
    loadMailboxAnalyticsSnapshot(supabase, organization.id, mailboxA),
    loadMailboxAnalyticsSnapshot(supabase, organization.id, mailboxB),
  ]);

  // The one call this whole page exists to finally make — compareMailboxMetrics
  // shipped in Phase 2C (801276d) with no caller anywhere in the codebase,
  // the same seam compareCampaignMetrics was in before /campaigns/compare.
  const metricTrends = compareMailboxMetrics(snapshotA.overview, snapshotB.overview);

  const comparisonRows: ComparisonMetricRow[] = [
    { key: "sent", label: "Emails sent", format: "count", aValue: snapshotA.overview.sentCount, bValue: snapshotB.overview.sentCount, trend: metricTrends.sent },
    { key: "delivered", label: "Delivered", format: "count", aValue: snapshotA.overview.deliveredCount, bValue: snapshotB.overview.deliveredCount, trend: metricTrends.delivered },
    { key: "opened", label: "Opened", format: "count", aValue: snapshotA.overview.openedCount, bValue: snapshotB.overview.openedCount, trend: metricTrends.opened },
    { key: "clicked", label: "Clicked", format: "count", aValue: snapshotA.overview.clickedCount, bValue: snapshotB.overview.clickedCount, trend: metricTrends.clicked },
    { key: "replied", label: "Replied", format: "count", aValue: snapshotA.overview.repliedCount, bValue: snapshotB.overview.repliedCount, trend: metricTrends.replied },
    { key: "bounced", label: "Bounced", format: "count", aValue: snapshotA.overview.bouncedCount, bValue: snapshotB.overview.bouncedCount, trend: metricTrends.bounced },
    { key: "spamComplaint", label: "Spam complaints", format: "count", aValue: snapshotA.overview.spamComplaintCount, bValue: snapshotB.overview.spamComplaintCount, trend: metricTrends.spamComplaint },
  ];

  const labelA = mailboxA.display_name || mailboxA.email;
  const labelB = mailboxB.display_name || mailboxB.email;

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compare mailboxes</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {labelA} vs. {labelB}, all-time.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/mailboxes/compare">Change mailboxes</Link>
          </Button>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        {[{ label: labelA, overview: snapshotA.overview }, { label: labelB, overview: snapshotB.overview }].map(
          ({ label, overview }) => (
            <FadeIn key={label} delay={0.1}>
              <div>
                <h2 className="font-semibold tracking-tight">{label}</h2>
                <div className="@container mt-3">
                  <div className="grid gap-4 @sm:grid-cols-2">
                    <MailboxMetricsOverviewCards summary={overview} delayStart={0.12} />
                  </div>
                </div>
              </div>
            </FadeIn>
          ),
        )}
      </div>

      <FadeIn delay={0.2}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Metrics</h2>
          <p className="text-sm text-muted-foreground">Every overview metric, A vs. B.</p>
        </div>
      </FadeIn>

      <FadeIn delay={0.25}>
        <ComparisonTable aLabel={labelA} bLabel={labelB} rows={comparisonRows} />
      </FadeIn>

      <FadeIn delay={0.3}>
        <div className="border-t border-border pt-6 sm:pt-8">
          <h2 className="font-semibold tracking-tight">Mailbox health</h2>
          <p className="text-sm text-muted-foreground">Each mailbox&apos;s stored health score, side by side.</p>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-2">
        <FadeIn delay={0.35}>
          <MailboxHealthSummary mailboxHealth={snapshotA.health} />
        </FadeIn>
        <FadeIn delay={0.4}>
          <MailboxHealthSummary mailboxHealth={snapshotB.health} />
        </FadeIn>
      </div>
    </div>
  );
}
