import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNextSchedule,
  computeNextSendTime,
  computeRetryDelay,
  findNextStep,
  findPreviousStep,
  recomputeNextSendAt,
  resolveLeadSendingWindow,
  resolveSendDecision,
  resolveSendingWindow,
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

describe("findPreviousStep", () => {
  const steps: SequenceStepLike[] = [
    { id: "a", step_order: 0, day_delay: 0 },
    { id: "b", step_order: 1, day_delay: 2 },
    { id: "c", step_order: 2, day_delay: 3 },
  ];

  it("returns null when currentStepId is null", () => {
    expect(findPreviousStep(steps, null)).toBeNull();
  });

  it("returns null for the first step — nothing precedes it", () => {
    expect(findPreviousStep(steps, "a")).toBeNull();
  });

  it("returns the step immediately before the current one", () => {
    expect(findPreviousStep(steps, "b")).toEqual(steps[0]);
    expect(findPreviousStep(steps, "c")).toEqual(steps[1]);
  });

  it("returns null when currentStepId doesn't match any step", () => {
    expect(findPreviousStep(steps, "does-not-exist")).toBeNull();
  });

  it("returns null for an empty sequence", () => {
    expect(findPreviousStep([], "a")).toBeNull();
  });

  it("sorts by step_order regardless of input array order", () => {
    const shuffled = [steps[2], steps[0], steps[1]];
    expect(findPreviousStep(shuffled, "c")).toEqual(steps[1]);
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

// Batch B: the send worker's final sending-window decision. Fixtures use the
// shape of a real production campaign (Asia/Dubai, Sun-Thu, 09:00-17:00).
describe("resolveSendDecision", () => {
  const DUBAI_SUN_TO_THU: SendingWindow = {
    days: ["sun", "mon", "tue", "wed", "thu"],
    startHour: 9,
    endHour: 17,
    timezone: "Asia/Dubai", // UTC+4, no DST
  };

  function decide(nowIso: string, sendingWindow: unknown, sendNowStepId: string | null = null, currentStepId = "step-1") {
    return resolveSendDecision({ now: new Date(nowIso), sendingWindow, currentStepId, sendNowStepId });
  }

  it("sends a normal due lead inside the window", () => {
    // Wed 2026-09-23 10:00 Dubai
    expect(decide("2026-09-23T06:00:00.000Z", DUBAI_SUN_TO_THU)).toEqual({ send: true, usesSendNowBypass: false });
  });

  it("defers a lead due before the window opens to that day's opening", () => {
    // Wed 08:00 Dubai -> Wed 09:00 Dubai
    expect(decide("2026-09-23T04:00:00.000Z", DUBAI_SUN_TO_THU)).toEqual({
      send: false,
      nextSendAt: new Date("2026-09-23T05:00:00.000Z"),
    });
  });

  it("defers a lead due after the window closes to the next allowed day's opening", () => {
    // Wed 18:00 Dubai -> Thu 09:00 Dubai
    expect(decide("2026-09-23T14:00:00.000Z", DUBAI_SUN_TO_THU)).toEqual({
      send: false,
      nextSendAt: new Date("2026-09-24T05:00:00.000Z"),
    });
  });

  it("skips disabled sending days", () => {
    // Fri 09:06 Dubai (Fri and Sat disabled) -> Sun 09:00 Dubai
    expect(decide("2026-09-25T05:06:00.000Z", DUBAI_SUN_TO_THU)).toEqual({
      send: false,
      nextSendAt: new Date("2026-09-27T05:00:00.000Z"),
    });
  });

  it("treats the window as [startHour, endHour) — opening sends, closing defers", () => {
    expect(decide("2026-09-23T05:00:00.000Z", DUBAI_SUN_TO_THU).send).toBe(true); // Wed 09:00
    expect(decide("2026-09-23T13:00:00.000Z", DUBAI_SUN_TO_THU)).toEqual({
      send: false,
      nextSendAt: new Date("2026-09-24T05:00:00.000Z"),
    }); // Wed 17:00 -> Thu 09:00
  });

  it("uses DST-correct local time across America/New_York spring-forward (EDT starts 2026-03-08)", () => {
    const newYork: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, timezone: "America/New_York" };
    // Sat 2026-03-07 18:00 EST (after close) -> Sun 09:00 EDT = 13:00Z, not 14:00Z
    expect(decide("2026-03-07T23:00:00.000Z", newYork)).toEqual({
      send: false,
      nextSendAt: new Date("2026-03-08T13:00:00.000Z"),
    });
    // Sun 2026-03-08 09:30 EDT is inside the window
    expect(decide("2026-03-08T13:30:00.000Z", newYork).send).toBe(true);
  });

  it("sends at any time for a 0-24 window", () => {
    const allDay: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, startHour: 0, endHour: 24, timezone: "Asia/Kolkata" };
    expect(decide("2026-09-22T18:21:53.000Z", allDay).send).toBe(true);
  });

  it("falls back to the default 09:00-17:00 UTC window for an unset/invalid window", () => {
    expect(decide("2026-09-23T20:00:00.000Z", {})).toEqual({
      send: false,
      nextSendAt: new Date("2026-09-24T09:00:00.000Z"),
    });
  });

  it("never defers to the current instant, so a deferred lead isn't immediately due again", () => {
    const now = "2026-09-25T05:06:00.000Z";
    const decision = decide(now, DUBAI_SUN_TO_THU);
    if (decision.send) throw new Error("expected a deferral");
    expect(decision.nextSendAt.getTime()).toBeGreaterThan(new Date(now).getTime());
    // ...and once that opening arrives, the same lead is sendable.
    expect(decide(decision.nextSendAt.toISOString(), DUBAI_SUN_TO_THU).send).toBe(true);
  });

  it("lets an explicit Send Now for the current step bypass the window", () => {
    expect(decide("2026-09-25T05:06:00.000Z", DUBAI_SUN_TO_THU, "step-1", "step-1")).toEqual({
      send: true,
      usesSendNowBypass: true,
    });
  });

  it("never applies a Send Now recorded for another step (no leak into the next step)", () => {
    expect(decide("2026-09-25T05:06:00.000Z", DUBAI_SUN_TO_THU, "step-1", "step-2")).toEqual({
      send: false,
      nextSendAt: new Date("2026-09-27T05:00:00.000Z"),
    });
  });

  it("gives no bypass once the Send Now has been consumed (a failed send's retry waits for the window)", () => {
    // After the worker consumes it, send_now_step_id is null again.
    expect(decide("2026-09-25T05:06:00.000Z", DUBAI_SUN_TO_THU, null, "step-1").send).toBe(false);
  });
});

// Batch G: per-lead timezone. resolveLeadSendingWindow only swaps the
// window's timezone; every schedule below comes from the existing engine,
// so DST handling is luxon's IANA arithmetic in the lead's own zone.
describe("resolveLeadSendingWindow", () => {
  const CAMPAIGN: SendingWindow = { days: ["mon", "tue", "wed", "thu", "fri"], startHour: 9, endHour: 17, timezone: "Asia/Riyadh" };

  it("uses the campaign timezone when the lead has none (null)", () => {
    expect(resolveLeadSendingWindow(CAMPAIGN, null)).toEqual(CAMPAIGN);
    expect(resolveLeadSendingWindow(CAMPAIGN, undefined)).toEqual(CAMPAIGN);
    expect(resolveLeadSendingWindow(CAMPAIGN, "")).toEqual(CAMPAIGN);
  });

  it.each(["Not/A_Zone", "EST5EDT-ish", "America/NewYork", " "])("uses the campaign timezone for an invalid lead timezone %j", (tz) => {
    expect(resolveLeadSendingWindow(CAMPAIGN, tz)).toEqual(CAMPAIGN);
  });

  it("uses a valid lead timezone, keeping the campaign's days and hours", () => {
    expect(resolveLeadSendingWindow(CAMPAIGN, "America/New_York")).toEqual({ ...CAMPAIGN, timezone: "America/New_York" });
  });

  it("applies a lead timezone to the default window when the campaign window is unset/invalid", () => {
    expect(resolveLeadSendingWindow({}, "Asia/Tokyo")).toEqual({ ...resolveSendingWindow({}), timezone: "Asia/Tokyo" });
    expect(resolveLeadSendingWindow({}, null)).toEqual(resolveSendingWindow({}));
  });
});

describe("scheduling in the lead's timezone", () => {
  const UTC_WEEKDAYS: SendingWindow = { days: ["mon", "tue", "wed", "thu", "fri"], startHour: 9, endHour: 17, timezone: "UTC" };
  const EVERY_DAY_8_TO_18_UTC: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, startHour: 8, endHour: 18 };
  const step = (dayDelay: number): SequenceStepLike[] => [{ id: "step-1", step_order: 0, day_delay: dayDelay }];

  function nextSend(campaignWindow: SendingWindow, leadTimezone: string | null, from: string, dayDelay = 0) {
    return computeNextSchedule({
      steps: step(dayDelay),
      currentStepId: null,
      from: new Date(from),
      sendingWindow: resolveLeadSendingWindow(campaignWindow, leadTimezone),
    }).nextSendAt?.toISOString();
  }

  // Tue 2026-09-01 00:00 UTC.
  const TUE_MIDNIGHT_UTC = "2026-09-01T00:00:00.000Z";

  it("a lead without a timezone schedules exactly as the campaign does", () => {
    expect(nextSend(UTC_WEEKDAYS, null, TUE_MIDNIGHT_UTC)).toBe("2026-09-01T09:00:00.000Z");
    expect(nextSend(UTC_WEEKDAYS, null, TUE_MIDNIGHT_UTC)).toBe(
      computeNextSchedule({ steps: step(0), currentStepId: null, from: new Date(TUE_MIDNIGHT_UTC), sendingWindow: UTC_WEEKDAYS })
        .nextSendAt?.toISOString(),
    );
  });

  it("a lead ahead of the campaign timezone gets the campaign hours in its own local time", () => {
    // Tue 09:00 in Tokyo (+9) is already open at 00:00 UTC.
    expect(nextSend(UTC_WEEKDAYS, "Asia/Tokyo", TUE_MIDNIGHT_UTC)).toBe("2026-09-01T00:00:00.000Z");
    // Tue 18:00 Tokyo (09:00Z) is after hours there: next is Wed 09:00 JST.
    expect(nextSend(UTC_WEEKDAYS, "Asia/Tokyo", "2026-09-01T09:00:00.000Z")).toBe("2026-09-02T00:00:00.000Z");
  });

  it("a lead behind the campaign timezone gets the campaign hours in its own local time", () => {
    // Mon 17:00 in Los Angeles (-7) at 00:00Z: next is Tue 09:00 PDT = 16:00Z.
    expect(nextSend(UTC_WEEKDAYS, "America/Los_Angeles", TUE_MIDNIGHT_UTC)).toBe("2026-09-01T16:00:00.000Z");
  });

  it("uses the lead's own weekdays: Friday afternoon UTC is still Friday morning in Los Angeles", () => {
    // Fri 2026-09-04 16:00Z = Fri 09:00 PDT (open) but Fri 16:00 UTC is also open;
    // Fri 2026-09-04 23:00Z = Fri 16:00 PDT (open in LA, closed in UTC).
    expect(nextSend(UTC_WEEKDAYS, "America/Los_Angeles", "2026-09-04T23:00:00.000Z")).toBe("2026-09-04T23:00:00.000Z");
    expect(nextSend(UTC_WEEKDAYS, null, "2026-09-04T23:00:00.000Z")).toBe("2026-09-07T09:00:00.000Z"); // Mon
  });

  describe("DST in the lead's timezone", () => {
    it("US spring-forward: a day's delay keeps the local send time across the missing hour", () => {
      // Sat 2026-03-07 10:00 EST (15:00Z) + 1 day -> Sun 2026-03-08 10:00 EDT (14:00Z), 23h later.
      expect(nextSend(EVERY_DAY_8_TO_18_UTC, "America/New_York", "2026-03-07T15:00:00.000Z", 1)).toBe(
        "2026-03-08T14:00:00.000Z",
      );
    });

    it("US spring-forward: a window opening in the skipped hour moves to the first real instant", () => {
      const twoAm: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, startHour: 2, endHour: 5 };
      // Sun 2026-03-08 00:30 EST (05:30Z): 02:00 doesn't exist that night; it opens at 03:00 EDT (07:00Z).
      expect(nextSend(twoAm, "America/New_York", "2026-03-08T05:30:00.000Z")).toBe("2026-03-08T07:00:00.000Z");
    });

    it("US fall-back: a day's delay keeps the local send time across the repeated hour", () => {
      // Sat 2026-10-31 10:00 EDT (14:00Z) + 1 day -> Sun 2026-11-01 10:00 EST (15:00Z), 25h later.
      expect(nextSend(EVERY_DAY_8_TO_18_UTC, "America/New_York", "2026-10-31T14:00:00.000Z", 1)).toBe(
        "2026-11-01T15:00:00.000Z",
      );
    });

    it("US fall-back: a window opening in the repeated hour uses its first occurrence", () => {
      const oneAm: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, startHour: 1, endHour: 5 };
      // Sun 2026-11-01 00:30 EDT (04:30Z): 01:00 happens twice; the first (EDT) is 05:00Z.
      expect(nextSend(oneAm, "America/New_York", "2026-11-01T04:30:00.000Z")).toBe("2026-11-01T05:00:00.000Z");
    });

    it("EU transition (Europe/London, BST starts 2026-03-29)", () => {
      // Sat 2026-03-28 09:00 GMT (09:00Z) + 1 day -> Sun 2026-03-29 09:00 BST (08:00Z).
      expect(nextSend(EVERY_DAY_8_TO_18_UTC, "Europe/London", "2026-03-28T09:00:00.000Z", 1)).toBe(
        "2026-03-29T08:00:00.000Z",
      );
    });

    it("southern-hemisphere transition (Australia/Sydney, AEDT starts 2026-10-04)", () => {
      // Sat 2026-10-03 09:00 AEST (2026-10-02 23:00Z) + 1 day -> Sun 2026-10-04 09:00 AEDT (2026-10-03 22:00Z).
      expect(nextSend(EVERY_DAY_8_TO_18_UTC, "Australia/Sydney", "2026-10-02T23:00:00.000Z", 1)).toBe(
        "2026-10-03T22:00:00.000Z",
      );
      // And back: Sat 2026-04-04 09:00 AEDT (2026-04-03 22:00Z) + 1 day -> Sun 2026-04-05 09:00 AEST (2026-04-04 23:00Z).
      expect(nextSend(EVERY_DAY_8_TO_18_UTC, "Australia/Sydney", "2026-04-03T22:00:00.000Z", 1)).toBe(
        "2026-04-04T23:00:00.000Z",
      );
    });
  });

  it("the final send decision uses the lead's window (inside for the lead, outside for the campaign)", () => {
    // Fri 2026-09-04 23:00Z: closed in UTC, Fri 16:00 in Los Angeles (open).
    const now = new Date("2026-09-04T23:00:00.000Z");
    const base = { now, currentStepId: "step-1", sendNowStepId: null };
    expect(resolveSendDecision({ ...base, sendingWindow: resolveLeadSendingWindow(UTC_WEEKDAYS, "America/Los_Angeles") })).toEqual({
      send: true,
      usesSendNowBypass: false,
    });
    expect(resolveSendDecision({ ...base, sendingWindow: resolveLeadSendingWindow(UTC_WEEKDAYS, null) })).toEqual({
      send: false,
      nextSendAt: new Date("2026-09-07T09:00:00.000Z"),
    });
  });

  it("recompute re-snaps a queued time into the lead's window", () => {
    // Mon 2026-09-07 10:00Z is inside UTC hours but 03:00 in Los Angeles.
    expect(
      recomputeNextSendAt(new Date("2026-09-07T10:00:00.000Z"), resolveLeadSendingWindow(UTC_WEEKDAYS, "America/Los_Angeles"))
        .toISOString(),
    ).toBe("2026-09-07T16:00:00.000Z");
  });
});

// Overnight windows (endHour < startHour) belong to the day they start and
// end on the next day. Dates: Tue 2026-09-01 ... Fri 09-04, Sat 09-05,
// Sun 09-06, Mon 09-07 (no DST in September for UTC/Riyadh/New York).
describe("overnight sending windows", () => {
  const WEEKDAYS_22_TO_6_UTC: SendingWindow = { days: ["mon", "tue", "wed", "thu", "fri"], startHour: 22, endHour: 6, timezone: "UTC" };
  const ALL_DAYS_23_TO_1_UTC: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, startHour: 23, endHour: 1 };

  function decide(nowIso: string, sendingWindow: unknown, sendNowStepId: string | null = null) {
    return resolveSendDecision({ now: new Date(nowIso), sendingWindow, currentStepId: "step-1", sendNowStepId });
  }
  const SEND = { send: true, usesSendNowBypass: false };
  const deferTo = (iso: string) => ({ send: false, nextSendAt: new Date(iso) });

  describe("22:00 -> 06:00, Mon-Fri (start-day rule)", () => {
    it("sends inside the window, before and after midnight", () => {
      expect(decide("2026-09-01T23:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND); // Tue 23:00
      expect(decide("2026-09-02T03:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND); // Wed 03:00, Tue's window
    });

    it("defers the blocked daytime period to that evening's opening", () => {
      expect(decide("2026-09-01T12:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(deferTo("2026-09-01T22:00:00.000Z"));
    });

    it("treats the window as [22:00, 06:00 next day): 21:59 defers, 22:00 sends, 05:59 sends, 06:00 defers", () => {
      expect(decide("2026-09-01T21:59:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(deferTo("2026-09-01T22:00:00.000Z"));
      expect(decide("2026-09-01T22:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND);
      expect(decide("2026-09-02T05:59:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND);
      expect(decide("2026-09-02T06:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(deferTo("2026-09-02T22:00:00.000Z"));
    });

    it("stays open across the midnight boundary", () => {
      expect(decide("2026-09-01T23:59:59.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND);
      expect(decide("2026-09-02T00:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND);
    });

    it("Friday 23:00 is allowed", () => {
      expect(decide("2026-09-04T23:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND);
    });

    it("Saturday 03:00 is allowed — it belongs to Friday's window", () => {
      expect(decide("2026-09-05T03:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND);
    });

    it("Saturday 06:00 (Friday's window closed) defers to Monday 22:00", () => {
      expect(decide("2026-09-05T06:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(deferTo("2026-09-07T22:00:00.000Z"));
    });

    it("Saturday 22:00 is not allowed — Saturday isn't a start day — and defers to Monday 22:00", () => {
      expect(decide("2026-09-05T22:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(deferTo("2026-09-07T22:00:00.000Z"));
    });

    it("Monday 03:00 is not allowed — Sunday isn't a start day — and defers to Monday 22:00", () => {
      expect(decide("2026-09-07T03:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(deferTo("2026-09-07T22:00:00.000Z"));
    });

    it("Tuesday 03:00 is allowed — it belongs to Monday's window", () => {
      expect(decide("2026-09-08T03:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(SEND);
    });
  });

  describe("23:00 -> 01:00 (closest whole-hour form of 23:30 -> 00:30)", () => {
    it("sends at 23:30 and 00:30, defers at 22:59 and 01:00", () => {
      expect(decide("2026-09-01T23:30:00.000Z", ALL_DAYS_23_TO_1_UTC)).toEqual(SEND);
      expect(decide("2026-09-02T00:30:00.000Z", ALL_DAYS_23_TO_1_UTC)).toEqual(SEND);
      expect(decide("2026-09-01T22:59:00.000Z", ALL_DAYS_23_TO_1_UTC)).toEqual(deferTo("2026-09-01T23:00:00.000Z"));
      expect(decide("2026-09-02T01:00:00.000Z", ALL_DAYS_23_TO_1_UTC)).toEqual(deferTo("2026-09-02T23:00:00.000Z"));
    });
  });

  it("17:00 -> 09:00 sends in the evening and defers mid-morning to 17:00", () => {
    const eveningToMorning: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, startHour: 17, endHour: 9 };
    expect(decide("2026-09-01T20:00:00.000Z", eveningToMorning)).toEqual(SEND);
    expect(decide("2026-09-02T08:59:00.000Z", eveningToMorning)).toEqual(SEND);
    expect(decide("2026-09-02T10:00:00.000Z", eveningToMorning)).toEqual(deferTo("2026-09-02T17:00:00.000Z"));
  });

  it("a same-day 09:00 -> 17:00 window is unchanged: no carry-over from the previous day", () => {
    expect(decide("2026-09-02T03:00:00.000Z", ALL_DAYS_9_TO_5_UTC)).toEqual(deferTo("2026-09-02T09:00:00.000Z"));
    expect(decide("2026-09-02T09:00:00.000Z", ALL_DAYS_9_TO_5_UTC)).toEqual(SEND);
    expect(decide("2026-09-02T17:00:00.000Z", ALL_DAYS_9_TO_5_UTC)).toEqual(deferTo("2026-09-03T09:00:00.000Z"));
    expect(decide("2026-09-04T18:00:00.000Z", WEEKDAYS_ONLY_9_TO_5_UTC)).toEqual(deferTo("2026-09-07T09:00:00.000Z"));
  });

  it("an equal start/end window is invalid and falls back to the default 09:00-17:00 UTC", () => {
    expect(resolveSendingWindow({ ...ALL_DAYS_9_TO_5_UTC, startHour: 9, endHour: 9 })).toEqual(resolveSendingWindow({}));
  });

  it("sweeping every 30 minutes across a full week always lands inside the local overnight window, on an allowed start day", () => {
    const window: SendingWindow = { ...WEEKDAYS_22_TO_6_UTC, timezone: "America/New_York" };
    const allowed = new Set([1, 2, 3, 4, 5]);
    const isInside = (local: DateTime) =>
      (local.hour >= 22 && allowed.has(local.weekday)) || (local.hour < 6 && allowed.has(local.minus({ days: 1 }).weekday));

    let from = DateTime.fromISO("2026-09-06T00:00:00", { zone: "America/New_York" }); // Sun
    for (let i = 0; i < 7 * 48; i++, from = from.plus({ minutes: 30 })) {
      const result = DateTime.fromJSDate(computeNextSendTime({ from: from.toJSDate(), dayDelay: 0, window })).setZone(window.timezone);
      expect(isInside(result), `from ${from.toISO()} -> ${result.toISO()}`).toBe(true);
      expect(result.toMillis()).toBeGreaterThanOrEqual(from.toMillis());
      // Minimal: an instant already inside comes back unchanged, one outside goes to the next opening.
      if (isInside(from)) expect(result.toMillis()).toBe(from.toMillis());
      else expect([result.hour, result.minute]).toEqual([22, 0]);
    }
  });

  describe("follow-ups (computeNextSchedule)", () => {
    const steps: SequenceStepLike[] = [
      { id: "step-1", step_order: 0, day_delay: 0 },
      { id: "step-2", step_order: 1, day_delay: 1 },
    ];
    const next = (from: string) =>
      computeNextSchedule({ steps, currentStepId: "step-1", from: new Date(from), sendingWindow: WEEKDAYS_22_TO_6_UTC });

    it("a follow-up a day after a 23:30 send is due at 23:30 the next night", () => {
      expect(next("2026-09-01T23:30:00.000Z")).toEqual({ nextStepId: "step-2", nextSendAt: new Date("2026-09-02T23:30:00.000Z"), completed: false });
    });

    it("a follow-up a day after a 04:00 send is due at 04:00 the next morning (the following night's window)", () => {
      expect(next("2026-09-02T04:00:00.000Z").nextSendAt).toEqual(new Date("2026-09-03T04:00:00.000Z"));
    });

    it("a follow-up landing on the weekend waits for Monday 22:00", () => {
      expect(next("2026-09-04T23:30:00.000Z").nextSendAt).toEqual(new Date("2026-09-07T22:00:00.000Z")); // -> Sat 23:30
      expect(next("2026-09-05T04:00:00.000Z").nextSendAt).toEqual(new Date("2026-09-07T22:00:00.000Z")); // -> Sun 04:00
    });

    it("a same-day (day_delay 0) first step inside the window is due immediately", () => {
      expect(
        computeNextSchedule({ steps, currentStepId: null, from: new Date("2026-09-02T04:00:00.000Z"), sendingWindow: WEEKDAYS_22_TO_6_UTC }).nextSendAt,
      ).toEqual(new Date("2026-09-02T04:00:00.000Z"));
    });
  });

  describe("schedule edits (recomputeNextSendAt)", () => {
    it("re-snaps a queued daytime send into the new overnight window, idempotently", () => {
      const once = recomputeNextSendAt(new Date("2026-09-01T10:00:00.000Z"), WEEKDAYS_22_TO_6_UTC);
      expect(once.toISOString()).toBe("2026-09-01T22:00:00.000Z");
      expect(recomputeNextSendAt(once, WEEKDAYS_22_TO_6_UTC).getTime()).toBe(once.getTime());
    });

    it("leaves a queued time already inside the overnight window unchanged", () => {
      expect(recomputeNextSendAt(new Date("2026-09-02T03:00:00.000Z"), WEEKDAYS_22_TO_6_UTC).toISOString()).toBe("2026-09-02T03:00:00.000Z");
    });

    it("re-snaps an overnight queued time back into a same-day window when the schedule is changed back", () => {
      expect(recomputeNextSendAt(new Date("2026-09-02T03:00:00.000Z"), ALL_DAYS_9_TO_5_UTC).toISOString()).toBe("2026-09-02T09:00:00.000Z");
    });
  });

  describe("DST (America/New_York, every day 22:00 -> 06:00)", () => {
    const NEW_YORK_22_TO_6: SendingWindow = { ...ALL_DAYS_9_TO_5_UTC, startHour: 22, endHour: 6, timezone: "America/New_York" };

    it("spring-forward night (EDT starts 2026-03-08, a 7-hour night): opens 22:00 EST, closes 06:00 EDT", () => {
      expect(decide("2026-03-08T02:59:00.000Z", NEW_YORK_22_TO_6)).toEqual(deferTo("2026-03-08T03:00:00.000Z")); // Sat 21:59 EST
      expect(decide("2026-03-08T03:00:00.000Z", NEW_YORK_22_TO_6)).toEqual(SEND); // Sat 22:00 EST
      expect(decide("2026-03-08T07:30:00.000Z", NEW_YORK_22_TO_6)).toEqual(SEND); // Sun 03:30 EDT
      expect(decide("2026-03-08T09:59:00.000Z", NEW_YORK_22_TO_6)).toEqual(SEND); // Sun 05:59 EDT
      expect(decide("2026-03-08T10:00:00.000Z", NEW_YORK_22_TO_6)).toEqual(deferTo("2026-03-09T02:00:00.000Z")); // 06:00 EDT -> Sun 22:00 EDT
    });

    it("spring-forward: an end hour in the skipped hour closes at the first real instant after it (03:00 EDT)", () => {
      const tenToTwo: SendingWindow = { ...NEW_YORK_22_TO_6, endHour: 2 };
      expect(decide("2026-03-08T06:59:00.000Z", tenToTwo)).toEqual(SEND); // Sun 01:59 EST
      expect(decide("2026-03-08T07:00:00.000Z", tenToTwo)).toEqual(deferTo("2026-03-09T02:00:00.000Z")); // 03:00 EDT
    });

    it("fall-back night (EST resumes 2026-11-01, a 9-hour night): both 01:30s are inside, closes 06:00 EST", () => {
      expect(decide("2026-11-01T02:00:00.000Z", NEW_YORK_22_TO_6)).toEqual(SEND); // Sat 22:00 EDT
      expect(decide("2026-11-01T05:30:00.000Z", NEW_YORK_22_TO_6)).toEqual(SEND); // 01:30 EDT
      expect(decide("2026-11-01T06:30:00.000Z", NEW_YORK_22_TO_6)).toEqual(SEND); // 01:30 EST
      expect(decide("2026-11-01T10:59:00.000Z", NEW_YORK_22_TO_6)).toEqual(SEND); // 05:59 EST
      expect(decide("2026-11-01T11:00:00.000Z", NEW_YORK_22_TO_6)).toEqual(deferTo("2026-11-02T03:00:00.000Z")); // 06:00 EST -> Sun 22:00 EST
    });

    it("a follow-up a day after a 23:00 send keeps local 23:00 across spring-forward", () => {
      // Sat 2026-03-07 23:00 EST (03-08 04:00Z) + 1 day -> Sun 23:00 EDT (03-09 03:00Z), 23h later.
      expect(computeNextSendTime({ from: new Date("2026-03-08T04:00:00.000Z"), dayDelay: 1, window: NEW_YORK_22_TO_6 }).toISOString()).toBe(
        "2026-03-09T03:00:00.000Z",
      );
    });
  });

  describe("per-lead timezone (campaign Mon-Fri 22:00 -> 06:00 UTC, lead in Asia/Riyadh, UTC+3)", () => {
    const base = { currentStepId: "step-1", sendNowStepId: null };
    const leadWindow = resolveLeadSendingWindow(WEEKDAYS_22_TO_6_UTC, "Asia/Riyadh");
    const campaignWindow = resolveLeadSendingWindow(WEEKDAYS_22_TO_6_UTC, null);

    it("keeps the campaign's overnight hours in the lead's own timezone", () => {
      expect(leadWindow).toEqual({ ...WEEKDAYS_22_TO_6_UTC, timezone: "Asia/Riyadh" });
    });

    it("Fri 20:00Z is Fri 23:00 for the lead (inside) but before the campaign's 22:00 UTC opening", () => {
      const now = new Date("2026-09-04T20:00:00.000Z");
      expect(resolveSendDecision({ ...base, now, sendingWindow: leadWindow })).toEqual(SEND);
      expect(resolveSendDecision({ ...base, now, sendingWindow: campaignWindow })).toEqual(deferTo("2026-09-04T22:00:00.000Z"));
    });

    it("Sat 03:30Z is inside Friday's window in UTC, but Sat 06:30 for the lead — deferred to Mon 22:00 Riyadh", () => {
      const now = new Date("2026-09-05T03:30:00.000Z");
      expect(resolveSendDecision({ ...base, now, sendingWindow: campaignWindow })).toEqual(SEND);
      expect(resolveSendDecision({ ...base, now, sendingWindow: leadWindow })).toEqual(deferTo("2026-09-07T19:00:00.000Z"));
    });
  });

  describe("Send Now and retries", () => {
    it("an explicit Send Now for the current step still bypasses the blocked daytime period", () => {
      expect(decide("2026-09-01T12:00:00.000Z", WEEKDAYS_22_TO_6_UTC, "step-1")).toEqual({ send: true, usesSendNowBypass: true });
    });

    it("a Send Now for another step gives no bypass", () => {
      expect(decide("2026-09-01T12:00:00.000Z", WEEKDAYS_22_TO_6_UTC, "step-0")).toEqual(deferTo("2026-09-01T22:00:00.000Z"));
    });

    it("a retry coming due in the blocked period is deferred to the next opening", () => {
      // computeRetryDelay isn't window-aware; the final check defers it (a Tue 07:00 retry -> Tue 22:00).
      expect(decide("2026-09-01T07:00:00.000Z", WEEKDAYS_22_TO_6_UTC)).toEqual(deferTo("2026-09-01T22:00:00.000Z"));
    });
  });
});
