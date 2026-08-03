import { describe, expect, it } from "vitest";
import {
  benchmarkToInsight,
  collectInsights,
  forecastToInsight,
  healthFactorsToInsights,
  trendToInsight,
  type Insight,
} from "./insights";
import type { HealthScoreFactor } from "./types";
import type { TrendResult } from "./trends";
import type { ForecastPoint } from "./forecasting";

describe("healthFactorsToInsights", () => {
  it("maps each factor's detail into an insight message, preserving tone", () => {
    const factors: HealthScoreFactor[] = [
      { key: "bounce_rate", label: "Bounce rate", tone: "good", detail: "Bounce rate is 1%, healthy." },
      { key: "reply_rate", label: "Reply rate", tone: "warning", detail: "Reply rate is 0.5%, low." },
    ];
    expect(healthFactorsToInsights(factors)).toEqual([
      { key: "health_bounce_rate", tone: "good", message: "Bounce rate is 1%, healthy." },
      { key: "health_reply_rate", tone: "warning", message: "Reply rate is 0.5%, low." },
    ]);
  });

  it("returns an empty array for no factors", () => {
    expect(healthFactorsToInsights([])).toEqual([]);
  });
});

describe("trendToInsight", () => {
  it("returns a warning insight for a significant downward trend", () => {
    const trend: TrendResult = { direction: "down", percentageChange: -20 };
    expect(trendToInsight("replies", "Reply volume", trend)).toEqual({
      key: "trend_replies",
      tone: "warning",
      message: "Reply volume is down 20% vs. the previous period.",
    });
  });

  it("returns a good insight for a significant upward trend", () => {
    const trend: TrendResult = { direction: "up", percentageChange: 25 };
    expect(trendToInsight("sends", "Send volume", trend)).toEqual({
      key: "trend_sends",
      tone: "good",
      message: "Send volume is up 25% vs. the previous period.",
    });
  });

  it("returns null for a trend below the significance threshold", () => {
    const trend: TrendResult = { direction: "up", percentageChange: 5 };
    expect(trendToInsight("sends", "Send volume", trend)).toBeNull();
  });

  it("returns null when percentageChange is null", () => {
    const trend: TrendResult = { direction: "up", percentageChange: null };
    expect(trendToInsight("sends", "Send volume", trend)).toBeNull();
  });
});

function points(values: number[]): ForecastPoint[] {
  return values.map((value, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    predictedValue: value,
    confidence: 0.5,
  }));
}

describe("forecastToInsight", () => {
  it("returns a warning insight when the forecast trajectory declines significantly", () => {
    const result = forecastToInsight("Sends", points([100, 50]));
    expect(result).toEqual({
      key: "forecast_declining",
      tone: "warning",
      message: "Sends is forecasted to decline over the next 2 days.",
    });
  });

  it("returns a good insight when the forecast trajectory grows significantly", () => {
    const result = forecastToInsight("Sends", points([50, 100]));
    expect(result).toEqual({
      key: "forecast_growing",
      tone: "good",
      message: "Sends is forecasted to grow over the next 2 days.",
    });
  });

  it("returns null for a flat forecast", () => {
    expect(forecastToInsight("Sends", points([50, 51]))).toBeNull();
  });

  it("returns null for fewer than two points", () => {
    expect(forecastToInsight("Sends", points([50]))).toBeNull();
  });
});

describe("benchmarkToInsight", () => {
  it("returns a warning insight when significantly below the peer average", () => {
    const benchmark: TrendResult = { direction: "down", percentageChange: -30 };
    expect(benchmarkToInsight("Campaign A", "reply rate", benchmark)).toEqual({
      key: "benchmark_below_Campaign A",
      tone: "warning",
      message: "Campaign A's reply rate is 30% below your organization's average.",
    });
  });

  it("returns a good insight when significantly above the peer average", () => {
    const benchmark: TrendResult = { direction: "up", percentageChange: 40 };
    expect(benchmarkToInsight("Mailbox B", "reply rate", benchmark)).toEqual({
      key: "benchmark_above_Mailbox B",
      tone: "good",
      message: "Mailbox B's reply rate is 40% above your organization's average.",
    });
  });

  it("returns null for an insignificant difference", () => {
    const benchmark: TrendResult = { direction: "down", percentageChange: -3 };
    expect(benchmarkToInsight("Domain C", "reply rate", benchmark)).toBeNull();
  });
});

describe("collectInsights", () => {
  it("filters out null candidates", () => {
    const insight: Insight = { key: "a", tone: "good", message: "A" };
    expect(collectInsights([null, insight, null], "steady")).toEqual([insight]);
  });

  it("falls back to a steady insight when nothing fired", () => {
    expect(collectInsights([null, null], "Everything is steady.")).toEqual([
      { key: "steady", tone: "good", message: "Everything is steady." },
    ]);
  });
});
