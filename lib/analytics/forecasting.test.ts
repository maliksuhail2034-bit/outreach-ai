import { describe, expect, it } from "vitest";
import { PlaceholderForecaster } from "./forecasting";

describe("PlaceholderForecaster", () => {
  it("returns no predictions regardless of input", async () => {
    const result = await new PlaceholderForecaster().forecast(
      [{ date: "2026-08-01", value: 10 }],
      7,
    );
    expect(result).toEqual([]);
  });
});
