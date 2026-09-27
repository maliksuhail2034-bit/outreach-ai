import { LEAD_STATUSES } from "@/lib/validations/leads";
import { LEAD_VERIFICATION_STATUSES, leadSegmentSchema, type LeadSegmentRule } from "@/lib/validations/lead-segments";

export type Field = LeadSegmentRule["field"];

export const FIELD_LABELS: Record<Field, string> = {
  status: "Status",
  verification_status: "Verification status",
  list_id: "List",
  company: "Company",
  title: "Title",
  city: "City",
  country: "Country",
  email_domain: "Email domain",
  created_at: "Date added",
};

export function operatorsFor(field: Field): string[] {
  if (field === "status" || field === "verification_status") return ["is", "is_not", "in", "not_in"];
  if (field === "list_id") return ["in"];
  if (field === "email_domain") return ["equals"];
  if (field === "created_at") return ["after", "before"];
  return ["contains", "equals"];
}

export function enumValuesFor(field: "status" | "verification_status"): readonly string[] {
  return field === "status" ? LEAD_STATUSES : LEAD_VERIFICATION_STATUSES;
}

export function defaultRule(field: Field): LeadSegmentRule {
  switch (field) {
    case "status":
      return { field, operator: "is", value: "new" };
    case "verification_status":
      return { field, operator: "is", value: "valid" };
    case "list_id":
      return { field, operator: "in", values: [] };
    case "email_domain":
      return { field, operator: "equals", value: "" };
    case "created_at":
      return { field, operator: "after", value: "" };
    default:
      return { field, operator: "contains", value: "" };
  }
}

// Radix Select can report a transient value ("" or an option from the
// previous field's list) while its options are swapped on a field change;
// anything that isn't a real choice for the rule is ignored so it can't
// overwrite the valid state.
export function withField(rule: LeadSegmentRule, field: string): LeadSegmentRule {
  if (field === rule.field || !(field in FIELD_LABELS)) return rule;
  return defaultRule(field as Field);
}

// Keeps the chosen value(s) when switching between single- and multi-value
// operators on the same enum field.
export function withOperator(rule: LeadSegmentRule, operator: string): LeadSegmentRule {
  if (!operatorsFor(rule.field).includes(operator)) return rule;
  if (rule.field === "status" || rule.field === "verification_status") {
    const current = "values" in rule ? rule.values : [rule.value];
    if (operator === "in" || operator === "not_in") {
      return { field: rule.field, operator, values: current } as LeadSegmentRule;
    }
    return { field: rule.field, operator, value: current[0] ?? (rule.field === "status" ? "new" : "valid") } as LeadSegmentRule;
  }
  return { ...rule, operator } as LeadSegmentRule;
}

export function withEnumValue(rule: LeadSegmentRule, value: string): LeadSegmentRule {
  if (rule.field !== "status" && rule.field !== "verification_status") return rule;
  if ("values" in rule || !enumValuesFor(rule.field).includes(value)) return rule;
  return { ...rule, value } as LeadSegmentRule;
}

export function segmentFormErrors(input: { name: string; description: string; rules: LeadSegmentRule[] }): string[] {
  const parsed = leadSegmentSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const [first, index] = issue.path;
    if (first === "rules" && typeof index === "number") return `Rule ${index + 1}: ${issue.message}`;
    if (first === "name") return `Name: ${issue.message}`;
    return issue.message;
  });
}
