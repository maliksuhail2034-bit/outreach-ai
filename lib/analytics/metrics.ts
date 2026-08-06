// Reusable metric calculators — small, composable, pure functions over
// plain numbers/arrays. A future metric (Revenue Analytics, Cohorts, A/B
// Testing) is a new function added here, never an edit to an existing one:
// nothing in this file branches on which metric is being computed, so
// there's no shared switch/dispatch for a new case to slot into (or
// accidentally break).

export function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

// One-decimal percentage. Null (not 0 or NaN) when the denominator is 0 —
// "no rate" is a distinct answer from "a rate of zero," and callers
// (dashboard cards) are expected to render null as "—", not "0%".
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// Trailing average over the last `windowSize` values, one output per input
// index (fewer than windowSize values available at the start just average
// what exists) — the shape a "7-day rolling average" line needs.
export function rollingAverage(values: number[], windowSize: number): number[] {
  if (windowSize <= 0) throw new Error("windowSize must be at least 1.");
  return values.map((_, index) => {
    const windowStart = Math.max(0, index - windowSize + 1);
    const window = values.slice(windowStart, index + 1);
    return total(window) / window.length;
  });
}

// Counts items by a derived key — the general shape "group by event type,"
// "group by mailbox," etc. all reduce to.
export function groupCounts<T>(items: T[], keyOf: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// Sums a numeric field by a derived key — what summing pre-aggregated rows
// (e.g. analytics_daily_rollups: one row per day per event_type, not one
// row per event) needs, as opposed to groupCounts' "count raw items by
// key." Scalability Track, Phase D.
export function sumByKey<T>(items: T[], keyOf: (item: T) => string, valueOf: (item: T) => number): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    sums[key] = (sums[key] ?? 0) + valueOf(item);
  }
  return sums;
}
