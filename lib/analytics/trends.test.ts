import { describe, expect, it } from "vitest";
import { calculateTrend } from "./trends";

describe("calculateTrend", () => {
  it("reports an increase with its percentage change", () => {
    expect(calculateTrend(120, 100)).toEqual({ direction: "up", percentageChange: 20 });
  });

  it("reports a decrease with its percentage change", () => {
    expect(calculateTrend(80, 100)).toEqual({ direction: "down", percentageChange: -20 });
  });

  it("treats a small change within the noise band as stable", () => {
    const result = calculateTrend(100.5, 100);
    expect(result.direction).toBe("stable");
  });

  it("treats no change at all as stable with 0% change", () => {
    expect(calculateTrend(50, 50)).toEqual({ direction: "stable", percentageChange: 0 });
  });

  it("reports stable with no percentage when both current and previous are 0", () => {
    expect(calculateTrend(0, 0)).toEqual({ direction: "stable", percentageChange: null });
  });

  it("reports up with no percentage when going from 0 to a positive number", () => {
    expect(calculateTrend(10, 0)).toEqual({ direction: "up", percentageChange: null });
  });
});
