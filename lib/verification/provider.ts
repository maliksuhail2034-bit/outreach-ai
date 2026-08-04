// Provider-agnostic contract for checking a single email address's
// deliverability. Exactly two callers exist (lib/verification/verify.ts for
// the single-lead path, lib/verification/bulk-worker.ts for the queued bulk
// path) and both only ever depend on this interface, never a concrete
// provider class — mirrors lib/ai/provider.ts's interface + classified
// error + factory split exactly.
export interface VerificationResult {
  status: "valid" | "invalid" | "catch_all" | "unknown" | "error";
  // 0-100, or null when the provider couldn't complete verification at all
  // (status "error"). Not every provider returns a native score — see
  // lib/verification/providers/millionverifier.ts for how this one is
  // derived rather than passed through.
  riskScore: number | null;
  // Raw provider signals (disposable/role/catch-all flags, subresult,
  // credits remaining, etc.) — stored as-is on leads.verification_detail so
  // the column shape doesn't need to change per provider or per new field a
  // vendor adds to their response.
  detail: Record<string, unknown>;
}

// Thrown by any VerificationProvider implementation on failure. `outcome`
// mirrors AiGenerationError/EmailSendError's classification:
//   "retry"       — transient (network error, timeout); safe to reclaim on
//                   the next worker pass or let the user click "Verify"
//                   again.
//   "invalid_key" — the connected API key was rejected, or the connected
//                   account is out of credits; the settings UI should point
//                   the user back to Settings -> Verification rather than
//                   suggesting a retry.
//   "failed"      — terminal for this attempt for any other reason.
export class VerificationError extends Error {
  constructor(
    message: string,
    public readonly outcome: "retry" | "invalid_key" | "failed",
  ) {
    super(message);
    this.name = "VerificationError";
  }
}

export interface VerificationProvider {
  verify(email: string): Promise<VerificationResult>;
}
