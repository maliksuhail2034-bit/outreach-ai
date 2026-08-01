import { calculateTrend, type TrendResult } from "./trends";

// Applies calculateTrend across a whole named set of metrics at once — the
// data a Comparison Card needs (this period vs. last period, for every
// metric on a dashboard) without each caller re-deriving a trend one
// metric at a time. A metric present in `current` but missing from
// `previous` is compared against 0, the same "never happened before"
// baseline calculateTrend already handles.
export function compareMetrics(
  current: Record<string, number>,
  previous: Record<string, number>,
): Record<string, TrendResult> {
  const result: Record<string, TrendResult> = {};
  for (const key of Object.keys(current)) {
    result[key] = calculateTrend(current[key], previous[key] ?? 0);
  }
  return result;
}
