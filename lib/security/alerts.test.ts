import { describe, expect, it } from "vitest";
import { buildSecurityAlerts, signInsByCountry, type AlertInputs } from "./alerts";

type Event = AlertInputs["authEvents"][number];

function failure(ip: string, emailHash = "h1"): Event {
  return { event_type: "sign_in_failure", ip, email_hash: emailHash, user_id: null, country: "US" };
}

function inputs(overrides: Partial<AlertInputs> = {}): AlertInputs {
  return {
    authEvents: [],
    unhealthyJobs: [],
    blockedIps: new Set(),
    staffUserIds: new Set(),
    auditChain: { checked: 10, firstBrokenSeq: null },
    ...overrides,
  };
}

describe("buildSecurityAlerts", () => {
  it("is quiet when nothing is wrong", () => {
    expect(buildSecurityAlerts(inputs())).toEqual([]);
  });

  it("flags an IP with many failures, critical past 50 unless already blocked", () => {
    const ten = Array.from({ length: 10 }, (_, i) => failure("203.0.113.7", `h${i}`));
    expect(buildSecurityAlerts(inputs({ authEvents: ten }))).toEqual([
      expect.objectContaining({ severity: "warning", ip: "203.0.113.7", alreadyBlocked: false }),
    ]);

    const fifty = Array.from({ length: 50 }, (_, i) => failure("203.0.113.7", `h${i}`));
    expect(buildSecurityAlerts(inputs({ authEvents: fifty }))[0]).toMatchObject({ severity: "critical" });
    expect(
      buildSecurityAlerts(inputs({ authEvents: fifty, blockedIps: new Set(["203.0.113.7"]) }))[0],
    ).toMatchObject({ severity: "warning", alreadyBlocked: true });
  });

  it("doesn't flag a few failures", () => {
    const nine = Array.from({ length: 9 }, (_, i) => failure("203.0.113.7", `h${i}`));
    expect(buildSecurityAlerts(inputs({ authEvents: nine }))).toEqual([]);
  });

  it("flags repeated failures against one account from many IPs, without naming it", () => {
    const spread = Array.from({ length: 5 }, (_, i) => failure(`198.51.100.${i}`, "same-hash"));
    const alerts = buildSecurityAlerts(inputs({ authEvents: spread }));
    expect(alerts).toEqual([expect.objectContaining({ severity: "warning", title: "5 failed sign-ins against one account" })]);
    expect(JSON.stringify(alerts)).not.toContain("same-hash");
  });

  it("puts a broken audit chain first, as critical", () => {
    const alerts = buildSecurityAlerts(
      inputs({ auditChain: { checked: 10, firstBrokenSeq: 4 }, unhealthyJobs: [{ job: "send-emails", error: "boom" }] }),
    );
    expect(alerts[0]).toMatchObject({ id: "audit-chain", severity: "critical" });
    expect(alerts[1]).toMatchObject({ id: "job:send-emails", detail: "boom" });
  });

  it("flags a staff account signing in from two countries, but not a customer", () => {
    const events: Event[] = [
      { event_type: "sign_in_success", ip: "1.1.1.1", email_hash: null, user_id: "staff-1", country: "IN" },
      { event_type: "sign_in_success", ip: "2.2.2.2", email_hash: null, user_id: "staff-1", country: "RU" },
      { event_type: "sign_in_success", ip: "1.1.1.1", email_hash: null, user_id: "cust-1", country: "IN" },
      { event_type: "sign_in_success", ip: "2.2.2.2", email_hash: null, user_id: "cust-1", country: "US" },
    ];
    const alerts = buildSecurityAlerts(inputs({ authEvents: events, staffUserIds: new Set(["staff-1"]) }));
    expect(alerts).toEqual([expect.objectContaining({ id: "staff-countries:staff-1", detail: expect.stringContaining("IN, RU") })]);
  });

  it("notes rate-limited attempts as info", () => {
    const events: Event[] = [{ event_type: "sign_in_rate_limited", ip: "1.1.1.1", email_hash: "h", user_id: null, country: null }];
    expect(buildSecurityAlerts(inputs({ authEvents: events }))).toEqual([expect.objectContaining({ severity: "info" })]);
  });
});

describe("signInsByCountry", () => {
  it("groups outcomes by country, busiest first, unknown kept", () => {
    const events: Event[] = [
      { event_type: "sign_in_success", ip: null, email_hash: null, user_id: "u", country: "IN" },
      failure("1.1.1.1"),
      failure("1.1.1.2"),
      { event_type: "sign_in_failure", ip: null, email_hash: "h", user_id: null, country: null },
    ];
    expect(signInsByCountry(events)).toEqual([
      { country: "US", successes: 0, failures: 2 },
      { country: "IN", successes: 1, failures: 0 },
      { country: "Unknown", successes: 0, failures: 1 },
    ]);
  });
});
