import { calculateTrend, type TrendResult } from "./trends";
import type { ForecastPoint } from "./forecasting";
import type { HealthScoreFactor } from "./types";

// Deterministic, rule-based "AI Insights" — every function here adapts an
// already-computed output from another engine (health-score factors,
// trend/comparison results, a forecast's own trajectory, a benchmark
// comparison) into one shared plain-language shape. Nothing in this file
// recomputes a rate, a score, or a trend; it only decides which
// already-real signals are worth calling out. No LLM integration — see the
// AI Insights milestone's explicit scope ("start with deterministic
// rule-based insights").

export type InsightTone = "good" | "warning" | "info";

export interface Insight {
  key: string;
  tone: InsightTone;
  message: string;
}

// A HealthScoreFactor (lib/campaigns/health-score.ts,
// lib/deliverability/scoring.ts) already IS a plain-language insight — it
// just uses `detail`/`label` instead of `message`. This is a shape adapter,
// not a second scoring pass: every entity's health-score engine already
// decided what's good/warning and wrote the sentence explaining why.
export function healthFactorsToInsights(factors: HealthScoreFactor[]): Insight[] {
  return factors.map((factor) => ({ key: `health_${factor.key}`, tone: factor.tone, message: factor.detail }));
}

// Below this magnitude, a trend/benchmark swing reads as noise rather than
// something worth surfacing as an insight — a coarser bar than
// lib/analytics/trends.ts's own STABLE_THRESHOLD_PERCENT (1%), since "not
// perfectly flat" and "worth an AI Insights callout" are different bars.
const SIGNIFICANT_SWING_PERCENT = 15;

// Whether an increase is the desirable direction for this metric — true
// for sends/replies, false for bounces/spam complaints/failures. The
// message always states the real, factual direction ("up"/"down"); only
// the tone depends on whether that direction is good or bad for this
// particular metric, so an inverse metric (e.g. bounces) doesn't get
// mislabeled "good" just because it went up.
function directionTone(isIncrease: boolean, higherIsBetter: boolean): InsightTone {
  return isIncrease === higherIsBetter ? "good" : "warning";
}

// Surfaces an already-computed TrendResult (lib/analytics/trends.ts's
// calculateTrend, or any compare*Metrics()'s per-metric output — the exact
// numbers the Trends section on every analytics page already renders) as
// an insight once the swing is large enough to be worth a callout. No new
// comparison math.
export function trendToInsight(
  key: string,
  label: string,
  trend: TrendResult,
  higherIsBetter: boolean = true,
): Insight | null {
  if (trend.percentageChange === null) return null;
  const magnitude = Math.abs(trend.percentageChange);
  if (magnitude < SIGNIFICANT_SWING_PERCENT) return null;

  const isIncrease = trend.direction === "up";
  return {
    key: `trend_${key}`,
    tone: directionTone(isIncrease, higherIsBetter),
    message: `${label} is ${isIncrease ? "up" : "down"} ${magnitude}% vs. the previous period.`,
  };
}

// Surfaces a forecast's own trajectory (its first vs. last projected day)
// as an insight — reuses lib/analytics/forecasting.ts's ForecastPoint[]
// output and runs it through the same calculateTrend every other trend in
// this app uses, rather than a second growth-rate calculation.
export function forecastToInsight(label: string, points: ForecastPoint[], higherIsBetter: boolean = true): Insight | null {
  if (points.length < 2) return null;
  const trend = calculateTrend(points[points.length - 1].predictedValue, points[0].predictedValue);
  if (trend.percentageChange === null) return null;
  const magnitude = Math.abs(trend.percentageChange);
  if (magnitude < SIGNIFICANT_SWING_PERCENT) return null;

  const isIncrease = trend.direction === "up";
  const tone = directionTone(isIncrease, higherIsBetter);
  return {
    key: isIncrease ? "forecast_growing" : "forecast_declining",
    tone,
    message: `${label} is forecasted to ${isIncrease ? "grow" : "decline"} over the next ${points.length} days.`,
  };
}

// A benchmark result (lib/analytics/benchmarks.ts's compareToBenchmark
// output) is already a TrendResult — "entity vs. peer average" reuses the
// exact same direction/percentageChange shape "this period vs. last
// period" does, so this is the same adapter as trendToInsight, just with
// benchmark-specific wording and its own key (multiple entities can each
// produce one of these in the same collectInsights call, unlike
// trendToInsight/forecastToInsight which fire at most once per page).
export function benchmarkToInsight(
  entityLabel: string,
  metricLabel: string,
  benchmark: TrendResult,
  higherIsBetter: boolean = true,
): Insight | null {
  if (benchmark.percentageChange === null) return null;
  const magnitude = Math.abs(benchmark.percentageChange);
  if (magnitude < SIGNIFICANT_SWING_PERCENT) return null;

  const isIncrease = benchmark.direction === "up";
  return {
    key: `benchmark_${isIncrease ? "above" : "below"}_${entityLabel}`,
    tone: directionTone(isIncrease, higherIsBetter),
    message: `${entityLabel}'s ${metricLabel} is ${magnitude}% ${isIncrease ? "above" : "below"} your organization's average.`,
  };
}

// Every page assembles its own candidate list from whichever rule
// functions above apply to the signals it actually has, then passes it
// through this — filtering out the rules that didn't fire, and falling
// back to one deterministic "steady" insight so the panel is never
// confusingly empty, the same "all healthy and consistent" fallback
// lib/campaigns/mailbox-insights.ts already establishes for its own
// insight list.
export function collectInsights(candidates: (Insight | null)[], steadyMessage: string): Insight[] {
  const insights = candidates.filter((insight): insight is Insight => insight !== null);
  if (insights.length === 0) {
    return [{ key: "steady", tone: "good", message: steadyMessage }];
  }
  return insights;
}
