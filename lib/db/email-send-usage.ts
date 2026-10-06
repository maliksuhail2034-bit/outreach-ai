import type { Client } from "./shared";

// Plan-limit helper for lib/billing/limits.ts's isWithinMonthlyEmailLimit —
// successful campaign sends recorded for `userId` in the UTC calendar month
// starting at `monthStart` (YYYY-MM-01). email_send_usage is written only by
// a database trigger on send_attempts becoming 'sent' and users can't change
// it, so unlike the old count over email_events, deleting campaigns or
// events can't reset it (supabase/migrations/20261002100000_plan_limit_enforcement.sql).
// Filters by user_id explicitly because the send worker calls this with the
// admin client, where RLS doesn't scope it.
export async function getMonthlySentEmailCount(supabase: Client, userId: string, monthStart: string): Promise<number> {
  const { data, error } = await supabase
    .from("email_send_usage")
    .select("sent_count")
    .eq("user_id", userId)
    .eq("month", monthStart)
    .maybeSingle();
  if (error) throw error;
  return data?.sent_count ?? 0;
}
