import { compareMetrics } from "./comparisons";
import type { TrendResult } from "./trends";

// A peer group's per-metric values — any entity's already-summarized
// metrics (CampaignMetricsSummary, MailboxMetricsSummary, or the same
// shape reused for domains/organizations) satisfy this structurally, since
// every summary is just named numeric/nullable-numeric fields. A rate
// field is null when there's no denominator yet (see lib/analytics/metrics.ts's
// rate()) — treated as "not observed," never coerced to 0, so one thin
// peer doesn't quietly drag a real average down.
export type BenchmarkMetrics = Record<string, number | null>;

// Averages each metric across every peer, excluding a peer's value for a
// key when it's null rather than treating it as 0, and dropping a key
// entirely if no peer has a numeric value for it at all. Entity-agnostic:
// this has no idea whether the peers are campaigns, mailboxes, or domains —
// it only operates on plain records, so any entity type's summary list can
// feed it.
export function calculatePeerAverage(peers: BenchmarkMetrics[]): Record<string, number> {
  const keys = new Set<string>();
  for (const peer of peers) {
    for (const key of Object.keys(peer)) keys.add(key);
  }

  const result: Record<string, number> = {};
  for (const key of keys) {
    const values = peers.map((peer) => peer[key]).filter((value): value is number => value != null);
    if (values.length === 0) continue;
    result[key] = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
  }
  return result;
}

// Compares one entity's metrics against its peer-group average, reusing
// the exact same trend engine period-over-period comparisons use (see
// lib/analytics/comparisons.ts) — "how does this entity compare to its
// peers" and "how does this period compare to last period" are the same
// operation, just fed a different baseline instead of a prior period. Only
// compares keys the entity has a real (non-null) value for and that the
// peer average actually covers — never fabricates a comparison against an
// unknown baseline.
export function compareToBenchmark(
  entity: BenchmarkMetrics,
  peerAverage: Record<string, number>,
): Record<string, TrendResult> {
  const comparable: Record<string, number> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (value != null && key in peerAverage) comparable[key] = value;
  }
  return compareMetrics(comparable, peerAverage);
}
