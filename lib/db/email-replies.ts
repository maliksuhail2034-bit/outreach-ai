import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// No userId parameter: ownership is derived from campaign_id via RLS (and
// the DB-level check_email_reply_owner trigger), same as email_events —
// see lib/db/email-events.ts and 20260920100000_email_replies.sql.

// Idempotency check used by lib/email/reply-worker.ts before inserting: the
// real guarantee is the DB-level unique index on email_event_id
// (email_replies_email_event_id_key), not this lookup, which only avoids a
// redundant insert attempt (and the resulting unique-violation handling) in
// the common case — same shape as getEmailEventByProviderMessageId.
export async function getEmailReplyByEventId(supabase: Client, emailEventId: string) {
  const { data, error } = await supabase
    .from("email_replies")
    .select("*")
    .eq("email_event_id", emailEventId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Typically called from the reply-sync worker with the admin client
// (lib/supabase/admin.ts), immediately after the corresponding email_events
// 'replied' row is recorded — see processInboundMessage.
export async function recordEmailReply(supabase: Client, values: TablesInsert<"email_replies">) {
  const result = await supabase.from("email_replies").insert(values).select("*").single();
  return unwrap<Tables<"email_replies">>(result);
}
