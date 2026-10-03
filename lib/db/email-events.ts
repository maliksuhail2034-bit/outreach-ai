import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { countOrThrow, unwrap } from "./shared";

const DEFAULT_LIST_LIMIT = 200;

// No userId parameter: ownership is derived from campaign_id via RLS.

// campaignId omitted lists across all of the caller's campaigns (RLS-scoped)
// — used by analytics, which aggregates across campaigns rather than
// showing one campaign's history. mailboxId narrows further to one
// mailbox's events (see lib/analytics/mailbox-metrics.ts) — every 'sent'
// row already carries mailbox_id from record_send_success, so this needs
// no join. mailboxIds narrows to a *set* of mailboxes in one query instead
// of one call per mailbox — see lib/deliverability/domain-analytics.ts,
// which aggregates across every mailbox linked to a domain.
export async function listEmailEvents(
  supabase: Client,
  campaignId?: string,
  options?: { leadId?: string; eventType?: string; mailboxId?: string; mailboxIds?: string[]; limit?: number },
) {
  let query = supabase
    .from("email_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? DEFAULT_LIST_LIMIT);

  if (campaignId) {
    query = query.eq("campaign_id", campaignId);
  }
  if (options?.leadId) {
    query = query.eq("lead_id", options.leadId);
  }
  if (options?.eventType) {
    query = query.eq("event_type", options.eventType);
  }
  if (options?.mailboxId) {
    query = query.eq("mailbox_id", options.mailboxId);
  }
  if (options?.mailboxIds) {
    query = query.in("mailbox_id", options.mailboxIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Dashboard KPI helper — total count across all of the caller's campaigns
// (RLS-scoped), not limited to one campaign like listEmailEvents above.
export async function countEmailEventsByType(supabase: Client, eventType: string) {
  return countOrThrow(
    await supabase.from("email_events").select("*", { count: "exact", head: true }).eq("event_type", eventType),
  );
}

// Reply-tracking idempotency check: whether a 'replied' event already exists
// for a given inbound Message-ID (lib/email/reply-worker.ts). Matching a
// reply to the email it answers uses getSentEventForOwner below instead.
export async function getEmailEventByProviderMessageId(
  supabase: Client,
  providerMessageId: string,
  eventType: string,
) {
  const { data, error } = await supabase
    .from("email_events")
    .select("*")
    .eq("provider_message_id", providerMessageId)
    .eq("event_type", eventType)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Reply matching: the outbound 'sent' event a reply's In-Reply-To/References
// header points to, but only when its campaign belongs to `userId` — the
// owner of the mailbox the reply arrived in. A header naming another user's
// email is treated as no match rather than returned: recording a reply
// across owners is rejected by email_events' owner trigger anyway, and that
// rejection must not become an error that stalls the mailbox's sync. Runs
// on the admin client (the reply-sync worker), so this filter — not RLS —
// is what scopes it.
export async function getSentEventForOwner(supabase: Client, providerMessageId: string, userId: string) {
  const { data, error } = await supabase
    .from("email_events")
    .select("*, campaigns!inner(user_id)")
    .eq("provider_message_id", providerMessageId)
    .eq("event_type", "sent")
    .eq("campaigns.user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Typically called from the sending worker or a provider webhook handler
// with the admin client (lib/supabase/admin.ts), since events are usually
// recorded by a trusted backend process rather than an interactive user.
export async function recordEmailEvent(supabase: Client, values: TablesInsert<"email_events">) {
  const result = await supabase.from("email_events").insert(values).select("*").single();
  return unwrap<Tables<"email_events">>(result);
}
