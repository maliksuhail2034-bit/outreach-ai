import { describe, expect, it } from "vitest";
import { bucketByDayInRange, daysInRange, previousDateRange, resolveDateRange } from "./aggregations";

const NOW = new Date("2026-08-03T15:00:00.000Z");

describe("resolveDateRange", () => {
  it("resolves 'today' to a single-day range ending now", () => {
    expect(resolveDateRange("today", undefined, NOW)).toEqual({ start: "2026-08-03", end: "2026-08-03" });
  });

  it("resolves '7d' to the last 7 days inclusive of today", () => {
    expect(resolveDateRange("7d", undefined, NOW)).toEqual({ start: "2026-07-28", end: "2026-08-03" });
  });

  it("resolves '30d' and '90d' the same way, just wider", () => {
    expect(resolveDateRange("30d", undefined, NOW).start).toBe("2026-07-05");
    expect(resolveDateRange("90d", undefined, NOW).start).toBe("2026-05-06");
  });

  it("passes a custom range through unchanged", () => {
    const custom = { start: "2026-01-01", end: "2026-01-31" };
    expect(resolveDateRange("custom", custom, NOW)).toEqual(custom);
  });

  it("throws for 'custom' without a range", () => {
    expect(() => resolveDateRange("custom", undefined, NOW)).toThrow();
  });

  it("throws when a custom range's start is after its end", () => {
    expect(() => resolveDateRange("custom", { start: "2026-02-01", end: "2026-01-01" }, NOW)).toThrow();
  });
});

describe("daysInRange", () => {
  it("counts a single day as 1", () => {
    expect(daysInRange({ start: "2026-08-03", end: "2026-08-03" })).toBe(1);
  });

  it("counts a 7-day range as 7", () => {
    expect(daysInRange({ start: "2026-07-28", end: "2026-08-03" })).toBe(7);
  });
});

describe("previousDateRange", () => {
  it("returns the same-length range immediately before", () => {
    expect(previousDateRange({ start: "2026-07-28", end: "2026-08-03" })).toEqual({
      start: "2026-07-21",
      end: "2026-07-27",
    });
  });

  it("works for a single-day range", () => {
    expect(previousDateRange({ start: "2026-08-03", end: "2026-08-03" })).toEqual({
      start: "2026-08-02",
      end: "2026-08-02",
    });
  });
});

describe("bucketByDayInRange", () => {
  it("counts timestamps per day across the range", () => {
    const timestamps = [
      "2026-08-01T01:00:00.000Z",
      "2026-08-01T23:00:00.000Z",
      "2026-08-02T12:00:00.000Z",
    ];
    const result = bucketByDayInRange(timestamps, { start: "2026-08-01", end: "2026-08-03" });

    expect(result).toEqual([
      { date: "2026-08-01", value: 2 },
      { date: "2026-08-02", value: 1 },
      { date: "2026-08-03", value: 0 },
    ]);
  });

  it("works for a range that doesn't end today, unlike bucketByDay", () => {
    const result = bucketByDayInRange(["2026-01-15T00:00:00.000Z"], { start: "2026-01-14", end: "2026-01-16" });
    expect(result.map((point) => point.date)).toEqual(["2026-01-14", "2026-01-15", "2026-01-16"]);
    expect(result[1].value).toBe(1);
  });

  it("returns an empty array for an inverted range instead of looping forever", () => {
    expect(bucketByDayInRange([], { start: "2026-08-05", end: "2026-08-01" })).toEqual([]);
  });
});
