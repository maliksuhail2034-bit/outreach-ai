import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// No userId parameter: ownership is derived from campaign_id via RLS (and
// the DB-level ownership-consistency trigger), not stored on this table.

export async function listCampaignLeads(supabase: Client, campaignId: string, options?: { status?: string }) {
  let query = supabase
    .from("campaign_leads")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// The lead-scoped counterpart to listCampaignLeads above — every campaign a
// given lead is enrolled in, not one campaign's enrolled leads. Used by the
// lead detail page (app/(app)/leads/[leadId]/page.tsx). No userId param
// needed here either: RLS already restricts this to enrollments whose
// campaign belongs to the caller, regardless of which lead_id is queried, so
// a lead_id from another user's account simply returns zero rows rather than
// leaking anything.
export async function listCampaignLeadsForLead(supabase: Client, leadId: string) {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export interface CampaignLeadActivitySummary {
  leadsCount: number;
  nextSendAt: string | null;
  lastActivityAt: string | null;
}

// Dashboard "Recent campaigns" widget needs a count plus two extremal
// timestamps per campaign, not every enrolled lead row — three small,
// already-indexed (campaign_id) lookups instead of pulling the full
// campaign_leads result set into memory just to derive them (see the
// Performance audit's P8: this used to be `listCampaignLeads` fetching every
// row, per campaign, on every dashboard load).
export async function getCampaignLeadActivitySummary(
  supabase: Client,
  campaignId: string,
): Promise<CampaignLeadActivitySummary> {
  const [countResult, nextSendResult, lastActivityResult] = await Promise.all([
    supabase.from("campaign_leads").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId),
    supabase
      .from("campaign_leads")
      .select("next_send_at")
      .eq("campaign_id", campaignId)
      .not("next_send_at", "is", null)
      .order("next_send_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("campaign_leads")
      .select("updated_at")
      .eq("campaign_id", campaignId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (countResult.error) throw countResult.error;
  if (nextSendResult.error) throw nextSendResult.error;
  if (lastActivityResult.error) throw lastActivityResult.error;

  return {
    leadsCount: countResult.count ?? 0,
    nextSendAt: nextSendResult.data?.next_send_at ?? null,
    lastActivityAt: lastActivityResult.data?.updated_at ?? null,
  };
}

export async function getCampaignLead(supabase: Client, id: string) {
  const result = await supabase.from("campaign_leads").select("*").eq("id", id).single();
  return unwrap<Tables<"campaign_leads">>(result);
}

export async function addLeadToCampaign(supabase: Client, values: TablesInsert<"campaign_leads">) {
  const result = await supabase.from("campaign_leads").insert(values).select("*").single();
  return unwrap<Tables<"campaign_leads">>(result);
}

export async function updateCampaignLead(supabase: Client, id: string, values: TablesUpdate<"campaign_leads">) {
  const result = await supabase.from("campaign_leads").update(values).eq("id", id).select("*").single();
  return unwrap<Tables<"campaign_leads">>(result);
}

export async function removeCampaignLead(supabase: Client, id: string) {
  const { error } = await supabase.from("campaign_leads").delete().eq("id", id);
  if (error) throw error;
}

// Bulk-enrolls leads not already in the campaign (campaign_leads has a
// unique(campaign_id, lead_id) constraint as a DB-level backstop, but
// pre-filtering here gives an accurate inserted/skipped count for the UI
// instead of relying on parsing constraint-violation errors per row).
//
// Batch 8: the single mailboxId value this used to take is now a resolver
// callback, keyed by "enrollment index" (existing enrolled count + this
// lead's position among the ones actually being inserted, preserving
// leadIds' given order) — lets the caller round-robin across a mailbox pool
// (see lib/campaigns/readiness.ts's resolvePoolMailboxId) without this
// function needing any pool-specific knowledge of its own. The existing
// count this already queried for dedup purposes doubles as the rotation
// offset — no second query added. A caller with no pool just returns the
// same mailboxId for every index, reproducing the exact prior behavior.
export async function addLeadsToCampaign(
  supabase: Client,
  campaignId: string,
  leadIds: string[],
  resolveMailboxId: (enrollmentIndex: number) => string | null,
) {
  const { data: existing, error: existingError } = await supabase
    .from("campaign_leads")
    .select("lead_id")
    .eq("campaign_id", campaignId);
  if (existingError) throw existingError;

  const alreadyEnrolled = new Set(existing.map((row) => row.lead_id));
  const startIndex = existing.length;
  const toInsert = leadIds
    .filter((leadId) => !alreadyEnrolled.has(leadId))
    .map((leadId, index) => ({ campaign_id: campaignId, lead_id: leadId, mailbox_id: resolveMailboxId(startIndex + index) }));

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: leadIds.length, rows: [] as Tables<"campaign_leads">[] };
  }

  // .select("*") on the same insert (no extra query) so callers can
  // schedule each newly-enrolled row without a second round-trip — see
  // scheduleOnEnrollment in app/(app)/campaigns/[campaignId]/actions.ts.
  const { data, error } = await supabase.from("campaign_leads").insert(toInsert).select("*");
  if (error) throw error;

  return { inserted: toInsert.length, skipped: leadIds.length - toInsert.length, rows: data ?? [] };
}

// Reply-tracking helper — campaign_leads has a unique(campaign_id, lead_id)
// constraint, so a header-based reply match (which lands on an
// email_events row carrying campaign_id + lead_id, not a campaign_lead id
// directly) can resolve the specific enrollment via this lookup.
export async function getCampaignLeadByCampaignAndLead(supabase: Client, campaignId: string, leadId: string) {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Reply-tracking fallback-matching helper (see lib/email/reply-worker.ts) —
// bounded to a specific mailbox and a specific set of candidate lead ids
// (already resolved by From-address), so the caller can require an exact
// single match before treating it as attributable.
export async function listActiveCampaignLeadsForMailbox(supabase: Client, mailboxId: string, leadIds: string[]) {
  if (leadIds.length === 0) return [];
  const { data, error } = await supabase
    .from("campaign_leads")
    .select("*")
    .eq("status", "active")
    .eq("mailbox_id", mailboxId)
    .in("lead_id", leadIds);
  if (error) throw error;
  return data;
}

// Stopping a campaign (see stopCampaignAction) cancels every lead still
// waiting in the pipeline in one statement, rather than looping
// updateCampaignLead per row — atomic, and avoids N round-trips for a
// campaign with many enrolled leads. 'cancelled' leaves the row queryable
// (unlike a delete) while guaranteeing claim_due_sends() (status = 'active'
// only) never picks it up again — see 20260804100000_sending_limits.sql for
// why 'cancelled' exists.
export async function cancelActiveCampaignLeads(supabase: Client, campaignId: string) {
  const { error } = await supabase
    .from("campaign_leads")
    .update({ status: "cancelled", next_send_at: null, locked_until: null })
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "active"]);
  if (error) throw error;
}

// Wraps request_send_now()
// (supabase/migrations/20260926100000_campaign_leads_send_now_step.sql) — the
// only way to record a Send Now bypass. Must be called with the user's own
// session (lib/supabase/server.ts): the RPC checks ownership via auth.uid()
// and every eligibility condition atomically, so false means the lead was no
// longer eligible by the time it ran (most often: the worker had just
// claimed it).
export async function requestSendNow(supabase: Client, campaignLeadId: string) {
  const { data, error } = await supabase.rpc("request_send_now", { p_campaign_lead_id: campaignLeadId });
  if (error) throw error;
  return data === true;
}

// The send worker's clear-before-send of a Send Now bypass. Conditional on
// the row still holding exactly the bypass the worker claimed, for the same
// step: its claimed copy can be stale — a pause after the claim clears
// send_now_step_id in the database (campaigns_clear_send_now_on_inactive).
// Returns false when nothing matched, i.e. the bypass is no longer valid and
// must not be used. Called with the admin client from the worker.
export async function consumeSendNow(
  supabase: Client,
  campaignLeadId: string,
  sendNowStepId: string,
  currentStepId: string,
) {
  const { data, error } = await supabase
    .from("campaign_leads")
    .update({ send_now_step_id: null })
    .eq("id", campaignLeadId)
    .eq("send_now_step_id", sendNowStepId)
    .eq("current_step_id", currentStepId)
    .select("id");
  if (error) throw error;
  return data.length > 0;
}

// When the send worker finds a due lead outside its campaign's sending
// window, every other lead of that campaign due right now is outside it too
// (the window is per campaign), so they're all moved to the same next
// opening in one statement instead of being claimed and deferred one per
// worker run. Only rows that are active, due, unleased and have no pending
// Send Now — a leased row belongs to an in-flight worker, and a Send Now
// request is handled on its own. Called with the admin client from the
// worker (see lib/email/send-worker.ts).
export async function deferDueCampaignLeads(supabase: Client, campaignId: string, nextSendAt: Date, now: Date) {
  const nowIso = now.toISOString();
  const { error } = await supabase
    .from("campaign_leads")
    .update({ next_send_at: nextSendAt.toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "active")
    .lte("next_send_at", nowIso)
    .is("send_now_step_id", null)
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`);
  if (error) throw error;
}

// Wraps claim_due_sends() (supabase/migrations/20260730100020_claim_due_sends.sql).
// Must be called with lib/supabase/admin.ts — same carve-out as
// recordEmailEvent/getMailboxCredentials: privileged, no user in the loop.
// Locking/eligibility/daily-limit logic all lives in the RPC itself; this
// is a thin wrapper only.
export async function claimDueSends(supabase: Client, limit = 25) {
  const { data, error } = await supabase.rpc("claim_due_sends", { p_limit: limit });
  if (error) throw error;
  return data;
}
