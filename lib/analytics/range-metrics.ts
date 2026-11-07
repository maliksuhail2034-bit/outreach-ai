import { DateTime, IANAZone } from "luxon";

import type { Client } from "@/lib/db/shared";
import type { DailyCount } from "./time-buckets";
import { rate } from "./metrics";
import { calculateTrend, type TrendResult } from "./trends";

// Range-scoped analytics for the /analytics page, aggregated in Postgres by
// analytics_daily_event_counts()/analytics_campaign_event_counts() (see
// supabase/migrations/20261106100000_analytics_range_metrics.sql) instead
// of from capped raw-row fetches in Node.

export type RangePreset = "today" | "7d" | "30d" | "90d";

export const RANGE_PRESETS: { preset: RangePreset; label: string; days: number }[] = [
  { preset: "today", label: "Today", days: 1 },
  { preset: "7d", label: "7 days", days: 7 },
  { preset: "30d", label: "30 days", days: 30 },
  { preset: "90d", label: "90 days", days: 90 },
];

export interface ZonedRange {
  // Inclusive calendar dates in `timezone`.
  start: string;
  end: string;
  // Half-open UTC instants [since, until) covering those dates.
  since: string;
  until: string;
  timezone: string;
  days: number;
}

export function safeTimezone(timezone: string | null | undefined): string {
  return timezone && IANAZone.isValidZone(timezone) ? timezone : "UTC";
}

// "Last N days" ends today in the user's own timezone, so "Today" means their
// today, not UTC's.
export function resolveZonedRange(preset: RangePreset, timezone: string, now: Date = new Date()): ZonedRange {
  const zone = safeTimezone(timezone);
  const days = RANGE_PRESETS.find((option) => option.preset === preset)?.days ?? 7;
  const endDay = DateTime.fromJSDate(now, { zone }).startOf("day");
  const startDay = endDay.minus({ days: days - 1 });
  return {
    start: startDay.toISODate()!,
    end: endDay.toISODate()!,
    since: startDay.toUTC().toISO()!,
    until: endDay.plus({ days: 1 }).toUTC().toISO()!,
    timezone: zone,
    days,
  };
}

// The equal-length window immediately before `range`, for trend comparison.
export function previousZonedRange(range: ZonedRange): ZonedRange {
  const startDay = DateTime.fromISO(range.start, { zone: range.timezone }).minus({ days: range.days });
  const endDay = startDay.plus({ days: range.days - 1 });
  return {
    start: startDay.toISODate()!,
    end: endDay.toISODate()!,
    since: startDay.toUTC().toISO()!,
    until: endDay.plus({ days: 1 }).toUTC().toISO()!,
    timezone: range.timezone,
    days: range.days,
  };
}

export interface CampaignEventRow {
  campaign_id: string;
  event_type: string;
  event_count: number;
  unique_leads: number;
}

export interface DailyEventRow {
  day: string;
  event_type: string;
  event_count: number;
}

export interface RangeTotals {
  sent: number;
  // Distinct leads emailed in the range (per campaign) — the denominator for
  // engagement rates, the way Lemlist/Instantly report "contacted".
  contacted: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  replies: number;
  uniqueReplies: number;
  bounced: number;
  unsubscribed: number;
  failed: number;
}

export interface RangeRates {
  openRate: number | null;
  clickRate: number | null;
  replyRate: number | null;
  bounceRate: number | null;
  unsubscribeRate: number | null;
}

const EMPTY_TOTALS: RangeTotals = {
  sent: 0,
  contacted: 0,
  opens: 0,
  uniqueOpens: 0,
  clicks: 0,
  uniqueClicks: 0,
  replies: 0,
  uniqueReplies: 0,
  bounced: 0,
  unsubscribed: 0,
  failed: 0,
};

export function summarizeEventRows(rows: CampaignEventRow[]): RangeTotals {
  const totals = { ...EMPTY_TOTALS };
  for (const row of rows) {
    const count = Number(row.event_count);
    const unique = Number(row.unique_leads);
    switch (row.event_type) {
      case "sent":
        totals.sent += count;
        totals.contacted += unique;
        break;
      case "opened":
        totals.opens += count;
        totals.uniqueOpens += unique;
        break;
      case "clicked":
        totals.clicks += count;
        totals.uniqueClicks += unique;
        break;
      case "replied":
        totals.replies += count;
        totals.uniqueReplies += unique;
        break;
      case "bounced":
        totals.bounced += count;
        break;
      case "unsubscribed":
        totals.unsubscribed += count;
        break;
      case "failed":
        totals.failed += count;
        break;
    }
  }
  return totals;
}

// Engagement in a window can belong to emails sent before it began (a reply
// today to last week's email), so a short window can exceed 100% — capped,
// since "over 100% reply rate" reads as a bug rather than as timing.
function cappedRate(numerator: number, denominator: number): number | null {
  const value = rate(numerator, denominator);
  return value === null ? null : Math.min(100, value);
}

export function rangeRates(totals: RangeTotals): RangeRates {
  return {
    openRate: cappedRate(totals.uniqueOpens, totals.contacted),
    clickRate: cappedRate(totals.uniqueClicks, totals.contacted),
    replyRate: cappedRate(totals.uniqueReplies, totals.contacted),
    bounceRate: cappedRate(totals.bounced, totals.sent),
    unsubscribeRate: cappedRate(totals.unsubscribed, totals.contacted),
  };
}

export function totalsTrends(current: RangeTotals, previous: RangeTotals): Record<keyof RangeTotals, TrendResult> {
  const result = {} as Record<keyof RangeTotals, TrendResult>;
  for (const key of Object.keys(current) as (keyof RangeTotals)[]) {
    result[key] = calculateTrend(current[key], previous[key]);
  }
  return result;
}

// One zero-filled series per event type across every day of the range, so a
// quiet day renders as an empty bar instead of disappearing.
export function dailySeries(rows: DailyEventRow[], range: ZonedRange, eventType: string): DailyCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.event_type !== eventType) continue;
    counts.set(row.day, (counts.get(row.day) ?? 0) + Number(row.event_count));
  }
  const series: DailyCount[] = [];
  let cursor = DateTime.fromISO(range.start, { zone: "UTC" });
  const end = DateTime.fromISO(range.end, { zone: "UTC" });
  while (cursor <= end) {
    const key = cursor.toISODate()!;
    series.push({ date: key, value: counts.get(key) ?? 0 });
    cursor = cursor.plus({ days: 1 });
  }
  return series;
}

export function campaignTotals(rows: CampaignEventRow[]): Map<string, RangeTotals> {
  const byCampaign = new Map<string, CampaignEventRow[]>();
  for (const row of rows) {
    const list = byCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    byCampaign.set(row.campaign_id, list);
  }
  const result = new Map<string, RangeTotals>();
  for (const [campaignId, campaignRows] of byCampaign) {
    result.set(campaignId, summarizeEventRows(campaignRows));
  }
  return result;
}

export async function fetchCampaignEventCounts(supabase: Client, range: ZonedRange): Promise<CampaignEventRow[]> {
  const { data, error } = await supabase.rpc("analytics_campaign_event_counts", {
    p_since: range.since,
    p_until: range.until,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchDailyEventCounts(supabase: Client, range: ZonedRange): Promise<DailyEventRow[]> {
  const { data, error } = await supabase.rpc("analytics_daily_event_counts", {
    p_since: range.since,
    p_until: range.until,
    p_timezone: range.timezone,
  });
  if (error) throw error;
  return data ?? [];
}
