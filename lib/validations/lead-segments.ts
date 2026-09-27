import { z } from "zod";
import { LEAD_STATUSES } from "@/lib/validations/leads";

// Mirrors leads_verification_status_check
// (supabase/migrations/20260809110000_leads_verification.sql).
export const LEAD_VERIFICATION_STATUSES = [
  "unverified",
  "pending",
  "valid",
  "invalid",
  "catch_all",
  "unknown",
  "error",
] as const;
export type LeadVerificationStatus = (typeof LEAD_VERIFICATION_STATUSES)[number];

export const SEGMENT_TEXT_FIELDS = ["company", "title", "city", "country"] as const;
export type SegmentTextField = (typeof SEGMENT_TEXT_FIELDS)[number];

export const MAX_SEGMENT_RULES = 20;
const MAX_SEGMENT_LISTS = 50;

// PostgREST treats `*` as a LIKE wildcard (alongside `%`), with no escape
// for it, and its handling of `\` inside a like pattern isn't something to
// rely on — so both are rejected rather than risk a widened match. `%` and
// `_` are escaped at query time instead (escapeLikePattern in
// lib/db/lead-segments.ts), verified against PostgREST to match literally.
const textValue = z
  .string()
  .trim()
  .min(1, { message: "Enter a value." })
  .max(200)
  .refine((value) => !/[*\\]/.test(value), { message: "The * and \\ characters aren't supported." });

// Hostname labels only — letters, digits and inner hyphens, at least one
// dot — so a domain rule can never carry a wildcard or a stray `@`.
const emailDomainValue = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/, {
    message: "Enter a domain like example.com.",
  });

const dateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Enter a date as YYYY-MM-DD." })
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, { message: "Enter a real calendar date." });

function enumRules<const Field extends string, const Values extends readonly [string, ...string[]]>(
  field: Field,
  values: Values,
) {
  const value = z.enum(values);
  const list = z.array(value).min(1, { message: "Choose at least one value." }).max(values.length);
  return [
    z.object({ field: z.literal(field), operator: z.literal("is"), value }).strict(),
    z.object({ field: z.literal(field), operator: z.literal("is_not"), value }).strict(),
    z.object({ field: z.literal(field), operator: z.literal("in"), values: list }).strict(),
    z.object({ field: z.literal(field), operator: z.literal("not_in"), values: list }).strict(),
  ] as const;
}

// One strict object per (field, operator) pair: an unsupported field, an
// unsupported operator for a field, or any extra key fails validation.
export const leadSegmentRuleSchema = z.union([
  ...enumRules("status", LEAD_STATUSES),
  ...enumRules("verification_status", LEAD_VERIFICATION_STATUSES),
  z
    .object({
      field: z.literal("list_id"),
      operator: z.literal("in"),
      values: z.array(z.uuid()).min(1, { message: "Choose at least one list." }).max(MAX_SEGMENT_LISTS),
    })
    .strict(),
  z
    .object({
      field: z.enum(SEGMENT_TEXT_FIELDS),
      operator: z.enum(["equals", "contains"]),
      value: textValue,
    })
    .strict(),
  z.object({ field: z.literal("email_domain"), operator: z.literal("equals"), value: emailDomainValue }).strict(),
  z.object({ field: z.literal("created_at"), operator: z.enum(["before", "after"]), value: dateValue }).strict(),
]);
export type LeadSegmentRule = z.infer<typeof leadSegmentRuleSchema>;

export const leadSegmentRulesSchema = z
  .array(leadSegmentRuleSchema)
  .min(1, { message: "Add at least one rule." })
  .max(MAX_SEGMENT_RULES, { message: `A segment can have at most ${MAX_SEGMENT_RULES} rules.` });

export const leadSegmentSchema = z.object({
  name: z.string().trim().min(1, { message: "Enter a segment name." }).max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  rules: leadSegmentRulesSchema,
});
export type LeadSegmentInput = z.input<typeof leadSegmentSchema>;

// Stored rules are re-validated before every use, not trusted because they
// were validated on the way in: the column is plain jsonb.
export function parseSegmentRules(raw: unknown): LeadSegmentRule[] {
  return leadSegmentRulesSchema.parse(raw);
}

// Every list id a set of rules references, for the application-side list
// ownership check (the database enforces the same thing in
// check_lead_segment_list_owner).
export function referencedListIds(rules: readonly LeadSegmentRule[]): string[] {
  return [...new Set(rules.flatMap((rule) => (rule.field === "list_id" ? rule.values : [])))];
}
