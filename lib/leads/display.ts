// What a customer sees as a lead's address. A lead delivered from the
// Polimatiq verified pool stores a non-routable placeholder in `email` and a
// masked address (j••••@acme.com) in `display_email`; the real address never
// reaches the customer (see supabase/migrations/20261107100000_staff_console.sql).
export function leadEmailLabel(lead: { email: string; display_email?: string | null }): string {
  return lead.display_email ?? lead.email;
}

export function isVerifiedPoolLead(lead: { verified_lead_id?: string | null }): boolean {
  return Boolean(lead.verified_lead_id);
}

// A lead's pipeline status (leads.status, LEAD_STATUSES) for people.
export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting_booked: "Meeting booked",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
  unqualified: "Unqualified",
};

export function leadStatusLabel(status: string): string {
  return LEAD_STATUS_LABEL[status] ?? status;
}

export const LEAD_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "success" | "info" | "warning" | "outline"> = {
  new: "outline",
  contacted: "secondary",
  replied: "info",
  interested: "info",
  meeting_booked: "warning",
  qualified: "default",
  won: "success",
  lost: "destructive",
  unqualified: "destructive",
};
