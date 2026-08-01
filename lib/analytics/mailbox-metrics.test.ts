import { describe, expect, it } from "vitest";
import { compareMailboxMetrics, summarizeMailboxMetrics } from "./mailbox-metrics";

const ZERO_INPUTS = {
  sentCount: 0,
  deliveredCount: 0,
  openedCount: 0,
  clickedCount: 0,
  repliedCount: 0,
  bouncedCount: 0,
  spamComplaintCount: 0,
};

describe("summarizeMailboxMetrics", () => {
  it("computes delivery/open/click/reply/bounce/spam rates from raw counts", () => {
    const summary = summarizeMailboxMetrics({
      ...ZERO_INPUTS,
      sentCount: 200,
      deliveredCount: 190,
      openedCount: 76,
      clickedCount: 19,
      repliedCount: 10,
      bouncedCount: 10,
      spamComplaintCount: 2,
    });

    expect(summary.deliveryRate).toBe(95);
    expect(summary.openRate).toBe(40); // 76 / 190
    expect(summary.clickRate).toBe(10); // 19 / 190
    expect(summary.replyRate).toBe(5);
    expect(summary.bounceRate).toBe(5);
    expect(summary.spamComplaintRate).toBe(1);
  });

  it("returns null rates instead of dividing by zero when nothing was sent yet", () => {
    const summary = summarizeMailboxMetrics(ZERO_INPUTS);
    expect(summary.deliveryRate).toBeNull();
    expect(summary.openRate).toBeNull();
    expect(summary.clickRate).toBeNull();
    expect(summary.replyRate).toBeNull();
    expect(summary.bounceRate).toBeNull();
    expect(summary.spamComplaintRate).toBeNull();
  });
});

describe("compareMailboxMetrics", () => {
  it("compares every metric between two mailbox summaries", () => {
    const current = summarizeMailboxMetrics({ ...ZERO_INPUTS, sentCount: 120, bouncedCount: 6 });
    const previous = summarizeMailboxMetrics({ ...ZERO_INPUTS, sentCount: 100, bouncedCount: 3 });

    const result = compareMailboxMetrics(current, previous);

    expect(result.sent).toEqual({ direction: "up", percentageChange: 20 });
    expect(result.bounced).toEqual({ direction: "up", percentageChange: 100 });
  });

  it("treats a previous summary with zero activity as the 'never happened before' baseline", () => {
    const current = summarizeMailboxMetrics({ ...ZERO_INPUTS, spamComplaintCount: 1 });
    const previous = summarizeMailboxMetrics(ZERO_INPUTS);

    expect(compareMailboxMetrics(current, previous).spamComplaint).toEqual({
      direction: "up",
      percentageChange: null,
    });
  });
});
