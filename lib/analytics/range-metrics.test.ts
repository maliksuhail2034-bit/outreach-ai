import { describe, expect, it } from "vitest";

import {
  campaignTotals,
  dailySeries,
  previousZonedRange,
  rangeRates,
  resolveZonedRange,
  safeTimezone,
  summarizeEventRows,
  totalsTrends,
  type CampaignEventRow,
} from "./range-metrics";

const NOW = new Date("2026-11-06T02:30:00.000Z"); // Fri 07:30 in Asia/Karachi, still Thu 18:30 in Los Angeles

describe("resolveZonedRange", () => {
  it("ends today in the user's own timezone, not UTC", () => {
    expect(resolveZonedRange("today", "America/Los_Angeles", NOW)).toMatchObject({
      start: "2026-11-05",
      end: "2026-11-05",
      since: "2026-11-05T08:00:00.000Z",
      until: "2026-11-06T08:00:00.000Z",
      days: 1,
    });
    expect(resolveZonedRange("today", "Asia/Karachi", NOW)).toMatchObject({ start: "2026-11-06", end: "2026-11-06" });
  });

  it("covers N whole local days for the N-day presets", () => {
    const range = resolveZonedRange("7d", "UTC", NOW);
    expect(range).toMatchObject({ start: "2026-10-31", end: "2026-11-06", since: "2026-10-31T00:00:00.000Z", until: "2026-11-07T00:00:00.000Z" });
  });

  it("falls back to UTC for an unknown timezone instead of throwing", () => {
    expect(safeTimezone("Not/AZone")).toBe("UTC");
    expect(safeTimezone(null)).toBe("UTC");
    expect(resolveZonedRange("30d", "Not/AZone", NOW).timezone).toBe("UTC");
  });
});

describe("previousZonedRange", () => {
  it("is the equal-length window immediately before", () => {
    const range = resolveZonedRange("7d", "UTC", NOW);
    expect(previousZonedRange(range)).toMatchObject({
      start: "2026-10-24",
      end: "2026-10-30",
      since: "2026-10-24T00:00:00.000Z",
      until: "2026-10-31T00:00:00.000Z",
    });
  });
});

const ROWS: CampaignEventRow[] = [
  { campaign_id: "c1", event_type: "sent", event_count: 100, unique_leads: 80 },
  { campaign_id: "c1", event_type: "opened", event_count: 90, unique_leads: 40 },
  { campaign_id: "c1", event_type: "replied", event_count: 9, unique_leads: 8 },
  { campaign_id: "c1", event_type: "bounced", event_count: 2, unique_leads: 2 },
  { campaign_id: "c2", event_type: "sent", event_count: 50, unique_leads: 20 },
  { campaign_id: "c2", event_type: "clicked", event_count: 6, unique_leads: 4 },
  { campaign_id: "c2", event_type: "unsubscribed", event_count: 1, unique_leads: 1 },
  { campaign_id: "c2", event_type: "failed", event_count: 3, unique_leads: 3 },
];

describe("summarizeEventRows / rangeRates", () => {
  it("totals counts across campaigns and uses distinct leads for engagement", () => {
    const totals = summarizeEventRows(ROWS);
    expect(totals).toEqual({
      sent: 150,
      contacted: 100,
      opens: 90,
      uniqueOpens: 40,
      clicks: 6,
      uniqueClicks: 4,
      replies: 9,
      uniqueReplies: 8,
      bounced: 2,
      unsubscribed: 1,
      failed: 3,
    });
    expect(rangeRates(totals)).toEqual({ openRate: 40, clickRate: 4, replyRate: 8, bounceRate: 1.3, unsubscribeRate: 1 });
  });

  it("reports no rate (not 0%) when nothing was sent", () => {
    expect(rangeRates(summarizeEventRows([]))).toEqual({
      openRate: null,
      clickRate: null,
      replyRate: null,
      bounceRate: null,
      unsubscribeRate: null,
    });
  });

  it("caps a rate at 100% when engagement belongs to earlier sends", () => {
    const totals = summarizeEventRows([
      { campaign_id: "c1", event_type: "sent", event_count: 1, unique_leads: 1 },
      { campaign_id: "c1", event_type: "replied", event_count: 5, unique_leads: 5 },
    ]);
    expect(rangeRates(totals).replyRate).toBe(100);
  });

  it("accepts bigint-as-string counts from PostgREST", () => {
    const totals = summarizeEventRows([
      { campaign_id: "c1", event_type: "sent", event_count: "12" as unknown as number, unique_leads: "10" as unknown as number },
    ]);
    expect(totals.sent).toBe(12);
    expect(totals.contacted).toBe(10);
  });
});

describe("campaignTotals", () => {
  it("splits rows per campaign", () => {
    const byCampaign = campaignTotals(ROWS);
    expect(byCampaign.get("c1")?.sent).toBe(100);
    expect(byCampaign.get("c2")?.failed).toBe(3);
    expect(byCampaign.has("c3")).toBe(false);
  });
});

describe("totalsTrends", () => {
  it("compares every total with the previous period", () => {
    const current = summarizeEventRows(ROWS);
    const previous = { ...current, sent: 75, failed: 0 };
    const trends = totalsTrends(current, previous);
    expect(trends.sent).toEqual({ direction: "up", percentageChange: 100 });
    expect(trends.failed.direction).toBe("up");
    expect(trends.contacted).toEqual({ direction: "stable", percentageChange: 0 });
  });
});

describe("dailySeries", () => {
  it("zero-fills every day in range for one event type", () => {
    const range = resolveZonedRange("7d", "UTC", NOW);
    const series = dailySeries(
      [
        { day: "2026-11-01", event_type: "sent", event_count: 4 },
        { day: "2026-11-06", event_type: "sent", event_count: 2 },
        { day: "2026-11-06", event_type: "replied", event_count: 9 },
      ],
      range,
      "sent",
    );
    expect(series).toHaveLength(7);
    expect(series[0]).toEqual({ date: "2026-10-31", value: 0 });
    expect(series.find((point) => point.date === "2026-11-01")?.value).toBe(4);
    expect(series.at(-1)).toEqual({ date: "2026-11-06", value: 2 });
  });
});
