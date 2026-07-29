import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

type Mailbox = Tables<"mailboxes">;
export type MailboxSafe = Omit<Mailbox, "encrypted_smtp_password">;

// Strips the encrypted credential before a row can reach any user-facing
// code path. Only getMailboxCredentials() (below) returns it.
function omitPassword(row: Mailbox): MailboxSafe {
  const safe: Partial<Mailbox> = { ...row };
  delete safe.encrypted_smtp_password;
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
