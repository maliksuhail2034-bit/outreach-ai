import { describe, expect, it } from "vitest";
import { calculateOrganizationBenchmarks, buildOrganizationInsights, type OrganizationRollup } from "./organization-rollup";

function rollup(overrides: Partial<OrganizationRollup> = {}): OrganizationRollup {
  return {
    overview: {
      sentCount: 0,
      deliveredCount: 0,
      openedCount: 0,
      clickedCount: 0,
      repliedCount: 0,
      bouncedCount: 0,
      spamComplaintCount: 0,
      deliveryRate: null,
      openRate: null,
      clickRate: null,
      replyRate: null,
      bounceRate: null,
      spamComplaintRate: null,
    },
    campaignSnapshots: [],
    mailboxSnapshots: [],
    domainSnapshots: [],
    ...overrides,
  };
}

describe("calculateOrganizationBenchmarks", () => {
  it("averages reply rate independently per entity type", () => {
    const result = calculateOrganizationBenchmarks(
      rollup({
        campaignSnapshots: [
          { campaign: { id: "c1" }, overview: { replyRate: 10 }, healthScore: { score: null, factors: [] } },
          { campaign: { id: "c2" }, overview: { replyRate: 20 }, healthScore: { score: null, factors: [] } },
        ] as unknown as OrganizationRollup["campaignSnapshots"],
      }),
    );
    expect(result.campaignReplyRatePeerAverage.replyRate).toBe(15);
    expect(result.mailboxReplyRatePeerAverage).toEqual({});
    expect(result.domainReplyRatePeerAverage).toEqual({});
  });
});

describe("buildOrganizationInsights", () => {
  it("flags a campaign whose reply rate is significantly below its peers", () => {
    const org = rollup({
      campaignSnapshots: [
        { campaign: { id: "c1", name: "Campaign A" }, overview: { replyRate: 2 }, healthScore: { score: null, factors: [] } },
        { campaign: { id: "c2", name: "Campaign B" }, overview: { replyRate: 20 }, healthScore: { score: null, factors: [] } },
      ] as unknown as OrganizationRollup["campaignSnapshots"],
    });
    const benchmarks = calculateOrganizationBenchmarks(org);

    const insights = buildOrganizationInsights(org, benchmarks, []);

    expect(insights.some((insight) => insight.message.includes("Campaign A") && insight.tone === "warning")).toBe(true);
  });

  it("falls back to a steady insight when nothing crosses a threshold", () => {
    const org = rollup();
    const benchmarks = calculateOrganizationBenchmarks(org);

    const insights = buildOrganizationInsights(org, benchmarks, []);

    expect(insights).toEqual([
      { key: "steady", tone: "good", message: "No notable changes across your organization right now — everything is steady." },
    ]);
  });
});
