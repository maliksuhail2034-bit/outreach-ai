import { createAdminClient } from "@/lib/supabase/admin";
import type { Client, MailboxSafe } from "@/lib/db";
import {
  getMailboxHealthByMailboxId,
  getWarmupProfileByMailboxId,
  listActiveMailboxesForHealthCheck,
  upsertMailboxHealth,
} from "@/lib/db";
import { calculateMailboxHealthScore } from "./scoring";
import { STAGE_TO_DELIVERABILITY_STATUS } from "./warmup-status";
import type { WarmupStage } from "@/lib/warmup/types";
import type { WarmupStatus } from "./types";
import { captureError } from "@/lib/monitoring/error-tracking";

export interface DeliverabilityHealthCheckSummary {
  checked: number;
  updated: number;
  failed: number;
}

// Orchestration only, mirrors lib/email/reply-worker.ts's shape: this file
// contains no scoring logic of its own, only the same recompute
// recalculateMailboxHealthAction (settings/deliverability/actions.ts)
// already does for one mailbox at a time — calculateMailboxHealthScore for
// the math, STAGE_TO_DELIVERABILITY_STATUS for the warmup bridge — applied
// across every active mailbox instead of a single user-triggered one.
//
// Domain-side automation is deliberately out of scope here — see the
// roadmap note: no real DNS provider/integration exists yet for domain
// verification to produce meaningful automated results.
export async function runDeliverabilityHealthCheckWorker(): Promise<DeliverabilityHealthCheckSummary> {
  const supabase = createAdminClient();
  const summary: DeliverabilityHealthCheckSummary = { checked: 0, updated: 0, failed: 0 };

  const mailboxes = await listActiveMailboxesForHealthCheck(supabase);

  for (const mailbox of mailboxes) {
    summary.checked += 1;

    try {
      await recalculateMailboxHealth(supabase, mailbox);
      summary.updated += 1;
    } catch (error) {
      // One mailbox's failure (a transient DB error, a malformed row) must
      // not stop the rest of the run — same failure-isolation shape as
      // runReplySyncWorker's per-mailbox loop.
      summary.failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error.";
      console.error("[deliverability-health-check-worker]", { mailboxId: mailbox.id, error: message });
      await captureError({ job: "deliverability-health-check", message, context: { mailboxId: mailbox.id } });
    }
  }

  return summary;
}

async function recalculateMailboxHealth(supabase: Client, mailbox: MailboxSafe): Promise<void> {
  const [warmupProfile, existing] = await Promise.all([
    getWarmupProfileByMailboxId(supabase, mailbox.id),
    getMailboxHealthByMailboxId(supabase, mailbox.id),
  ]);

  const warmupStatus: WarmupStatus = warmupProfile
    ? STAGE_TO_DELIVERABILITY_STATUS[warmupProfile.stage as WarmupStage]
    : ((existing?.warmup_status ?? "not_started") as WarmupStatus);

  const healthScore = calculateMailboxHealthScore({
    warmupStatus,
    reputationScore: existing?.reputation_score ?? null,
    bounceRate: existing?.bounce_rate ?? null,
    replyRate: existing?.reply_rate ?? null,
  });

  await upsertMailboxHealth(supabase, {
    mailbox_id: mailbox.id,
    user_id: mailbox.user_id,
    warmup_status: warmupStatus,
    reputation_score: existing?.reputation_score ?? null,
    bounce_rate: existing?.bounce_rate ?? null,
    reply_rate: existing?.reply_rate ?? null,
    health_score: healthScore,
    last_calculated_at: new Date().toISOString(),
  });
}
