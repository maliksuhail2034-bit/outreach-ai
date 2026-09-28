import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { countOrThrow, unwrap } from "./shared";

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

// --- Unified inbox (read UI) -----------------------------------------------
// Read with the session client (lib/supabase/server.ts): email_replies_select_
// own (and each embedded table's own policy) is the ownership boundary.
//
// Explicit columns only. body_html is never selected — inbound mail is
// attacker-controlled and the inbox renders body_text only — and the mailbox
// embed names its three display columns so the encrypted credential columns
// on mailboxes can never ride along.
export const INBOX_REPLY_SELECT =
  "id, campaign_id, lead_id, mailbox_id, subject, from_email, from_name, to_emails, body_text, received_at, read_at, lead:leads(id, first_name, last_name, email, company), campaign:campaigns(id, name), mailbox:mailboxes(id, email, display_name)" as const;

export interface InboxReply {
  id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string;
  subject: string | null;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  body_text: string | null;
  received_at: string;
  read_at: string | null;
  lead: { id: string; first_name: string | null; last_name: string | null; email: string; company: string | null } | null;
  campaign: { id: string; name: string } | null;
  mailbox: { id: string; email: string; display_name: string | null } | null;
}

const INBOX_PAGE_SIZE = 25;

export interface PaginatedInboxReplies {
  replies: InboxReply[];
  page: number;
  pageSize: number;
  totalCount: number;
}

// Newest first. Same shape as listCampaignsPage (lib/db/campaigns.ts): one
// `{ count: "exact" }` + `.range()` query, and on PGRST103 (an offset past the
// end, e.g. a stale ?page=) fall back to the last real page instead of
// throwing.
export async function listEmailRepliesPage(
  supabase: Client,
  options?: { page?: number; pageSize?: number },
): Promise<PaginatedInboxReplies> {
  const pageSize = options?.pageSize ?? INBOX_PAGE_SIZE;
  let page = Math.max(options?.page ?? 1, 1);

  const buildQuery = (from: number, to: number) =>
    supabase
      .from("email_replies")
      .select(INBOX_REPLY_SELECT, { count: "exact" })
      .order("received_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

  let from = (page - 1) * pageSize;
  let result = await buildQuery(from, from + pageSize - 1);

  if (result.error) {
    if ((result.error as { code?: string }).code !== "PGRST103") throw result.error;

    const totalCount = countOrThrow(await supabase.from("email_replies").select("*", { count: "exact", head: true }));
    page = Math.max(Math.ceil(totalCount / pageSize), 1);
    from = (page - 1) * pageSize;
    result = await buildQuery(from, from + pageSize - 1);
    if (result.error) throw result.error;
  }

  return { replies: (result.data ?? []) as InboxReply[], page, pageSize, totalCount: result.count ?? 0 };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Defensive ceiling for one conversation (one lead in one campaign).
const THREAD_LIMIT = 200;

export interface InboxThread {
  campaignId: string;
  leadId: string;
  replies: InboxReply[];
}

// The conversation a reply belongs to: every reply from the same lead in the
// same campaign (campaign_leads is unique per campaign + lead), oldest first.
// Resolves the requested reply through RLS first, so a missing id, a
// malformed id, or another user's reply all come back as null (not found).
export async function getEmailReplyThread(supabase: Client, replyId: string): Promise<InboxThread | null> {
  if (!UUID_PATTERN.test(replyId)) return null;

  const { data: anchor, error: anchorError } = await supabase
    .from("email_replies")
    .select("id, campaign_id, lead_id")
    .eq("id", replyId)
    .maybeSingle();
  if (anchorError) throw anchorError;
  if (!anchor) return null;

  const { data, error } = await supabase
    .from("email_replies")
    .select(INBOX_REPLY_SELECT)
    .eq("campaign_id", anchor.campaign_id)
    .eq("lead_id", anchor.lead_id)
    .order("received_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(THREAD_LIMIT);
  if (error) throw error;

  return { campaignId: anchor.campaign_id, leadId: anchor.lead_id, replies: (data ?? []) as InboxReply[] };
}

export async function countUnreadEmailReplies(supabase: Client) {
  return countOrThrow(await supabase.from("email_replies").select("*", { count: "exact", head: true }).is("read_at", null));
}

// Sets read_at on the given replies that are still unread. Writes read_at
// only (the one column authenticated users are granted UPDATE on); RLS
// (email_replies_update_own) limits it to the caller's own replies, and the
// read_at-is-null filter makes a repeat call a no-op that keeps the first
// read time.
export async function markEmailRepliesRead(supabase: Client, replyIds: string[], readAt: Date = new Date()) {
  if (replyIds.length === 0) return;
  const { error } = await supabase
    .from("email_replies")
    .update({ read_at: readAt.toISOString() })
    .in("id", replyIds)
    .is("read_at", null);
  if (error) throw error;
}
