import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// --- Domain DNS checks ---------------------------------------------------

// Newest-first, across every domain the user owns — the Domain Health page
// fetches this once and reduces it to "latest per domain per record type"
// client-side (see lib/deliverability/latest-dns-checks.ts) rather than
// issuing one query per domain.
export async function listDomainDnsChecks(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("domain_dns_checks")
    .select("*")
    .eq("user_id", userId)
    .order("checked_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertDomainDnsCheck(supabase: Client, values: TablesInsert<"domain_dns_checks">) {
  const result = await supabase.from("domain_dns_checks").insert(values).select("*").single();
  return unwrap<Tables<"domain_dns_checks">>(result);
}

// --- Mailbox health -------------------------------------------------------

export async function listMailboxHealth(supabase: Client, userId: string) {
  const { data, error } = await supabase.from("mailbox_health").select("*").eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

export async function getMailboxHealth(supabase: Client, userId: string, mailboxId: string) {
  const { data, error } = await supabase
    .from("mailbox_health")
    .select("*")
    .eq("user_id", userId)
    .eq("mailbox_id", mailboxId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Upserted on mailbox_id (unique) — same reasoning as billing's
// upsertSubscription (lib/db/billing.ts): a recalculation always replaces
// the prior row rather than needing separate insert-vs-update branching.
export async function upsertMailboxHealth(supabase: Client, values: TablesInsert<"mailbox_health">) {
  const result = await supabase
    .from("mailbox_health")
    .upsert(values, { onConflict: "mailbox_id" })
    .select("*")
    .single();
  return unwrap<Tables<"mailbox_health">>(result);
}
