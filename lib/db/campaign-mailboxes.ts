import type { Tables } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// A campaign's optional mailbox pool (see supabase/migrations/
// 20260918120000_campaign_mailboxes.sql). No userId parameter: ownership is
// derived from campaign_id via RLS (and the DB-level ownership-consistency
// trigger), same as campaign-leads.ts.

// Ordered by created_at (insertion order) so round-robin assignment
// (lib/campaigns/readiness.ts's resolvePoolMailboxId) cycles deterministically
// rather than depending on whatever order the database happens to return rows.
// `id` is a secondary sort key: created_at alone isn't unique (two rows can
// share a timestamp, e.g. two concurrent adds), and Postgres doesn't
// guarantee stable ordering across ties — id breaks them deterministically.
export async function listCampaignMailboxes(supabase: Client, campaignId: string) {
  const { data, error } = await supabase
    .from("campaign_mailboxes")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addCampaignMailbox(supabase: Client, campaignId: string, mailboxId: string) {
  const result = await supabase
    .from("campaign_mailboxes")
    .insert({ campaign_id: campaignId, mailbox_id: mailboxId })
    .select("*")
    .single();
  return unwrap<Tables<"campaign_mailboxes">>(result);
}

// Deletes by the natural (campaign_id, mailbox_id) key rather than the row's
// own id — callers (the mailbox pool UI) know which mailbox they're
// toggling off, not the join row's internal id.
export async function removeCampaignMailbox(supabase: Client, campaignId: string, mailboxId: string) {
  const { error } = await supabase
    .from("campaign_mailboxes")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("mailbox_id", mailboxId);
  if (error) throw error;
}
