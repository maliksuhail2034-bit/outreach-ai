import type { WarmupStage } from "./types";

// Warmup scoring foundation — combines whatever signals are actually
// available into a 0-100 weighted average, the same approach
// lib/deliverability/scoring.ts uses (small duplicated helper below rather
// than a shared import, so this module has no dependency on Deliverability
// internals). reply/bounce/spam rate come from warmup_stats, which nothing
// writes yet (see the migration) — they're optional inputs today so this
// function's signature doesn't change once a stats worker exists.

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

export interface WarmupScoreInputs {
  stage: WarmupStage;
  targetDailyVolume: number;
  currentDailyVolume: number;
  // None of these three are written by any pipeline yet — warmup_stats has
  // no rows until a future stats-aggregation worker exists. Each is simply
  // excluded from the average until populated.
  replyRate?: number | null; // percentage, 0-100, higher is better
  bounceRate?: number | null; // percentage, 0-100, lower is better
  spamRate?: number | null; // percentage, 0-100, lower is better
}

// How far along the state machine a stage represents, on its own — used
// alongside volume progress below. 'healthy' is full marks; 'cooling'
// (backing off after a problem) and 'paused' score lower than mid-ramp
// stages on purpose.
const STAGE_SIGNAL_VALUE: Record<WarmupStage, number> = {
  disabled: 0,
  starting: 20,
  warming: 60,
  healthy: 100,
  cooling: 70,
  paused: 40,
};

// Placeholder cutoffs, same reasoning as lib/deliverability/scoring.ts's
// BOUNCE_RATE_ZERO_POINT: 5% bounce is a commonly cited hard ceiling for
// cold email, 1% spam-complaint rate is a commonly cited hard ceiling, and
// 10% reply rate is treated as a strong outcome worth full marks.
const BOUNCE_RATE_ZERO_POINT = 5;
const SPAM_RATE_ZERO_POINT = 1;
const REPLY_RATE_FULL_POINT = 10;

export function calculateWarmupScore(inputs: WarmupScoreInputs): number {
  const volumeProgress =
    inputs.targetDailyVolume > 0 ? clamp((inputs.currentDailyVolume / inputs.targetDailyVolume) * 100, 0, 100) : 0;

  const signals: WeightedSignal[] = [
    { value: STAGE_SIGNAL_VALUE[inputs.stage], weight: 1 },
    { value: volumeProgress, weight: 1 },
  ];

  if (inputs.bounceRate != null) {
    signals.push({ value: clamp(100 - (inputs.bounceRate / BOUNCE_RATE_ZERO_POINT) * 100, 0, 100), weight: 1 });
  }
  if (inputs.spamRate != null) {
    signals.push({ value: clamp(100 - (inputs.spamRate / SPAM_RATE_ZERO_POINT) * 100, 0, 100), weight: 1 });
  }
  if (inputs.replyRate != null) {
    signals.push({ value: clamp((inputs.replyRate / REPLY_RATE_FULL_POINT) * 100, 0, 100), weight: 1 });
  }

  return weightedAverage(signals);
}
