import { z } from "zod";

export const LEAD_STATUSES = ["new", "contacted", "replied", "qualified", "unqualified"] as const;

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
});
export type LeadCsvRowInput = z.infer<typeof leadCsvRowSchema>;
