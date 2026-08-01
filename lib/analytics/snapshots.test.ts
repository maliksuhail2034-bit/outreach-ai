import { describe, expect, it } from "vitest";
import { compareSnapshots } from "./snapshots";

describe("compareSnapshots", () => {
  it("compares two snapshots' metrics the same way a live comparison would", () => {
    const result = compareSnapshots({ emailsSent: 200 }, { emailsSent: 100 });
    expect(result.emailsSent).toEqual({ direction: "up", percentageChange: 100 });
  });
});
