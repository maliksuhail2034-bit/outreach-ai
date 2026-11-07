import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import { getDeliveredVerifiedLeadEmail, type VerifiedLeadStatus } from "@/lib/db";

// Where mail for a lead actually goes. A lead delivered from the Polimatiq
// verified pool stores a non-routable placeholder in `email`; its real
// address lives only in verified_leads and is resolved here, server-side,
// on the service-role client (send worker, unsubscribe, reply/bounce
// matching). The result must never be returned to a customer-facing page.
export interface LeadContact {
  email: string;
  // null for the customer's own leads.
  poolStatus: VerifiedLeadStatus | null;
}

type ContactLead = Pick<Tables<"leads">, "id" | "user_id" | "email" | "verified_lead_id">;

// null when a pool lead has no matching delivery record — it can't be
// mailed, and callers treat it as unresolvable rather than falling back to
// the placeholder.
export async function resolveLeadContact(supabase: Client, lead: ContactLead): Promise<LeadContact | null> {
  if (!lead.verified_lead_id) return { email: lead.email, poolStatus: null };
  const delivered = await getDeliveredVerifiedLeadEmail(supabase, lead);
  return delivered ? { email: delivered.email, poolStatus: delivered.status } : null;
}

// GDPR Art. 14: a recipient whose address we didn't collect from them must
// be told where it came from. Added to every email sent to a pool lead.
export const VERIFIED_LEAD_SOURCE_NOTICE =
  "Your business contact details were sourced by Polimatiq from publicly available professional information. Reply or use the unsubscribe link to opt out and have them removed.";
