import { describe, expect, it } from "vitest";
import { computeDailyWarmupStats } from "./stats";

describe("computeDailyWarmupStats", () => {
  it("counts every sent message, initial and reply alike, toward emailsSent", () => {
    const stats = computeDailyWarmupStats(
      [
        { message_type: "initial", reply_decision: "undecided" },
        { message_type: "reply", reply_decision: "undecided" },
      ],
      0,
    );
    expect(stats.emailsSent).toBe(2);
  });

  it("passes emailsReceived through unchanged", () => {
    const stats = computeDailyWarmupStats([], 5);
    expect(stats.emailsReceived).toBe(5);
  });

  it("computes replyRate as the share of 'initial' sends that got a real reply, excluding 'reply' rows", () => {
    const stats = computeDailyWarmupStats(
      [
        { message_type: "initial", reply_decision: "replied" },
        { message_type: "initial", reply_decision: "pending" },
        { message_type: "initial", reply_decision: "skipped" },
        { message_type: "initial", reply_decision: "undecided" },
        { message_type: "reply", reply_decision: "undecided" },
      ],
      0,
    );
    expect(stats.replyRate).toBe(25);
    expect(stats.positiveInteractions).toBe(1);
  });

  it("returns a null replyRate (not zero) when no 'initial' message was sent that day", () => {
    const stats = computeDailyWarmupStats([{ message_type: "reply", reply_decision: "undecided" }], 0);
    expect(stats.replyRate).toBeNull();
    expect(stats.positiveInteractions).toBe(0);
  });

  it("rounds replyRate to two decimal places", () => {
    const stats = computeDailyWarmupStats(
      [
        { message_type: "initial", reply_decision: "replied" },
        { message_type: "initial", reply_decision: "undecided" },
        { message_type: "initial", reply_decision: "undecided" },
      ],
      0,
    );
    expect(stats.replyRate).toBe(33.33);
  });
});
