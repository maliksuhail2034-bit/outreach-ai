import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// --- Warmup profiles -------------------------------------------------------

export async function listWarmupProfiles(supabase: Client, organizationId: string) {
  const { data, error } = await supabase
    .from("warmup_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getWarmupProfileByMailbox(supabase: Client, organizationId: string, mailboxId: string) {
  const { data, error } = await supabase
    .from("warmup_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("mailbox_id", mailboxId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Admin-context equivalent of getWarmupProfileByMailbox — filtered by
// mailbox_id only, no organization_id. Reserved for trusted worker code with
// no user/organization in the loop (lib/deliverability/health-check-worker.ts);
// the service-role client already bypasses RLS, so the extra organization
// scope that protects a user-facing read isn't meaningful here.
export async function getWarmupProfileByMailboxId(supabase: Client, mailboxId: string) {
  const { data, error } = await supabase.from("warmup_profiles").select("*").eq("mailbox_id", mailboxId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createWarmupProfile(supabase: Client, values: TablesInsert<"warmup_profiles">) {
  const result = await supabase.from("warmup_profiles").insert(values).select("*").single();
  return unwrap<Tables<"warmup_profiles">>(result);
}

export async function updateWarmupProfile(
  supabase: Client,
  organizationId: string,
  mailboxId: string,
  values: TablesUpdate<"warmup_profiles">,
) {
  const result = await supabase
    .from("warmup_profiles")
    .update(values)
    .eq("organization_id", organizationId)
    .eq("mailbox_id", mailboxId)
    .select("*")
    .single();
  return unwrap<Tables<"warmup_profiles">>(result);
}

// --- Warmup events (append-only) -------------------------------------------

export async function insertWarmupEvent(supabase: Client, values: TablesInsert<"warmup_events">) {
  const result = await supabase.from("warmup_events").insert(values).select("*").single();
  return unwrap<Tables<"warmup_events">>(result);
}

export async function listWarmupEvents(supabase: Client, organizationId: string, warmupProfileId: string) {
  const { data, error } = await supabase
    .from("warmup_events")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("warmup_profile_id", warmupProfileId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// --- Warmup engine (lib/warmup/warmup-worker.ts) ----------------------------
// Admin-context, trusted-worker-only reads/writes for the actual cycle
// execution — mirrors the claim/release/insert shape reply-worker.ts's
// equivalents in this file already use for mailboxes.

// Atomic claim via claim_due_warmup_sends() (`for update skip locked`,
// mirrors claimMailboxesForReplySync/claimDueSends) — an overlapping cron
// invocation can never double-process the same profile.
export async function claimDueWarmupSends(
  supabase: Client,
  organizationId: string,
  limit = 10,
): Promise<Tables<"warmup_profiles">[]> {
  const { data, error } = await supabase.rpc("claim_due_warmup_sends", {
    p_organization_id: organizationId,
    p_limit: limit,
  });
  if (error) throw error;
  return data ?? [];
}

// Releases a profile's claim lease early instead of waiting out the full
// 10-minute window — called on both success and failure, same convention
// releaseMailboxReplySyncLock already follows.
export async function releaseWarmupProfileLock(supabase: Client, id: string) {
  const { error } = await supabase.from("warmup_profiles").update({ locked_until: null }).eq("id", id);
  if (error) throw error;
}

export async function insertWarmupMessage(supabase: Client, values: TablesInsert<"warmup_messages">) {
  const result = await supabase.from("warmup_messages").insert(values).select("*").single();
  return unwrap<Tables<"warmup_messages">>(result);
}

export async function updateWarmupMessage(supabase: Client, id: string, values: TablesUpdate<"warmup_messages">) {
  const result = await supabase.from("warmup_messages").update(values).eq("id", id).select("*").single();
  return unwrap<Tables<"warmup_messages">>(result);
}

// Idempotency lookup for the inbound-detection step: a fetched IMAP message
// is only a "warmup message we sent" if its Message-ID matches a row here.
export async function getWarmupMessageByProviderMessageId(supabase: Client, providerMessageId: string) {
  const { data, error } = await supabase
    .from("warmup_messages")
    .select("*")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Replies this mailbox owes right now — reply_decision='pending' rows whose
// reply_due_at has arrived. `now` is passed in (ISO) rather than computed
// here, matching this file's existing "caller decides what 'now' means"
// shape.
export async function listDueWarmupReplies(supabase: Client, mailboxId: string, now: string) {
  const { data, error } = await supabase
    .from("warmup_messages")
    .select("*")
    .eq("to_mailbox_id", mailboxId)
    .eq("reply_decision", "pending")
    .lte("reply_due_at", now)
    .order("sent_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// How many fresh conversations this profile has already initiated since
// `sinceIso` (the caller's start-of-day boundary) — derived via count(),
// not a maintained counter, same "derive, don't drift" reasoning
// claim_due_sends()'s own comments use for email_events.
export async function countWarmupMessagesSentToday(supabase: Client, warmupProfileId: string, sinceIso: string) {
  const { count, error } = await supabase
    .from("warmup_messages")
    .select("*", { count: "exact", head: true })
    .eq("from_warmup_profile_id", warmupProfileId)
    .eq("message_type", "initial")
    .gte("sent_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

// --- Warmup stats ------------------------------------------------------------
// Architecture only — no pipeline writes these yet (see the migration:
// warmup_stats has no insert/update/delete policy for the RLS-scoped
// client). Provided as the ready-made read/write seam for a future
// stats-aggregation worker, the same way the rest of this file exists
// before anything in the UI actually calls it.

export async function listWarmupStats(supabase: Client, organizationId: string, warmupProfileId: string) {
  const { data, error } = await supabase
    .from("warmup_stats")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("warmup_profile_id", warmupProfileId)
    .order("stat_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Service-role-only write — warmup_stats has no insert policy for the
// RLS-scoped client. Reserved for a future stats-aggregation worker;
// nothing calls this yet.
export async function insertWarmupStat(supabase: Client, values: TablesInsert<"warmup_stats">) {
  const result = await supabase.from("warmup_stats").insert(values).select("*").single();
  return unwrap<Tables<"warmup_stats">>(result);
}
