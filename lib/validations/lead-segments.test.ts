import { describe, expect, it } from "vitest";
import {
  MAX_SEGMENT_RULES,
  leadSegmentRuleSchema,
  leadSegmentSchema,
  parseSegmentRules,
  referencedListIds,
} from "./lead-segments";

const LIST_A = "11111111-1111-4111-8111-111111111111";
const LIST_B = "22222222-2222-4222-8222-222222222222";

function accepts(rule: unknown) {
  return leadSegmentRuleSchema.safeParse(rule).success;
}

describe("leadSegmentRuleSchema — supported rules", () => {
  it.each([
    { field: "status", operator: "is", value: "new" },
    { field: "status", operator: "is_not", value: "replied" },
    { field: "status", operator: "in", values: ["new", "contacted"] },
    { field: "status", operator: "not_in", values: ["unqualified"] },
    { field: "verification_status", operator: "is", value: "valid" },
    { field: "verification_status", operator: "is_not", value: "invalid" },
    { field: "verification_status", operator: "in", values: ["valid", "catch_all"] },
    { field: "verification_status", operator: "not_in", values: ["invalid", "error"] },
    { field: "list_id", operator: "in", values: [LIST_A, LIST_B] },
    { field: "company", operator: "equals", value: "Acme" },
    { field: "title", operator: "contains", value: "Head of" },
    { field: "city", operator: "equals", value: "Dubai" },
    { field: "country", operator: "contains", value: "United" },
    { field: "email_domain", operator: "equals", value: "example.com" },
    { field: "created_at", operator: "before", value: "2026-09-01" },
    { field: "created_at", operator: "after", value: "2026-01-31" },
  ])("accepts $field $operator", (rule) => {
    expect(accepts(rule)).toBe(true);
  });

  it("trims text values and lower-cases email domains", () => {
    expect(leadSegmentRuleSchema.parse({ field: "company", operator: "equals", value: "  Acme  " })).toEqual({
      field: "company",
      operator: "equals",
      value: "Acme",
    });
    expect(leadSegmentRuleSchema.parse({ field: "email_domain", operator: "equals", value: " Example.COM " })).toEqual({
      field: "email_domain",
      operator: "equals",
      value: "example.com",
    });
  });
});

describe("leadSegmentRuleSchema — unsupported fields and operators", () => {
  it.each([
    ["custom_fields is not a supported field", { field: "custom_fields", operator: "equals", value: "x" }],
    ["email itself is not a supported field", { field: "email", operator: "equals", value: "a@b.com" }],
    ["user_id can never be a rule", { field: "user_id", operator: "is", value: LIST_A }],
    ["status has no contains", { field: "status", operator: "contains", value: "new" }],
    ["company has no is_not", { field: "company", operator: "is_not", value: "Acme" }],
    ["list_id only supports in", { field: "list_id", operator: "is", value: LIST_A }],
    ["email_domain only supports equals", { field: "email_domain", operator: "contains", value: "example" }],
    ["created_at has no equals", { field: "created_at", operator: "equals", value: "2026-09-01" }],
    ["extra keys are rejected", { field: "company", operator: "equals", value: "Acme", column: "user_id" }],
    ["a single-value operator can't take values", { field: "status", operator: "is", values: ["new"] }],
  ])("rejects: %s", (_label, rule) => {
    expect(accepts(rule)).toBe(false);
  });
});

describe("leadSegmentRuleSchema — invalid values", () => {
  it.each([
    ["an unknown status", { field: "status", operator: "is", value: "archived" }],
    ["an unknown verification status", { field: "verification_status", operator: "in", values: ["valid", "bogus"] }],
    ["an empty in-list", { field: "status", operator: "in", values: [] }],
    ["a non-uuid list id", { field: "list_id", operator: "in", values: ["not-a-uuid"] }],
    ["an empty list selection", { field: "list_id", operator: "in", values: [] }],
    ["an empty text value", { field: "company", operator: "equals", value: "   " }],
    ["an over-long text value", { field: "title", operator: "contains", value: "x".repeat(201) }],
    ["a * in a text value (PostgREST wildcard, no escape)", { field: "company", operator: "contains", value: "Ac*me" }],
    ["a backslash in a text value", { field: "title", operator: "equals", value: "back\\slash" }],
    ["a domain with @", { field: "email_domain", operator: "equals", value: "@example.com" }],
    ["a domain with a wildcard", { field: "email_domain", operator: "equals", value: "%.com" }],
    ["a domain without a dot", { field: "email_domain", operator: "equals", value: "localhost" }],
    ["a non-ISO date", { field: "created_at", operator: "before", value: "01/09/2026" }],
    ["an impossible date", { field: "created_at", operator: "after", value: "2026-02-30" }],
    ["a timestamp instead of a date", { field: "created_at", operator: "before", value: "2026-09-01T00:00:00Z" }],
  ])("rejects %s", (_label, rule) => {
    expect(accepts(rule)).toBe(false);
  });

  it("keeps % and _ in text values (they're escaped at query time, not rejected)", () => {
    expect(accepts({ field: "company", operator: "contains", value: "100%_off" })).toBe(true);
  });
});

describe("leadSegmentSchema / parseSegmentRules", () => {
  const rule = { field: "status", operator: "is", value: "new" };

  it("requires a name and at least one rule", () => {
    expect(leadSegmentSchema.safeParse({ name: "", rules: [rule] }).success).toBe(false);
    expect(leadSegmentSchema.safeParse({ name: "Hot", rules: [] }).success).toBe(false);
    expect(leadSegmentSchema.safeParse({ name: "Hot", rules: [rule] }).success).toBe(true);
  });

  it(`caps a segment at ${MAX_SEGMENT_RULES} rules`, () => {
    expect(leadSegmentSchema.safeParse({ name: "Big", rules: Array(MAX_SEGMENT_RULES).fill(rule) }).success).toBe(true);
    expect(leadSegmentSchema.safeParse({ name: "Big", rules: Array(MAX_SEGMENT_RULES + 1).fill(rule) }).success).toBe(false);
  });

  it("re-validates stored rules and throws on anything that no longer fits", () => {
    expect(parseSegmentRules([rule])).toEqual([rule]);
    expect(() => parseSegmentRules({ field: "status" })).toThrow();
    expect(() => parseSegmentRules([{ field: "custom_fields", operator: "equals", value: "x" }])).toThrow();
    expect(() => parseSegmentRules(null)).toThrow();
  });

  it("lists every referenced list id once", () => {
    expect(
      referencedListIds([
        { field: "list_id", operator: "in", values: [LIST_A, LIST_B] },
        { field: "status", operator: "is", value: "new" },
        { field: "list_id", operator: "in", values: [LIST_A] },
      ]),
    ).toEqual([LIST_A, LIST_B]);
  });
});
