import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

const DEFAULT_LIST_LIMIT = 200;

// No userId parameter: ownership is derived from campaign_id via RLS.

// campaignId omitted lists across all of the caller's campaigns (RLS-scoped)
// — used by analytics, which aggregates across campaigns rather than
// showing one campaign's history. mailboxId narrows further to one
// mailbox's events (see lib/analytics/mailbox-metrics.ts) — every 'sent'
// row already carries mailbox_id from record_send_success, so this needs
// no join.
export async function listEmailEvents(
  supabase: Client,
  campaignId?: string,
  options?: { leadId?: string; eventType?: string; mailboxId?: string; limit?: number },
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

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Dashboard KPI helper — total count across all of the caller's campaigns
// (RLS-scoped), not limited to one campaign like listEmailEvents above.
export async function countEmailEventsByType(supabase: Client, eventType: string) {
  const { count, error } = await supabase
    .from("email_events")
    .select("*", { count: "exact", head: true })
    .eq("event_type", eventType);
  if (error) throw error;
  return count ?? 0;
}

// Reply-tracking helper — used two ways by lib/email/reply-worker.ts: (a)
// matching, looking up the outbound 'sent' event a reply's In-Reply-To/
// References header points to, and (b) the idempotency check, looking up
// whether a 'replied' event already exists for a given inbound Message-ID.
// Both are the same lookup shape, so one function serves both instead of two.
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

// Typically called from the sending worker or a provider webhook handler
// with the admin client (lib/supabase/admin.ts), since events are usually
// recorded by a trusted backend process rather than an interactive user.
export async function recordEmailEvent(supabase: Client, values: TablesInsert<"email_events">) {
  const result = await supabase.from("email_events").insert(values).select("*").single();
  return unwrap<Tables<"email_events">>(result);
}
