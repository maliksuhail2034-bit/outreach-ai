import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangleIcon,
  BarChart3Icon,
  CalendarClockIcon,
  ListTodoIcon,
  MessageCircleReplyIcon,
  SendIcon,
} from "lucide-react";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaign,
  listCampaignLeads,
  listEmailEvents,
  listLeadLists,
  listLeads,
  listMailboxes,
  listSequences,
  listSequenceSteps,
  listSuppressions,
  listTemplates,
} from "@/lib/db";
import { resolveSendingWindow } from "@/lib/email/scheduling";
import { groupCounts } from "@/lib/analytics/metrics";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { CampaignLeadTable } from "@/components/campaigns/campaign-lead-table";
import { CampaignSetupWizard } from "@/components/campaigns/campaign-setup-wizard";
import { SequenceStepsPanel } from "@/components/sequences/sequence-steps-panel";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  active: "default",
  paused: "secondary",
  completed: "secondary",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Single-campaign scope, so a generous limit (like the campaign analytics
// page's) comfortably covers a campaign's full send history without
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

  const [campaignLeads, leads, leadLists, mailboxes, sequences, templates, suppressions, emailEvents] =
    await Promise.all([
      listCampaignLeads(supabase, campaignId),
      listLeads(supabase, user.id, { limit: 10000 }),
      listLeadLists(supabase, user.id),
      listMailboxes(supabase, user.id),
      listSequences(supabase, campaignId),
      listTemplates(supabase, user.id),
      listSuppressions(supabase, user.id),
      listEmailEvents(supabase, campaignId, { limit: EVENT_FETCH_LIMIT }),
    ]);

  const allLeads = leads ?? [];
  const enrolledLeadIds = new Set((campaignLeads ?? []).map((row) => row.lead_id));
  const availableLeads = allLeads.filter((lead) => !enrolledLeadIds.has(lead.id));

  // --- Execution status (Phase 2D) — counts derived from campaign_leads'
  // own status/next_send_at (the sending queue itself, see claim_due_sends())
  // and email_events (the append-only send/reply log), the same sources
  // Campaign Analytics reads from. No separate "queue" table to keep in
  // sync.
  const enrolledLeads = campaignLeads ?? [];
  const eventCounts = groupCounts(emailEvents ?? [], (event) => event.event_type);
  const executionStatus = {
    queued: enrolledLeads.filter((lead) => lead.status === "pending" || lead.status === "active").length,
    scheduled: enrolledLeads.filter((lead) => lead.status === "active" && lead.next_send_at !== null).length,
    sent: eventCounts.sent ?? 0,
    failed: enrolledLeads.filter((lead) => lead.status === "failed" || lead.status === "needs_review").length,
    replied: eventCounts.replied ?? 0,
  };

  // Sequences aren't a user-facing concept yet — every campaign has at most
  // one, created lazily on first step add. See getOrCreateDefaultSequence.
  const sequence = sequences?.[0] ?? null;
  const sequenceSteps = sequence ? await listSequenceSteps(supabase, sequence.id) : [];
  const sendingWindow = resolveSendingWindow(campaign.sending_window);

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{campaign.name}</h1>
            <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>{statusLabel(campaign.status)}</Badge>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/campaigns/${campaignId}/analytics`}>
              <BarChart3Icon />
              View analytics
            </Link>
          </Button>
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
          />
        </FadeIn>
      ) : (
        <>
          <div className="@container">
            <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-5">
              <FadeIn delay={0.05}>
                <StatCard title="Leads queued" value={executionStatus.queued} icon={<ListTodoIcon className="size-4" />} isEmpty={executionStatus.queued === 0} emptyHint="No leads waiting to be sent to." />
              </FadeIn>
              <FadeIn delay={0.07}>
                <StatCard title="Emails scheduled" value={executionStatus.scheduled} icon={<CalendarClockIcon className="size-4" />} isEmpty={executionStatus.scheduled === 0} emptyHint="Nothing scheduled right now." />
              </FadeIn>
              <FadeIn delay={0.09}>
                <StatCard title="Emails sent" value={executionStatus.sent} icon={<SendIcon className="size-4" />} isEmpty={executionStatus.sent === 0} emptyHint="Will appear once this campaign starts sending." />
              </FadeIn>
              <FadeIn delay={0.11}>
                <StatCard title="Failed sends" value={executionStatus.failed} icon={<AlertTriangleIcon className="size-4" />} isEmpty={executionStatus.failed === 0} emptyHint="No failures — nice." />
              </FadeIn>
              <FadeIn delay={0.13}>
                <StatCard title="Replies received" value={executionStatus.replied} icon={<MessageCircleReplyIcon className="size-4" />} isEmpty={executionStatus.replied === 0} emptyHint="Will appear once a lead replies." />
              </FadeIn>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <FadeIn delay={0.16} className="lg:col-span-2">
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

            <FadeIn delay={0.18} className="lg:col-span-1">
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

          <FadeIn delay={0.2}>
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
