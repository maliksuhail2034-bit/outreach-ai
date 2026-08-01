import type { MailboxSafe } from "@/lib/db";
import type { Tables } from "@/types/database.types";

// Campaign launch-readiness — the single place that decides whether a
// campaign can start sending, reused by both launchCampaignAction (which
// enforces it) and the campaign detail/wizard UI (which displays it ahead
// of the click, instead of only surfacing failures after the fact via a
// thrown error). Pure and DB-free: every input is already-loaded data, so
// this is unit-testable without a database and safe to call from a Server
// Component render.

// The effective mailbox for a lead: its own override, or the campaign's
// default. Shared by the readiness checks below and by the "leads ready"
// count on the campaign detail page, so both agree on what "resolvable"
// means.
export function resolveLeadMailboxId(
  lead: Pick<Tables<"campaign_leads">, "mailbox_id">,
  campaign: Pick<Tables<"campaigns">, "default_mailbox_id">,
): string | null {
  return lead.mailbox_id ?? campaign.default_mailbox_id;
}

export interface CampaignReadinessInput {
  campaign: Pick<Tables<"campaigns">, "default_mailbox_id">;
  campaignLeads: Pick<Tables<"campaign_leads">, "mailbox_id">[];
  sequenceStepCount: number;
  mailboxes: Pick<MailboxSafe, "id" | "display_name" | "email" | "status" | "daily_limit" | "hourly_limit">[];
  domainCount: number;
}

export interface CampaignReadinessResult {
  ready: boolean;
  // Blocking — the exact conditions launchCampaignAction already enforced
  // before this module existed (leads enrolled, a sequence, every lead
  // resolving to an active mailbox). `ready` is false whenever this is
  // non-empty.
  errors: string[];
  // Advisory only — surfaced in the UI but never block a launch, since
  // neither condition was previously enforced and both would otherwise be a
  // new hard requirement for every account that hasn't touched the
  // Deliverability/domains feature (or, for mailbox limits, can't actually
  // fail today: hourly_limit/daily_limit are non-nullable, checked > 0
  // columns — see 20260804100000_sending_limits.sql). Listed as their own
  // bucket instead of silently dropped, since Phase 2E's spec still asks
  // for them to be checked and shown.
  warnings: string[];
}

export function checkCampaignReadiness(input: CampaignReadinessInput): CampaignReadinessResult {
  const { campaign, campaignLeads, sequenceStepCount, mailboxes, domainCount } = input;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (campaignLeads.length === 0) {
    errors.push("Enroll at least one lead before launching.");
  }

  if (sequenceStepCount === 0) {
    errors.push("Add at least one sequence step before launching.");
  }

  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));

  const unresolvedCount = campaignLeads.filter((lead) => !resolveLeadMailboxId(lead, campaign)).length;
  if (unresolvedCount > 0) {
    errors.push(
      `${unresolvedCount} lead${unresolvedCount === 1 ? "" : "s"} ${unresolvedCount === 1 ? "has" : "have"} no mailbox assigned. Set a default mailbox or assign one per lead.`,
    );
  }

  const inactiveMailboxNames = new Set<string>();
  const underconfiguredMailboxNames = new Set<string>();
  for (const lead of campaignLeads) {
    const effectiveMailboxId = resolveLeadMailboxId(lead, campaign);
    const mailbox = effectiveMailboxId ? mailboxById.get(effectiveMailboxId) : undefined;
    if (!mailbox) continue;
    if (mailbox.status !== "active") {
      inactiveMailboxNames.add(mailbox.display_name || mailbox.email);
    }
    if (mailbox.daily_limit <= 0 || mailbox.hourly_limit <= 0) {
      underconfiguredMailboxNames.add(mailbox.display_name || mailbox.email);
    }
  }
  if (inactiveMailboxNames.size > 0) {
    errors.push(`These mailboxes aren't active: ${[...inactiveMailboxNames].join(", ")}.`);
  }
  if (underconfiguredMailboxNames.size > 0) {
    warnings.push(`These mailboxes have no sending limits configured: ${[...underconfiguredMailboxNames].join(", ")}.`);
  }

  if (domainCount === 0) {
    warnings.push("No sending domain configured yet — add one from the Deliverability page for better inbox placement.");
  }

  return { ready: errors.length === 0, errors, warnings };
}

// The 5-state vocabulary Phase 2E's UI shows (Draft/Ready/Running/Paused/
// Completed), derived from the 4 states campaigns.status actually stores
// (draft/active/paused/completed — see 20260728100060_campaigns.sql) plus
// this module's readiness check. No schema change: "Ready" is a draft
// campaign whose readiness is already satisfied, not a new persisted
// status — keeps the DB status column exactly what claim_due_sends() and
// every other query already expect.
export type CampaignExecutionState = "draft" | "ready" | "running" | "paused" | "completed";

export function deriveExecutionState(campaignStatus: string, readiness: CampaignReadinessResult): CampaignExecutionState {
  if (campaignStatus === "draft") return readiness.ready ? "ready" : "draft";
  if (campaignStatus === "active") return "running";
  if (campaignStatus === "paused") return "paused";
  return "completed";
}

export const CAMPAIGN_EXECUTION_STATE_LABEL: Record<CampaignExecutionState, string> = {
  draft: "Draft",
  ready: "Ready",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
};
