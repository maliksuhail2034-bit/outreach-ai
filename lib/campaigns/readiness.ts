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

// Batch 8: round-robin selection across a campaign's configured mailbox pool
// (campaign_mailboxes — see supabase/migrations/20260918120000_campaign_mailboxes.sql).
// Pure and DB-free, same as resolveLeadMailboxId above — the enrollment index
// itself (how many leads already existed before this one) is computed by the
// caller from already-loaded data (see app/(app)/campaigns/[campaignId]/actions.ts),
// never stored as its own rotation cursor. An empty pool returns null so
// callers fall through to campaign.default_mailbox_id exactly as they did
// before this pool existed — see the resolution order used at every call
// site: explicit override ?? resolvePoolMailboxId(pool, index) ?? campaign.default_mailbox_id.
//
// Deliberately not filtered by mailbox status here — same as
// resolveLeadMailboxId, which never filters campaign.default_mailbox_id by
// status either. Active-status enforcement stays exactly where it already
// lives: claim_due_sends() at send time, and checkCampaignReadiness below at
// launch time.
//
// Not atomic/race-proof across two simultaneous enrollment calls against the
// same campaign (both could read the same "existing count" and land on the
// same pool mailbox) — a known, accepted limitation for this human-paced,
// UI-triggered action, not addressed in this batch. See lib/campaigns/readiness.test.ts
// for this function's coverage.
export function resolvePoolMailboxId(
  pool: Pick<Tables<"campaign_mailboxes">, "mailbox_id">[],
  enrollmentIndex: number,
): string | null {
  if (pool.length === 0) return null;
  return pool[enrollmentIndex % pool.length].mailbox_id;
}

export interface CampaignReadinessInput {
  campaign: Pick<Tables<"campaigns">, "default_mailbox_id">;
  campaignLeads: Pick<Tables<"campaign_leads">, "mailbox_id">[];
  sequenceStepCount: number;
  mailboxes: Pick<MailboxSafe, "id" | "display_name" | "email" | "status" | "daily_limit" | "hourly_limit">[];
  domainCount: number;
  // Batch 8: the campaign's configured mailbox pool, if any — defaults to
  // empty so every existing caller (before this field existed) keeps
  // behaving exactly as before. Serves two roles: (1) a non-empty pool
  // makes every mailbox_id-less lead resolvable (see resolveLeadMailboxId's
  // call sites in checkCampaignReadiness below), same as a campaign default
  // would; (2) every pool mailbox must itself be active for the campaign to
  // be ready, same severity as the existing per-lead check, not merely a
  // warning.
  campaignMailboxes?: Pick<Tables<"campaign_mailboxes">, "mailbox_id">[];
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
  const { campaign, campaignLeads, sequenceStepCount, mailboxes, domainCount, campaignMailboxes = [] } = input;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (campaignLeads.length === 0) {
    errors.push("Enroll at least one lead before launching.");
  }

  if (sequenceStepCount === 0) {
    errors.push("Add at least one sequence step before launching.");
  }

  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const hasPool = campaignMailboxes.length > 0;

  // Batch 8 fix: a lead with no explicit mailbox_id and no campaign default
  // is still resolvable when a pool is configured — launchCampaignAction's
  // backfill (and enrollLeadAction/enrollLeadListAction at enrollment time)
  // round-robins it across the pool (see resolvePoolMailboxId). Mirrors the
  // explicit ?? pool ?? default order used at every one of those call
  // sites, so a pool-only campaign (no default_mailbox_id at all — see
  // campaign-setup-wizard.tsx's deriveStep) isn't blocked from launching.
  const unresolvedCount = campaignLeads.filter(
    (lead) => !lead.mailbox_id && !hasPool && !campaign.default_mailbox_id,
  ).length;
  if (unresolvedCount > 0) {
    errors.push(
      `${unresolvedCount} lead${unresolvedCount === 1 ? "" : "s"} ${unresolvedCount === 1 ? "has" : "have"} no mailbox assigned. Set a default mailbox or assign one per lead.`,
    );
  }

  const inactiveMailboxNames = new Set<string>();
  const underconfiguredMailboxNames = new Set<string>();
  for (const lead of campaignLeads) {
    // A lead with no explicit override that resolves through the pool has no
    // single "effective mailbox" known at readiness time (which pool
    // mailbox it lands on depends on the backfill/enrollment index) — the
    // pool-status loop below already checks every pool mailbox's active
    // status directly, so skip it here rather than resolving to the
    // campaign default (which this lead won't actually use once a pool
    // exists) or silently passing.
    if (!lead.mailbox_id && hasPool) continue;
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
  // Batch 8: every mailbox in the configured pool must be active too, same
  // severity as the per-lead check above — folded into the same
  // inactiveMailboxNames set so an inactive pool mailbox produces the exact
  // same error message a user already understands, rather than a second,
  // separate error string for what is functionally the same problem.
  for (const poolEntry of campaignMailboxes) {
    const mailbox = mailboxById.get(poolEntry.mailbox_id);
    if (!mailbox) continue;
    if (mailbox.status !== "active") {
      inactiveMailboxNames.add(mailbox.display_name || mailbox.email);
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
