import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

type Mailbox = Tables<"mailboxes">;
export type MailboxSafe = Omit<Mailbox, "encrypted_smtp_password" | "encrypted_imap_password">;

// Strips both encrypted credentials before a row can reach any user-facing
// code path. Only getMailboxCredentials()/listMailboxesForReplySync()
// (below) return them.
function omitPassword(row: Mailbox): MailboxSafe {
  const safe: Partial<Mailbox> = { ...row };
  delete safe.encrypted_smtp_password;
  delete safe.encrypted_imap_password;
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

// Reply-tracking reads/writes, admin-context — same carve-out as
// getMailboxCredentials: restricted to the trusted reply-sync worker
// (lib/email/reply-worker.ts), never a code path reachable by a browser.

// Full rows (including encrypted_imap_password), across every user, for the
// reply-sync worker to iterate. Scoped to mailboxes that are both actively
// sending (status='active') and have reply tracking configured.
export async function listMailboxesForReplySync(supabase: Client): Promise<Mailbox[]> {
  const { data, error } = await supabase
    .from("mailboxes")
    .select("*")
    .eq("status", "active")
    .eq("imap_enabled", true);
  if (error) throw error;
  return data;
}

// Advances a mailbox's IMAP sync cursor. Never touches any other column —
// deliberately narrower than the general-purpose updateMailbox(), which is
// userId-scoped and not meant for admin-context worker use.
export async function updateMailboxSyncCursor(
  supabase: Client,
  id: string,
  cursor: { uidValidity: number; lastUid: number },
) {
  const { error } = await supabase
    .from("mailboxes")
    .update({ imap_uid_validity: cursor.uidValidity, imap_last_uid: cursor.lastUid })
    .eq("id", id);
  if (error) throw error;
}
