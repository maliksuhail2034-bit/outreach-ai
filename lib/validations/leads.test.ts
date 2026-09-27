import { describe, expect, it } from "vitest";
import { leadCsvRowSchema, leadSchema, leadsTimezoneUpdateSchema, MAX_BULK_TIMEZONE_LEADS } from "./leads";

const LEAD = { email: "jane@acme.com" };
const ID = "11111111-1111-4111-8111-111111111111";

describe("leadSchema timezone", () => {
  it.each(["America/New_York", "Asia/Kolkata", "Europe/London", "UTC"])("accepts the IANA timezone %s", (timezone) => {
    expect(leadSchema.parse({ ...LEAD, timezone }).timezone).toBe(timezone);
  });

  it("accepts an empty value (use the campaign timezone)", () => {
    expect(leadSchema.parse({ ...LEAD, timezone: "" }).timezone).toBe("");
  });

  it("accepts an omitted timezone", () => {
    expect(leadSchema.parse(LEAD).timezone).toBeUndefined();
  });

  it("trims whitespace around a timezone", () => {
    expect(leadSchema.parse({ ...LEAD, timezone: "  Asia/Tokyo  " }).timezone).toBe("Asia/Tokyo");
  });

  it.each(["Mars/Olympus_Mons", "America/NewYork", "GMT+25", "not a timezone"])("rejects %j", (timezone) => {
    const result = leadSchema.safeParse({ ...LEAD, timezone });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["timezone"]);
  });
});

describe("leadCsvRowSchema timezone", () => {
  it("passes the raw value through for the importer to check (an invalid one doesn't fail the row)", () => {
    expect(leadCsvRowSchema.parse({ ...LEAD, timezone: "Nowhere/Special" }).timezone).toBe("Nowhere/Special");
  });
});

describe("leadsTimezoneUpdateSchema", () => {
  it("accepts a valid timezone", () => {
    expect(leadsTimezoneUpdateSchema.parse({ ids: [ID], timezone: "America/Chicago" })).toEqual({
      ids: [ID],
      timezone: "America/Chicago",
    });
  });

  it("accepts null (use the campaign timezone)", () => {
    expect(leadsTimezoneUpdateSchema.parse({ ids: [ID], timezone: null }).timezone).toBeNull();
  });

  it.each([
    ["an invalid timezone", { ids: [ID], timezone: "Not/A_Zone" }],
    ["an empty timezone string", { ids: [ID], timezone: "" }],
    ["no ids", { ids: [], timezone: null }],
    ["a non-uuid id", { ids: ["lead-1"], timezone: null }],
    ["too many ids", { ids: Array.from({ length: MAX_BULK_TIMEZONE_LEADS + 1 }, () => ID), timezone: null }],
  ])("rejects %s", (_label, input) => {
    expect(leadsTimezoneUpdateSchema.safeParse(input).success).toBe(false);
  });
});
