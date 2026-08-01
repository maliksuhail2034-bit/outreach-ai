import type { Client } from "@/lib/db/shared";
import { countCampaigns, countLeads, countMailboxes, getOrCreateOrganizationForUser, listCampaigns } from "@/lib/db";
import { getPlanForOrganization } from "./resolve-plan";
import { UNLIMITED } from "./plans";

// Thrown by every assert* below — actions.ts callers let this propagate as
// a normal thrown Error (same convention as every other validation failure
// in this codebase, e.g. launchCampaignAction's readiness checks); the
// distinct class exists only so a caller that wants to distinguish "over
// plan limit" from "any other failure" can with instanceof, not because
// anything here needs special HTTP-status handling.
export class PlanLimitError extends Error {}

// Every call site below already has a signed-in user (from requireUser())
// but not yet an organization_id — Task 3 deliberately didn't thread
// organization_id through existing user-owned tables, so this is the one
// place that bridges "userId I have" to "organization to check the plan
// against". Lazily provisions an organization the same way
// getOrCreateDefaultSequence does for a campaign, so this never fails for
// a user who simply hasn't been resolved to an org yet.
async function resolveOrganizationId(supabase: Client, userId: string, userEmail: string | null | undefined) {
  const namePrefix = userEmail?.split("@")[0]?.trim();
  const organization = await getOrCreateOrganizationForUser(supabase, userId, `${namePrefix || "My"}'s workspace`);
  return organization.id;
}

export async function assertWithinMailboxLimit(supabase: Client, userId: string, userEmail: string | null | undefined) {
  const organizationId = await resolveOrganizationId(supabase, userId, userEmail);
  const plan = await getPlanForOrganization(supabase, organizationId);
  if (plan.limits.mailboxes === UNLIMITED) return;

  const count = await countMailboxes(supabase, userId);
  if (count >= plan.limits.mailboxes) {
    throw new PlanLimitError(
      `Your ${plan.name} plan allows up to ${plan.limits.mailboxes} mailbox${plan.limits.mailboxes === 1 ? "" : "es"}. Upgrade to add more.`,
    );
  }
}

export async function assertWithinCampaignLimit(supabase: Client, userId: string, userEmail: string | null | undefined) {
  const organizationId = await resolveOrganizationId(supabase, userId, userEmail);
  const plan = await getPlanForOrganization(supabase, organizationId);
  if (plan.limits.campaigns === UNLIMITED) return;

  const count = await countCampaigns(supabase, userId);
  if (count >= plan.limits.campaigns) {
    throw new PlanLimitError(
      `Your ${plan.name} plan allows up to ${plan.limits.campaigns} campaign${plan.limits.campaigns === 1 ? "" : "s"}. Upgrade to add more.`,
    );
  }
}

export async function assertWithinLeadLimit(supabase: Client, userId: string, userEmail: string | null | undefined) {
  const organizationId = await resolveOrganizationId(supabase, userId, userEmail);
  const plan = await getPlanForOrganization(supabase, organizationId);
  if (plan.limits.leads === UNLIMITED) return;

  const count = await countLeads(supabase, userId);
  if (count >= plan.limits.leads) {
    throw new PlanLimitError(`Your ${plan.name} plan allows up to ${plan.limits.leads} leads. Upgrade to add more.`);
  }
}

// Bulk-import variant: rather than an all-or-nothing throw, returns how
// many more leads this account can add right now so importLeadsAction can
// keep its existing partial-success UX (import what fits, report the rest
// as skipped) instead of rejecting the whole file over a plan limit.
// Infinity for an unlimited plan — callers already do count < remaining
// comparisons, which Infinity handles correctly without a separate branch.
export async function getRemainingLeadQuota(
  supabase: Client,
  userId: string,
  userEmail: string | null | undefined,
): Promise<number> {
  const organizationId = await resolveOrganizationId(supabase, userId, userEmail);
  const plan = await getPlanForOrganization(supabase, organizationId);
  if (plan.limits.leads === UNLIMITED) return Infinity;

  const count = await countLeads(supabase, userId);
  return Math.max(0, plan.limits.leads - count);
}

// Gates the account's total configured daily-sending capacity, not any
// single send — checked wherever a campaign's daily_limit is set
// (create/update), not inside the send worker itself. Deliberately sums
// every campaign regardless of status (draft/active/paused/completed)
// rather than only 'active' ones: simpler, and never under-counts what a
// user could turn on. The tradeoff is a paused/completed campaign's old
// daily_limit still counts against the cap — acceptable for a first cut,
// revisit only if it turns out to bite real users.
export async function assertWithinDailySendLimit(
  supabase: Client,
  userId: string,
  userEmail: string | null | undefined,
  newDailyLimit: number,
  excludingCampaignId?: string,
) {
  const organizationId = await resolveOrganizationId(supabase, userId, userEmail);
  const plan = await getPlanForOrganization(supabase, organizationId);
  if (plan.limits.dailySends === UNLIMITED) return;

  const campaigns = await listCampaigns(supabase, userId);
  const currentTotal = (campaigns ?? [])
    .filter((campaign) => campaign.id !== excludingCampaignId)
    .reduce((sum, campaign) => sum + campaign.daily_limit, 0);

  if (currentTotal + newDailyLimit > plan.limits.dailySends) {
    throw new PlanLimitError(
      `Your ${plan.name} plan allows up to ${plan.limits.dailySends} total daily sends across all campaigns (currently configured: ${currentTotal}). Lower this campaign's daily limit or upgrade.`,
    );
  }
}
