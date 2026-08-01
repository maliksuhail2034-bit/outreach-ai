import type { FunnelDropOff } from "@/lib/analytics/funnel";
import type { TrendResult } from "@/lib/analytics/trends";

// Campaign health scoring — mirrors lib/deliverability/scoring.ts's shape
// exactly: combine whatever signals are actually available into a 0-100
// weighted average, rather than a fixed formula that assumes every input
// exists. A signal this codebase doesn't collect yet (delivery rate,
// positive-reply rate, meeting rate — see the field comments below) is
// simply an optional input today; when a future feature starts populating
// it, it passes it in here and the score adjusts automatically — no
// signature change, no refactor.
//
// One deliberate departure from scoring.ts: every signal here is optional
// (deliverability's mailbox score always has warmupStatus as a guaranteed
// baseline signal; a campaign has no equivalent — a brand-new campaign
// with zero sends genuinely has nothing to score yet). weightedAverage()
// therefore returns null, not 0, when there isn't a single usable signal —
// an honest "not enough data," never a fabricated failing score.

interface WeightedSignal {
  value: number; // 0-100
  weight: number;
}

function weightedAverage(signals: WeightedSignal[]): number | null {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (totalWeight === 0) return null;
  const weightedSum = signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0);
  return Math.round(clamp(weightedSum / totalWeight, 0, 100));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Same industry-cited cutoffs lib/deliverability/scoring.ts uses for a
// mailbox's bounce/reply rate, applied here at the campaign level — kept as
// separate constants (not imported) since a campaign's healthy range is a
// deliberately independent tuning decision from a single mailbox's, even
// though they start at the same values.
const BOUNCE_RATE_ZERO_POINT = 5; // 5%+ bounce rate scores 0 on this signal
const REPLY_RATE_FULL_POINT = 10; // 10%+ reply rate scores 100 on this signal
const POSITIVE_REPLY_RATE_FULL_POINT = 5; // 5%+ positive-reply rate scores 100
const MEETING_RATE_FULL_POINT = 2; // meetings are rarer than replies; 2%+ scores 100

// "Good"/"warning" callouts use their own, coarser cutoffs than the score
// curve above — two bands, not a sliding scale, so the explanation stays
// legible (see CampaignHealthFactor). A value between these bands is real
// but unremarkable and gets no callout, same as PercentageCard showing a
// plain number instead of manufacturing commentary for a middling rate.
const BOUNCE_RATE_GOOD_MAX = 2;
const BOUNCE_RATE_WARNING_MIN = 5;
const REPLY_RATE_GOOD_MIN = 5;
const REPLY_RATE_WARNING_MAX = 1;
const DELIVERY_RATE_GOOD_MIN = 95;
const DELIVERY_RATE_WARNING_MAX = 90;
const STEP_DROP_OFF_WARNING_MIN = 50;

const TREND_DIRECTION_VALUE: Record<TrendResult["direction"], number> = {
  up: 100,
  stable: 60,
  down: 20,
};

export interface CampaignHealthScoreInputs {
  bounceRate?: number | null; // percentage 0-100, lower is better
  replyRate?: number | null; // percentage 0-100, higher is better
  // Optional — no producer writes a 'delivered' email_event anywhere in the
  // codebase today (see lib/analytics/funnel.ts's UNTRACKED_STAGE_KEYS for
  // the same limitation at the funnel level).
  deliveryRate?: number | null;
  // Optional — analytics_events has zero writers anywhere (see
  // lib/db/analytics.ts's insertAnalyticsEvent, never called), so
  // positive_reply/meeting_booked counts are always 0 today, not a real
  // signal — pass null/omit until a producer exists.
  positiveReplyRate?: number | null;
  meetingRate?: number | null;
  // Optional — feed lib/analytics/trends.ts's calculateTrend() output
  // directly (e.g. replies this period vs. the previous one).
  engagementTrend?: TrendResult | null;
  // Optional — feed lib/analytics/sequence-step-metrics.ts's
  // identifyBiggestStepDropOff() output directly.
  biggestStepDropOff?: FunnelDropOff | null;
}

export interface CampaignHealthFactor {
  key: string;
  label: string;
  tone: "good" | "warning";
  detail: string;
}

export interface CampaignHealthScoreResult {
  // Null when there isn't a single usable signal yet — see the module
  // comment above for why this differs from scoring.ts's plain number.
  score: number | null;
  factors: CampaignHealthFactor[];
}

export function calculateCampaignHealthScore(inputs: CampaignHealthScoreInputs): CampaignHealthScoreResult {
  const signals: WeightedSignal[] = [];
  const factors: CampaignHealthFactor[] = [];

  if (inputs.bounceRate != null) {
    signals.push({ value: clamp(100 - (inputs.bounceRate / BOUNCE_RATE_ZERO_POINT) * 100, 0, 100), weight: 1 });
    if (inputs.bounceRate <= BOUNCE_RATE_GOOD_MAX) {
      factors.push({
        key: "bounce_rate",
        label: "Bounce rate",
        tone: "good",
        detail: `Bounce rate is ${inputs.bounceRate}%, well within a healthy range.`,
      });
    } else if (inputs.bounceRate >= BOUNCE_RATE_WARNING_MIN) {
      factors.push({
        key: "bounce_rate",
        label: "Bounce rate",
        tone: "warning",
        detail: `Bounce rate is ${inputs.bounceRate}%, higher than a healthy range.`,
      });
    }
  }

  if (inputs.replyRate != null) {
    signals.push({ value: clamp((inputs.replyRate / REPLY_RATE_FULL_POINT) * 100, 0, 100), weight: 1 });
    if (inputs.replyRate >= REPLY_RATE_GOOD_MIN) {
      factors.push({
        key: "reply_rate",
        label: "Reply rate",
        tone: "good",
        detail: `Reply rate is ${inputs.replyRate}%, a strong result.`,
      });
    } else if (inputs.replyRate <= REPLY_RATE_WARNING_MAX) {
      factors.push({
        key: "reply_rate",
        label: "Reply rate",
        tone: "warning",
        detail: `Reply rate is ${inputs.replyRate}%, lower than typical.`,
      });
    }
  }

  if (inputs.deliveryRate != null) {
    signals.push({ value: clamp(inputs.deliveryRate, 0, 100), weight: 1 });
    if (inputs.deliveryRate >= DELIVERY_RATE_GOOD_MIN) {
      factors.push({
        key: "delivery_rate",
        label: "Delivery rate",
        tone: "good",
        detail: `Delivery rate is ${inputs.deliveryRate}%.`,
      });
    } else if (inputs.deliveryRate < DELIVERY_RATE_WARNING_MAX) {
      factors.push({
        key: "delivery_rate",
        label: "Delivery rate",
        tone: "warning",
        detail: `Delivery rate is ${inputs.deliveryRate}%, lower than typical.`,
      });
    }
  }

  if (inputs.positiveReplyRate != null) {
    signals.push({
      value: clamp((inputs.positiveReplyRate / POSITIVE_REPLY_RATE_FULL_POINT) * 100, 0, 100),
      weight: 1,
    });
    if (inputs.positiveReplyRate >= POSITIVE_REPLY_RATE_FULL_POINT) {
      factors.push({
        key: "positive_reply_rate",
        label: "Positive replies",
        tone: "good",
        detail: `Positive reply rate is ${inputs.positiveReplyRate}%.`,
      });
    }
  }

  if (inputs.meetingRate != null) {
    signals.push({ value: clamp((inputs.meetingRate / MEETING_RATE_FULL_POINT) * 100, 0, 100), weight: 1 });
    if (inputs.meetingRate >= MEETING_RATE_FULL_POINT) {
      factors.push({
        key: "meeting_rate",
        label: "Meetings booked",
        tone: "good",
        detail: `Meeting rate is ${inputs.meetingRate}%.`,
      });
    }
  }

  if (inputs.engagementTrend) {
    signals.push({ value: TREND_DIRECTION_VALUE[inputs.engagementTrend.direction], weight: 1 });
    if (inputs.engagementTrend.direction === "up") {
      factors.push({
        key: "engagement_trend",
        label: "Engagement trend",
        tone: "good",
        detail: "Engagement is trending up vs. the previous period.",
      });
    } else if (inputs.engagementTrend.direction === "down") {
      factors.push({
        key: "engagement_trend",
        label: "Engagement trend",
        tone: "warning",
        detail: "Engagement is trending down vs. the previous period.",
      });
    }
  }

  if (inputs.biggestStepDropOff?.dropOffPercent != null) {
    const { dropOffPercent, toLabel, fromLabel } = inputs.biggestStepDropOff;
    signals.push({ value: clamp(100 - dropOffPercent, 0, 100), weight: 1 });
    if (dropOffPercent >= STEP_DROP_OFF_WARNING_MIN) {
      factors.push({
        key: "step_drop_off",
        label: "Sequence drop-off",
        tone: "warning",
        detail: `${toLabel} is underperforming — ${dropOffPercent}% fewer leads reached it than ${fromLabel}.`,
      });
    }
  }

  return { score: weightedAverage(signals), factors };
}
