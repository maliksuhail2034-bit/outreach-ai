import type { WarmupStatus } from "./types";

// Deliverability scoring foundation. Both scorers below combine whatever
// signals are actually available into a 0-100 weighted average, rather than
// a fixed formula that assumes every input exists — see Task 5's plan:
// "For now create the scoring infrastructure and placeholder calculation."
// Signals this codebase doesn't collect yet (mailbox reputation via Google
// Postmaster/Microsoft SNDS, domain reputation, complaint rate) are simply
// optional inputs today; when a future feature starts populating them, it
// passes them in here and the score adjusts automatically — no signature
// change, no refactor of either function.

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
}

// SPF/DKIM/DMARC/MX are weighted equally today — DNS hygiene is the only
// signal this phase actually collects (see PlaceholderDnsProvider). Once
// reputationScore is available it joins as a fifth equally-weighted signal;
// rebalancing the weights is a future, deliberate decision, not something
// this placeholder tries to anticipate.
export function calculateDomainHealthScore(inputs: DomainHealthScoreInputs): number {
  const signals: WeightedSignal[] = [
    { value: inputs.spfVerified ? 100 : 0, weight: 1 },
    { value: inputs.dkimVerified ? 100 : 0, weight: 1 },
    { value: inputs.dmarcVerified ? 100 : 0, weight: 1 },
    { value: inputs.mxVerified ? 100 : 0, weight: 1 },
  ];
  if (inputs.reputationScore != null) {
    signals.push({ value: clamp(inputs.reputationScore, 0, 100), weight: 1 });
  }
  return weightedAverage(signals);
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

// 5% bounce rate is a commonly cited hard ceiling for cold email sending —
// used here only as a placeholder cutoff (0 points at 5%+) until a real
// bounce-rate policy exists. 10% reply rate is treated as a strong outcome
// for cold outreach and scored as a full 100.
const BOUNCE_RATE_ZERO_POINT = 5;
const REPLY_RATE_FULL_POINT = 10;

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
