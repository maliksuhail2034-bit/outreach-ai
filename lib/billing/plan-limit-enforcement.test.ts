import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ENTITLEMENT_PERIOD_GRACE_MS } from "./entitlement-grace";
import { PAID_PLAN_IDS, PLANS, type PlanId } from "./plans";

// The database enforces mailbox/campaign/lead limits itself
// (supabase/migrations/20261002100000_plan_limit_enforcement.sql), so it
// carries its own copy of those limits and of plan resolution. These tests
// fail when that copy drifts from the app's — behaviour is covered by
// supabase/tests/plan_limits.test.sql.
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261002100000_plan_limit_enforcement.sql"),
  "utf8",
);

function sqlPlanLimits(): Map<string, { mailboxes: number; campaigns: number; leads: number }> {
  const block = migration.match(/-- plan-limits:begin([\s\S]*?)-- plan-limits:end/);
  if (!block) throw new Error("plan-limits markers not found in the migration");
  const rows = new Map<string, { mailboxes: number; campaigns: number; leads: number }>();
  for (const [, planId, mailboxes, campaigns, leads] of block[1].matchAll(/\('(\w+)', (\d+), (\d+), (\d+)\)/g)) {
    rows.set(planId, { mailboxes: Number(mailboxes), campaigns: Number(campaigns), leads: Number(leads) });
  }
  return rows;
}

describe("database plan limits", () => {
  it("has exactly the app's plans, with the same mailbox, campaign and lead limits", () => {
    const rows = sqlPlanLimits();
    expect([...rows.keys()].sort()).toEqual((Object.keys(PLANS) as PlanId[]).sort());
    for (const [planId, plan] of Object.entries(PLANS)) {
      expect(rows.get(planId), planId).toEqual({
        mailboxes: plan.limits.mailboxes,
        campaigns: plan.limits.campaigns,
        leads: plan.limits.leads,
      });
    }
  });

  it("grants only the app's paid plan ids from a subscription", () => {
    const list = PAID_PLAN_IDS.map((id) => `'${id}'`).join(", ");
    expect(migration).toContain(`s.internal_plan_id in (${list})`);
  });

  it("uses the app's entitlement grace period", () => {
    const hours = ENTITLEMENT_PERIOD_GRACE_MS / (60 * 60 * 1000);
    expect(migration).toContain(`now() < s.current_period_end + interval '${hours} hours'`);
  });

  it("treats the app's internal workspace as unlimited", () => {
    const resolvePlan = readFileSync(join(process.cwd(), "lib/billing/resolve-plan.ts"), "utf8");
    const internalId = resolvePlan.match(/INTERNAL_UNLIMITED_ORGANIZATION_ID = "([0-9a-f-]{36})"/)?.[1];
    expect(internalId).toBeDefined();
    expect(migration).toContain(`when m.organization_id = '${internalId}'::uuid then 'internal_unlimited'`);
  });
});
