import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

type Mailbox = Tables<"mailboxes">;
export type MailboxSafe = Omit<
  Mailbox,
  | "encrypted_smtp_password"
  | "encrypted_imap_password"
  | "encrypted_google_refresh_token"
  | "encrypted_microsoft_refresh_token"
>;

// Strips all four encrypted credentials before a row can reach any
// user-facing code path. Only getMailboxCredentials()/claimMailboxesForReplySync()
// (below) return them.
function omitPassword(row: Mailbox): MailboxSafe {
  const safe: Partial<Mailbox> = { ...row };
  delete safe.encrypted_smtp_password;
  delete safe.encrypted_imap_password;
  delete safe.encrypted_google_refresh_token;
  delete safe.encrypted_microsoft_refresh_token;
  return safe as MailboxSafe;
}

export async function listMailboxes(supabase: Client, userId: string): Promise<MailboxSafe[]> {
  const { data, error } = await supabase
    .from("mailboxes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(omitPassword);
}

export async function countMailboxes(supabase: Client, userId: string) {
  const { count, error } = await supabase
    .from("mailboxes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

export async function getMailbox(supabase: Client, userId: string, id: string): Promise<MailboxSafe> {
  const result = await supabase.from("mailboxes").select("*").eq("user_id", userId).eq("id", id).single();
  return omitPassword(unwrap<Mailbox>(result));
}

// Natural-key lookup on the (user_id, email) unique constraint — used by
// the Google OAuth callback to tell a first-time connect from a reconnect
// of an already-connected Gmail mailbox, same "look up the one row for this
// natural key" shape as getIntegrationByProvider/getAiProviderKeyByProvider.
export async function getMailboxByUserAndEmail(supabase: Client, userId: string, email: string): Promise<MailboxSafe | null> {
  const { data, error } = await supabase
    .from("mailboxes")
    .select("*")
    .eq("user_id", userId)
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data ? omitPassword(data) : null;
}

// Returns the full row, including the encrypted credential. Restricted to
// the trusted sending worker (called with lib/supabase/admin.ts) — never
// call this from a code path that can reach a browser or a client-facing
// response.
export async function getMailboxCredentials(supabase: Client, id: string): Promise<Mailbox> {
  const result = await supabase.from("mailboxes").select("*").eq("id", id).single();
  return unwrap<Mailbox>(result);
}

export async function createMailbox(supabase: Client, values: TablesInsert<"mailboxes">): Promise<MailboxSafe> {
  const result = await supabase.from("mailboxes").insert(values).select("*").single();
  return omitPassword(unwrap<Mailbox>(result));
}

export async function updateMailbox(
  supabase: Client,
  userId: string,
  id: string,
  values: TablesUpdate<"mailboxes">,
): Promise<MailboxSafe> {
  const result = await supabase
    .from("mailboxes")
    .update(values)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  return omitPassword(unwrap<Mailbox>(result));
}

export async function deleteMailbox(supabase: Client, userId: string, id: string) {
  const { error } = await supabase.from("mailboxes").delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
}

// User-scoped (RLS-respecting client + explicit user_id filter, same as
// every other function in this file) read of the IMAP credential — lets a
// user's own mailbox actions (update validation, test-connection) check for
// or reuse a stored credential without going through the admin-context
// getMailboxCredentials(), which has no ownership check and is reserved for
// the trusted reply-sync worker.
export async function getMailboxImapCredential(supabase: Client, userId: string, id: string) {
  const { data, error } = await supabase
    .from("mailboxes")
    .select("encrypted_imap_password")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Same shape as getMailboxImapCredential above, for the SMTP password — lets
// testSmtpConnectionAction test-connect using a stored credential without
// requiring the password to be re-entered.
export async function getMailboxSmtpCredential(supabase: Client, userId: string, id: string) {
  const { data, error } = await supabase
    .from("mailboxes")
    .select("encrypted_smtp_password")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Admin-context, credential-free (only id/domain_id) — lets the analytics
// rollup worker (lib/analytics/rollup-worker.ts) resolve which domain each
// already-computed mailbox-level rollup belongs to, without fetching full
// mailbox rows. Scoped to a specific id list rather than "every mailbox"
// since the worker only needs the mailboxes its own rollup pass already
// produced rows for.
export async function listMailboxDomainsByIds(
  supabase: Client,
  ids: string[],
): Promise<{ id: string; domain_id: string | null }[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("mailboxes").select("id, domain_id").in("id", ids);
  if (error) throw error;
  return data ?? [];
}

// Reply-tracking reads/writes, admin-context — same carve-out as
// getMailboxCredentials: restricted to the trusted reply-sync worker
// (lib/email/reply-worker.ts), never a code path reachable by a browser.

// Full rows (including encrypted_imap_password), across every user, for the
// reply-sync worker to iterate. Scoped to mailboxes that are both actively
// sending (status='active') and have reply tracking configured. Atomic claim
// via claim_mailboxes_for_reply_sync() (`for update skip locked`, mirrors
// claim_due_sends()/claim_due_verifications()) — a slow run still in flight
// when the next scheduled sync-replies invocation fires can no longer
// process the same mailbox's inbox twice concurrently. Reliability Track
// item 6.
export async function claimMailboxesForReplySync(supabase: Client): Promise<Mailbox[]> {
  const { data, error } = await supabase.rpc("claim_mailboxes_for_reply_sync");
  if (error) throw error;
  return data;
}

// Releases a mailbox's reply-sync claim lease early instead of waiting out
// the full 10-minute window — called on both success (updateMailboxSyncCursor)
// and failure (runReplySyncWorker's per-mailbox catch) so a mailbox is never
// locked out longer than one run, matching send_attempts' "always clear the
// lock, rely on the next scheduled run rather than the lease itself for
// pacing" convention.
export async function releaseMailboxReplySyncLock(supabase: Client, id: string) {
  const { error } = await supabase.from("mailboxes").update({ reply_sync_locked_until: null }).eq("id", id);
  if (error) throw error;
}

// Admin-context, across every user — the set the automated deliverability
// health-check worker (lib/deliverability/health-check-worker.ts) iterates.
// Credentials are never needed for scoring, so this returns MailboxSafe like
// every user-facing read, unlike the reply-sync/send-worker admin reads above.
//
// DEFENSIVE_LIST_LIMIT (Scalability Track, Item 2): a ceiling only, not real
// batching — this is a platform-wide, unbounded read across every user's
// mailboxes, processed sequentially in one cron invocation. A real
// batched/claimed pattern (mirroring claim_due_sends()) is a later item.
const DEFENSIVE_LIST_LIMIT = 5000;

export async function listActiveMailboxesForHealthCheck(supabase: Client): Promise<MailboxSafe[]> {
  const { data, error } = await supabase
    .from("mailboxes")
    .select("*")
    .eq("status", "active")
    .limit(DEFENSIVE_LIST_LIMIT);
  if (error) throw error;
  return (data ?? []).map(omitPassword);
}

// Advances a mailbox's IMAP sync cursor and releases its reply-sync claim
// lease in the same write. Never touches any other column — deliberately
// narrower than the general-purpose updateMailbox(), which is userId-scoped
// and not meant for admin-context worker use.
export async function updateMailboxSyncCursor(
  supabase: Client,
  id: string,
  cursor: { uidValidity: number; lastUid: number },
) {
  const { error } = await supabase
    .from("mailboxes")
    .update({ imap_uid_validity: cursor.uidValidity, imap_last_uid: cursor.lastUid, reply_sync_locked_until: null })
    .eq("id", id);
  if (error) throw error;
}
