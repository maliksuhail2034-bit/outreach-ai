import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Batch 5: no local Postgres/Supabase instance was available in this
// environment (Docker was not running) to execute
// supabase/migrations/20260918100000_warmup_multi_org_claim.sql against a
// real database and prove FOR UPDATE SKIP LOCKED concurrency behavior
// end-to-end. This is the strongest repository-level check available short
// of that: it asserts the replacement claim_due_warmup_sends definition
// keeps every existing safety clause (skip-locked claim, locked_until
// lease, status/stage/mailbox-active/due-time predicates, ordering, limit)
// byte-for-byte, and only the organization_id filter is gone. The SQL
// function's live behavior still needs confirming against a real database
// before/when this migration is applied.
const migrationPath = join(__dirname, "..", "..", "supabase", "migrations", "20260918100000_warmup_multi_org_claim.sql");
const migrationSql = readFileSync(migrationPath, "utf8");

// The function body only — isolates the assertions below from this file's
// own prose comments (which legitimately mention p_organization_id/
// organization_id while explaining the change).
const functionBody = migrationSql.slice(
  migrationSql.indexOf("create or replace function public.claim_due_warmup_sends"),
  migrationSql.indexOf("comment on function"),
);

describe("20260918100000_warmup_multi_org_claim.sql", () => {
  it("drops the p_organization_id parameter and its filter", () => {
    expect(migrationSql).toContain("claim_due_warmup_sends(p_limit integer default 10)");
    expect(functionBody).not.toContain("p_organization_id");
    expect(functionBody).not.toContain("wp.organization_id = ");
  });

  it("preserves the skip-locked claim and lease", () => {
    expect(migrationSql).toContain("for update of wp skip locked");
    expect(migrationSql).toContain("locked_until = now() + interval '10 minutes'");
  });

  it("preserves every existing eligibility predicate", () => {
    expect(migrationSql).toContain("wp.status = 'enabled'");
    expect(migrationSql).toContain("wp.stage in ('starting', 'warming', 'healthy', 'cooling')");
    expect(migrationSql).toContain("m.status = 'active'");
    expect(migrationSql).toContain("wp.locked_until is null or wp.locked_until < now()");
    expect(migrationSql).toContain("wp.next_send_at is null or wp.next_send_at <= now()");
    expect(migrationSql).toContain("wm.reply_decision = 'pending'");
    expect(migrationSql).toContain("wm.reply_due_at <= now()");
  });

  it("preserves ordering and the claim limit", () => {
    expect(migrationSql).toContain("order by wp.updated_at");
    expect(migrationSql).toContain("limit p_limit");
  });
});
