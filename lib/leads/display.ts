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
