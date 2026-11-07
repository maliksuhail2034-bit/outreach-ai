import type { Json } from "@/types/database.types";
import type { Client } from "@/lib/db/shared";
import { getSendAttempt, hasHumanOpenForStep, recordEmailEvent } from "@/lib/db";
import { classifyEngagement, type EngagementKind } from "./engagement-classifier";

export interface EngagementContext {
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  mailboxId: string | null;
  sequenceStepId: string | null;
}

// Records an open or click from a tracking request, classified as a person
// or a bot (lib/email/engagement-classifier.ts). A person's click on a step
// with no recorded open means the client blocked images, so the open is
// recorded too (marked inferred) — otherwise "didn't open" conditions and
// open rates would count people who demonstrably read the email.
export async function recordEngagement(
  supabase: Client,
  kind: EngagementKind,
  context: EngagementContext,
  userAgent: string | null,
  metadata: Record<string, Json> = {},
  now: Date = new Date(),
): Promise<{ isBot: boolean }> {
  // A failed lookup only loses the timing rule, never the event.
  const attempt = context.sequenceStepId
    ? await getSendAttempt(supabase, context.campaignLeadId, context.sequenceStepId).catch(() => null)
    : null;
  const sentAt = attempt?.status === "sent" && attempt.resolved_at ? new Date(attempt.resolved_at) : null;
  const { isBot, reason } = classifyEngagement({ kind, userAgent, sentAt, now });

  await recordEmailEvent(supabase, {
    campaign_id: context.campaignId,
    lead_id: context.leadId,
    mailbox_id: context.mailboxId,
    event_type: kind,
    is_bot: isBot,
    metadata: { sequenceStepId: context.sequenceStepId, ...metadata, ...(reason ? { botReason: reason } : {}) },
  });

  if (kind === "clicked" && !isBot && context.sequenceStepId) {
    const opened = await hasHumanOpenForStep(supabase, context.campaignId, context.leadId, context.sequenceStepId);
    if (!opened) {
      await recordEmailEvent(supabase, {
        campaign_id: context.campaignId,
        lead_id: context.leadId,
        mailbox_id: context.mailboxId,
        event_type: "opened",
        is_bot: false,
        metadata: { sequenceStepId: context.sequenceStepId, inferredFromClick: true },
      });
    }
  }

  return { isBot };
}
