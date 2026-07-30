import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getCampaign,
  listCampaignLeads,
  listLeadLists,
  listLeads,
  listMailboxes,
  listSequences,
  listSequenceSteps,
} from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { CampaignLeadTable } from "@/components/campaigns/campaign-lead-table";
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

  const [campaignLeads, leads, leadLists, mailboxes, sequences] = await Promise.all([
    listCampaignLeads(supabase, campaignId),
    listLeads(supabase, user.id, { limit: 10000 }),
    listLeadLists(supabase, user.id),
    listMailboxes(supabase, user.id),
    listSequences(supabase, campaignId),
  ]);

  const allLeads = leads ?? [];
  const enrolledLeadIds = new Set((campaignLeads ?? []).map((row) => row.lead_id));
  const availableLeads = allLeads.filter((lead) => !enrolledLeadIds.has(lead.id));

  // Sequences aren't a user-facing concept yet — every campaign has at most
  // one, created lazily on first step add. See getOrCreateDefaultSequence.
  const sequence = sequences?.[0] ?? null;
  const sequenceSteps = sequence ? await listSequenceSteps(supabase, sequence.id) : [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{campaign.name}</h1>
          <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>{statusLabel(campaign.status)}</Badge>
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-3">
        <FadeIn delay={0.05} className="lg:col-span-2">
          <CampaignLeadTable
            campaignId={campaignId}
            campaignLeads={campaignLeads ?? []}
            leads={allLeads}
            availableLeads={availableLeads}
            leadLists={leadLists ?? []}
            mailboxes={mailboxes}
          />
        </FadeIn>

        <FadeIn delay={0.1} className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>Name, status, and sending defaults.</CardDescription>
            </CardHeader>
            <CardContent>
              <CampaignForm mode="edit" campaign={campaign} mailboxes={mailboxes} />
            </CardContent>
          </Card>
        </FadeIn>
      </div>

      <FadeIn delay={0.15}>
        <SequenceStepsPanel campaignId={campaignId} sequenceId={sequence?.id ?? null} steps={sequenceSteps ?? []} />
      </FadeIn>
    </div>
  );
}
