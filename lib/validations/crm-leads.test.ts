import { describe, expect, it } from "vitest";
import { bulkLeadTargetSchema, crmLeadsHref, parseCrmSearchParams } from "./crm-leads";

const CAMPAIGN = "11111111-1111-4111-8111-111111111111";
const STEP = "22222222-2222-4222-8222-222222222222";

describe("parseCrmSearchParams", () => {
  it("defaults to every lead, newest first, page 1", () => {
    expect(parseCrmSearchParams({})).toEqual({
      page: 1,
      q: undefined,
      status: undefined,
      list: undefined,
      verification: undefined,
      segment: undefined,
      engagement: "any",
      campaign: undefined,
      step: undefined,
      sort: "recent",
    });
  });

  it("keeps valid filters", () => {
    expect(
      parseCrmSearchParams({
        page: "3",
        q: "  acme ",
        status: "meeting_booked",
        list: "none",
        verification: "valid",
        engagement: "not_opened",
        campaign: CAMPAIGN,
        step: STEP,
        sort: "opens",
      }),
    ).toMatchObject({ page: 3, q: "acme", status: "meeting_booked", list: "none", verification: "valid", engagement: "not_opened", campaign: CAMPAIGN, step: STEP, sort: "opens" });
  });

  it("drops anything invalid instead of failing", () => {
    expect(
      parseCrmSearchParams({ page: "-2", status: "boss", list: "x", engagement: "hacked", campaign: "1 or 1=1", sort: "random" }),
    ).toMatchObject({ page: 1, status: undefined, list: undefined, engagement: "any", campaign: undefined, sort: "recent" });
  });

  it("ignores a step without its campaign, and takes the first of repeated params", () => {
    expect(parseCrmSearchParams({ step: STEP }).step).toBeUndefined();
    expect(parseCrmSearchParams({ status: ["won", "lost"] }).status).toBe("won");
  });
});

describe("crmLeadsHref", () => {
  it("leaves defaults out", () => {
    expect(crmLeadsHref({ engagement: "any", sort: "recent", page: 1 })).toBe("/leads");
  });

  it("round-trips through parseCrmSearchParams", () => {
    const params = parseCrmSearchParams({ q: "jane", engagement: "clicked", campaign: CAMPAIGN, step: STEP, sort: "activity", page: "2" });
    const href = crmLeadsHref(params);
    expect(parseCrmSearchParams(Object.fromEntries(new URL(href, "https://app.test").searchParams))).toEqual(params);
  });
});

describe("bulkLeadTargetSchema", () => {
  it("accepts ticked ids or a page query, nothing else", () => {
    expect(bulkLeadTargetSchema.safeParse({ ids: [CAMPAIGN] }).success).toBe(true);
    expect(bulkLeadTargetSchema.safeParse({ query: "engagement=opened" }).success).toBe(true);
    expect(bulkLeadTargetSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(bulkLeadTargetSchema.safeParse({ ids: ["not-a-uuid"] }).success).toBe(false);
    expect(bulkLeadTargetSchema.safeParse({}).success).toBe(false);
  });
});
