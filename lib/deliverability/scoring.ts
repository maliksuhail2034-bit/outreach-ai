import type { HealthScoreFactor } from "@/lib/analytics/types";
import type { WarmupStatus } from "./types";

// Deliverability scoring foundation. Both scorers below combine whatever
// signals are actually available into a 0-100 weighted average, rather than
// a fixed formula that assumes every input exists — see Task 5's plan:
// "For now create the scoring infrastructure and placeholder calculation."
// Signals this codebase doesn't collect yet (mailbox reputation via Google
// Postmaster/Microsoft SNDS, domain reputation, complaint rate) are simply
// optional inputs today; when a future feature starts populating them, it
// passes them in here and the score adjusts automatically — no signature
// change, no refactor of either function. calculateDomainHealthScore also
// returns a HealthScoreFactor[] explainability breakdown (the same shared
// shape lib/campaigns/health-score.ts uses) — calculateMailboxHealthScore
// doesn't yet, since nothing calls it with more than one real signal today.

interface WeightedSignal {
  value: number; // 0-100
  weight: number;
}

function weightedAverage(signals: WeightedSignal[]): number {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0);
  return Math.round(clamp(weightedSum / totalWeight, 0, 100));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 5% bounce rate is a commonly cited hard ceiling for cold email sending —
// used here only as a placeholder cutoff (0 points at 5%+) until a real
// bounce-rate policy exists. 10% reply rate is treated as a strong outcome
// for cold outreach and scored as a full 100. Shared by the mailbox and
// domain scorers below — both measure the same underlying signal (sent
// mail's bounce/reply rate), just aggregated at a different level.
const BOUNCE_RATE_ZERO_POINT = 5;
const REPLY_RATE_FULL_POINT = 10;

export interface DomainHealthScoreInputs {
  spfVerified: boolean;
  dkimVerified: boolean;
  dmarcVerified: boolean;
  mxVerified: boolean;
  // Not populated by anything yet — a future domain-reputation integration
  // (Google Postmaster, a blocklist checker, etc.) will set this. Optional
  // so this function's signature doesn't need to change when it lands; a
  // missing reputation score simply isn't counted yet, and the four DNS
  // checks alone can still reach 100.
  reputationScore?: number | null;
  // Optional — only available once a domain has mailboxes with real sending
  // history (feed lib/deliverability/domain-analytics.ts's overview output
  // directly, the same rates Domain Analytics already computes).
  // Excluded from the average, not counted as a failing 0, until real data
  // exists.
  deliveryRate?: number | null; // percentage 0-100, higher is better
  bounceRate?: number | null; // percentage 0-100, lower is better
  replyRate?: number | null; // percentage 0-100, higher is better
}

export interface DomainHealthScoreResult {
  // Unlike Campaign Health, this is never null — the four DNS signals are
  // always known for any tracked domain, so there's always at least one
  // usable signal.
  score: number;
  factors: HealthScoreFactor[];
}

// "Good"/"warning" callouts use their own, coarser cutoffs than the score
// curve above — two bands, not a sliding scale, so the explanation stays
// legible (see HealthScoreFactor). A value between these bands is real but
// unremarkable and gets no callout. Independent from Campaign Health's own
// bounce/reply/delivery bands (lib/campaigns/health-score.ts) — each entity
// tunes its own bands deliberately, the same convention that file
// documents; delivery-rate bands happen to start at the same 95/90 values
// since a domain's delivered ÷ sent means the same thing end to end.
const DOMAIN_BOUNCE_RATE_GOOD_MAX = 2;
const DOMAIN_BOUNCE_RATE_WARNING_MIN = 5;
const DOMAIN_REPLY_RATE_GOOD_MIN = 5;
const DOMAIN_REPLY_RATE_WARNING_MAX = 1;
const DOMAIN_DELIVERY_RATE_GOOD_MIN = 95;
const DOMAIN_DELIVERY_RATE_WARNING_MAX = 90;

// SPF/DKIM/DMARC/MX are weighted equally today — DNS hygiene is the only
// signal this phase actually collects (see PlaceholderDnsProvider). Once
// reputationScore is available it joins as a fifth equally-weighted signal;
// rebalancing the weights is a future, deliberate decision, not something
// this placeholder tries to anticipate. deliveryRate/bounceRate/replyRate
// join the same way once a domain has real mailbox activity.
export function calculateDomainHealthScore(inputs: DomainHealthScoreInputs): DomainHealthScoreResult {
  const signals: WeightedSignal[] = [
    { value: inputs.spfVerified ? 100 : 0, weight: 1 },
    { value: inputs.dkimVerified ? 100 : 0, weight: 1 },
    { value: inputs.dmarcVerified ? 100 : 0, weight: 1 },
    { value: inputs.mxVerified ? 100 : 0, weight: 1 },
  ];
  const factors: HealthScoreFactor[] = [];

  const dnsPassCount = [inputs.spfVerified, inputs.dkimVerified, inputs.dmarcVerified, inputs.mxVerified].filter(
    Boolean,
  ).length;
  if (dnsPassCount === 4) {
    factors.push({
      key: "dns_health",
      label: "DNS health",
      tone: "good",
      detail: "SPF, DKIM, DMARC, and MX are all verified.",
    });
  } else {
    factors.push({
      key: "dns_health",
      label: "DNS health",
      tone: "warning",
      detail: `${4 - dnsPassCount} of 4 DNS records (SPF/DKIM/DMARC/MX) aren't verified yet.`,
    });
  }

  if (inputs.reputationScore != null) {
    signals.push({ value: clamp(inputs.reputationScore, 0, 100), weight: 1 });
  }

  if (inputs.deliveryRate != null) {
    signals.push({ value: clamp(inputs.deliveryRate, 0, 100), weight: 1 });
    if (inputs.deliveryRate >= DOMAIN_DELIVERY_RATE_GOOD_MIN) {
      factors.push({
        key: "deliverability",
        label: "Deliverability",
        tone: "good",
        detail: `Delivery rate is ${inputs.deliveryRate}%.`,
      });
    } else if (inputs.deliveryRate < DOMAIN_DELIVERY_RATE_WARNING_MAX) {
      factors.push({
        key: "deliverability",
        label: "Deliverability",
        tone: "warning",
        detail: `Delivery rate is ${inputs.deliveryRate}%, lower than typical.`,
      });
    }
  }

  if (inputs.bounceRate != null) {
    signals.push({ value: clamp(100 - (inputs.bounceRate / BOUNCE_RATE_ZERO_POINT) * 100, 0, 100), weight: 1 });
    if (inputs.bounceRate <= DOMAIN_BOUNCE_RATE_GOOD_MAX) {
      factors.push({
        key: "bounce_rate",
        label: "Bounce rate",
        tone: "good",
        detail: `Bounce rate is ${inputs.bounceRate}%, well within a healthy range.`,
      });
    } else if (inputs.bounceRate >= DOMAIN_BOUNCE_RATE_WARNING_MIN) {
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
    if (inputs.replyRate >= DOMAIN_REPLY_RATE_GOOD_MIN) {
      factors.push({
        key: "reply_rate",
        label: "Reply rate",
        tone: "good",
        detail: `Reply rate is ${inputs.replyRate}%, a strong result.`,
      });
    } else if (inputs.replyRate <= DOMAIN_REPLY_RATE_WARNING_MAX) {
      factors.push({
        key: "reply_rate",
        label: "Reply rate",
        tone: "warning",
        detail: `Reply rate is ${inputs.replyRate}%, lower than typical.`,
      });
    }
  }

  return { score: weightedAverage(signals), factors };
}

export interface MailboxHealthScoreInputs {
  warmupStatus: WarmupStatus;
  // None of these three are written by any pipeline yet (no bounce/reply
  // aggregation, no reputation integration) — every field here is optional
  // and simply excluded from the average until something populates it.
  reputationScore?: number | null; // 0-100
  bounceRate?: number | null; // percentage, 0-100, lower is better
  replyRate?: number | null; // percentage, 0-100, higher is better
}

const WARMUP_SIGNAL_VALUE: Record<WarmupStatus, number> = {
  not_started: 0,
  warming: 50,
  warmed: 100,
  paused: 25,
};

export function calculateMailboxHealthScore(inputs: MailboxHealthScoreInputs): number {
  const signals: WeightedSignal[] = [{ value: WARMUP_SIGNAL_VALUE[inputs.warmupStatus], weight: 1 }];

  if (inputs.reputationScore != null) {
    signals.push({ value: clamp(inputs.reputationScore, 0, 100), weight: 1 });
  }
  if (inputs.bounceRate != null) {
    signals.push({ value: clamp(100 - (inputs.bounceRate / BOUNCE_RATE_ZERO_POINT) * 100, 0, 100), weight: 1 });
  }
  if (inputs.replyRate != null) {
    signals.push({ value: clamp((inputs.replyRate / REPLY_RATE_FULL_POINT) * 100, 0, 100), weight: 1 });
  }

  return weightedAverage(signals);
}
