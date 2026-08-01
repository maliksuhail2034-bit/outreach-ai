import { describe, expect, it } from "vitest";
import { calculateCampaignHealthScore } from "./health-score";
import type { TrendResult } from "@/lib/analytics/trends";
import type { FunnelDropOff } from "@/lib/analytics/funnel";

function trend(direction: TrendResult["direction"]): TrendResult {
  return { direction, percentageChange: direction === "stable" ? 0 : direction === "up" ? 20 : -20 };
}

function dropOff(overrides: Partial<FunnelDropOff>): FunnelDropOff {
  return {
    fromKey: "step-2",
    fromLabel: "Step 2",
    toKey: "step-3",
    toLabel: "Step 3",
    fromValue: 100,
    toValue: 50,
    droppedCount: 50,
    dropOffPercent: 50,
    ...overrides,
  };
}

describe("calculateCampaignHealthScore", () => {
  it("returns a null score and no factors when there is no usable signal at all", () => {
    const result = calculateCampaignHealthScore({});
    expect(result.score).toBeNull();
    expect(result.factors).toEqual([]);
  });

  it("returns a null score when every provided signal is null", () => {
    const result = calculateCampaignHealthScore({
      bounceRate: null,
      replyRate: null,
      deliveryRate: null,
      positiveReplyRate: null,
      meetingRate: null,
      engagementTrend: null,
      biggestStepDropOff: null,
    });
    expect(result.score).toBeNull();
  });

  it("scores from bounce rate alone", () => {
    // bounceRate 0 -> full 100 on this signal, only signal present.
    const result = calculateCampaignHealthScore({ bounceRate: 0 });
    expect(result.score).toBe(100);
  });

  it("scores a high bounce rate as 0 on that signal", () => {
    const result = calculateCampaignHealthScore({ bounceRate: 5 });
    expect(result.score).toBe(0);
  });

  it("scores a healthy reply rate at or above the full point as 100 on that signal", () => {
    const result = calculateCampaignHealthScore({ replyRate: 10 });
    expect(result.score).toBe(100);
  });

  it("clamps a reply rate above the full point instead of exceeding 100", () => {
    const result = calculateCampaignHealthScore({ replyRate: 25 });
    expect(result.score).toBe(100);
  });

  it("averages multiple provided signals", () => {
    // bounceRate 0 -> 100; replyRate 5 -> 50. Average = 75.
    const result = calculateCampaignHealthScore({ bounceRate: 0, replyRate: 5 });
    expect(result.score).toBe(75);
  });

  it("ignores an omitted or null signal entirely rather than treating it as 0", () => {
    const withOnlyBounce = calculateCampaignHealthScore({ bounceRate: 0 });
    const withBounceAndNullReply = calculateCampaignHealthScore({ bounceRate: 0, replyRate: null });
    expect(withOnlyBounce.score).toBe(withBounceAndNullReply.score);
  });

  it("includes delivery rate the moment it's provided, unchanged signature", () => {
    const result = calculateCampaignHealthScore({ deliveryRate: 98 });
    expect(result.score).toBe(98);
  });

  it("scores engagement trend by direction", () => {
    expect(calculateCampaignHealthScore({ engagementTrend: trend("up") }).score).toBe(100);
    expect(calculateCampaignHealthScore({ engagementTrend: trend("stable") }).score).toBe(60);
    expect(calculateCampaignHealthScore({ engagementTrend: trend("down") }).score).toBe(20);
  });

  it("scores biggest step drop-off inversely to its percentage", () => {
    const result = calculateCampaignHealthScore({ biggestStepDropOff: dropOff({ dropOffPercent: 30 }) });
    expect(result.score).toBe(70);
  });

  it("ignores a biggestStepDropOff with a null dropOffPercent", () => {
    const result = calculateCampaignHealthScore({ biggestStepDropOff: dropOff({ dropOffPercent: null }) });
    expect(result.score).toBeNull();
  });

  it("rounds the final average to the nearest whole number", () => {
    // bounceRate 1 -> 80; replyRate 3 -> 30. Average = 55.
    const result = calculateCampaignHealthScore({ bounceRate: 1, replyRate: 3 });
    expect(result.score).toBe(55);
    expect(Number.isInteger(result.score)).toBe(true);
  });
});

describe("calculateCampaignHealthScore factors", () => {
  it("flags a low bounce rate as good", () => {
    const result = calculateCampaignHealthScore({ bounceRate: 0.5 });
    expect(result.factors).toContainEqual(
      expect.objectContaining({ key: "bounce_rate", tone: "good" }),
    );
  });

  it("flags a high bounce rate as a warning", () => {
    const result = calculateCampaignHealthScore({ bounceRate: 8 });
    expect(result.factors).toContainEqual(
      expect.objectContaining({ key: "bounce_rate", tone: "warning" }),
    );
  });

  it("generates no bounce-rate factor for a middling, unremarkable value", () => {
    const result = calculateCampaignHealthScore({ bounceRate: 3.5 });
    expect(result.factors.some((f) => f.key === "bounce_rate")).toBe(false);
  });

  it("flags a strong reply rate as good", () => {
    const result = calculateCampaignHealthScore({ replyRate: 6 });
    expect(result.factors).toContainEqual(expect.objectContaining({ key: "reply_rate", tone: "good" }));
  });

  it("flags a low reply rate as a warning", () => {
    const result = calculateCampaignHealthScore({ replyRate: 0.5 });
    expect(result.factors).toContainEqual(expect.objectContaining({ key: "reply_rate", tone: "warning" }));
  });

  it("generates no factor at all for a signal that was never provided", () => {
    const result = calculateCampaignHealthScore({ replyRate: 6 });
    expect(result.factors.some((f) => f.key === "delivery_rate")).toBe(false);
    expect(result.factors.some((f) => f.key === "positive_reply_rate")).toBe(false);
    expect(result.factors.some((f) => f.key === "meeting_rate")).toBe(false);
    expect(result.factors.some((f) => f.key === "engagement_trend")).toBe(false);
    expect(result.factors.some((f) => f.key === "step_drop_off")).toBe(false);
  });

  it("flags an upward engagement trend as good and a downward one as a warning", () => {
    expect(calculateCampaignHealthScore({ engagementTrend: trend("up") }).factors).toContainEqual(
      expect.objectContaining({ key: "engagement_trend", tone: "good" }),
    );
    expect(calculateCampaignHealthScore({ engagementTrend: trend("down") }).factors).toContainEqual(
      expect.objectContaining({ key: "engagement_trend", tone: "warning" }),
    );
  });

  it("generates no engagement-trend factor for a stable trend", () => {
    const result = calculateCampaignHealthScore({ engagementTrend: trend("stable") });
    expect(result.factors.some((f) => f.key === "engagement_trend")).toBe(false);
  });

  it("flags a large step drop-off as a warning naming the underperforming step", () => {
    const result = calculateCampaignHealthScore({
      biggestStepDropOff: dropOff({ toLabel: "Step 3", dropOffPercent: 62 }),
    });
    const factor = result.factors.find((f) => f.key === "step_drop_off");
    expect(factor?.tone).toBe("warning");
    expect(factor?.detail).toContain("Step 3");
    expect(factor?.detail).toContain("62%");
  });

  it("generates no step-drop-off factor when the drop-off is below the warning threshold", () => {
    const result = calculateCampaignHealthScore({ biggestStepDropOff: dropOff({ dropOffPercent: 10 }) });
    expect(result.factors.some((f) => f.key === "step_drop_off")).toBe(false);
  });

  it("combines factors from multiple signals in one result", () => {
    const result = calculateCampaignHealthScore({
      bounceRate: 0.5,
      replyRate: 6,
      biggestStepDropOff: dropOff({ toLabel: "Step 3", dropOffPercent: 70 }),
    });
    expect(result.factors.map((f) => f.key).sort()).toEqual(["bounce_rate", "reply_rate", "step_drop_off"]);
  });
});
