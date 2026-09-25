import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The behavioral and concurrency tests for this migration are pgTAP tests
// that need a real Postgres (supabase/tests/claim_due_sends.test.sql, run
// with `supabase test db` against the local stack). This file is the part
// that runs in plain `npm test`: it pins the replacement claim_due_sends()
// to every safety clause of the version it replaces
// (20260804100000_sending_limits.sql), plus the new per-mailbox/campaign
// capacity rules, so an edit that silently drops one fails here too.
const migrationPath = join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "20260925100000_claim_due_sends_per_mailbox_capacity.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

function between(start: string, end: string): string {
  const from = migrationSql.indexOf(start);
  const to = migrationSql.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return migrationSql.slice(from, to);
}

const eligibility = between(
  "create or replace function public.claimable_due_sends",
  "comment on function public.claimable_due_sends",
);
const claim = between("create or replace function public.claim_due_sends", "comment on function public.claim_due_sends");

describe("20260925100000_claim_due_sends_per_mailbox_capacity.sql", () => {
  it("keeps the claim_due_sends signature", () => {
    expect(claim).toContain("claim_due_sends(p_limit integer default 25)");
    expect(claim).toContain("returns setof public.campaign_leads");
  });

  it("preserves every existing eligibility predicate", () => {
    expect(eligibility).toContain("cl.status = 'active'");
    expect(eligibility).toContain("cl.next_send_at is not null and cl.next_send_at <= now()");
    expect(eligibility).toContain("(cl.locked_until is null or cl.locked_until < now())");
    expect(eligibility).toContain("c.status = 'active'");
    expect(eligibility).toContain("cl.mailbox_id is not null and m.status = 'active'");
    expect(eligibility).toContain("coalesce(st.c, 0) < m.daily_limit");
    expect(eligibility).toContain("coalesce(sth.c, 0) < m.hourly_limit");
    expect(eligibility).toContain("ls.last_sent_at <= now() - make_interval(mins => m.cooldown_minutes)");
  });

  it("never claims for a mailbox that already has a send in flight", () => {
    expect(eligibility).toContain("where f.mailbox_id = cl.mailbox_id and f.locked_until >= now()");
  });

  it("enforces remaining campaign daily capacity, including in-flight sends", () => {
    expect(eligibility).toContain("c.daily_limit - coalesce(cst.c, 0) - coalesce(cif.c, 0) > 0");
    expect(claim).toContain("where r.campaign_rank <= r.campaign_capacity");
  });

  it("claims at most one lead per mailbox, earliest due first", () => {
    expect(claim).toContain("select distinct on (e.mailbox_id)");
    expect(claim).toContain("order by e.mailbox_id, e.next_send_at, e.id");
  });

  it("locks only the mailboxes and campaigns it acts on, never waiting", () => {
    expect(claim).toContain("for no key update of m skip locked");
    expect(claim).toContain("for no key update of c skip locked");
    expect(claim).not.toContain("pg_advisory");
  });

  // Postgres re-checks a concurrently-updated row only against the locking
  // query's own WHERE clause, so the lead-row predicates must be in the final
  // FOR UPDATE query itself, not just in claimable_due_sends() — otherwise a
  // lead that became replied/cancelled or was rescheduled between the
  // snapshot and the lock would still be claimed. Not reproducible
  // deterministically in the pgTAP suite (see its header), so pinned here.
  it("re-checks the lead-row predicates in the final locking query", () => {
    const candidates = claim.slice(claim.indexOf("candidates as ("), claim.indexOf("for update of cl skip locked"));
    expect(candidates).toContain("cl.status = 'active'");
    expect(candidates).toContain("cl.next_send_at is not null");
    expect(candidates).toContain("cl.next_send_at <= now()");
    expect(candidates).toContain("(cl.locked_until is null or cl.locked_until < now())");
  });

  it("preserves the skip-locked lead claim, ordering, limit and 10 minute lease", () => {
    expect(claim).toContain("for update of cl skip locked");
    expect(claim).toContain("order by cl.next_send_at");
    expect(claim).toContain("limit p_limit");
    expect(claim).toContain("set locked_until = now() + interval '10 minutes'");
  });

  it("keeps the eligibility helper away from API roles but callable by the worker", () => {
    expect(migrationSql).toContain(
      "revoke execute on function public.claimable_due_sends(uuid[]) from public, anon, authenticated;",
    );
    expect(migrationSql).toContain("grant execute on function public.claimable_due_sends(uuid[]) to service_role;");
  });
});
