import { describe, expect, it } from "vitest";
import { compareCampaignMetrics, summarizeCampaignMetrics } from "./campaign-metrics";

const ZERO_INPUTS = {
  sentCount: 0,
  deliveredCount: 0,
  openedCount: 0,
  clickedCount: 0,
  repliedCount: 0,
  bouncedCount: 0,
  positiveReplyCount: 0,
  meetingBookedCount: 0,
};

describe("summarizeCampaignMetrics", () => {
  it("computes delivery/open/bounce/reply rates from raw counts", () => {
    const summary = summarizeCampaignMetrics({
      ...ZERO_INPUTS,
      sentCount: 100,
      deliveredCount: 95,
      openedCount: 38,
      repliedCount: 5,
      bouncedCount: 5,
    });

    expect(summary.deliveryRate).toBe(95);
    expect(summary.openRate).toBe(40); // 38 / 95
    expect(summary.bounceRate).toBe(5);
    expect(summary.replyRate).toBe(5);
  });

  it("returns null rates instead of dividing by zero when nothing was sent yet", () => {
    const summary = summarizeCampaignMetrics(ZERO_INPUTS);
    expect(summary.deliveryRate).toBeNull();
    expect(summary.openRate).toBeNull();
    expect(summary.bounceRate).toBeNull();
    expect(summary.replyRate).toBeNull();
  });

  it("passes the raw counts through unchanged alongside the computed rates", () => {
    const summary = summarizeCampaignMetrics({ ...ZERO_INPUTS, positiveReplyCount: 3, meetingBookedCount: 1 });
    expect(summary.positiveReplyCount).toBe(3);
    expect(summary.meetingBookedCount).toBe(1);
  });
});

describe("compareCampaignMetrics", () => {
  it("compares every metric between two campaign summaries", () => {
    const current = summarizeCampaignMetrics({ ...ZERO_INPUTS, sentCount: 120, repliedCount: 6 });
    const previous = summarizeCampaignMetrics({ ...ZERO_INPUTS, sentCount: 100, repliedCount: 3 });

    const result = compareCampaignMetrics(current, previous);

    expect(result.sent).toEqual({ direction: "up", percentageChange: 20 });
    expect(result.replied).toEqual({ direction: "up", percentageChange: 100 });
  });

  it("treats a previous summary with zero activity as the 'never happened before' baseline", () => {
    const current = summarizeCampaignMetrics({ ...ZERO_INPUTS, meetingBookedCount: 2 });
    const previous = summarizeCampaignMetrics(ZERO_INPUTS);

    expect(compareCampaignMetrics(current, previous).meetingBooked).toEqual({
      direction: "up",
      percentageChange: null,
    });
  });
});
