// Shared types for the Analytics Foundation — the event model, date-range
// aggregation, and trend/comparison engines. See events.ts for the event
// catalog and aggregations.ts for how DateRangePreset resolves to a
// concrete DateRange.

export type AnalyticsEventType =
  | "email_sent"
  | "delivered"
  | "bounced"
  | "opened"
  | "clicked"
  | "replied"
  | "positive_reply"
  | "meeting_booked"
  | "unsubscribed"
  | "spam_report"
  | "campaign_completed";

// What kind of thing an event or rollup is about. 'organization' is the
// fallback for anything not scoped to a specific campaign/lead/mailbox/
// domain/warmup profile — see analytics_daily_rollups' migration comment
// for why rollups always set a concrete subject rather than leaving it
// null.
export type AnalyticsSubjectType = "organization" | "campaign" | "lead" | "mailbox" | "domain" | "warmup_profile";

export type DateRangePreset = "today" | "7d" | "30d" | "90d" | "custom";

// The four quick-select presets every per-entity analytics page (Campaign,
// Mailbox, Domain) offers alongside a custom range — shared so each page
// declares the same options once instead of re-typing an identical literal
// array. See components/analytics/date-range-picker.tsx for the control
// that renders these.
export const ANALYTICS_RANGE_OPTIONS: { preset: Exclude<DateRangePreset, "custom">; label: string }[] = [
  { preset: "today", label: "Today" },
  { preset: "7d", label: "7 Days" },
  { preset: "30d", label: "30 Days" },
  { preset: "90d", label: "90 Days" },
];

// Inclusive on both ends, YYYY-MM-DD (UTC) — matches Postgres `date`
// columns (rollup_date, snapshot_date) and time-buckets.ts's DailyCount.
export interface DateRange {
  start: string;
  end: string;
}

export type TrendDirection = "up" | "down" | "stable";
