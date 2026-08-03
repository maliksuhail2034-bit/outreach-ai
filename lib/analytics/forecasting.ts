// Contract a forecasting engine implements — trend extrapolation, a proper
// time-series model, or an AI-driven predictor. Mirrors
// lib/deliverability/dns-provider.ts's interface + placeholder + factory
// split exactly. LinearTrendForecaster (below) is the first real
// implementation, filling what was previously an unimplemented seam.

export interface ForecastPoint {
  date: string; // YYYY-MM-DD
  predictedValue: number;
  confidence: number; // 0-1
}

export interface Forecaster {
  forecast(history: { date: string; value: number }[], horizonDays: number): Promise<ForecastPoint[]>;
}

// Always returns no predictions — useful as an explicit opt-out (tests, a
// future "forecasting disabled" setting) even though getForecaster() below
// no longer returns this by default.
export class PlaceholderForecaster implements Forecaster {
  async forecast(history: { date: string; value: number }[], horizonDays: number): Promise<ForecastPoint[]> {
    void history;
    void horizonDays;
    return [];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let denominator = 0;
  values.forEach((y, x) => {
    numerator += (x - xMean) * (y - yMean);
    denominator += (x - xMean) ** 2;
  });

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function addDays(date: string, offset: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

const MIN_HISTORY_POINTS = 2;
// History length at which confidence stops improving — an arbitrary but
// documented cutoff (two weeks of daily data), not tuned against real usage
// data since this is the first real forecaster this app has had.
const FULL_CONFIDENCE_HISTORY_DAYS = 14;

// Least-squares linear regression over history's index/value pairs — the
// simplest of the three options this file's contract names ("trend
// extrapolation"). Any entity's already-computed daily timeline
// (lib/analytics/time-buckets.ts's DailyCount[], or aggregations.ts's
// bucketByDayInRange output) is the exact {date, value}[] shape this
// consumes directly — no adapter needed, and no new queries for any caller
// that already builds one of those for its own chart.
//
// Confidence is deliberately simple and honest about uncertainty rather
// than fabricated precision: it grows with more history (capped at
// FULL_CONFIDENCE_HISTORY_DAYS) and decays linearly the further a projected
// day sits past the last known data point. Fewer than MIN_HISTORY_POINTS
// returns no predictions at all — the same "honest empty" convention
// lib/analytics/metrics.ts's rate() uses for a 0 denominator, rather than
// projecting a trend from a single data point.
export class LinearTrendForecaster implements Forecaster {
  async forecast(history: { date: string; value: number }[], horizonDays: number): Promise<ForecastPoint[]> {
    if (history.length < MIN_HISTORY_POINTS || horizonDays <= 0) return [];

    const { slope, intercept } = linearRegression(history.map((point) => point.value));
    const lastIndex = history.length - 1;
    const lastDate = history[history.length - 1].date;
    const historyConfidence = clamp(history.length / FULL_CONFIDENCE_HISTORY_DAYS, 0, 1);

    return Array.from({ length: horizonDays }, (_, offset) => {
      const day = offset + 1;
      const predictedValue = Math.max(0, Math.round(intercept + slope * (lastIndex + day)));
      const horizonDecay = 1 - day / (horizonDays + 1);
      const confidence = Math.round(clamp(historyConfidence * horizonDecay, 0, 1) * 100) / 100;
      return { date: addDays(lastDate, day), predictedValue, confidence };
    });
  }
}

export function getForecaster(): Forecaster {
  return new LinearTrendForecaster();
}

export interface ForecastSummary {
  projectedTotal: number;
  averageConfidence: number; // 0-1
}

// The single reduction every entity page needs from a raw ForecastPoint[]
// — a projected total over the horizon plus how much to trust it — shared
// so campaign/mailbox/domain/organization analytics don't each write their
// own sum/average. Null (not a fabricated 0) when there's nothing to
// summarize, matching getForecaster()'s own "no predictions" convention for
// too little history.
export function summarizeForecast(points: ForecastPoint[]): ForecastSummary | null {
  if (points.length === 0) return null;
  const projectedTotal = points.reduce((sum, point) => sum + point.predictedValue, 0);
  const averageConfidence =
    Math.round((points.reduce((sum, point) => sum + point.confidence, 0) / points.length) * 100) / 100;
  return { projectedTotal, averageConfidence };
}
