import type { AnalyticsEventType, AnalyticsSubjectType } from "./types";

// The event/subject catalog — the single source of truth every other
// module (validation, the database check constraints they mirror, the
// dashboard) reads from, the same role lib/billing/plans.ts's PLANS plays
// for plan tiers. Adding a new event type is a two-place change (this
// array + the matching check constraint in the migration), same cost as
// adding one to email_events today — this module doesn't try to make that
// migration-free, just centralizes the app-side half of it.
export const ANALYTICS_EVENT_TYPES: AnalyticsEventType[] = [
  "email_sent",
  "delivered",
  "bounced",
  "opened",
  "clicked",
  "replied",
  "positive_reply",
  "meeting_booked",
  "unsubscribed",
  "spam_report",
  "campaign_completed",
];

export const ANALYTICS_EVENT_LABELS: Record<AnalyticsEventType, string> = {
  email_sent: "Email sent",
  delivered: "Delivered",
  bounced: "Bounced",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  positive_reply: "Positive reply",
  meeting_booked: "Meeting booked",
  unsubscribed: "Unsubscribed",
  spam_report: "Spam report",
  campaign_completed: "Campaign completed",
};

// "Positive" events count toward growth-oriented metrics (reply rate,
// meeting rate); "negative" ones count toward risk metrics (bounce/
// complaint rate). Used by metrics.ts's grouped-metric helpers so a future
// feature (AI Insights, benchmarks) can ask "how many positive signals
// this period" without re-deriving the event list itself.
export const POSITIVE_EVENT_TYPES: ReadonlySet<AnalyticsEventType> = new Set(["positive_reply", "meeting_booked"]);
export const NEGATIVE_EVENT_TYPES: ReadonlySet<AnalyticsEventType> = new Set([
  "bounced",
  "unsubscribed",
  "spam_report",
]);

export function isAnalyticsEventType(value: string): value is AnalyticsEventType {
  return (ANALYTICS_EVENT_TYPES as string[]).includes(value);
}

export const ANALYTICS_SUBJECT_TYPES: AnalyticsSubjectType[] = [
  "organization",
  "campaign",
  "lead",
  "mailbox",
  "domain",
  "warmup_profile",
];

export function isAnalyticsSubjectType(value: string): value is AnalyticsSubjectType {
  return (ANALYTICS_SUBJECT_TYPES as string[]).includes(value);
}
