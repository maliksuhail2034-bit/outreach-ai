// Pure, presentation-layer aggregation for the analytics section. Takes
// already-fetched timestamps and buckets them by calendar day — no
// database access, no business logic, nothing that affects the send
// pipeline. Days with zero activity are included (as 0) so charts don't
// silently skip gaps.

export interface DailyCount {
  date: string; // YYYY-MM-DD
  value: number;
}

function toDateKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

export function bucketByDay(timestamps: string[], days: number): DailyCount[] {
  const counts = new Map<string, number>();
  for (const timestamp of timestamps) {
    const key = toDateKey(timestamp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result: DailyCount[] = [];
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - offset);
    const key = day.toISOString().slice(0, 10);
    result.push({ date: key, value: counts.get(key) ?? 0 });
  }
  return result;
}
