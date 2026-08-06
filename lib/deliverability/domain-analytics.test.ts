import { describe, expect, it, vi, beforeEach } from "vitest";

// This is the first test file for domain-analytics.ts — previously
// untested (only exercised via live verification against the linked
// dev/staging project, per the Scalability Track's own precedent). Added
// alongside the Deliverability Trends Rollup Migration to cover the new
// dailyRollups fetch this file gained; the pre-existing overview/health
// -score computation is exercised incidentally by the same fixtures.
const { getDomainMock, listMailboxesMock, getOrganizationMembershipMock, listDailyRollupsMock } = vi.hoisted(() => ({
  getDomainMock: vi.fn(),
  listMailboxesMock: vi.fn(),
  getOrganizationMembershipMock: vi.fn(),
  listDailyRollupsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDomain: getDomainMock,
  listMailboxes: listMailboxesMock,
  getOrganizationMembership: getOrganizationMembershipMock,
  listDailyRollups: listDailyRollupsMock,
}));

import { loadDomainAnalyticsSnapshot } from "./domain-analytics";

const DOMAIN = {
  id: "domain-1",
  domain: "example.com",
  spf_verified: true,
  dkim_verified: true,
  dmarc_verified: true,
  mx_verified: true,
  health_score: 100,
};

const MAILBOX = { id: "mailbox-1", domain_id: "domain-1" };
const MEMBERSHIP = { organization_id: "org-1" };
const SUPABASE = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  getDomainMock.mockResolvedValue(DOMAIN);
  listMailboxesMock.mockResolvedValue([MAILBOX]);
  getOrganizationMembershipMock.mockResolvedValue(MEMBERSHIP);
  listDailyRollupsMock.mockResolvedValue([]);
});

describe("loadDomainAnalyticsSnapshot — dailyRollups (Deliverability Trends Rollup Migration)", () => {
  it("does not fetch domain-scoped daily rollups when no trends range is given (Domain Comparison's call shape)", async () => {
    const snapshot = await loadDomainAnalyticsSnapshot(SUPABASE, "user-1", "domain-1");

    expect(snapshot.dailyRollups).toEqual([]);
    expect(listDailyRollupsMock).toHaveBeenCalledTimes(1); // only the mailbox-scoped overview fetch
  });

  it("fetches domain-scoped daily rollups for the given range, alongside the existing mailbox-scoped overview rollups", async () => {
    listDailyRollupsMock.mockImplementation(async (_supabase: unknown, _orgId: string, options: { subjectType: string }) => {
      if (options.subjectType === "domain") {
        return [{ rollup_date: "2026-08-01", event_type: "sent", event_count: 3 }];
      }
      return [];
    });

    const snapshot = await loadDomainAnalyticsSnapshot(SUPABASE, "user-1", "domain-1", {
      start: "2026-07-25",
      end: "2026-08-01",
    });

    expect(listDailyRollupsMock).toHaveBeenCalledWith(SUPABASE, "org-1", {
      subjectType: "mailbox",
      subjectIds: ["mailbox-1"],
    });
    expect(listDailyRollupsMock).toHaveBeenCalledWith(SUPABASE, "org-1", {
      subjectType: "domain",
      subjectId: "domain-1",
      since: "2026-07-25",
      until: "2026-08-01",
    });
    expect(snapshot.dailyRollups).toEqual([{ rollup_date: "2026-08-01", event_type: "sent", event_count: 3 }]);
  });

  it("passes the trends range through to listDailyRollups unmodified — no clamping of the current/partial day", async () => {
    // DateRange (lib/analytics/types.ts) is documented as matching
    // rollup_date/DailyCount's UTC-day convention already; this only
    // confirms loadDomainAnalyticsSnapshot itself doesn't reinterpret or
    // shift the boundary it's given — today's partial-day gap (the rollup
    // worker only has data through yesterday) is entirely a property of
    // what the worker has written, not something this function adjusts for.
    await loadDomainAnalyticsSnapshot(SUPABASE, "user-1", "domain-1", {
      start: "2026-07-25",
      end: "2026-08-06",
    });

    expect(listDailyRollupsMock).toHaveBeenCalledWith(
      SUPABASE,
      "org-1",
      expect.objectContaining({ since: "2026-07-25", until: "2026-08-06" }),
    );
  });

  it("returns no daily rollups when the domain has no mailboxes, even with a trends range given", async () => {
    listMailboxesMock.mockResolvedValue([]);

    const snapshot = await loadDomainAnalyticsSnapshot(SUPABASE, "user-1", "domain-1", {
      start: "2026-07-25",
      end: "2026-08-01",
    });

    expect(snapshot.dailyRollups).toEqual([]);
    expect(getOrganizationMembershipMock).not.toHaveBeenCalled();
    expect(listDailyRollupsMock).not.toHaveBeenCalled();
  });

  it("still computes the overview summary from mailbox-scoped rollups, unaffected by the new trends fetch", async () => {
    listDailyRollupsMock.mockImplementation(async (_supabase: unknown, _orgId: string, options: { subjectType: string }) => {
      if (options.subjectType === "mailbox") {
        return [
          { event_type: "sent", event_count: 10 },
          { event_type: "delivered", event_count: 9 },
        ];
      }
      return [];
    });

    const snapshot = await loadDomainAnalyticsSnapshot(SUPABASE, "user-1", "domain-1", {
      start: "2026-07-25",
      end: "2026-08-01",
    });

    expect(snapshot.overview.sentCount).toBe(10);
    expect(snapshot.overview.deliveredCount).toBe(9);
  });
});
