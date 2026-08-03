import { describe, expect, it } from "vitest";
import { calculatePeerAverage, compareToBenchmark } from "./benchmarks";

describe("calculatePeerAverage", () => {
  it("averages a metric across every peer", () => {
    const result = calculatePeerAverage([{ replyRate: 10 }, { replyRate: 20 }, { replyRate: 30 }]);
    expect(result.replyRate).toBe(20);
  });

  it("excludes null values from a metric's average instead of treating them as 0", () => {
    const result = calculatePeerAverage([{ replyRate: 10 }, { replyRate: null }, { replyRate: 20 }]);
    expect(result.replyRate).toBe(15);
  });

  it("drops a metric entirely when no peer has a numeric value for it", () => {
    const result = calculatePeerAverage([{ replyRate: null }, { replyRate: null }]);
    expect(result).toEqual({});
  });

  it("returns an empty object for no peers", () => {
    expect(calculatePeerAverage([])).toEqual({});
  });

  it("averages each metric independently across peers with different keys", () => {
    const result = calculatePeerAverage([{ sentCount: 100, replyRate: 10 }, { sentCount: 200 }]);
    expect(result).toEqual({ sentCount: 150, replyRate: 10 });
  });
});

describe("compareToBenchmark", () => {
  it("compares an entity's metric against the peer average, reusing the trend engine", () => {
    const result = compareToBenchmark({ replyRate: 15 }, { replyRate: 10 });
    expect(result.replyRate.direction).toBe("up");
    expect(result.replyRate.percentageChange).toBe(50);
  });

  it("excludes a metric the entity has no real value for", () => {
    const result = compareToBenchmark({ replyRate: null, bounceRate: 5 }, { replyRate: 10, bounceRate: 2 });
    expect(result.replyRate).toBeUndefined();
    expect(result.bounceRate).toBeDefined();
  });

  it("excludes a metric the peer average has no coverage for", () => {
    const result = compareToBenchmark({ replyRate: 15, spamRate: 1 }, { replyRate: 10 });
    expect(result.spamRate).toBeUndefined();
  });
});
