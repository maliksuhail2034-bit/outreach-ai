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
  listMailboxes,
} from "@/lib/db";
import { anyFailed, firstError, isNotFoundError, optionalRead, withRetry } from "@/lib/db/resilient-read";
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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "outline",
  contacted: "secondary",
  replied: "secondary",
  qualified: "default",
  unqualified: "destructive",
};

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

// Same shape/order as app/(app)/analytics/page.tsx's own EMAIL_EVENT_LABEL/
// VARIANT maps — duplicated rather than imported since that page doesn't
// export them and the map is small enough that sharing it isn't worth a new
// module. Every event_type email_events' check constraint allows.
const EMAIL_EVENT_LABEL: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  failed: "Failed",
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

function leadName(name: { first_name: string | null; last_name: string | null; email: string }) {
  const full = [name.first_name, name.last_name].filter(Boolean).join(" ");
  return full || name.email;
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
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

  const [campaignLeadsResult, campaignsResult, mailboxesResult, leadListsResult, emailEventsResult] =
    await Promise.all([
      optionalRead(() => listCampaignLeadsForLead(supabase, leadId), []),
      optionalRead(() => listCampaigns(supabase, user.id), []),
      optionalRead(() => listMailboxes(supabase, user.id), []),
      optionalRead(() => listLeadLists(supabase, user.id), []),
      optionalRead(() => listEmailEvents(supabase, undefined, { leadId, limit: EVENT_FETCH_LIMIT }), []),
    ]);

  const campaignLeads = campaignLeadsResult.data;
  const campaigns = campaignsResult.data ?? [];
  const mailboxes = mailboxesResult.data;
  const leadLists = leadListsResult.data;
  const emailEvents = emailEventsResult.data;

  const campaignNameById = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));

  const enrollmentsFailed = anyFailed(campaignLeadsResult, campaignsResult, mailboxesResult);
  const enrollmentsError = firstError(campaignLeadsResult, campaignsResult, mailboxesResult);
  const activityFailed = emailEventsResult.failed;
  const detailsFormFailed = leadListsResult.failed;

  const timeline: TimelineEntry[] = emailEvents
    .map((event) => ({
      id: event.id,
      source: "email_event" as const,
      label: EMAIL_EVENT_LABEL[event.event_type] ?? event.event_type,
      variant: EMAIL_EVENT_VARIANT[event.event_type] ?? "outline",
      detail: null,
      timestamp: event.created_at,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{leadName(lead)}</h1>
            <Badge variant={STATUS_VARIANT[lead.status] ?? "outline"}>{statusLabel(lead.status)}</Badge>
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
                  description="Every send/engagement event recorded for this lead, across all campaigns."
                  emptyLabel="No email activity recorded yet."
                />
              )}
            </WidgetErrorBoundary>
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Edit this lead&apos;s information.</CardDescription>
            </CardHeader>
            <CardContent>
              <WidgetErrorBoundary label="Lead details">
                {detailsFormFailed ? (
                  <ThrowIfFailed error={leadListsResult.error} />
                ) : (
                  <LeadForm mode="edit" lead={lead} leadLists={leadLists} onSuccess={() => {}} />
                )}
              </WidgetErrorBoundary>
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
