import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Behavioral tests for this migration are pgTAP scenarios s11/s12 in
// supabase/tests/claim_due_sends.test.sql (run with `supabase test db`
// against the local stack). This file is the part that runs in plain
// `npm test`: it pins the redefined claimable_due_sends() to the version it
// replaces (20260925100000_claim_due_sends_per_mailbox_capacity.sql) plus
// exactly the restored suppression clause, so neither an edit that drops the
// clause again nor an accidental change to any other predicate goes unnoticed.
const migrationsDir = join(__dirname, "..", "..", "supabase", "migrations");

function read(file: string): string {
  return readFileSync(join(migrationsDir, file), "utf8").replace(/\r\n/g, "\n");
}

function eligibilityBody(sql: string): string {
  const from = sql.indexOf("create or replace function public.claimable_due_sends");
  const to = sql.indexOf("\n$$;\n", from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return sql.slice(from, to);
}

const migrationSql = read("20261025100000_claimable_due_sends_suppression.sql");
const previous = eligibilityBody(read("20260925100000_claim_due_sends_per_mailbox_capacity.sql"));
const current = eligibilityBody(migrationSql);

const SUPPRESSION_CLAUSE = `    and not exists (
      select 1 from public.suppressions s
      join public.leads l on l.id = cl.lead_id
      where s.user_id = c.user_id and s.email = l.email
    )`;

describe("20261025100000_claimable_due_sends_suppression.sql", () => {
  it("excludes addresses the campaign owner has suppressed", () => {
    expect(current).toContain(SUPPRESSION_CLAUSE);
  });

  it("scopes the suppression to the campaign owner, the same key the send worker's re-check uses", () => {
    expect(current).toContain("where s.user_id = c.user_id and s.email = l.email");
    expect(current).toContain("join public.campaigns c on c.id = cl.campaign_id");
  });

  it("is the previous definition verbatim plus only the restored clause", () => {
    const withoutComments = (sql: string) =>
      sql
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n");
    expect(withoutComments(current)).toBe(`${withoutComments(previous)}\n${SUPPRESSION_CLAUSE}`);
  });

  it("does not redefine claim_due_sends()", () => {
    expect(migrationSql).not.toContain("function public.claim_due_sends");
  });

  it("keeps the eligibility helper away from API roles but callable by the worker", () => {
    expect(migrationSql).toContain(
      "revoke execute on function public.claimable_due_sends(uuid[]) from public, anon, authenticated;",
    );
    expect(migrationSql).toContain("grant execute on function public.claimable_due_sends(uuid[]) to service_role;");
  });
});
