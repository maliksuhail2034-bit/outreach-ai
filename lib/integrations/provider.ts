import type { Insight } from "@/lib/analytics/insights";

// Provider-agnostic contract for delivering an organization digest to an
// external destination. Exactly one implementation exists today
// (WebhookIntegrationProvider) — this interface exists so a second
// provider (Slack, Zapier, a CRM) can be added later without touching any
// call site that only depends on this file. Mirrors
// lib/email/provider.ts's EmailProvider split exactly.

// Deliberately generic (plain numbers/strings/an Insight[]), not shaped
// around any one provider's payload format — lib/integrations/digest.ts
// builds this once from the existing analytics/forecasting/benchmark/AI
// Insights engines, and every provider implementation renders it however
// that destination needs (a webhook posts it as JSON; a future Slack
// provider would format it as blocks).
export interface IntegrationPayload {
  organizationId: string;
  organizationName: string;
  generatedAt: string; // ISO timestamp
  overview: {
    sentCount: number;
    replyRate: number | null;
    bounceRate: number | null;
  };
  insights: Insight[];
}

export interface IntegrationDeliveryResult {
  delivered: boolean;
}

// Thrown by any IntegrationProvider implementation on failure. `outcome`
// mirrors EmailSendError's classification (lib/email/provider.ts):
//   "retry"  — transient (network error, 5xx, timeout); safe to try again
//              next scheduled run.
//   "failed" — terminal for this attempt (4xx, invalid destination); still
//              retried on the next scheduled run like anything else, but
//              not expected to succeed without the user fixing their
//              configuration.
// This class only carries the classification — it never retries anything
// itself; that's the worker's job (or the next cron run, since there's no
// separate retry scheduler for integrations the way send_attempts has one).
export class IntegrationDeliveryError extends Error {
  constructor(
    message: string,
    public readonly outcome: "retry" | "failed",
  ) {
    super(message);
    this.name = "IntegrationDeliveryError";
  }
}

export interface IntegrationProvider {
  send(payload: IntegrationPayload): Promise<IntegrationDeliveryResult>;
}
