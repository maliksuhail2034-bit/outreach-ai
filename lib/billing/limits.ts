import type { Client } from "@/lib/db/shared";
import { countCampaigns, countEmailsSentSince, countLeads, countMailboxes, getUserOrganization, listCampaigns } from "@/lib/db";
import { getPlanForOrganization } from "./resolve-plan";
import { UNLIMITED, type Plan } from "./plans";

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
  const organization = await getUserOrganization(supabase, { id: userId, email: userEmail ?? undefined });
  return organization.id;
}

// The leading clause for every PlanLimitError message below, including the
// "allows up to" that every message shares — so a call site only ever
// appends the limit number/noun and the closing sentence. PLANS.free's
// `name` ("No active subscription") reads fine as a standalone status but
// not stitched into "Your ${name} plan allows..." — that produces "Your No
// active subscription plan allows...", which is grammatically broken and,
// worse, still reads like a named plan called "No active subscription".
// This branches so the fallback reads as an account status, never a named
// (and never a "Free") plan, while every real paid plan keeps the
// unchanged "Your Starter/Growth/Pro/Scale plan allows..." wording.
function planLimitPrefix(plan: Plan): string {
  return plan.id === "free"
    ? "Your account has no active subscription. The current limit allows up to"
    : `Your ${plan.name} plan allows up to`;
}

export async function assertWithinMailboxLimit(supabase: Client, userId: string, userEmail: string | null | undefined) {
  const organizationId = await resolveOrganizationId(supabase, userId, userEmail);
  const plan = await getPlanForOrganization(supabase, organizationId);
  if (plan.limits.mailboxes === UNLIMITED) return;

  const count = await countMailboxes(supabase, userId);
  if (count >= plan.limits.mailboxes) {
    throw new PlanLimitError(
      `${planLimitPrefix(plan)} ${plan.limits.mailboxes} mailbox${plan.limits.mailboxes === 1 ? "" : "es"}. Upgrade to add more.`,
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
      `${planLimitPrefix(plan)} ${plan.limits.campaigns} campaign${plan.limits.campaigns === 1 ? "" : "s"}. Upgrade to add more.`,
    );
  }
}

export async function assertWithinLeadLimit(supabase: Client, userId: string, userEmail: string | null | undefined) {
  const organizationId = await resolveOrganizationId(supabase, userId, userEmail);
  const plan = await getPlanForOrganization(supabase, organizationId);
  if (plan.limits.leads === UNLIMITED) return;

  const count = await countLeads(supabase, userId);
  if (count >= plan.limits.leads) {
    throw new PlanLimitError(`${planLimitPrefix(plan)} ${plan.limits.leads} leads. Upgrade to add more.`);
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
      `${planLimitPrefix(plan)} ${plan.limits.dailySends} total daily sends across all campaigns (currently configured: ${currentTotal}). Lower this campaign's daily limit or upgrade.`,
    );
  }
}

// UTC calendar-month boundary — same "derive, don't drift" reasoning
// lib/warmup/warmup-worker.ts's recordDailyWarmupStats already documents
// for its own UTC day boundary: a fixed, unambiguous cutover rather than
// anything tied to a particular org's timezone (this app has no
// per-org/per-user timezone setting to key it off).
function startOfCurrentMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// Called from lib/email/send-worker.ts (the admin client, no interactive
// user) immediately before a send is attempted — see the plan's isolation
// checklist: this is the real, send-time-enforced volume cap the launch
// pricing is built around, distinct from assertWithinDailySendLimit above
// (which only bounds *configured* capacity at campaign-create/edit time).
// Returns a boolean rather than throwing PlanLimitError like every
// assertWithin* above: the send worker needs a decision to skip one lead
// and move on, not an exception to catch per lead — same reasoning
// getRemainingLeadQuota below returns a number instead of throwing, for its
// own different (bulk-import, partial-success) caller shape.
export async function isWithinMonthlyEmailLimit(supabase: Client, userId: string, now: Date = new Date()): Promise<boolean> {
  const organizationId = await resolveOrganizationId(supabase, userId, undefined);
  const plan = await getPlanForOrganization(supabase, organizationId);
  if (plan.limits.emailsPerMonth === UNLIMITED) return true;

  const campaigns = await listCampaigns(supabase, userId);
  const campaignIds = (campaigns ?? []).map((campaign) => campaign.id);

  const sentThisMonth = await countEmailsSentSince(supabase, campaignIds, startOfCurrentMonthIso(now));
  return sentThisMonth < plan.limits.emailsPerMonth;
}
