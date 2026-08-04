import { createAdminClient } from "@/lib/supabase/admin";
import type { Client } from "@/lib/db/shared";
import type { Json, Tables } from "@/types/database.types";
import {
  claimDueVerifications,
  getOrganizationMembership,
  getVerificationProviderKeyByProvider,
  setLeadVerificationResult,
} from "@/lib/db";
import { decryptVerificationProviderKey } from "@/lib/crypto/verification-provider-key-secret";
import { getVerificationProvider } from "./get-provider";
import { VerificationError } from "./provider";

const DEFAULT_CLAIM_LIMIT = 25;

export interface VerificationWorkerSummary {
  claimed: number;
  verified: number;
  failed: number;
}

// Orchestration only, mirrors lib/email/send-worker.ts: claim due rows via
// the atomic Postgres function, then process each sequentially through the
// same provider call lib/verification/verify.ts uses for the synchronous
// single-lead path. Runs under the admin (service-role) client — no user in
// the loop, same carve-out as the sending worker — and is only ever invoked
// by app/api/cron/verify-leads/route.ts, never called synchronously from a
// Server Function (see the Email Verification architecture review: bulk
// verification is always queued, never a synchronous batch).
export async function runVerificationWorker(limit = DEFAULT_CLAIM_LIMIT): Promise<VerificationWorkerSummary> {
  const supabase = createAdminClient();

  const claimed = await claimDueVerifications(supabase, limit);
  const summary: VerificationWorkerSummary = { claimed: claimed.length, verified: 0, failed: 0 };

  for (const lead of claimed) {
    const outcome = await processLead(supabase, lead);
    summary[outcome] += 1;
  }

  return summary;
}

async function processLead(supabase: Client, lead: Tables<"leads">): Promise<"verified" | "failed"> {
  const verifiedAt = new Date().toISOString();

  // A lead's owning user should always have an organization (backfilled by
  // the organizations migration for every pre-existing user, provisioned
  // lazily for new ones the first time they visit a page that needs one) —
  // this worker deliberately does not auto-provision one itself, since that
  // would require guessing a workspace name with no user session present.
  const membership = await getOrganizationMembership(supabase, lead.user_id);
  if (!membership) {
    await setLeadVerificationResult(supabase, lead.id, {
      verification_status: "error",
      verification_risk_score: null,
      verification_detail: { error: "No organization found for this account." },
      verified_at: verifiedAt,
    });
    return "failed";
  }

  const keyRow = await getVerificationProviderKeyByProvider(supabase, membership.organization_id, "millionverifier");
  if (!keyRow) {
    await setLeadVerificationResult(supabase, lead.id, {
      verification_status: "error",
      verification_risk_score: null,
      verification_detail: { error: "No verification provider is connected. Connect one in Settings -> Verification." },
      verified_at: verifiedAt,
    });
    return "failed";
  }

  try {
    const apiKey = decryptVerificationProviderKey(keyRow.encrypted_api_key);
    const result = await getVerificationProvider("millionverifier", apiKey).verify(lead.email);

    await setLeadVerificationResult(supabase, lead.id, {
      verification_status: result.status,
      verification_risk_score: result.riskScore,
      verification_detail: result.detail as unknown as Json,
      verified_at: verifiedAt,
    });
    return "verified";
  } catch (error) {
    const message = error instanceof VerificationError || error instanceof Error ? error.message : "Unknown verification error.";

    await setLeadVerificationResult(supabase, lead.id, {
      verification_status: "error",
      verification_risk_score: null,
      verification_detail: { error: message },
      verified_at: verifiedAt,
    });
    return "failed";
  }
}
