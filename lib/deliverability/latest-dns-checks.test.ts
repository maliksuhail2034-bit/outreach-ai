import { describe, expect, it } from "vitest";
import type { Tables } from "@/types/database.types";
import { latestDnsChecksByType } from "./latest-dns-checks";

type DomainDnsCheckRow = Tables<"domain_dns_checks">;

function makeCheck(overrides: Partial<DomainDnsCheckRow>): DomainDnsCheckRow {
  return {
    id: "check-1",
    domain_id: "domain-1",
    user_id: "user-1",
    record_type: "spf",
    status: "pending",
    detail: null,
    checked_at: "2026-08-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("latestDnsChecksByType", () => {
  it("keeps only the first row seen per record type", () => {
    const checks = [
      makeCheck({ id: "newest-spf", record_type: "spf", status: "pass", checked_at: "2026-08-02T00:00:00.000Z" }),
      makeCheck({ id: "older-spf", record_type: "spf", status: "fail", checked_at: "2026-08-01T00:00:00.000Z" }),
      makeCheck({ id: "newest-dkim", record_type: "dkim", status: "pass", checked_at: "2026-08-02T00:00:00.000Z" }),
    ];

    const latest = latestDnsChecksByType(checks);

    expect(latest.spf?.id).toBe("newest-spf");
    expect(latest.dkim?.id).toBe("newest-dkim");
  });

  it("leaves record types with no checks absent from the result", () => {
    const checks = [makeCheck({ record_type: "mx" })];

    const latest = latestDnsChecksByType(checks);

    expect(latest.mx).toBeDefined();
    expect(latest.spf).toBeUndefined();
    expect(latest.dkim).toBeUndefined();
    expect(latest.dmarc).toBeUndefined();
  });

  it("returns an empty object for no checks", () => {
    expect(latestDnsChecksByType([])).toEqual({});
  });
});
