import { compareMetrics } from "./comparisons";
import type { TrendResult } from "./trends";

// A snapshot freezes a named set of metric values for one date — see
// analytics_snapshots. Nothing populates real snapshots yet (that's a
// future scheduled job; see lib/db/analytics.ts's insertSnapshot), so this
// module is intentionally small: the shape a future job writes, and how a
// comparison view reads two of them.
export type SnapshotMetrics = Record<string, number>;

// Compares two point-in-time snapshots (e.g. this month's vs last month's)
// metric-by-metric, reusing the same trend engine a live period-over-period
// comparison uses — a snapshot comparison and a live comparison are the
// same operation, just fed pre-computed numbers instead of freshly
// aggregated ones.
export function compareSnapshots(current: SnapshotMetrics, previous: SnapshotMetrics): Record<string, TrendResult> {
  return compareMetrics(current, previous);
}
