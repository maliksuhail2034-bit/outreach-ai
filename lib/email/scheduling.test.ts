import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNextSchedule,
  computeNextSendTime,
  computeRetryDelay,
  findNextStep,
  recomputeNextSendAt,
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

// Batch 4: full IANA timezone support + explicit, timezone-aware sending
// windows. Asia/Riyadh has no DST (fixed UTC+3 year-round) — a clean check
// that the window is interpreted in local time, not UTC, with no DST
// complexity muddying the assertion.
describe("computeNextSendTime — Asia/Riyadh (fixed UTC+3, no DST)", () => {
  const RIYADH_9_TO_5: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, timezone: "Asia/Riyadh" };

  it("rolls a UTC instant that's before the local window to local window start, not UTC window start", () => {
    // 04:00 UTC = 07:00 Riyadh — before the 09:00 local start, so it must
    // roll to 09:00 Riyadh (06:00 UTC), not 09:00 UTC (which the old
    // implicit-UTC behavior would have produced).
    const from = new Date("2026-08-03T04:00:00.000Z");
    const result = computeNextSendTime({ from, dayDelay: 0, window: RIYADH_9_TO_5 });
    expect(result.toISOString()).toBe("2026-08-03T06:00:00.000Z");
  });

  it("treats a UTC instant inside the local window as already due", () => {
    // 10:00 UTC = 13:00 Riyadh — inside 09:00-17:00 local.
    const from = new Date("2026-08-03T10:00:00.000Z");
    const result = computeNextSendTime({ from, dayDelay: 0, window: RIYADH_9_TO_5 });
    expect(result.toISOString()).toBe(from.toISOString());
  });

  it("rolls to the next day's local window start once today's local window has closed", () => {
    // 15:00 UTC = 18:00 Riyadh — after the 17:00 local close.
    const from = new Date("2026-08-03T15:00:00.000Z");
    const result = computeNextSendTime({ from, dayDelay: 0, window: RIYADH_9_TO_5 });
    expect(result.toISOString()).toBe("2026-08-04T06:00:00.000Z"); // next day, 09:00 Riyadh
  });
});

describe("computeNextSendTime — Europe/London DST (BST starts 2026-03-29)", () => {
  const LONDON_9_TO_5: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, timezone: "Europe/London" };

  it("preserves the intended local wall-clock hour across the spring-forward transition", () => {
    // Friday 2026-03-27 14:00 GMT (offset 0) + 2 days -> Sunday 2026-03-29,
    // already in BST (offset +60). A DST-naive "add exact hours" scheduler
    // would produce 14:00 UTC (15:00 local); the correct, DST-safe answer
    // keeps the wall clock at 14:00 local, which is 13:00 UTC.
    const from = new Date("2026-03-27T14:00:00.000Z");
    const result = computeNextSendTime({ from, dayDelay: 2, window: LONDON_9_TO_5 });

    expect(result.toISOString()).toBe("2026-03-29T13:00:00.000Z");
    const resultLondon = DateTime.fromJSDate(result).setZone("Europe/London");
    expect(resultLondon.hour).toBe(14);
    expect(resultLondon.day).toBe(29);
  });
});

describe("computeNextSendTime — America/New_York DST (EDT starts 2026-03-08)", () => {
  const NEW_YORK_9_TO_5: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, timezone: "America/New_York" };

  it("preserves the intended local wall-clock hour across the spring-forward transition", () => {
    // Friday 2026-03-06 18:00 UTC = 13:00 EST (offset -300) + 2 days ->
    // Sunday 2026-03-08, already in EDT (offset -240). DST-safe result keeps
    // the wall clock at 13:00 local, which is 17:00 UTC — not 18:00 UTC
    // (what naively adding 48 hours in UTC would give).
    const from = new Date("2026-03-06T18:00:00.000Z");
    const result = computeNextSendTime({ from, dayDelay: 2, window: NEW_YORK_9_TO_5 });

    expect(result.toISOString()).toBe("2026-03-08T17:00:00.000Z");
    const resultNewYork = DateTime.fromJSDate(result).setZone("America/New_York");
    expect(resultNewYork.hour).toBe(13);
    expect(resultNewYork.day).toBe(8);
  });
});

// ISO weekday numbers (Luxon's DateTime.weekday: Monday=1 ... Sunday=7) —
// used instead of a locale-dependent name like weekdayShort, which depends
// on the runtime's default locale and would make this test environment-
// dependent for no reason.
const WEEKDAY_NUMBERS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 } as const;

describe("computeNextSendTime — 09:00-17:00 local window is never violated", () => {
  it("sweeping every hour across a full week always lands inside the local window, on an allowed day", () => {
    for (const timezone of ["Asia/Riyadh", "America/New_York", "Europe/London", "Pacific/Auckland"]) {
      const window: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, timezone };
      const allowedWeekdayNumbers = window.days.map((d) => WEEKDAY_NUMBERS[d]);
      for (let hourOffset = 0; hourOffset < 24 * 7; hourOffset++) {
        const from = new Date(Date.UTC(2026, 2, 1, 0, 0, 0) + hourOffset * 60 * 60 * 1000);
        const result = computeNextSendTime({ from, dayDelay: 0, window });
        const local = DateTime.fromJSDate(result).setZone(timezone);

        expect(local.hour, `timezone=${timezone} from=${from.toISOString()}`).toBeGreaterThanOrEqual(9);
        expect(local.hour, `timezone=${timezone} from=${from.toISOString()}`).toBeLessThan(17);
        expect(allowedWeekdayNumbers, `timezone=${timezone}`).toContain(local.weekday);
      }
    }
  });
});

describe("recomputeNextSendAt", () => {
  const RIYADH_9_TO_5: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, timezone: "Asia/Riyadh" };

  it("leaves an already-valid queued time unchanged", () => {
    const current = new Date("2026-08-03T10:00:00.000Z"); // 13:00 Riyadh, inside window
    const result = recomputeNextSendAt(current, RIYADH_9_TO_5);
    expect(result.toISOString()).toBe(current.toISOString());
  });

  it("re-snaps a queued time that's now outside the new window's local hours", () => {
    // Was scheduled for 15:00 UTC (18:00 Riyadh) under whatever window
    // produced it — outside a newly-edited 09:00-17:00 Riyadh window, so it
    // must roll to the next valid instant, not stay outside the window.
    const current = new Date("2026-08-03T15:00:00.000Z");
    const result = recomputeNextSendAt(current, RIYADH_9_TO_5);
    expect(result.toISOString()).toBe("2026-08-04T06:00:00.000Z");
  });

  it("re-snaps into a newly-changed timezone, not the timezone the time was originally computed in", () => {
    // A time that was valid as 12:00 in one zone might land at a completely
    // different local hour once reinterpreted under a new timezone — the
    // recompute must use the NEW window's timezone, not the old one.
    const current = new Date("2026-08-03T12:00:00.000Z"); // valid under UTC 9-17
    const newWindow: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, timezone: "America/Los_Angeles" };
    // 12:00 UTC = 05:00 America/Los_Angeles (PDT, UTC-7) — before the window,
    // so it rolls forward to 09:00 local (16:00 UTC).
    const result = recomputeNextSendAt(current, newWindow);
    expect(result.toISOString()).toBe("2026-08-03T16:00:00.000Z");
  });

  it("respects a narrowed set of allowed days in the new window", () => {
    // 2026-08-08 is a Saturday. If the new window drops weekends, a
    // Saturday-scheduled time must roll forward to the next allowed day.
    const current = new Date("2026-08-08T10:00:00.000Z"); // Saturday, 13:00 Riyadh
    const weekdaysOnly: SendingWindow = { ...RIYADH_9_TO_5, days: ["mon", "tue", "wed", "thu", "fri"] };
    const result = recomputeNextSendAt(current, weekdaysOnly);
    expect(result.toISOString()).toBe("2026-08-10T06:00:00.000Z"); // next Monday, 09:00 Riyadh
  });

  it("is idempotent — recomputing an already-recomputed time returns the same result", () => {
    const current = new Date("2026-08-03T15:00:00.000Z");
    const once = recomputeNextSendAt(current, RIYADH_9_TO_5);
    const twice = recomputeNextSendAt(once, RIYADH_9_TO_5);
    expect(twice.toISOString()).toBe(once.toISOString());
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
