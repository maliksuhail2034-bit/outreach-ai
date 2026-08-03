import { describe, expect, it } from "vitest";
import { getForecaster, LinearTrendForecaster, PlaceholderForecaster, summarizeForecast } from "./forecasting";

describe("PlaceholderForecaster", () => {
  it("returns no predictions regardless of input", async () => {
    const result = await new PlaceholderForecaster().forecast([{ date: "2026-08-01", value: 10 }], 7);
    expect(result).toEqual([]);
  });
});

function daysOfHistory(values: number[], startDate = "2026-08-01") {
  return values.map((value, index) => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), value };
  });
}

describe("LinearTrendForecaster", () => {
  it("projects an upward trend forward with increasing predicted values", async () => {
    const history = daysOfHistory([10, 20, 30, 40, 50]);
    const result = await new LinearTrendForecaster().forecast(history, 3);

    expect(result).toHaveLength(3);
    expect(result[0].predictedValue).toBeGreaterThan(50);
    expect(result[1].predictedValue).toBeGreaterThan(result[0].predictedValue);
    expect(result[2].predictedValue).toBeGreaterThan(result[1].predictedValue);
  });

  it("projects a flat history as flat", async () => {
    const history = daysOfHistory([25, 25, 25, 25, 25]);
    const result = await new LinearTrendForecaster().forecast(history, 3);

    for (const point of result) {
      expect(point.predictedValue).toBe(25);
    }
  });

  it("never predicts a negative value for a steep downward trend", async () => {
    const history = daysOfHistory([50, 30, 10]);
    const result = await new LinearTrendForecaster().forecast(history, 5);

    for (const point of result) {
      expect(point.predictedValue).toBeGreaterThanOrEqual(0);
    }
  });

  it("continues the date sequence from the last history date", async () => {
    const history = daysOfHistory([1, 2, 3], "2026-08-01");
    const result = await new LinearTrendForecaster().forecast(history, 2);

    expect(result[0].date).toBe("2026-08-04");
    expect(result[1].date).toBe("2026-08-05");
  });

  it("returns no predictions for fewer than two history points", async () => {
    const result = await new LinearTrendForecaster().forecast(daysOfHistory([10]), 7);
    expect(result).toEqual([]);
  });

  it("returns no predictions for a non-positive horizon", async () => {
    const result = await new LinearTrendForecaster().forecast(daysOfHistory([10, 20, 30]), 0);
    expect(result).toEqual([]);
  });

  it("decays confidence the further a prediction sits past the last known day", async () => {
    const history = daysOfHistory(Array.from({ length: 20 }, (_, i) => 10 + i));
    const result = await new LinearTrendForecaster().forecast(history, 7);

    expect(result[0].confidence).toBeGreaterThan(result[result.length - 1].confidence);
    for (const point of result) {
      expect(point.confidence).toBeGreaterThanOrEqual(0);
      expect(point.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("has lower confidence for a shorter history than a longer one, same horizon", async () => {
    const shortHistory = daysOfHistory([10, 20, 30]);
    const longHistory = daysOfHistory(Array.from({ length: 20 }, (_, i) => 10 + i * 10));

    const shortResult = await new LinearTrendForecaster().forecast(shortHistory, 3);
    const longResult = await new LinearTrendForecaster().forecast(longHistory, 3);

    expect(longResult[0].confidence).toBeGreaterThan(shortResult[0].confidence);
  });
});

describe("getForecaster", () => {
  it("returns the real trend forecaster, not the placeholder", () => {
    expect(getForecaster()).toBeInstanceOf(LinearTrendForecaster);
  });
});

describe("summarizeForecast", () => {
  it("returns null for an empty forecast", () => {
    expect(summarizeForecast([])).toBeNull();
  });

  it("sums predicted values and averages confidence", () => {
    const result = summarizeForecast([
      { date: "2026-08-01", predictedValue: 10, confidence: 0.8 },
      { date: "2026-08-02", predictedValue: 20, confidence: 0.6 },
    ]);
    expect(result).toEqual({ projectedTotal: 30, averageConfidence: 0.7 });
  });
});
