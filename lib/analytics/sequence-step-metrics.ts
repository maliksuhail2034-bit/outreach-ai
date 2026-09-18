import type { FunnelStage } from "@/components/dashboard/funnel-card";
import { identifyBiggestDropOff, type FunnelDropOff } from "./funnel";
import { rate } from "./metrics";

// Per-sequence-step analytics, built entirely on data already fetched by
// the campaign analytics page (send_attempts + email_events) — no new
// query. send_attempts has sequence_step_id directly, so "sent per step"
// needs no correlation. email_events does NOT have a sequence_step_id
// column, so per-step attribution for 'replied' vs. 'opened'/'clicked'
// uses two different mechanisms:
//
//   - 'replied': the provider_message_id chain
//     record_send_success/reply-worker.ts already establish —
//     send_attempts.provider_message_id (per step, set on send)
//       === email_events 'sent'.provider_message_id (same value, same insert)
//       === a 'replied' event's metadata.inReplyTo / metadata.references
//           (the outbound message id the reply-worker matched against —
//           see lib/email/reply-worker.ts's matchReply)
//     A reply matched via the "address-fallback" path (see reply-worker.ts)
//     has no such reference, or one that doesn't resolve to a step this
//     campaign actually sent — those replies are real but simply can't be
//     attributed to a specific step, so they're excluded rather than guessed.
//
//   - 'opened'/'clicked' (Batch 9C): attributed directly via
//     metadata.sequenceStepId, which app/api/track/open/[token]/route.ts
//     and app/api/track/click/[token]/route.ts both already write on every
//     recorded event (see lib/email/tracking-token.ts's
//     OpenTrackingContext/ClickTrackingContext) — no header-chain
//     correlation needed, unlike replies, since the tracking token embeds
//     the step id directly at send time. An event whose metadata is
//     missing, malformed, or names a step id that isn't part of this
//     sequence is excluded rather than guessed, same policy as the
//     reply-matching fallback above.

export interface SequenceStepMetricsInput {
  stepId: string;
  order: number; // 1-based position in the sequence, for "Step N" labeling
  label: string;
}

// Structurally compatible with Tables<"send_attempts">/Tables<"email_events">
// — the campaign analytics page can pass its already-fetched arrays
// straight in, no remapping.
export interface SendAttemptForStep {
  sequence_step_id: string;
  status: string;
  provider_message_id: string | null;
}

export interface EmailEventForAttribution {
  event_type: string;
  metadata: unknown;
}

export interface SequenceStepSummary {
  stepId: string;
  order: number;
  label: string;
  sentCount: number;
  repliedCount: number;
  replyRate: number | null;
  // deliveryRate/positiveReplyRate are always null today, not a fabricated
  // 0% — 'delivered' has no producer anywhere in the codebase (same
  // limitation as lib/analytics/funnel.ts's UNTRACKED_STAGE_KEYS), and
  // positive_reply has no producer either (analytics_events has zero
  // writers — see lib/db/analytics.ts's insertAnalyticsEvent, never
  // called). openRate/clickRate ARE computed from real data as of Batch
  // 9C — see summarizeSequenceSteps below. Kept as explicit fields, not
  // omitted, so a future producer only needs to populate the count this
  // module reads from — nothing else here changes.
  deliveryRate: number | null;
  openRate: number | null; // opened / sent, this step only
  clickRate: number | null; // clicked / sent, this step only
  positiveReplyRate: number | null;
}

function extractReferencedMessageIds(metadata: unknown): string[] {
  if (typeof metadata !== "object" || metadata === null) return [];
  const record = metadata as Record<string, unknown>;
  const ids: string[] = [];

  if (typeof record.inReplyTo === "string") ids.push(record.inReplyTo);
  if (Array.isArray(record.references)) {
    for (const ref of record.references) {
      if (typeof ref === "string") ids.push(ref);
    }
  }

  return ids;
}

// Batch 9C: 'opened'/'clicked' events carry their sequence step id directly
// in metadata.sequenceStepId (see the module comment above) — no
// correlation needed, just safe extraction. Returns null (never throws) for
// missing metadata, a non-object metadata value, or a non-string/empty
// sequenceStepId — all treated as "can't attribute this event," the same
// policy extractReferencedMessageIds's callers already apply to replies.
function extractSequenceStepId(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const record = metadata as Record<string, unknown>;
  return typeof record.sequenceStepId === "string" && record.sequenceStepId.length > 0
    ? record.sequenceStepId
    : null;
}

export function summarizeSequenceSteps(
  steps: SequenceStepMetricsInput[],
  sendAttempts: SendAttemptForStep[],
  emailEvents: EmailEventForAttribution[],
): SequenceStepSummary[] {
  const stepByProviderMessageId = new Map<string, string>();
  const sentCountByStep = new Map<string, number>();

  for (const attempt of sendAttempts) {
    if (attempt.status !== "sent") continue;
    sentCountByStep.set(attempt.sequence_step_id, (sentCountByStep.get(attempt.sequence_step_id) ?? 0) + 1);
    if (attempt.provider_message_id) {
      stepByProviderMessageId.set(attempt.provider_message_id, attempt.sequence_step_id);
    }
  }

  // Only a step actually in this sequence is a valid attribution target —
  // a well-formed sequenceStepId that doesn't match any of them (a step
  // since deleted, or data from a different sequence entirely) is excluded
  // rather than guessed, same policy the reply-matching fallback above
  // uses for an unresolvable provider_message_id.
  const knownStepIds = new Set(steps.map((step) => step.stepId));

  const repliedCountByStep = new Map<string, number>();
  const openedCountByStep = new Map<string, number>();
  const clickedCountByStep = new Map<string, number>();

  for (const event of emailEvents) {
    if (event.event_type === "replied") {
      const referencedIds = extractReferencedMessageIds(event.metadata);
      const stepId = referencedIds.map((id) => stepByProviderMessageId.get(id)).find((id) => id !== undefined);
      if (!stepId) continue; // address-fallback match, or otherwise unattributable to a specific step

      repliedCountByStep.set(stepId, (repliedCountByStep.get(stepId) ?? 0) + 1);
      continue;
    }

    if (event.event_type === "opened" || event.event_type === "clicked") {
      const stepId = extractSequenceStepId(event.metadata);
      if (!stepId || !knownStepIds.has(stepId)) continue; // missing, malformed, or not a step in this sequence

      const countsByStep = event.event_type === "opened" ? openedCountByStep : clickedCountByStep;
      countsByStep.set(stepId, (countsByStep.get(stepId) ?? 0) + 1);
    }
  }

  return steps.map((step) => {
    const sentCount = sentCountByStep.get(step.stepId) ?? 0;
    const repliedCount = repliedCountByStep.get(step.stepId) ?? 0;
    const openedCount = openedCountByStep.get(step.stepId) ?? 0;
    const clickedCount = clickedCountByStep.get(step.stepId) ?? 0;

    return {
      stepId: step.stepId,
      order: step.order,
      label: step.label,
      sentCount,
      repliedCount,
      replyRate: rate(repliedCount, sentCount),
      deliveryRate: null,
      openRate: rate(openedCount, sentCount),
      clickRate: rate(clickedCount, sentCount),
      positiveReplyRate: null,
    };
  });
}

// "Best"/"weakest" are reply-rate comparisons — the only per-step metric
// backed by real data today (see SequenceStepSummary above). A step with
// no sends yet (replyRate null) is excluded from both rather than treated
// as a 0% floor or ceiling.
export function identifyBestStep(summaries: SequenceStepSummary[]): SequenceStepSummary | null {
  const withReplyRate = summaries.filter(
    (summary): summary is SequenceStepSummary & { replyRate: number } => summary.replyRate !== null,
  );
  if (withReplyRate.length === 0) return null;
  return withReplyRate.reduce((best, current) => (current.replyRate > best.replyRate ? current : best));
}

export function identifyWeakestStep(summaries: SequenceStepSummary[]): SequenceStepSummary | null {
  const withReplyRate = summaries.filter(
    (summary): summary is SequenceStepSummary & { replyRate: number } => summary.replyRate !== null,
  );
  if (withReplyRate.length === 0) return null;
  return withReplyRate.reduce((weakest, current) => (current.replyRate < weakest.replyRate ? current : weakest));
}

// Step-to-step attrition (how many leads who received step N never
// received step N+1) is the exact same shape as a funnel drop-off, so this
// reuses lib/analytics/funnel.ts's identifyBiggestDropOff directly instead
// of a second drop-off algorithm — sentCount-per-step, in step order,
// stands in for FunnelStage.value.
export function identifyBiggestStepDropOff(summaries: SequenceStepSummary[]): FunnelDropOff | null {
  const stages: FunnelStage[] = summaries
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((summary) => ({ key: summary.stepId, label: summary.label, value: summary.sentCount }));

  return identifyBiggestDropOff(stages);
}
