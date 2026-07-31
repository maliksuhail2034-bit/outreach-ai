import type { Client } from "@/lib/db/shared";
import { createSuppression, getCampaignById, getCampaignLead, getLeadById, recordEmailEvent, updateCampaignLead } from "@/lib/db";

export type UnsubscribeResult = { ok: true; email: string } | { ok: false; error: string };

// The one place unsubscribe business logic lives — the "use server" action
// (app/unsubscribe/[token]/actions.ts) is a thin wrapper around this, same
// "orchestration wrapper around testable logic" shape as
// lib/email/reply-worker.ts's processInboundMessage. Runs on the admin
// client: the visitor clicking this link has no session (see
// CLAUDE.md's admin.ts carve-out — privileged, no user in the loop).
export async function processUnsubscribe(supabase: Client, campaignLeadId: string): Promise<UnsubscribeResult> {
  let campaignLead;
  try {
    campaignLead = await getCampaignLead(supabase, campaignLeadId);
  } catch {
    // A valid signature but a since-deleted campaign_lead (lead removed,
    // campaign deleted) — no different from a bad link as far as the
    // visitor is concerned.
    return { ok: false, error: "This unsubscribe link is no longer valid." };
  }

  const [campaign, lead] = await Promise.all([
    getCampaignById(supabase, campaignLead.campaign_id),
    getLeadById(supabase, campaignLead.lead_id),
  ]);

  // suppressions is per-user, campaign-independent (see
  // supabase/migrations/20260730100010_suppressions.sql) — this blocks the
  // address across every campaign the user runs, not just this one, same
  // as the existing bounce path in record_send_failure.
  await createSuppression(supabase, {
    user_id: campaign.user_id,
    email: lead.email,
    reason: "unsubscribed",
    source_campaign_id: campaign.id,
  });

  // Only this one enrollment's status is updated — sibling enrollments (if
  // the lead is in other campaigns) are stopped by the suppressions check
  // at claim/send time, not by cascading a status update to every row.
  // Mirrors exactly how record_send_failure's bounced branch already
  // behaves; not a new pattern.
  await updateCampaignLead(supabase, campaignLead.id, {
    status: "unsubscribed",
    next_send_at: null,
    locked_until: null,
  });

  await recordEmailEvent(supabase, {
    campaign_id: campaign.id,
    lead_id: lead.id,
    mailbox_id: campaignLead.mailbox_id,
    event_type: "unsubscribed",
  });

  return { ok: true, email: lead.email };
}
