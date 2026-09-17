import type { MergeTagLead } from "./merge-tags";

// Realistic, obviously-fake sample lead used only for template previews
// (components/sequences/email-preview-dialog.tsx) and preview-based
// validation (lib/email/validate-template.ts) — never sent to a real
// recipient. One shared definition so what a user sees in the preview and
// what validate-template.ts reasons about can never drift apart.
export const SAMPLE_LEAD: MergeTagLead = {
  first_name: "Jane",
  last_name: "Cooper",
  email: "jane@example.com",
  company: "Acme",
  title: "VP Sales",
  custom_fields: null,
};

// Display rows for the preview UI's "using sample data" panel — derived
// from SAMPLE_LEAD (not hand-duplicated) so the panel can never show a
// stale value that no longer matches what the preview actually renders.
export const SAMPLE_LEAD_FIELDS: { label: string; value: string }[] = [
  { label: "First name", value: SAMPLE_LEAD.first_name ?? "" },
  { label: "Full name", value: `${SAMPLE_LEAD.first_name ?? ""} ${SAMPLE_LEAD.last_name ?? ""}`.trim() },
  { label: "Company", value: SAMPLE_LEAD.company ?? "" },
  { label: "Email", value: SAMPLE_LEAD.email },
  { label: "Job title", value: SAMPLE_LEAD.title ?? "" },
];
