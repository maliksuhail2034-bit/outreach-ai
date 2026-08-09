import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangleIcon,
  BarChart3Icon,
  CalendarClockIcon,
  CheckCircle2Icon,
  GaugeIcon,
  MessageCircleReplyIcon,
  SendIcon,
  ThumbsUpIcon,
  UsersIcon,
} from "lucide-react";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaign,
  getUserOrganization,
  listAnalyticsEvents,
  listCampaignLeads,
  listDomains,
  listEmailEvents,
  listLeadLists,
  listLeads,
  listLeadsAvailableForCampaign,
  listMailboxes,
  listSequences,
  listSequenceSteps,
  listSuppressions,
  listTemplates,
} from "@/lib/db";
import { resolveSendingWindow } from "@/lib/email/scheduling";
import { groupCounts, rate } from "@/lib/analytics/metrics";
import {
  CAMPAIGN_EXECUTION_STATE_LABEL,
  checkCampaignReadiness,
  deriveExecutionState,
  resolveLeadMailboxId,
} from "@/lib/campaigns/readiness";
import { selectUpcomingSends } from "@/lib/campaigns/queue";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { PercentageCard } from "@/components/dashboard/percentage-card";
import { CampaignExecutionControls } from "@/components/campaigns/campaign-execution-controls";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { CampaignLeadTable } from "@/components/campaigns/campaign-lead-table";
import { CampaignQueueView } from "@/components/campaigns/campaign-queue-view";
import { CampaignSetupWizard } from "@/components/campaigns/campaign-setup-wizard";
import { SequenceStepsPanel } from "@/components/sequences/sequence-steps-panel";

const EXECUTION_STATE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  ready: "secondary",
  running: "default",
  paused: "secondary",
  completed: "outline",
};

// Single-campaign scope, so a generous limit (like the campaign analytics
// page's) comfortably covers a campaign's full send/event history without
// pagination.
const EVENT_FETCH_LIMIT = 5000;

export default async function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();

  let campaign;
  try {
    campaign = await getCampaign(supabase, user.id, campaignId);
  } catch {
    notFound();
  }

  const organization = await getUserOrganization(supabase, user);

  const [campaignLeads, leads, availableLeadsResult, leadLists, mailboxes, sequences, templates, suppressions, domains, emailEvents, analyticsEvents] =
    await Promise.all([
      listCampaignLeads(supabase, campaignId),
      // Still needed as-is: CampaignLeadTable/CampaignQueueView/
      // CampaignSetupWizard all resolve *already-enrolled* leads' details
      // (name/email) from this full list too, not just "available" ones —
      // this fetch doesn't go away, only the availableLeads computation
      // below does (Scalability Track, Phase D, item 7).
      listLeads(supabase, user.id, { limit: 10000 }),
      // Pushes the "not yet enrolled" filter into SQL instead of diffing
      // the full 10,000-row fetch above in JS — removes both the per-render
      // JS diff and the correctness ceiling that diff had (an account with
      // more than 10,000 leads previously couldn't show leads past that cap
      // as available at all). limit explicitly matches the previous
      // effective ceiling (the 10k allLeads fetch) rather than this
      // function's own smaller default.
      listLeadsAvailableForCampaign(supabase, user.id, campaignId, { limit: 10000 }),
      listLeadLists(supabase, user.id),
      listMailboxes(supabase, user.id),
      listSequences(supabase, campaignId),
      listTemplates(supabase, user.id),
      listSuppressions(supabase, user.id),
      listDomains(supabase, user.id),
      listEmailEvents(supabase, campaignId, { limit: EVENT_FETCH_LIMIT }),
      listAnalyticsEvents(supabase, organization.id, {
        subjectType: "campaign",
        subjectId: campaignId,
        limit: EVENT_FETCH_LIMIT,
      }),
    ]);

  const allLeads = leads ?? [];
  const availableLeads = availableLeadsResult ?? [];

  // Sequences aren't a user-facing concept yet — every campaign has at most
  // one, created lazily on first step add. See getOrCreateDefaultSequence.
  const sequence = sequences?.[0] ?? null;
  const sequenceSteps = sequence ? await listSequenceSteps(supabase, sequence.id) : [];
  const sendingWindow = resolveSendingWindow(campaign.sending_window);

  // --- Readiness (Phase 2E) — same check launchCampaignAction enforces,
  // reused here purely for display: an unmet-readiness draft still reads
  // "Draft," a met one reads "Ready" — see lib/campaigns/readiness.ts.
  const readiness = checkCampaignReadiness({
    campaign,
    campaignLeads: campaignLeads ?? [],
    sequenceStepCount: sequenceSteps.length,
    mailboxes,
    domainCount: (domains ?? []).length,
  });
  const executionState = deriveExecutionState(campaign.status, readiness);

  // --- Execution status — counts derived from campaign_leads' own status/
  // next_send_at (the sending queue itself, see claim_due_sends()) and
  // email_events/analytics_events (the append-only send/reply logs), the
  // same sources Campaign Analytics reads from. No separate "queue" table
  // to keep in sync.
  const enrolledLeads = campaignLeads ?? [];
  const eventCounts = groupCounts(emailEvents ?? [], (event) => event.event_type);
  const analyticsCounts = groupCounts(analyticsEvents ?? [], (event) => event.event_type);
  const readyLeadsCount = enrolledLeads.filter(
    (lead) =>
      (lead.status === "pending" || lead.status === "active") && resolveLeadMailboxId(lead, campaign) !== null,
  ).length;
  const executionStatus = {
    totalLeads: enrolledLeads.length,
    ready: readyLeadsCount,
    scheduled: enrolledLeads.filter((lead) => lead.status === "active" && lead.next_send_at !== null).length,
    sent: eventCounts.sent ?? 0,
    failed: enrolledLeads.filter((lead) => lead.status === "failed" || lead.status === "needs_review").length,
    replied: eventCounts.replied ?? 0,
    positiveReplies: analyticsCounts.positive_reply ?? 0,
  };

  // --- Sending progress — the share of enrolled leads that have left the
  // active pipeline (sent through to a terminal state, one way or another),
  // out of everyone enrolled. rate() (lib/analytics/metrics.ts) returns null
  // instead of a fabricated 0% when nothing's enrolled yet.
  const inFlightStatuses = new Set(["pending", "active"]);
  const processedLeadsCount = enrolledLeads.filter((lead) => !inFlightStatuses.has(lead.status)).length;
  const progressPercent = rate(processedLeadsCount, enrolledLeads.length);

  const upcomingSends = selectUpcomingSends(enrolledLeads);

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{campaign.name}</h1>
            <Badge variant={EXECUTION_STATE_VARIANT[executionState] ?? "outline"}>
              {CAMPAIGN_EXECUTION_STATE_LABEL[executionState]}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {campaign.status !== "draft" && (
              <CampaignExecutionControls campaignId={campaignId} campaignStatus={campaign.status} />
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/campaigns/${campaignId}/analytics`}>
                <BarChart3Icon />
                View analytics
              </Link>
            </Button>
          </div>
        </div>
      </FadeIn>

      {campaign.status === "draft" ? (
        <FadeIn delay={0.05}>
          <CampaignSetupWizard
            campaign={campaign}
            campaignLeads={campaignLeads ?? []}
            leads={allLeads}
            availableLeads={availableLeads}
            leadLists={leadLists ?? []}
            mailboxes={mailboxes}
            sequenceId={sequence?.id ?? null}
            sequenceSteps={sequenceSteps ?? []}
            templates={templates ?? []}
            sendingWindow={sendingWindow}
            suppressions={suppressions ?? []}
            readiness={readiness}
          />
        </FadeIn>
      ) : (
        <>
          <div className="@container">
            <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-4">
              <FadeIn delay={0.05}>
                <StatCard title="Total leads" value={executionStatus.totalLeads} icon={<UsersIcon className="size-4" />} isEmpty={executionStatus.totalLeads === 0} emptyHint="No leads enrolled yet." />
              </FadeIn>
              <FadeIn delay={0.07}>
                <StatCard title="Leads ready" value={executionStatus.ready} icon={<CheckCircle2Icon className="size-4" />} isEmpty={executionStatus.ready === 0} emptyHint="No leads waiting to be sent to." />
              </FadeIn>
              <FadeIn delay={0.09}>
                <StatCard title="Emails scheduled" value={executionStatus.scheduled} icon={<CalendarClockIcon className="size-4" />} isEmpty={executionStatus.scheduled === 0} emptyHint="Nothing scheduled right now." />
              </FadeIn>
              <FadeIn delay={0.11}>
                <StatCard title="Emails sent" value={executionStatus.sent} icon={<SendIcon className="size-4" />} isEmpty={executionStatus.sent === 0} emptyHint="Will appear once this campaign starts sending." />
              </FadeIn>
              <FadeIn delay={0.13}>
                <StatCard title="Failed emails" value={executionStatus.failed} icon={<AlertTriangleIcon className="size-4" />} isEmpty={executionStatus.failed === 0} emptyHint="No failures — nice." tone="danger" />
              </FadeIn>
              <FadeIn delay={0.15}>
                <StatCard title="Replies received" value={executionStatus.replied} icon={<MessageCircleReplyIcon className="size-4" />} isEmpty={executionStatus.replied === 0} emptyHint="Will appear once a lead replies." />
              </FadeIn>
              <FadeIn delay={0.17}>
                <StatCard
                  title="Positive replies"
                  value={executionStatus.positiveReplies}
                  icon={<ThumbsUpIcon className="size-4" />}
                  isEmpty={executionStatus.positiveReplies === 0}
                  emptyHint="Sourced from the analytics event model — populates once reply sentiment is recorded there."
                />
              </FadeIn>
            </div>
          </div>

          {campaign.status === "active" && (
            <FadeIn delay={0.19}>
              <div className="@container">
                <div className="grid gap-4 @sm:grid-cols-2">
                  <PercentageCard
                    title="Sending progress"
                    value={progressPercent}
                    icon={<GaugeIcon className="size-4" />}
                    description={`${processedLeadsCount} of ${executionStatus.totalLeads} leads processed`}
                  />
                </div>
              </div>
            </FadeIn>
          )}

          <FadeIn delay={0.21}>
            <CampaignQueueView sends={upcomingSends} leads={allLeads} mailboxes={mailboxes} steps={sequenceSteps ?? []} />
          </FadeIn>

          <div className="grid gap-6 lg:grid-cols-3">
            <FadeIn delay={0.23} className="min-w-0 lg:col-span-2">
              <CampaignLeadTable
                campaignId={campaignId}
                campaignLeads={campaignLeads ?? []}
                leads={allLeads}
                availableLeads={availableLeads}
                leadLists={leadLists ?? []}
                mailboxes={mailboxes}
                steps={sequenceSteps ?? []}
                suppressions={suppressions ?? []}
              />
            </FadeIn>

            <FadeIn delay={0.25} className="lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle>Settings</CardTitle>
                  <CardDescription>Name, status, and sending defaults.</CardDescription>
                </CardHeader>
                <CardContent>
                  <CampaignForm mode="edit" campaign={campaign} sendingWindow={sendingWindow} mailboxes={mailboxes} />
                </CardContent>
              </Card>
            </FadeIn>
          </div>

          <FadeIn delay={0.27}>
            <SequenceStepsPanel
              campaignId={campaignId}
              sequenceId={sequence?.id ?? null}
              steps={sequenceSteps ?? []}
              templates={templates ?? []}
            />
          </FadeIn>
        </>
      )}
    </div>
  );
}
