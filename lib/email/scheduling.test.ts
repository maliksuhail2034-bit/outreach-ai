import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNextSchedule,
  computeNextSendTime,
  computeRetryDelay,
  findNextStep,
  type SequenceStepLike,
} from "./scheduling";
import type { SendingWindow } from "@/lib/validations/sending-window";

const ALL_DAYS_9_TO_5_UTC: SendingWindow = {
  days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  startHour: 9,
  endHour: 17,
  timezone: "UTC",
};

const WEEKDAYS_ONLY_9_TO_5_UTC: SendingWindow = {
  ...ALL_DAYS_9_TO_5_UTC,
  days: ["mon", "tue", "wed", "thu", "fri"],
};

describe("computeNextSendTime", () => {
  it("returns the same instant when already inside the window and dayDelay is 0", () => {
    const from = new Date("2026-08-03T12:00:00.000Z"); // Monday, inside 9-17 UTC
    const result = computeNextSendTime({ from, dayDelay: 0, window: ALL_DAYS_9_TO_5_UTC });
    expect(result.toISOString()).toBe(from.toISOString());
  });

  it("rolls forward to the window start when before it on the same day", () => {
    const from = new Date("2026-08-03T04:00:00.000Z"); // Monday, before 09:00 UTC
    const result = computeNextSendTime({ from, dayDelay: 0, window: ALL_DAYS_9_TO_5_UTC });
    expect(result.toISOString()).toBe("2026-08-03T09:00:00.000Z");
  });

  it("rolls forward to the next day's window start when today's window has closed", () => {
    const from = new Date("2026-08-03T20:00:00.000Z"); // Monday, after 17:00 UTC
    const result = computeNextSendTime({ from, dayDelay: 0, window: ALL_DAYS_9_TO_5_UTC });
    expect(result.toISOString()).toBe("2026-08-04T09:00:00.000Z");
  });

  it("skips disallowed days — Friday evening rolls to Monday when weekends are excluded", () => {
    const from = new Date("2026-08-07T20:00:00.000Z"); // Friday, after close
    const result = computeNextSendTime({ from, dayDelay: 0, window: WEEKDAYS_ONLY_9_TO_5_UTC });
    expect(result.toISOString()).toBe("2026-08-10T09:00:00.000Z"); // next Monday
  });

  it("adds dayDelay calendar days before rolling into the window", () => {
    const from = new Date("2026-08-03T12:00:00.000Z"); // Monday, inside window
    const result = computeNextSendTime({ from, dayDelay: 2, window: ALL_DAYS_9_TO_5_UTC });
    expect(result.toISOString()).toBe("2026-08-05T12:00:00.000Z"); // same time, 2 days later
  });
});

describe("findNextStep", () => {
  const steps: SequenceStepLike[] = [
    { id: "a", step_order: 0, day_delay: 0 },
    { id: "b", step_order: 1, day_delay: 2 },
    { id: "c", step_order: 2, day_delay: 3 },
  ];

  it("returns the first step (by step_order) when currentStepId is null", () => {
    expect(findNextStep(steps, null)).toEqual(steps[0]);
  });

  it("returns the step immediately after the current one", () => {
    expect(findNextStep(steps, "a")).toEqual(steps[1]);
    expect(findNextStep(steps, "b")).toEqual(steps[2]);
  });

  it("returns null once the sequence is exhausted", () => {
    expect(findNextStep(steps, "c")).toBeNull();
  });

  it("returns the first step when currentStepId doesn't match any step", () => {
    expect(findNextStep(steps, "does-not-exist")).toEqual(steps[0]);
  });

  it("returns null for an empty sequence", () => {
    expect(findNextStep([], null)).toBeNull();
  });

  it("sorts by step_order regardless of input array order", () => {
    const shuffled = [steps[2], steps[0], steps[1]];
    expect(findNextStep(shuffled, null)).toEqual(steps[0]);
  });
});

describe("computeNextSchedule", () => {
  const steps: SequenceStepLike[] = [
    { id: "a", step_order: 0, day_delay: 0 },
    { id: "b", step_order: 1, day_delay: 1 },
  ];

  it("marks the schedule completed when there is no next step", () => {
    const result = computeNextSchedule({
      steps,
      currentStepId: "b",
      from: new Date("2026-08-03T12:00:00.000Z"),
      sendingWindow: ALL_DAYS_9_TO_5_UTC,
    });
    expect(result).toEqual({ nextStepId: null, nextSendAt: null, completed: true });
  });

  it("composes findNextStep and computeNextSendTime for the normal case", () => {
    const from = new Date("2026-08-03T12:00:00.000Z");
    const result = computeNextSchedule({ steps, currentStepId: "a", from, sendingWindow: ALL_DAYS_9_TO_5_UTC });
    expect(result.completed).toBe(false);
    expect(result.nextStepId).toBe("b");
    expect(result.nextSendAt?.toISOString()).toBe("2026-08-04T12:00:00.000Z"); // day_delay: 1
  });

  it("falls back to the default sending window when sendingWindow is invalid/empty", () => {
    // campaigns.sending_window defaults to '{}' — resolveSendingWindow must
    // not throw, and must fall back to DEFAULT_SENDING_WINDOW (9-17 UTC).
    const from = new Date("2026-08-03T04:00:00.000Z");
    const result = computeNextSchedule({ steps, currentStepId: null, from, sendingWindow: {} });
    expect(result.nextSendAt?.toISOString()).toBe("2026-08-03T09:00:00.000Z");
  });
});

describe("computeRetryDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits 5 minutes after the first attempt", () => {
    expect(computeRetryDelay(1).toISOString()).toBe("2026-08-03T12:05:00.000Z");
  });

  it("waits 15 minutes after the second attempt", () => {
    expect(computeRetryDelay(2).toISOString()).toBe("2026-08-03T12:15:00.000Z");
  });

  it("waits 24 hours after the fifth attempt", () => {
    expect(computeRetryDelay(5).toISOString()).toBe("2026-08-04T12:00:00.000Z");
  });

  it("caps at the last rung for attempts beyond the ladder's length", () => {
    expect(computeRetryDelay(999).toISOString()).toBe(computeRetryDelay(5).toISOString());
  });

  it("clamps non-positive attempt counts to the first rung", () => {
    expect(computeRetryDelay(0).toISOString()).toBe("2026-08-03T12:05:00.000Z");
  });
});
