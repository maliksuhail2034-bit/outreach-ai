import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  listEmailEventsMock,
  loadOrganizationRollupMock,
  calculateOrganizationBenchmarksMock,
  buildOrganizationInsightsMock,
  forecastMock,
} = vi.hoisted(() => ({
  listEmailEventsMock: vi.fn(),
  loadOrganizationRollupMock: vi.fn(),
  calculateOrganizationBenchmarksMock: vi.fn(),
  buildOrganizationInsightsMock: vi.fn(),
  forecastMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  listEmailEvents: listEmailEventsMock,
}));

vi.mock("@/lib/analytics/organization-rollup", () => ({
  loadOrganizationRollup: loadOrganizationRollupMock,
  calculateOrganizationBenchmarks: calculateOrganizationBenchmarksMock,
  buildOrganizationInsights: buildOrganizationInsightsMock,
}));

vi.mock("@/lib/analytics/forecasting", () => ({
  getForecaster: () => ({ forecast: forecastMock }),
}));

import { buildOrganizationDigest } from "./digest";

const ORGANIZATION = { id: "org-1", name: "Acme", owner_user_id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  loadOrganizationRollupMock.mockResolvedValue({
    overview: { sentCount: 100, replyRate: 10, bounceRate: 1 },
    campaignSnapshots: [],
    mailboxSnapshots: [{ mailbox: { id: "mailbox-1" } }],
    domainSnapshots: [],
  });
  calculateOrganizationBenchmarksMock.mockReturnValue({
    campaignReplyRatePeerAverage: {},
    mailboxReplyRatePeerAverage: {},
    domainReplyRatePeerAverage: {},
  });
  buildOrganizationInsightsMock.mockReturnValue([{ key: "steady", tone: "good", message: "All steady." }]);
  listEmailEventsMock.mockResolvedValue([]);
  forecastMock.mockResolvedValue([]);
});

describe("buildOrganizationDigest", () => {
  it("assembles the payload from loadOrganizationRollup's overview and buildOrganizationInsights", async () => {
    const payload = await buildOrganizationDigest({} as never, ORGANIZATION);

    expect(payload.organizationId).toBe("org-1");
    expect(payload.organizationName).toBe("Acme");
    expect(payload.overview).toEqual({ sentCount: 100, replyRate: 10, bounceRate: 1 });
    expect(payload.insights).toEqual([{ key: "steady", tone: "good", message: "All steady." }]);
  });

  it("scopes the forecast's event fetch to this organization's own mailboxes", async () => {
    await buildOrganizationDigest({} as never, ORGANIZATION);

    expect(listEmailEventsMock).toHaveBeenCalledWith(
      {},
      undefined,
      expect.objectContaining({ eventType: "sent", mailboxIds: ["mailbox-1"] }),
    );
  });

  it("uses the organization's owner_user_id to load the rollup", async () => {
    await buildOrganizationDigest({} as never, ORGANIZATION);

    expect(loadOrganizationRollupMock).toHaveBeenCalledWith({}, "user-1", "org-1");
  });
});
