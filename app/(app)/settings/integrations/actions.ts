"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/db";
import { deleteIntegration, getIntegration, getOrCreateOrganizationForUser, updateIntegration, upsertIntegration } from "@/lib/db";
import { webhookIntegrationSchema, type WebhookIntegrationInput } from "@/lib/validations/integrations";
import { buildOrganizationDigest } from "@/lib/integrations/digest";
import { getIntegrationProvider } from "@/lib/integrations/get-provider";
import type { User } from "@supabase/supabase-js";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form already did.

async function getUserOrganization(supabase: Client, user: User) {
  const namePrefix = user.email?.split("@")[0]?.trim();
  return getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);
}

// Upserted on (organization_id, provider) — connecting an already-connected
// webhook replaces its URL and re-enables it rather than requiring a
// separate "reconnect" flow.
export async function connectWebhookIntegrationAction(input: WebhookIntegrationInput) {
  const parsed = webhookIntegrationSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  await upsertIntegration(supabase, {
    organization_id: organization.id,
    provider: "webhook",
    status: "enabled",
    config: { url: parsed.url },
  });

  revalidatePath("/settings/integrations");
}

export async function toggleIntegrationAction(id: string, enabled: boolean) {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  await updateIntegration(supabase, organization.id, id, { status: enabled ? "enabled" : "disabled" });

  revalidatePath("/settings/integrations");
}

export async function deleteIntegrationAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  await deleteIntegration(supabase, organization.id, id);

  revalidatePath("/settings/integrations");
}

// Builds and sends one real digest immediately, reusing the exact same
// buildOrganizationDigest/getIntegrationProvider path the scheduled worker
// uses — the fastest way for a user to confirm their webhook is configured
// correctly instead of waiting for the next cron run.
export async function sendTestDigestAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const integration = await getIntegration(supabase, organization.id, id); // throws if not owned
  const payload = await buildOrganizationDigest(supabase, organization);

  try {
    await getIntegrationProvider(integration).send(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown delivery error.";
    await updateIntegration(supabase, organization.id, id, {
      last_sent_at: new Date().toISOString(),
      last_status: "failed",
      last_error: message,
    });
    revalidatePath("/settings/integrations");
    throw error;
  }

  await updateIntegration(supabase, organization.id, id, {
    last_sent_at: new Date().toISOString(),
    last_status: "success",
    last_error: null,
  });

  revalidatePath("/settings/integrations");
}
