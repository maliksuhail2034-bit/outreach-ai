import { describe, expect, it } from "vitest";
import { compareMetrics } from "./comparisons";

describe("compareMetrics", () => {
  it("compares every metric in current against its matching previous value", () => {
    const result = compareMetrics({ emailsSent: 120, replies: 6 }, { emailsSent: 100, replies: 3 });

    expect(result.emailsSent).toEqual({ direction: "up", percentageChange: 20 });
    expect(result.replies).toEqual({ direction: "up", percentageChange: 100 });
  });

  it("treats a metric missing from previous as a comparison against 0", () => {
    const result = compareMetrics({ meetingsBooked: 2 }, {});
    expect(result.meetingsBooked).toEqual({ direction: "up", percentageChange: null });
  });

  it("returns an empty object when there are no current metrics", () => {
    expect(compareMetrics({}, { emailsSent: 10 })).toEqual({});
  });
});
