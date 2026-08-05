import { createAdminClient } from "@/lib/supabase/admin";
import type { Client } from "@/lib/db";
import { getOrganization, listEnabledIntegrations, recordIntegrationDeliveryResult } from "@/lib/db";
import type { Tables } from "@/types/database.types";
import { buildOrganizationDigest } from "./digest";
import { getIntegrationProvider } from "./get-provider";
import { captureError } from "@/lib/monitoring/error-tracking";

export interface IntegrationsDigestSummary {
  checked: number;
  delivered: number;
  failed: number;
}

// Orchestration only, mirrors lib/deliverability/health-check-worker.ts's
// shape: this file contains no digest-building or delivery logic of its
// own — buildOrganizationDigest assembles the payload, getIntegrationProvider
// resolves how to send it. Per-integration try/catch failure isolation, the
// same shape as runReplySyncWorker/runDeliverabilityHealthCheckWorker, so
// one organization's unreachable webhook can't stop every other
// organization's digest from sending.
export async function runIntegrationsDigestWorker(): Promise<IntegrationsDigestSummary> {
  const supabase = createAdminClient();
  const summary: IntegrationsDigestSummary = { checked: 0, delivered: 0, failed: 0 };

  const integrations = await listEnabledIntegrations(supabase);

  for (const integration of integrations) {
    summary.checked += 1;

    try {
      await deliverDigest(supabase, integration);
      await recordIntegrationDeliveryResult(supabase, integration.id, { status: "success", error: null });
      summary.delivered += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error.";
      console.error("[integrations-digest-worker]", { integrationId: integration.id, error: message });
      await captureError({ job: "integrations-digest", message, context: { integrationId: integration.id } });
      // Best-effort — a failure to record the failure must not crash the
      // loop or mask the original error above.
      await recordIntegrationDeliveryResult(supabase, integration.id, { status: "failed", error: message }).catch(
        () => {},
      );
    }
  }

  return summary;
}

async function deliverDigest(supabase: Client, integration: Tables<"integrations">): Promise<void> {
  const organization = await getOrganization(supabase, integration.organization_id);
  const payload = await buildOrganizationDigest(supabase, organization);
  await getIntegrationProvider(integration).send(payload);
}
