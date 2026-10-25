import { createAdminClient } from "@/lib/supabase/admin";
import { findCampaignLead, findSequenceStepWithCampaign, getLeadById, getSendAttempt } from "@/lib/db";
import { unescapeHtml } from "./merge-tags";
import { renderEmailContent } from "./render-email";
import { decodeUnverifiedClickTrackingPayload, type ClickTrackingContext } from "./tracking-token";

// Fallback for click links signed with a CLICK_TRACKING_TOKEN_SECRET that is
// no longer available (the Vercel → VPS migration could not recover it).
// Their signature can't be checked, so nothing in the payload is trusted:
// every field is re-established from the database, and the destination is
// only accepted if re-rendering the stored step for that lead produces
// exactly that link. A forged payload can therefore only ever redirect to a
// URL the sender themselves put in an email that was actually sent.
//
// Off unless CLICK_TRACKING_LEGACY_BEFORE is set (an ISO timestamp: the
// moment the secret changed). Only sends created before it qualify, so links
// signed with the current secret never fall back.

export type LegacyClickContext = Omit<ClickTrackingContext, "mailboxId"> & {
  // Null when the enrollment's mailbox no longer matches the token's — the
  // click is still honoured, but not attributed to an unverified mailbox.
  mailboxId: string | null;
};

// Same href shape send-worker.ts's rewriteClickTrackingLinks rewrote.
const HREF_URL_PATTERN = /href="(https?:\/\/[^"]*)"/g;
// Stands in for the real unsubscribe URL while re-rendering, which needs the
// unsubscribe secret; the send never tracked that link, so it's excluded.
const UNSUBSCRIBE_PLACEHOLDER = "https://unsubscribe.invalid/";

function legacyCutoff(): number | null {
  const raw = process.env.CLICK_TRACKING_LEGACY_BEFORE;
  if (!raw) return null;
  const cutoff = Date.parse(raw);
  return Number.isFinite(cutoff) ? cutoff : null;
}

export async function resolveLegacyClickToken(token: string): Promise<LegacyClickContext | null> {
  const cutoff = legacyCutoff();
  if (cutoff === null) return null;

  const claimed = decodeUnverifiedClickTrackingPayload(token);
  if (!claimed) return null;

  try {
    const supabase = createAdminClient();

    const attempt = await getSendAttempt(supabase, claimed.campaignLeadId, claimed.sequenceStepId);
    if (!attempt || attempt.status !== "sent" || !(Date.parse(attempt.created_at) < cutoff)) return null;

    const campaignLead = await findCampaignLead(supabase, claimed.campaignLeadId);
    if (!campaignLead || campaignLead.campaign_id !== claimed.campaignId || campaignLead.lead_id !== claimed.leadId) {
      return null;
    }

    const step = await findSequenceStepWithCampaign(supabase, claimed.sequenceStepId);
    if (!step || step.sequences.campaign_id !== claimed.campaignId) return null;

    const lead = await getLeadById(supabase, claimed.leadId);
    const rendered = renderEmailContent(step.subject ?? "", step.body ?? "", {
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      company: lead.company,
      title: lead.title,
      custom_fields: lead.custom_fields as Record<string, unknown> | null,
      unsubscribeUrl: UNSUBSCRIBE_PLACEHOLDER,
    });
    const sentLinks = new Set(
      [...rendered.html.matchAll(HREF_URL_PATTERN)].map(([, href]) => unescapeHtml(href)),
    );
    sentLinks.delete(UNSUBSCRIBE_PLACEHOLDER);
    if (!sentLinks.has(claimed.destinationUrl)) return null;

    return {
      ...claimed,
      mailboxId: campaignLead.mailbox_id === claimed.mailboxId ? claimed.mailboxId : null,
    };
  } catch (error) {
    console.error("[track-click] legacy link check failed", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}
