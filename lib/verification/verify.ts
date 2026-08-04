import type { Json, Tables } from "@/types/database.types";
import type { Client } from "@/lib/db";
import { getVerificationProviderKeyByProvider, updateLeadVerification } from "@/lib/db";
import { decryptVerificationProviderKey } from "@/lib/crypto/verification-provider-key-secret";
import { getVerificationProvider, type VerificationProviderName } from "./get-provider";
import { VerificationError } from "./provider";

// Email Verification v1 is BYOK-only (see ROADMAP.md): every call here uses
// an organization's own connected key, decrypted only for the duration of
// this one request. There is no managed/app-provided key path in v1 —
// outreach-ai never purchases verification credit on a user's behalf. A
// future managed mode would add a second branch here (skip the
// verification_provider_keys lookup, use the app's own key) without
// touching how a result is classified or stored. Mirrors
// lib/ai/recommendations.ts exactly.

// Orchestrates one manual "Verify" click end to end: load the
// organization's connected key for the requested provider, decrypt it, call
// the provider, and write the outcome directly onto the lead (V1 is
// in-place only — no separate audit/history table, see the
// leads_verification migration). Never called on a schedule — callers are
// Server Functions triggered directly by a user click. Bulk verification
// goes through lib/verification/bulk-worker.ts instead, which calls the
// same provider but persists via setLeadVerificationResult (admin context).
export async function verifyLead(
  supabase: Client,
  userId: string,
  organizationId: string,
  leadId: string,
  email: string,
  provider: VerificationProviderName,
): Promise<Tables<"leads">> {
  const keyRow = await getVerificationProviderKeyByProvider(supabase, organizationId, provider);
  if (!keyRow) {
    throw new Error(`No ${provider} API key is connected. Connect one in Settings -> Verification first.`);
  }

  const verifiedAt = new Date().toISOString();

  try {
    const apiKey = decryptVerificationProviderKey(keyRow.encrypted_api_key);
    const result = await getVerificationProvider(provider, apiKey).verify(email);

    return updateLeadVerification(supabase, userId, leadId, {
      verification_status: result.status,
      verification_risk_score: result.riskScore,
      verification_detail: result.detail as Json,
      verified_at: verifiedAt,
    });
  } catch (error) {
    const message = error instanceof VerificationError || error instanceof Error ? error.message : "Unknown verification error.";

    return updateLeadVerification(supabase, userId, leadId, {
      verification_status: "error",
      verification_risk_score: null,
      verification_detail: { error: message } as Json,
      verified_at: verifiedAt,
    });
  }
}
