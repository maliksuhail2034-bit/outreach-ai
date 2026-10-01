import type { Client } from "@/lib/db/shared";
import {
  createSuppression,
  findCampaignLead,
  getCampaignById,
  getLeadById,
  markCampaignLeadUnsubscribed,
  recordEmailEvent,
} from "@/lib/db";
import type { UnsubscribeRecipient, VerifiedUnsubscribeToken } from "./unsubscribe-token";

export type UnsubscribeResult = { ok: true; email: string } | { ok: false; error: string };

const NO_LONGER_VALID = "This unsubscribe link is no longer valid.";

// The one place unsubscribe business logic lives — the "use server" action
// (app/unsubscribe/[token]/actions.ts) is a thin wrapper around this, same
// "orchestration wrapper around testable logic" shape as
// lib/email/reply-worker.ts's processInboundMessage. Runs on the admin
// client: the visitor clicking this link has no session (see
// CLAUDE.md's admin.ts carve-out — privileged, no user in the loop).
//
// A current token carries the recipient itself, so it works whether or not
// the enrollment it was sent for still exists. A legacy token only names the
// enrollment, so it can only be resolved while that row exists.
export async function processUnsubscribe(supabase: Client, token: VerifiedUnsubscribeToken): Promise<UnsubscribeResult> {
  if (token.kind === "recipient") return unsubscribeRecipient(supabase, token.recipient);

  let campaignLead;
  try {
    campaignLead = await findCampaignLead(supabase, token.campaignLeadId);
  } catch {
    campaignLead = null;
  }
  // A legacy link whose enrollment was deleted (lead removed, campaign
  // deleted) can't be traced to anyone — no different from a bad link as far
  // as the visitor is concerned.
  if (!campaignLead) return { ok: false, error: NO_LONGER_VALID };

  const [campaign, lead] = await Promise.all([
    getCampaignById(supabase, campaignLead.campaign_id),
    getLeadById(supabase, campaignLead.lead_id),
  ]);
  return unsubscribeRecipient(supabase, { userId: campaign.user_id, email: lead.email, campaignLeadId: campaignLead.id });
}

async function unsubscribeRecipient(supabase: Client, recipient: UnsubscribeRecipient): Promise<UnsubscribeResult> {
  // The enrollment is secondary: if it can't be read, the suppression below
  // still stops every future send, and the send worker's suppression check
  // moves the enrollment to 'unsubscribed' the next time it's claimed.
  let enrollment: Awaited<ReturnType<typeof findRecipientEnrollment>> = null;
  try {
    enrollment = await findRecipientEnrollment(supabase, recipient);
  } catch (error) {
    console.error("[unsubscribe] could not read the enrollment, suppressing the address only", {
      campaignLeadId: recipient.campaignLeadId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  // suppressions is per-user, campaign-independent (see
  // supabase/migrations/20260730100010_suppressions.sql) — this blocks the
  // address across every campaign the user runs, not just this one, same
  // as the existing bounce path in record_send_failure. Keyed by the email
  // exactly as stored on the lead, which is what the send worker's
  // suppression check looks up. Written first: it's the part that has to
  // hold even when nothing else about the enrollment does.
  await createSuppression(supabase, {
    user_id: recipient.userId,
    email: recipient.email,
    reason: "unsubscribed",
    source_campaign_id: enrollment?.campaign_id ?? null,
  });

  // Only this one enrollment's status is updated — sibling enrollments (if
  // the lead is in other campaigns) are stopped by the suppressions check
  // at claim/send time, not by cascading a status update to every row.
  // Mirrors exactly how record_send_failure's bounced branch already
  // behaves; not a new pattern. The event is recorded only by the click
  // that actually stopped the enrollment.
  if (enrollment && (await markCampaignLeadUnsubscribed(supabase, enrollment.id))) {
    await recordEmailEvent(supabase, {
      campaign_id: enrollment.campaign_id,
      lead_id: enrollment.lead_id,
      mailbox_id: enrollment.mailbox_id,
      event_type: "unsubscribed",
    });
  }

  return { ok: true, email: recipient.email };
}

// The enrollment the email was sent for, only while it still belongs to this
// recipient — same owner, and its lead still has this address. Otherwise
// (deleted, or the lead's address has since been changed) no enrollment is
// touched; the suppression alone covers the address.
async function findRecipientEnrollment(supabase: Client, recipient: UnsubscribeRecipient) {
  const enrollment = await findCampaignLead(supabase, recipient.campaignLeadId);
  if (!enrollment) return null;

  const [campaign, lead] = await Promise.all([
    getCampaignById(supabase, enrollment.campaign_id),
    getLeadById(supabase, enrollment.lead_id),
  ]);
  return campaign.user_id === recipient.userId && lead.email === recipient.email ? enrollment : null;
}
