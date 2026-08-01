import { describe, expect, it } from "vitest";
import { calculateWarmupScore } from "./scoring";

describe("calculateWarmupScore", () => {
  it("scores 0 for a disabled profile with no volume", () => {
    expect(calculateWarmupScore({ stage: "disabled", targetDailyVolume: 30, currentDailyVolume: 0 })).toBe(0);
  });

  it("scores 100 for a healthy profile fully at its target volume", () => {
    expect(calculateWarmupScore({ stage: "healthy", targetDailyVolume: 30, currentDailyVolume: 30 })).toBe(100);
  });

  it("averages stage progress and volume progress when only partway there", () => {
    // stage 'starting' = 20, volume 0/30 = 0 -> average 10.
    expect(calculateWarmupScore({ stage: "starting", targetDailyVolume: 30, currentDailyVolume: 0 })).toBe(10);
  });

  it("treats a target of 0 as 0% volume progress instead of dividing by zero", () => {
    expect(() =>
      calculateWarmupScore({ stage: "starting", targetDailyVolume: 0, currentDailyVolume: 0 }),
    ).not.toThrow();
    expect(calculateWarmupScore({ stage: "starting", targetDailyVolume: 0, currentDailyVolume: 0 })).toBe(10);
  });

  it("folds in bounce/spam/reply rate once available", () => {
    const base = { stage: "healthy" as const, targetDailyVolume: 30, currentDailyVolume: 30 };
    // stage(100) + volume(100) + bounce-at-ceiling(0) = average 66.67 -> 67.
    expect(calculateWarmupScore({ ...base, bounceRate: 5 })).toBe(67);
  });

  it("ignores null stats the same as missing ones", () => {
    const base = { stage: "healthy" as const, targetDailyVolume: 30, currentDailyVolume: 30 };
    expect(calculateWarmupScore({ ...base, bounceRate: null, spamRate: null, replyRate: null })).toBe(100);
  });
});
