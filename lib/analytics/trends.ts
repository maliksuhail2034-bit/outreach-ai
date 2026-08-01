import type { TrendDirection } from "./types";

export interface TrendResult {
  direction: TrendDirection;
  // One-decimal percentage change from previous to current. Null when
  // previous is 0 — "up from zero" has no meaningful percentage (it's
  // either infinite or undefined depending on convention), so this is left
  // unrepresented rather than reported as a made-up number like 100%.
  percentageChange: number | null;
}

// Within this band either side of 0%, a change reads as noise rather than
// a real trend — e.g. going from 100 to 100.5 shouldn't render as "up."
const STABLE_THRESHOLD_PERCENT = 1;

// The single place that turns two numbers (this period, last period) into
// a direction + magnitude — every trend/comparison card in the dashboard
// framework reads from this, so "what counts as up vs stable" is decided
// once.
export function calculateTrend(current: number, previous: number): TrendResult {
  if (previous === 0) {
    return { direction: current === 0 ? "stable" : "up", percentageChange: null };
  }

  const percentageChange = Math.round(((current - previous) / previous) * 1000) / 10;
  if (Math.abs(percentageChange) < STABLE_THRESHOLD_PERCENT) {
    return { direction: "stable", percentageChange };
  }
  return { direction: percentageChange > 0 ? "up" : "down", percentageChange };
}
