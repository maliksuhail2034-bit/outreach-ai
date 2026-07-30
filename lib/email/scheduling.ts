import { DateTime } from "luxon";

import {
  SENDING_WINDOW_DAYS,
  sendingWindowSchema,
  type SendingWindow,
  type SendingWindowDay,
} from "@/lib/validations/sending-window";

// Pure scheduling math for the send pipeline: given a lead's current
// position in a sequence, a sending window, and "now", compute when its
// next email is due and which step that is. No database access, no
// provider calls, no side effects of any kind — every function here is a
// deterministic function of its inputs, returning plain timestamps. The
// caller (the sending worker, built separately) is responsible for reading
// the current state from the database and persisting whatever this module
// returns.

export const DEFAULT_SENDING_WINDOW: SendingWindow = {
  days: [...SENDING_WINDOW_DAYS],
  startHour: 9,
  endHour: 17,
  timezone: "UTC",
};

// campaigns.sending_window defaults to '{}' and predates this validated
// shape, so invalid/empty input falls back to a sane default rather than
// throwing — existing campaigns keep working without a data migration.
export function resolveSendingWindow(raw: unknown): SendingWindow {
  const parsed = sendingWindowSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SENDING_WINDOW;
}

const WEEKDAY_TO_LUXON: Record<SendingWindowDay, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

// Rolls `from` forward to the next instant that falls inside `window`,
// walking day-by-day in the window's timezone. Terminates within one week
// since sendingWindowSchema guarantees at least one allowed day.
function nextTimeWithinWindow(from: DateTime, window: SendingWindow): DateTime {
  const allowedWeekdays = new Set(window.days.map((day) => WEEKDAY_TO_LUXON[day]));

  for (let offset = 0; offset <= 7; offset++) {
    const candidateDay = from.plus({ days: offset }).startOf("day");
    if (!allowedWeekdays.has(candidateDay.weekday)) continue;

    const windowStart = candidateDay.set({ hour: window.startHour, minute: 0, second: 0, millisecond: 0 });
    const windowEnd = candidateDay.set({ hour: window.endHour, minute: 0, second: 0, millisecond: 0 });

    if (offset === 0) {
      if (from >= windowStart && from < windowEnd) return from;
      if (from < windowStart) return windowStart;
      continue; // Today's window has already closed — keep looking.
    }

    return windowStart;
  }

  // Unreachable given sendingWindowSchema enforces days.min(1), but keeps
  // this function total instead of implicitly returning undefined.
  throw new Error("No valid sending window found within 7 days — check sending window configuration.");
}

// Adds `dayDelay` calendar days (in the window's timezone, DST-safe via
// luxon) to `from`, then rolls the result forward into the next instant
// that satisfies `window`.
export function computeNextSendTime(params: { from: Date; dayDelay: number; window: SendingWindow }): Date {
  const zonedFrom = DateTime.fromJSDate(params.from).setZone(params.window.timezone);
  const target = zonedFrom.plus({ days: params.dayDelay });
  return nextTimeWithinWindow(target, params.window).toJSDate();
}

export interface SequenceStepLike {
  id: string;
  step_order: number;
  day_delay: number;
}

// currentStepId === null -> the first step (lowest step_order). Otherwise
// the step immediately after currentStepId's step_order. Returns null when
// there is no next step (sequence exhausted).
export function findNextStep(steps: SequenceStepLike[], currentStepId: string | null): SequenceStepLike | null {
  const sorted = [...steps].sort((a, b) => a.step_order - b.step_order);
  if (currentStepId === null) return sorted[0] ?? null;

  const currentIndex = sorted.findIndex((step) => step.id === currentStepId);
  if (currentIndex === -1) return sorted[0] ?? null;
  return sorted[currentIndex + 1] ?? null;
}

export interface NextScheduleResult {
  nextStepId: string | null;
  nextSendAt: Date | null;
  completed: boolean;
}

// Ties findNextStep + computeNextSendTime + resolveSendingWindow together
// into the one computation the worker needs after enrollment, campaign
// activation, or a successful send: "what step is next, and when is it
// due." Still pure — takes plain data, returns plain data.
export function computeNextSchedule(params: {
  steps: SequenceStepLike[];
  currentStepId: string | null;
  from: Date;
  sendingWindow: unknown;
}): NextScheduleResult {
  const nextStep = findNextStep(params.steps, params.currentStepId);
  if (!nextStep) {
    return { nextStepId: null, nextSendAt: null, completed: true };
  }

  const window = resolveSendingWindow(params.sendingWindow);
  const nextSendAt = computeNextSendTime({ from: params.from, dayDelay: nextStep.day_delay, window });

  return { nextStepId: nextStep.id, nextSendAt, completed: false };
}
