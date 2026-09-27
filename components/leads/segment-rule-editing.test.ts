import { describe, expect, it } from "vitest";
import type { LeadSegmentRule } from "@/lib/validations/lead-segments";
import { leadSegmentRuleSchema } from "@/lib/validations/lead-segments";
import { defaultRule, operatorsFor, segmentFormErrors, withEnumValue, withField, withOperator } from "./segment-rule-editing";

const statusIs: LeadSegmentRule = { field: "status", operator: "is", value: "contacted" };
const companyContains: LeadSegmentRule = { field: "company", operator: "contains", value: "acme" };

describe("withField", () => {
  it("Status → Company yields a company rule with the contains operator", () => {
    expect(withField(statusIs, "company")).toEqual({ field: "company", operator: "contains", value: "" });
  });

  it("Company → Status yields a status rule with a valid enum operator and value", () => {
    const next = withField(companyContains, "status");
    expect(next).toEqual({ field: "status", operator: "is", value: "new" });
    expect(operatorsFor("status")).toContain(next.operator);
    expect(leadSegmentRuleSchema.safeParse(next).success).toBe(true);
  });

  it("every field's default operator is one it offers", () => {
    for (const field of ["status", "verification_status", "list_id", "company", "title", "city", "country", "email_domain", "created_at"] as const) {
      expect(operatorsFor(field)).toContain(defaultRule(field).operator);
    }
  });

  it("ignores an empty or unknown field value", () => {
    expect(withField(companyContains, "")).toBe(companyContains);
    expect(withField(companyContains, "nope")).toBe(companyContains);
  });

  it("keeps the rule when the same field is reselected", () => {
    expect(withField(companyContains, "company")).toBe(companyContains);
  });
});

describe("withOperator — transient Select values", () => {
  it("an empty operator can't overwrite a valid one", () => {
    expect(withOperator(companyContains, "")).toBe(companyContains);
    expect(withOperator(statusIs, "")).toBe(statusIs);
  });

  it("an operator from the previous field's list can't overwrite a valid one", () => {
    expect(withOperator(companyContains, "is")).toBe(companyContains);
    expect(withOperator(statusIs, "contains")).toBe(statusIs);
  });

  it("a Status → Company switch followed by a transient empty operator keeps contains", () => {
    const afterField = withField(statusIs, "company");
    expect(withOperator(afterField, "").operator).toBe("contains");
  });

  it("still applies real operator changes", () => {
    expect(withOperator(companyContains, "equals")).toEqual({ field: "company", operator: "equals", value: "acme" });
    expect(withOperator(statusIs, "in")).toEqual({ field: "status", operator: "in", values: ["contacted"] });
    expect(withOperator({ field: "status", operator: "in", values: ["replied"] }, "is_not")).toEqual({
      field: "status",
      operator: "is_not",
      value: "replied",
    });
  });
});

describe("withEnumValue", () => {
  it("ignores an empty or out-of-set value", () => {
    expect(withEnumValue(statusIs, "")).toBe(statusIs);
    expect(withEnumValue(statusIs, "valid")).toBe(statusIs);
  });

  it("applies a real value", () => {
    expect(withEnumValue(statusIs, "replied")).toEqual({ field: "status", operator: "is", value: "replied" });
  });
});

describe("segmentFormErrors", () => {
  const base = { name: "Acme", description: "" };

  it("reports a rule error, then nothing once the rule is fixed", () => {
    const invalid = { ...companyContains, operator: "" } as unknown as LeadSegmentRule;
    expect(segmentFormErrors({ ...base, rules: [invalid] })).toEqual(["Rule 1: Invalid input"]);
    expect(segmentFormErrors({ ...base, rules: [companyContains] })).toEqual([]);
  });

  it("recomputes to the new problem when a rule changes to a different invalid state", () => {
    expect(segmentFormErrors({ ...base, rules: [{ field: "company", operator: "contains", value: "" }] })).toEqual([
      "Rule 1: Enter a value.",
    ]);
  });

  it("still rejects genuinely invalid rules", () => {
    const errors = segmentFormErrors({
      ...base,
      rules: [companyContains, { field: "email_domain", operator: "equals", value: "not a domain" }],
    });
    expect(errors).toEqual(["Rule 2: Enter a domain like example.com."]);
    expect(segmentFormErrors({ ...base, rules: [{ field: "list_id", operator: "in", values: [] }] })).toEqual([
      "Rule 1: Choose at least one list.",
    ]);
  });

  it("labels a name error", () => {
    expect(segmentFormErrors({ name: "", description: "", rules: [companyContains] })[0]).toMatch(/^Name: /);
  });
});
