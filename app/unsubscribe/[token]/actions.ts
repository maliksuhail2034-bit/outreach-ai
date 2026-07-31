"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { processUnsubscribe, type UnsubscribeResult } from "@/lib/email/unsubscribe";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

// Thin wrapper: verify the token, then hand off to the actual business
// logic in lib/email/unsubscribe.ts. Runs on the admin client — the
// visitor clicking this link has no session, this is the same
// "privileged, no user in the loop" carve-out as the sending/reply
// workers (see CLAUDE.md).
export async function confirmUnsubscribeAction(token: string): Promise<UnsubscribeResult> {
  const campaignLeadId = verifyUnsubscribeToken(token);
  if (!campaignLeadId) {
    return { ok: false, error: "This unsubscribe link is invalid." };
  }

  const supabase = createAdminClient();
  return processUnsubscribe(supabase, campaignLeadId);
}
