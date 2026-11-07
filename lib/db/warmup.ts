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
// invocation can never double-process the same profile. Claims across all
// organizations; each returned row carries its own organization_id, which
// drives all downstream scoping (peer selection, sends, stats).
export async function claimDueWarmupSends(supabase: Client, limit = 10): Promise<Tables<"warmup_profiles">[]> {
  const { data, error } = await supabase.rpc("claim_due_warmup_sends", {
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
// Populated by the warmup-cycle worker itself (lib/warmup/warmup-worker.ts's
// recordDailyWarmupStats), recomputed from warmup_messages on every cycle
// rather than incremented — same "derive, don't drift" reasoning
// countWarmupMessagesSentToday above already documents — so a re-run within
// the same day converges on the correct total instead of drifting.

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

// The raw rows one day's stats aggregation needs for a single profile —
// message_type and reply_decision are the only columns
// computeDailyWarmupStats (lib/warmup/stats.ts) reads. Bounded to
// [startOfDayIso, endOfDayIso] so the worker can ask for "today" on every
// cycle without re-scanning the profile's whole history.
export async function listWarmupMessagesSentOnDate(
  supabase: Client,
  warmupProfileId: string,
  startOfDayIso: string,
  endOfDayIso: string,
) {
  const { data, error } = await supabase
    .from("warmup_messages")
    .select("message_type, reply_decision, placement")
    .eq("from_warmup_profile_id", warmupProfileId)
    .gte("sent_at", startOfDayIso)
    .lte("sent_at", endOfDayIso);
  if (error) throw error;
  return data ?? [];
}

// Count-only counterpart for the "received" side of the same day — this
// mailbox as a peer's recipient, mirroring countWarmupMessagesSentToday's
// count()-not-fetch shape.
export async function countWarmupMessagesReceivedOnDate(
  supabase: Client,
  mailboxId: string,
  startOfDayIso: string,
  endOfDayIso: string,
) {
  const { count, error } = await supabase
    .from("warmup_messages")
    .select("*", { count: "exact", head: true })
    .eq("to_mailbox_id", mailboxId)
    .gte("sent_at", startOfDayIso)
    .lte("sent_at", endOfDayIso);
  if (error) throw error;
  return count ?? 0;
}

// Service-role-only write — warmup_stats has no insert/update policy for the
// RLS-scoped client. Upserts on the table's own (warmup_profile_id,
// stat_date) unique constraint, mirroring upsertDailyRollup's shape exactly,
// so an overlapping or later-that-day cron tick replaces today's row instead
// of erroring on a duplicate insert.
export async function upsertWarmupStat(supabase: Client, values: TablesInsert<"warmup_stats">) {
  const result = await supabase
    .from("warmup_stats")
    .upsert(values, { onConflict: "warmup_profile_id,stat_date" })
    .select("*")
    .single();
  return unwrap<Tables<"warmup_stats">>(result);
}

// Upper bound on ids per `in (...)` filter, keeping the PostgREST request
// URL small (Message-IDs can be ~100 characters each).
const MESSAGE_ID_CHUNK = 50;

// Batched form of getWarmupMessageByProviderMessageId: which of these
// Message-IDs are warmup emails, in one query per chunk instead of one per
// inbox message.
export async function listWarmupMessagesByProviderMessageIds(supabase: Client, providerMessageIds: string[]) {
  const unique = [...new Set(providerMessageIds)];
  const rows: Tables<"warmup_messages">[] = [];
  for (let index = 0; index < unique.length; index += MESSAGE_ID_CHUNK) {
    const { data, error } = await supabase
      .from("warmup_messages")
      .select("*")
      .in("provider_message_id", unique.slice(index, index + MESSAGE_ID_CHUNK));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

// Recent warmup mail addressed to this mailbox whose placement (inbox or
// spam) hasn't been found yet — what the inbox agent searches spam for.
export async function listUnplacedWarmupMessages(supabase: Client, mailboxId: string, sinceIso: string, limit = 50) {
  const { data, error } = await supabase
    .from("warmup_messages")
    .select("id, provider_message_id")
    .eq("to_mailbox_id", mailboxId)
    .is("placement", null)
    .gte("sent_at", sinceIso)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Records where a warmup message first landed. Only ever sets a placement
// that's still unknown, so a message rescued from spam (placement 'spam')
// isn't later relabelled 'inbox' when the agent sees it arrive there.
export async function recordWarmupPlacement(
  supabase: Client,
  providerMessageId: string,
  placement: "inbox" | "spam",
  rescued: boolean,
  now: string,
) {
  const { error } = await supabase
    .from("warmup_messages")
    .update({ placement, placement_checked_at: now, ...(rescued ? { rescued_at: now } : {}) })
    .eq("provider_message_id", providerMessageId)
    .is("placement", null);
  if (error) throw error;
}

// Every profile's daily stats since `sinceDate` (YYYY-MM-DD) for one
// organization, in a single query — the warmup dashboard's 7-day summary.
export async function listRecentWarmupStats(supabase: Client, organizationId: string, sinceDate: string) {
  const { data, error } = await supabase
    .from("warmup_stats")
    .select("warmup_profile_id, stat_date, emails_sent, emails_received, positive_interactions, inbox_count, spam_count")
    .eq("organization_id", organizationId)
    .gte("stat_date", sinceDate);
  if (error) throw error;
  return data ?? [];
}
