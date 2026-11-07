import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getLead,
  listCampaignLeadsForLead,
  listCampaigns,
  listEmailEvents,
  listLeadLists,
  listLeadNotes,
  listMailboxes,
  listSendAttemptsForCampaignLeads,
  listSequenceSteps,
  listSequences,
} from "@/lib/db";
import { anyFailed, firstError, isNotFoundError, optionalRead, withRetry } from "@/lib/db/resilient-read";
import { formatLocalTime, isValidIanaTimezone } from "@/lib/timezones";
import { WidgetErrorBoundary } from "@/components/ui/widget-error-boundary";
import { ThrowIfFailed } from "@/components/ui/throw-if-failed";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ActivityTimeline, type TimelineEntry } from "@/components/analytics/activity-timeline";
import { LeadForm } from "@/components/leads/lead-form";
import { LeadDetailActions } from "@/components/leads/lead-detail-actions";
import { LeadEnrollmentsTable } from "@/components/leads/lead-enrollments-table";
import { LeadNotes } from "@/components/leads/lead-notes";
import { LeadStatusSelect } from "@/components/leads/lead-status-select";
import { leadEmailLabel } from "@/lib/leads/display";
import { buildLeadActivity } from "@/lib/leads/activity";

const VERIFICATION_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "success" | "outline"> = {
  unverified: "outline",
  pending: "secondary",
  valid: "success",
  invalid: "destructive",
  catch_all: "secondary",
  unknown: "secondary",
  error: "destructive",
};

const VERIFICATION_STATUS_LABEL: Record<string, string> = {
  unverified: "Unverified",
  pending: "Pending",
  valid: "Valid",
  invalid: "Invalid",
  catch_all: "Catch-all",
  unknown: "Unknown",
  error: "Error",
};

const EMAIL_EVENT_VARIANT: Record<string, TimelineEntry["variant"]> = {
  sent: "default",
  delivered: "default",
  replied: "secondary",
  bounced: "destructive",
  failed: "destructive",
  unsubscribed: "secondary",
};

// Single-lead scope, so this comfortably covers a lead's full history
// without pagination — same reasoning as the analytics page's own
// ANALYTICS_ROW_LIMIT, just for one lead instead of a whole account.
const EVENT_FETCH_LIMIT = 500;

function leadName(name: { first_name: string | null; last_name: string | null; email: string; display_email: string | null }) {
  const full = [name.first_name, name.last_name].filter(Boolean).join(" ");
  return full || leadEmailLabel(name);
}

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();

  // Critical read: this page exists to show one specific lead, so a real
  // failure here is this page's normal error state, not something to paper
  // over. Only PGRST116 ("no row" — including a lead RLS filtered out
  // because it belongs to another user) maps to notFound(), mirroring
  // campaigns/[campaignId]/page.tsx exactly — getLead(), not getLeadById(),
  // is what makes this an ownership check and not just an existence check.
  let lead;
  try {
    lead = await withRetry(() => getLead(supabase, user.id, leadId));
  } catch (error) {
    if (isNotFoundError(error)) notFound();
    throw error;
  }

  const [campaignLeadsResult, campaignsResult, mailboxesResult, leadListsResult, emailEventsResult, notesResult] =
    await Promise.all([
      optionalRead(() => listCampaignLeadsForLead(supabase, leadId), []),
      optionalRead(() => listCampaigns(supabase, user.id), []),
      optionalRead(() => listMailboxes(supabase, user.id), []),
      optionalRead(() => listLeadLists(supabase, user.id), []),
      optionalRead(() => listEmailEvents(supabase, undefined, { leadId, limit: EVENT_FETCH_LIMIT }), []),
      optionalRead(() => listLeadNotes(supabase, user.id, leadId), []),
    ]);

  // The send log (which step each email was) and each enrolled campaign's
  // step numbers, so the activity reads "Opened · Q4 outbound · Step 2".
  const enrolledCampaignLeads = campaignLeadsResult.data ?? [];
  const [sendsResult, stepsResult] = await Promise.all([
    optionalRead(() => listSendAttemptsForCampaignLeads(supabase, enrolledCampaignLeads.map((row) => row.id)), []),
    optionalRead(async () => {
      const numbers = new Map<string, number>();
      for (const campaignId of new Set(enrolledCampaignLeads.map((row) => row.campaign_id))) {
        const sequences = await listSequences(supabase, campaignId);
        const steps = sequences[0] ? await listSequenceSteps(supabase, sequences[0].id) : [];
        [...steps].sort((a, b) => a.step_order - b.step_order).forEach((step, index) => numbers.set(step.id, index + 1));
      }
      return numbers;
    }, new Map<string, number>()),
  ]);

  const campaignLeads = campaignLeadsResult.data;
  const campaigns = campaignsResult.data ?? [];
  const mailboxes = mailboxesResult.data;
  const leadLists = leadListsResult.data;
  const emailEvents = emailEventsResult.data;

  const campaignNameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));

  const enrollmentsFailed = anyFailed(campaignLeadsResult, campaignsResult, mailboxesResult);
  const enrollmentsError = firstError(campaignLeadsResult, campaignsResult, mailboxesResult);
  const activityFailed = emailEventsResult.failed || sendsResult.failed;
  const detailsFormFailed = leadListsResult.failed;

  const campaignIdByCampaignLeadId = new Map(enrolledCampaignLeads.map((row) => [row.id, row.campaign_id]));
  const activity = buildLeadActivity({
    events: emailEvents,
    sends: (sendsResult.data ?? [])
      .filter((attempt) => attempt.status === "sent")
      .map((attempt) => ({
        id: attempt.id,
        campaignId: campaignIdByCampaignLeadId.get(attempt.campaign_lead_id) ?? "",
        stepId: attempt.sequence_step_id,
        sentAt: attempt.resolved_at ?? attempt.claimed_at,
      })),
    campaignNameById,
    stepNumberById: stepsResult.data,
  });
  const timeline: TimelineEntry[] = activity.entries.map((entry) => ({
    id: entry.id,
    source: "email_event" as const,
    label: entry.label,
    variant: EMAIL_EVENT_VARIANT[entry.eventType] ?? "outline",
    detail: entry.detail,
    timestamp: entry.timestamp,
  }));
  const hiddenBots =
    activity.botEvents > 0
      ? ` ${activity.botEvents} open${activity.botEvents === 1 ? " or click" : "s and clicks"} by security scanners hidden and not counted.`
      : "";

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{leadName(lead)}</h1>
            <LeadStatusSelect leadId={lead.id} status={lead.status} />
            <Badge variant={VERIFICATION_STATUS_VARIANT[lead.verification_status] ?? "outline"}>
              {VERIFICATION_STATUS_LABEL[lead.verification_status] ?? lead.verification_status}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LeadDetailActions lead={lead} />
            <Button variant="outline" size="sm" asChild>
              <Link href="/leads">Back to leads</Link>
            </Button>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.03}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Emails sent", activity.counts.sent],
              ["Opens", activity.counts.opened],
              ["Clicks", activity.counts.clicked],
              ["Replies", activity.counts.replied],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <FadeIn delay={0.05}>
            <WidgetErrorBoundary label="Campaign enrollments">
              {enrollmentsFailed ? (
                <ThrowIfFailed error={enrollmentsError} />
              ) : (
                <LeadEnrollmentsTable
                  campaignLeads={campaignLeads}
                  campaignNameById={campaignNameById}
                  mailboxes={mailboxes}
                />
              )}
            </WidgetErrorBoundary>
          </FadeIn>

          <FadeIn delay={0.1}>
            <WidgetErrorBoundary label="Email activity">
              {activityFailed ? (
                <ThrowIfFailed error={emailEventsResult.error} />
              ) : (
                <ActivityTimeline
                  entries={timeline}
                  title="Email activity"
                  description={`Every email sent to this lead and how they engaged, across all campaigns.${hiddenBots}`}
                  emptyLabel="No email activity recorded yet."
                  showSource={false}
                />
              )}
            </WidgetErrorBoundary>
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="space-y-6 lg:col-span-1">
          <WidgetErrorBoundary label="Notes">
            {notesResult.failed ? (
              <ThrowIfFailed error={notesResult.error} />
            ) : (
              <LeadNotes leadId={lead.id} notes={notesResult.data} />
            )}
          </WidgetErrorBoundary>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Edit this lead&apos;s information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground">Sending timezone</p>
                {lead.timezone && isValidIanaTimezone(lead.timezone) ? (
                  <p className="mt-1">
                    <span className="font-medium">{lead.timezone.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground"> · now {formatLocalTime(lead.timezone, new Date())}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    {lead.timezone
                      ? `"${lead.timezone}" isn't a valid timezone, so each campaign's own timezone is used.`
                      : "Not set — each campaign's own timezone is used."}
                  </p>
                )}
              </div>
              <WidgetErrorBoundary label="Lead details">
                {detailsFormFailed ? (
                  <ThrowIfFailed error={leadListsResult.error} />
                ) : (
                  <LeadForm mode="edit" lead={lead} leadLists={leadLists} />
                )}
              </WidgetErrorBoundary>
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
