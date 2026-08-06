import { describe, expect, it } from "vitest";
import { groupCounts, rate, rollingAverage, sumByKey, total } from "./metrics";

describe("total", () => {
  it("sums an array of numbers", () => {
    expect(total([1, 2, 3])).toBe(6);
  });

  it("returns 0 for an empty array", () => {
    expect(total([])).toBe(0);
  });
});

describe("rate", () => {
  it("computes a one-decimal percentage", () => {
    expect(rate(1, 3)).toBe(33.3);
  });

  it("returns null instead of a divide-by-zero result for a 0 denominator", () => {
    expect(rate(5, 0)).toBeNull();
  });

  it("returns 0, not null, when the numerator is 0 but the denominator isn't", () => {
    expect(rate(0, 10)).toBe(0);
  });
});

describe("rollingAverage", () => {
  it("averages within the window once enough values exist", () => {
    expect(rollingAverage([1, 2, 3, 4, 5], 2)).toEqual([1, 1.5, 2.5, 3.5, 4.5]);
  });

  it("averages whatever is available before the window fills", () => {
    expect(rollingAverage([10], 3)).toEqual([10]);
  });

  it("throws for a non-positive window size", () => {
    expect(() => rollingAverage([1, 2], 0)).toThrow();
  });
});

describe("groupCounts", () => {
  it("counts items by a derived key", () => {
    const events = [{ type: "opened" }, { type: "opened" }, { type: "bounced" }];
    expect(groupCounts(events, (e) => e.type)).toEqual({ opened: 2, bounced: 1 });
  });

  it("returns an empty object for no items", () => {
    expect(groupCounts([], () => "x")).toEqual({});
  });
});

describe("sumByKey", () => {
  it("sums a numeric field by a derived key", () => {
    const rollups = [
      { event_type: "sent", event_count: 3 },
      { event_type: "sent", event_count: 2 },
      { event_type: "bounced", event_count: 1 },
    ];
    expect(sumByKey(rollups, (r) => r.event_type, (r) => r.event_count)).toEqual({ sent: 5, bounced: 1 });
  });

  it("returns an empty object for no items", () => {
    expect(sumByKey([], () => "x", () => 1)).toEqual({});
  });
});
