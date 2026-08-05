"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteAiProviderKey, getUserOrganization, recordAuditEvent, upsertAiProviderKey } from "@/lib/db";
import { encryptAiProviderKey } from "@/lib/crypto/ai-provider-key-secret";
import { connectAiProviderKeySchema, type ConnectAiProviderKeyInput } from "@/lib/validations/ai";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form already did.

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

  const keyRow = await upsertAiProviderKey(supabase, {
    organization_id: organization.id,
    provider: parsed.provider,
    encrypted_api_key: encryptAiProviderKey(parsed.apiKey),
    key_preview: `••••${parsed.apiKey.slice(-4)}`,
    model: parsed.model || null,
  });

  await recordAuditEvent(supabase, {
    organization_id: organization.id,
    actor_user_id: user.id,
    action: "ai_key_connected",
    target_type: "ai_provider_key",
    target_id: keyRow.id,
    metadata: { provider: parsed.provider, key_preview: keyRow.key_preview },
  });

  revalidatePath("/settings/ai");
}

export async function disconnectAiProviderKeyAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  await deleteAiProviderKey(supabase, organization.id, id);

  await recordAuditEvent(supabase, {
    organization_id: organization.id,
    actor_user_id: user.id,
    action: "ai_key_disconnected",
    target_type: "ai_provider_key",
    target_id: id,
  });

  revalidatePath("/settings/ai");
}
