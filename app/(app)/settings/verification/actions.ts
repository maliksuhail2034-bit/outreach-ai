"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteVerificationProviderKey, getUserOrganization, upsertVerificationProviderKey } from "@/lib/db";
import { encryptVerificationProviderKey } from "@/lib/crypto/verification-provider-key-secret";
import { connectVerificationProviderKeySchema, type ConnectVerificationProviderKeyInput } from "@/lib/validations/verification";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form already did.

// Upserted on (organization_id, provider) — connecting an already-connected
// provider replaces its key rather than requiring a separate "reconnect"
// flow, same convention as connectAiProviderKeyAction. The plaintext key is
// never stored or returned to the client — only its encrypted form and a
// short display-only preview.
export async function connectVerificationProviderKeyAction(input: ConnectVerificationProviderKeyInput) {
  const parsed = connectVerificationProviderKeySchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  await upsertVerificationProviderKey(supabase, {
    organization_id: organization.id,
    provider: parsed.provider,
    encrypted_api_key: encryptVerificationProviderKey(parsed.apiKey),
    key_preview: `••••${parsed.apiKey.slice(-4)}`,
  });

  revalidatePath("/settings/verification");
}

export async function disconnectVerificationProviderKeyAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  await deleteVerificationProviderKey(supabase, organization.id, id);

  revalidatePath("/settings/verification");
}
