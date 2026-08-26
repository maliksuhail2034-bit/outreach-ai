import type { SendingWindow } from "@/lib/validations/sending-window";
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

// Randomized spacing (in minutes) until this mailbox should next initiate a
// fresh warmup conversation — used by lib/warmup/warmup-worker.ts to set
// warmup_profiles.next_send_at. Perfectly even intervals are themselves a
// spam signal, so this derives an average spacing from `dailyVolume` spread
// across the sending window's active hours, then jitters around it, rather
// than returning a fixed cadence. The caller is responsible for snapping the
// result into realistic hours via lib/email/scheduling.ts's
// computeNextSendTime()/resolveSendingWindow() — this function only does the
// randomization, not calendar/timezone math.
const MIN_DELAY_MINUTES = 20;
const MAX_DELAY_MINUTES = 240;
const JITTER_RATIO = 0.4; // +/- 40% around the average spacing

export function randomizedNextSendDelayMinutes(
  dailyVolume: number,
  window: Pick<SendingWindow, "startHour" | "endHour">,
): number {
  const windowMinutesPerDay = Math.max(1, window.endHour - window.startHour) * 60;
  const averageSpacing = dailyVolume > 0 ? windowMinutesPerDay / dailyVolume : windowMinutesPerDay;
  const jitter = averageSpacing * JITTER_RATIO * (Math.random() * 2 - 1);
  const spacing = Math.round(averageSpacing + jitter);
  return Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, spacing));
}
