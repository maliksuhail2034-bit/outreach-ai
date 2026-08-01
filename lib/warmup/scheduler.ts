import type { WarmupStage } from "./types";

// Pure scheduling math — decides what a warmup profile's daily volume
// should ramp to next, and when. No I/O and no actual sending: this phase
// only uses these functions to show a forecast on the Warmup Dashboard.
// A future scheduler (see ../queue.ts) is what would call this on a timer
// and actually persist the result and send warmup email — nothing here
// does either.

export interface WarmupRampInput {
  stage: WarmupStage;
  targetDailyVolume: number;
  currentDailyVolume: number;
  rampUpPercent: number; // e.g. 20 = +20% of current volume per increase
  lastActivityAt: string | null; // ISO
}

export interface WarmupRampForecast {
  // The volume the next scheduled increase would move to, capped at the
  // profile's target. Null when there's nothing left to ramp (disabled,
  // paused, healthy, or already at target).
  nextVolume: number | null;
  // When that increase would run. Null under the same conditions as
  // nextVolume.
  nextIncreaseAt: string | null;
}

const RAMPING_STAGES = new Set<WarmupStage>(["starting", "warming", "cooling"]);
const MINIMUM_STARTING_VOLUME = 5;

// "Daily scheduling" per Task 6's scope — ramp increases are computed one
// calendar day apart. Hourly scheduling is a documented future refinement
// this same shape supports: a caller passing a shorter interval here (or a
// second constant) doesn't change forecastNextRamp's contract at all.
const RAMP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function forecastNextRamp(input: WarmupRampInput, now: Date = new Date()): WarmupRampForecast {
  if (!RAMPING_STAGES.has(input.stage) || input.currentDailyVolume >= input.targetDailyVolume) {
    return { nextVolume: null, nextIncreaseAt: null };
  }

  const increment = Math.max(1, Math.round(input.currentDailyVolume * (input.rampUpPercent / 100)));
  const nextVolume =
    input.currentDailyVolume === 0
      ? Math.min(input.targetDailyVolume, Math.max(MINIMUM_STARTING_VOLUME, increment))
      : Math.min(input.targetDailyVolume, input.currentDailyVolume + increment);

  const lastRun = input.lastActivityAt ? new Date(input.lastActivityAt) : now;
  const nextIncreaseAt = new Date(lastRun.getTime() + RAMP_INTERVAL_MS);

  return { nextVolume, nextIncreaseAt: nextIncreaseAt.toISOString() };
}

// Whole calendar days since a profile first started warming. 0 for a
// profile that hasn't started (startedAt null) — not fractional, since
// "Days warming" is meant to read as a simple counter on the dashboard.
export function daysWarming(startedAt: string | null, now: Date = new Date()): number {
  if (!startedAt) return 0;
  const diffMs = now.getTime() - new Date(startedAt).getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}
