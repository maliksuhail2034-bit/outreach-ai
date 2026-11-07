import { z } from "zod";

import type { Client } from "@/lib/db/shared";

// Reads auth_event_summary() (supabase/migrations/20261112100000_auth_event_summary.sql):
// sign-in outcomes aggregated in SQL over a whole time window, so a large
// password-guessing burst can't push older events out of the counts.
// Service-role client only.

const count = z.coerce.number().int().nonnegative();

const summarySchema = z.object({
  successes: count,
  failures: count,
  rate_limited: count,
  by_ip: z.array(z.object({ ip: z.string(), failures: count, refused: count, country: z.string().nullable() })),
  by_account: z.array(count),
  staff_multi_country: z.array(z.object({ user_id: z.string(), countries: z.array(z.string()) })),
  countries: z.array(z.object({ country: z.string(), successes: count, refused: count })),
});

export type AuthEventSummary = z.infer<typeof summarySchema>;

export const EMPTY_AUTH_SUMMARY: AuthEventSummary = {
  successes: 0,
  failures: 0,
  rate_limited: 0,
  by_ip: [],
  by_account: [],
  staff_multi_country: [],
  countries: [],
};

export async function getAuthEventSummary(supabase: Client, sinceIso: string, listLimit = 50): Promise<AuthEventSummary> {
  const { data, error } = await supabase.rpc("auth_event_summary", { p_since: sinceIso, p_list_limit: listLimit });
  if (error) throw error;
  return summarySchema.parse(data);
}
