import { z } from "zod";
import { isValidIanaTimezone } from "@/lib/timezones";

export const LEAD_STATUSES = ["new", "contacted", "replied", "qualified", "unqualified"] as const;

const INVALID_TIMEZONE_MESSAGE = "Choose a valid timezone (e.g. America/New_York).";

// A lead's explicit timezone: empty means "use the campaign's timezone"
// (stored as null), anything else must be a real IANA zone — the same check
// the campaign sending window uses. Sending falls back to the campaign
// timezone for anything invalid regardless (resolveLeadSendingWindow), but
// an invalid value is never written in the first place.
const leadTimezoneField = z
  .string()
  .trim()
  .refine((value) => value === "" || isValidIanaTimezone(value), { message: INVALID_TIMEZONE_MESSAGE });

export const leadSchema = z.object({
  firstName: z.string().trim().max(120).optional().or(z.literal("")),
  lastName: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().min(1, { message: "Enter an email address." }).email({ message: "Enter a valid email address." }).max(320),
  company: z.string().trim().max(200).optional().or(z.literal("")),
  title: z.string().trim().max(200).optional().or(z.literal("")),
  // Optional so a create submission can omit it and let the DB default
  // ('new') apply — see supabase/migrations/20260729100000_leads_status.sql.
  status: z.enum(LEAD_STATUSES).optional(),
  listId: z.string().trim().optional().or(z.literal("")),
  timezone: leadTimezoneField.optional(),
});
export type LeadInput = z.infer<typeof leadSchema>;

// Subset used to validate each parsed CSV row during import — only the
// fields a spreadsheet column can reasonably supply. Status/list assignment
// for an import batch is chosen once in the UI, not per row.
export const leadCsvRowSchema = z.object({
  firstName: z.string().trim().max(120).optional().or(z.literal("")),
  lastName: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().min(1, { message: "Missing email." }).email({ message: "Invalid email." }).max(320),
  company: z.string().trim().max(200).optional().or(z.literal("")),
  title: z.string().trim().max(200).optional().or(z.literal("")),
  // Checked by the importer rather than here: an invalid timezone doesn't
  // fail the row, it's left unset with a warning (see importLeadsAction).
  timezone: z.string().trim().optional(),
});
export type LeadCsvRowInput = z.infer<typeof leadCsvRowSchema>;

// Bulk "Set timezone" (a zone) / "Use campaign timezone" (null) for
// selected leads — the lead table only ever selects within one page.
export const MAX_BULK_TIMEZONE_LEADS = 1000;

export const leadsTimezoneUpdateSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_BULK_TIMEZONE_LEADS),
  timezone: z
    .string()
    .trim()
    .refine(isValidIanaTimezone, { message: INVALID_TIMEZONE_MESSAGE })
    .nullable(),
});
export type LeadsTimezoneUpdateInput = z.infer<typeof leadsTimezoneUpdateSchema>;
