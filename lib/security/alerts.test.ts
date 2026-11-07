import { describe, expect, it } from "vitest";

import { buildSecurityAlerts, type AlertInputs } from "./alerts";
import { EMPTY_AUTH_SUMMARY, type AuthEventSummary } from "./auth-summary";

function inputs(overrides: Partial<Omit<AlertInputs, "summary">> & { summary?: Partial<AuthEventSummary> } = {}): AlertInputs {
  return {
    unhealthyJobs: [],
    blockedIps: new Set(),
    auditChain: { checked: 0, firstBrokenSeq: null },
    ...overrides,
    summary: { ...EMPTY_AUTH_SUMMARY, ...overrides.summary },
  };
}

const ip = (address: string, failures: number) => ({ ip: address, failures, refused: failures, country: null });

describe("buildSecurityAlerts", () => {
  it("is quiet when nothing is wrong", () => {
    expect(buildSecurityAlerts(inputs())).toEqual([]);
  });

  it("flags an IP with many failures, critical past 50 unless already blocked", () => {
    expect(buildSecurityAlerts(inputs({ summary: { by_ip: [ip("203.0.113.7", 10)] } }))).toEqual([
      expect.objectContaining({ id: "ip-failures:203.0.113.7", severity: "warning", ip: "203.0.113.7", alreadyBlocked: false }),
    ]);
    expect(buildSecurityAlerts(inputs({ summary: { by_ip: [ip("203.0.113.7", 50)] } }))[0]).toMatchObject({ severity: "critical" });
    expect(
      buildSecurityAlerts(inputs({ summary: { by_ip: [ip("203.0.113.7", 50)] }, blockedIps: new Set(["203.0.113.7"]) }))[0],
    ).toMatchObject({ severity: "warning", alreadyBlocked: true });
  });

  it("doesn't flag a few failures, and counts failures rather than rate-limited attempts", () => {
    expect(buildSecurityAlerts(inputs({ summary: { by_ip: [ip("203.0.113.7", 9)] } }))).toEqual([]);
    expect(
      buildSecurityAlerts(inputs({ summary: { by_ip: [{ ip: "203.0.113.8", failures: 2, refused: 40, country: null }] } })),
    ).toEqual([]);
  });

  it("flags repeated failures against one account, without naming it", () => {
    const alerts = buildSecurityAlerts(inputs({ summary: { by_account: [6, 2] } }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: "warning", title: "6 failed sign-ins against one account" });
    expect(JSON.stringify(alerts)).not.toMatch(/@/);
  });

  it("puts a broken audit chain first, as critical", () => {
    const alerts = buildSecurityAlerts(
      inputs({ auditChain: { checked: 10, firstBrokenSeq: 4 }, summary: { by_ip: [ip("203.0.113.7", 12)] } }),
    );
    expect(alerts[0]).toMatchObject({ id: "audit-chain", severity: "critical" });
  });

  it("flags a staff account signing in from several countries", () => {
    const alerts = buildSecurityAlerts(inputs({ summary: { staff_multi_country: [{ user_id: "staff-1", countries: ["US", "IN"] }] } }));
    expect(alerts).toEqual([expect.objectContaining({ id: "staff-countries:staff-1", severity: "warning" })]);
    expect(alerts[0].detail).toContain("IN, US");
  });

  it("notes rate-limited attempts as info", () => {
    expect(buildSecurityAlerts(inputs({ summary: { rate_limited: 3 } }))).toEqual([
      expect.objectContaining({ severity: "info", title: "3 sign-in attempts stopped by the rate limit" }),
    ]);
  });

  it("groups unhealthy background jobs", () => {
    const alerts = buildSecurityAlerts(
      inputs({ unhealthyJobs: [{ job: "send-emails", error: "boom" }, { job: "send-emails", error: null }] }),
    );
    expect(alerts).toEqual([expect.objectContaining({ id: "job:send-emails", title: 'Background job "send-emails" reported 2 problems', detail: "boom" })]);
  });
});
