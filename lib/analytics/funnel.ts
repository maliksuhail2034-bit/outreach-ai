import type { FunnelStage } from "@/components/dashboard/funnel-card";
import { rate } from "./metrics";

// Funnel conversion/drop-off analysis, built on the exact FunnelStage[]
// shape FunnelCard already renders (see components/dashboard/funnel-card.tsx)
// — a caller that already has a FunnelStage[] for display gets
// conversion/drop-off numbers from the same data, no parallel
// representation to keep in sync. Every percentage goes through rate()
// (lib/analytics/metrics.ts), so a zero denominator is null, never a
// fabricated 0% or 100%.

export interface FunnelStageConversion {
  key: string;
  label: string;
  value: number;
  // Percentage of the funnel's first non-placeholder stage this stage
  // represents. Null when that first stage is 0 (nothing to convert from)
  // or this stage is itself a placeholder — a stage with no real data
  // source yet (see FunnelStage.placeholder) never gets a computed
  // percentage.
  conversionFromStart: number | null;
}

export interface FunnelDropOff {
  fromKey: string;
  fromLabel: string;
  toKey: string;
  toLabel: string;
  fromValue: number;
  toValue: number;
  droppedCount: number;
  // Percentage of `from`'s value that did not reach `to`. Null when `from`
  // is 0 — there's nothing to have dropped off from.
  dropOffPercent: number | null;
}

function realStages(stages: FunnelStage[]): FunnelStage[] {
  return stages.filter((stage) => !stage.placeholder);
}

// Stage keys with no event producer anywhere in the codebase today — see
// lib/analytics/events.ts's catalog vs. the actual insert call sites:
// nothing ever writes a 'delivered', 'opened', or 'clicked' email_event, so
// those counts are always 0 for every campaign, not just campaigns that
// happen to have no engagement. A stage that is *always* 0 for that reason
// would otherwise make identifyBiggestDropOff mechanically report "Sent ->
// Delivered, 100% lost" for any campaign that ever sent anything — true
// arithmetic on real (zero) data, but a misleading insight, since it isn't
// actually a delivery failure.
//
// identifyBiggestDropOff (below) skips these when picking a winner, bridging
// straight to the next stage that *is* backed by real data (e.g. Sent ->
// Replied). calculateFunnelDropOffs is untouched and still reports every
// adjacent pair, including these — this exclusion is specific to "which
// transition should be called out as the biggest," not the underlying data.
//
// The moment a real producer exists for one of these event types, remove it
// from this set — nothing else in this file needs to change for it to be
// included in the comparison again. (Matches the FunnelStage.key values the
// campaign analytics page assigns; keep in sync if those keys ever change.)
const UNTRACKED_STAGE_KEYS = new Set(["delivered", "opened", "clicked"]);

function trackedStages(stages: FunnelStage[]): FunnelStage[] {
  return realStages(stages).filter((stage) => !UNTRACKED_STAGE_KEYS.has(stage.key));
}

export function calculateFunnelConversions(stages: FunnelStage[]): FunnelStageConversion[] {
  const base = realStages(stages)[0]?.value ?? 0;
  return stages.map((stage) => ({
    key: stage.key,
    label: stage.label,
    value: stage.value,
    conversionFromStart: stage.placeholder ? null : rate(stage.value, base),
  }));
}

// Pairwise drop-off across whatever stage sequence is passed in — shared by
// calculateFunnelDropOffs (every real stage) and identifyBiggestDropOff
// (tracked stages only), so the actual pairing math exists in exactly one
// place.
function buildDropOffs(orderedStages: FunnelStage[]): FunnelDropOff[] {
  const dropOffs: FunnelDropOff[] = [];

  for (let i = 1; i < orderedStages.length; i++) {
    const from = orderedStages[i - 1];
    const to = orderedStages[i];
    const droppedCount = Math.max(0, from.value - to.value);

    dropOffs.push({
      fromKey: from.key,
      fromLabel: from.label,
      toKey: to.key,
      toLabel: to.label,
      fromValue: from.value,
      toValue: to.value,
      droppedCount,
      dropOffPercent: rate(droppedCount, from.value),
    });
  }

  return dropOffs;
}

// Consecutive-stage drop-off, skipping any placeholder stage entirely (on
// either side of the pair) — a stage with no real data source yet can't
// honestly be said to have "dropped off" anything. Includes the currently-
// untracked delivered/opened/clicked stages (see UNTRACKED_STAGE_KEYS
// above) — this function reports the complete picture; only
// identifyBiggestDropOff narrows further to what's safe to call "biggest."
export function calculateFunnelDropOffs(stages: FunnelStage[]): FunnelDropOff[] {
  return buildDropOffs(realStages(stages));
}

// The single transition that lost the highest percentage of leads, among
// stages actually backed by real data today (see UNTRACKED_STAGE_KEYS) — an
// untracked stage is skipped over entirely rather than treated as an
// endpoint, so e.g. Sent -> Replied is compared directly when Delivered/
// Opened/Clicked sit between them with no real producer. Null when there's
// nothing to compare — fewer than two tracked stages, or every remaining
// transition's starting value is 0 (rate() already returns null for those,
// filtered out here rather than treated as "a 0% drop-off").
export function identifyBiggestDropOff(stages: FunnelStage[]): FunnelDropOff | null {
  const candidates = buildDropOffs(trackedStages(stages)).filter(
    (dropOff): dropOff is FunnelDropOff & { dropOffPercent: number } => dropOff.dropOffPercent !== null,
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((biggest, current) => (current.dropOffPercent > biggest.dropOffPercent ? current : biggest));
}
