import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// --- Organization-scoped reads/writes — the settings page's CRUD, RLS-enforced.
// Mirrors lib/db/integrations.ts's shape exactly (one row per
// organization per provider, upserted on that pair).

// Excludes encrypted_api_key — mirrors MailboxSafe in lib/db/mailboxes.ts.
// listAiProviderKeys' result reaches AiProvidersPanel (a Client Component),
// so it must never carry the ciphertext into the RSC flight payload.
// getAiProviderKeyByProvider below is the one exception: it feeds the
// server-only decrypt path in lib/ai/recommendations.ts and still needs the
// full row — never call it from a path whose result can reach the browser.
export type AiProviderKeySafe = Omit<Tables<"ai_provider_keys">, "encrypted_api_key">;

export async function listAiProviderKeys(supabase: Client, organizationId: string): Promise<AiProviderKeySafe[]> {
  const { data, error } = await supabase
    .from("ai_provider_keys")
    .select("id, organization_id, provider, key_preview, model, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAiProviderKeyByProvider(supabase: Client, organizationId: string, provider: string) {
  const { data, error } = await supabase
    .from("ai_provider_keys")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Upserted on (organization_id, provider) — connecting an already-connected
// provider replaces its key/preview/model rather than requiring a separate
// "reconnect" flow, same convention as upsertIntegration.
export async function upsertAiProviderKey(supabase: Client, values: TablesInsert<"ai_provider_keys">) {
  const result = await supabase
    .from("ai_provider_keys")
    .upsert(values, { onConflict: "organization_id,provider" })
    .select("*")
    .single();
  return unwrap<Tables<"ai_provider_keys">>(result);
}

export async function deleteAiProviderKey(supabase: Client, organizationId: string, id: string) {
  const { error } = await supabase.from("ai_provider_keys").delete().eq("organization_id", organizationId).eq("id", id);
  if (error) throw error;
}
