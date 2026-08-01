import type { DailyCount } from "./time-buckets";
import type { DateRange, DateRangePreset } from "./types";

// Resolves a user-facing preset ('today'/'7d'/'30d'/'90d'/'custom') to a
// concrete, inclusive DateRange — the one place that decides what "7 Days"
// actually means (today plus the 6 days before it, in UTC), so every
// caller (the dashboard, a future report export, a future scheduled job)
// agrees on the same boundaries instead of each re-deriving them.
const PRESET_DAYS: Record<Exclude<DateRangePreset, "custom">, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function resolveDateRange(
  preset: DateRangePreset,
  custom?: { start: string; end: string },
  now: Date = new Date(),
): DateRange {
  if (preset === "custom") {
    if (!custom) throw new Error("A custom date range requires start and end dates.");
    if (custom.start > custom.end) throw new Error("A custom date range's start must not be after its end.");
    return { start: custom.start, end: custom.end };
  }

  const days = PRESET_DAYS[preset];
  const end = now.toISOString().slice(0, 10);
  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  return { start: startDate.toISOString().slice(0, 10), end };
}

// Whole days spanned by a range, inclusive of both ends (so "today" is 1,
// not 0).
export function daysInRange(range: DateRange): number {
  const start = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

// The immediately-preceding range of the same length — what "vs. last
// period" compares against (see lib/analytics/trends.ts). E.g. the 7 days
// before a 7-day range, not the calendar-aligned "previous week."
export function previousDateRange(range: DateRange): DateRange {
  const days = daysInRange(range);
  const previousEnd = new Date(`${range.start}T00:00:00Z`);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - (days - 1));
  return { start: previousStart.toISOString().slice(0, 10), end: previousEnd.toISOString().slice(0, 10) };
}

// Same operation as time-buckets.ts's bucketByDay, generalized to an
// explicit {start, end} range instead of "N days ending today" — needed
// because a custom range doesn't necessarily end today, which bucketByDay
// assumes. bucketByDay itself is untouched and still exactly right for its
// existing "N days ending now" callers (see app/(app)/analytics/page.tsx);
// this is what a preset/custom-range selector needs instead.
export function bucketByDayInRange(timestamps: string[], range: DateRange): DailyCount[] {
  const counts = new Map<string, number>();
  for (const timestamp of timestamps) {
    const key = timestamp.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result: DailyCount[] = [];
  const cursor = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  if (cursor > end) return result;

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    result.push({ date: key, value: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}
