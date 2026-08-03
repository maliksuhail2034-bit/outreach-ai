"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/db";
import { deleteAiProviderKey, getOrCreateOrganizationForUser, upsertAiProviderKey } from "@/lib/db";
import { encryptAiProviderKey } from "@/lib/crypto/ai-provider-key-secret";
import { connectAiProviderKeySchema, type ConnectAiProviderKeyInput } from "@/lib/validations/ai";
import type { User } from "@supabase/supabase-js";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form already did.

async function getUserOrganization(supabase: Client, user: User) {
  const namePrefix = user.email?.split("@")[0]?.trim();
  return getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);
}

// Upserted on (organization_id, provider) — connecting an already-connected
// provider replaces its key/model rather than requiring a separate
// "reconnect" flow, same convention as connectWebhookIntegrationAction. The
// plaintext key is never stored or returned to the client — only its
// encrypted form and a short display-only preview.
export async function connectAiProviderKeyAction(input: ConnectAiProviderKeyInput) {
  const parsed = connectAiProviderKeySchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  await upsertAiProviderKey(supabase, {
    organization_id: organization.id,
    provider: parsed.provider,
    encrypted_api_key: encryptAiProviderKey(parsed.apiKey),
    key_preview: `••••${parsed.apiKey.slice(-4)}`,
    model: parsed.model || null,
  });

  revalidatePath("/settings/ai");
}

export async function disconnectAiProviderKeyAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  await deleteAiProviderKey(supabase, organization.id, id);

  revalidatePath("/settings/ai");
}
