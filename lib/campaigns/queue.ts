import type { Tables } from "@/types/database.types";

// Read-only view of a campaign's sending queue for the "Upcoming sends"
// panel — same eligibility signal claim_due_sends() uses (status = 'active',
// next_send_at set — see 20260730100020_claim_due_sends.sql), just sorted
// and shaped for display instead of claimed/locked. No new query or table:
// campaign_leads already is the queue (see the Phase 2D migration
// comments), this only decides how to present it.

export interface UpcomingSend {
  campaignLeadId: string;
  leadId: string;
  mailboxId: string | null;
  sequenceStepId: string | null;
  scheduledAt: string;
  // A row currently claimed (locked_until in the future) is being sent
  // right now rather than merely waiting — mirrors the "Sending…" badge
  // CampaignLeadTable already shows for the same condition.
  status: "scheduled" | "sending";
}

const DEFAULT_UPCOMING_LIMIT = 20;

export function selectUpcomingSends(
  campaignLeads: Tables<"campaign_leads">[],
  limit = DEFAULT_UPCOMING_LIMIT,
  now: Date = new Date(),
): UpcomingSend[] {
  return campaignLeads
    .filter((lead): lead is Tables<"campaign_leads"> & { next_send_at: string } => {
      return lead.status === "active" && lead.next_send_at !== null;
    })
    .sort((a, b) => new Date(a.next_send_at).getTime() - new Date(b.next_send_at).getTime())
    .slice(0, limit)
    .map((lead) => ({
      campaignLeadId: lead.id,
      leadId: lead.lead_id,
      mailboxId: lead.mailbox_id,
      sequenceStepId: lead.current_step_id,
      scheduledAt: lead.next_send_at,
      status: lead.locked_until && new Date(lead.locked_until) > now ? "sending" : "scheduled",
    }));
}
