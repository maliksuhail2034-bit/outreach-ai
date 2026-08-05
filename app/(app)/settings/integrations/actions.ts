"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  deleteIntegration,
  getIntegration,
  getUserOrganization,
  recordAuditEvent,
  updateIntegration,
  upsertIntegration,
} from "@/lib/db";
import { webhookIntegrationSchema, type WebhookIntegrationInput } from "@/lib/validations/integrations";
import { buildOrganizationDigest } from "@/lib/integrations/digest";
import { getIntegrationProvider } from "@/lib/integrations/get-provider";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form already did.

// Upserted on (organization_id, provider) — connecting an already-connected
// webhook replaces its URL and re-enables it rather than requiring a
// separate "reconnect" flow.
export async function connectWebhookIntegrationAction(input: WebhookIntegrationInput) {
  const parsed = webhookIntegrationSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const integration = await upsertIntegration(supabase, {
    organization_id: organization.id,
    provider: "webhook",
    status: "enabled",
    config: { url: parsed.url },
  });

  // metadata deliberately omits the webhook URL itself — not a credential,
  // but not something this log needs to surface either.
  await recordAuditEvent(supabase, {
    organization_id: organization.id,
    actor_user_id: user.id,
    action: "integration_connected",
    target_type: "integration",
    target_id: integration.id,
    metadata: { provider: "webhook" },
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

  const integration = await getIntegration(supabase, organization.id, id); // throws if not owned
  await deleteIntegration(supabase, organization.id, id);

  await recordAuditEvent(supabase, {
    organization_id: organization.id,
    actor_user_id: user.id,
    action: "integration_disconnected",
    target_type: "integration",
    target_id: id,
    metadata: { provider: integration.provider },
  });

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
