import { z } from "zod";

import type { Client } from "@/lib/db/shared";

// Reads traffic_summary() (supabase/migrations/20261108100000_page_views.sql)
// for the console's Traffic page. Service-role client only.

export const TRAFFIC_RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;
export type TrafficRangeDays = (typeof TRAFFIC_RANGES)[number]["days"];

const count = z.coerce.number().int().nonnegative();
const breakdownRow = z.object({ key: z.string(), views: count, visitors: count });

const summarySchema = z.object({
  page_views: count,
  visitors: count,
  signed_in_views: count,
  countries_count: count,
  daily: z.array(z.object({ date: z.string(), views: count, visitors: count })),
  countries: z.array(breakdownRow),
  pages: z.array(breakdownRow),
  referrers: z.array(breakdownRow),
  devices: z.array(breakdownRow),
});

export type TrafficSummary = z.infer<typeof summarySchema>;
export type TrafficBreakdownRow = z.infer<typeof breakdownRow>;

export function parseTrafficRange(value: string | undefined): TrafficRangeDays {
  const days = Number(value);
  return TRAFFIC_RANGES.find((range) => range.days === days)?.days ?? 30;
}

// Inclusive UTC date window ending today, and the same-length window before it.
export function trafficWindows(days: number, now: Date = new Date()) {
  const dayMs = 86_400_000;
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = today - (days - 1) * dayMs;
  return {
    current: { from: iso(from), to: iso(today) },
    previous: { from: iso(from - days * dayMs), to: iso(from - dayMs) },
  };
}

// Percentage change, or null when there is nothing to compare against.
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export async function getTrafficSummary(supabase: Client, from: string, to: string, limit = 10): Promise<TrafficSummary> {
  const { data, error } = await supabase.rpc("traffic_summary", { p_from: from, p_to: to, p_limit: limit });
  if (error) throw error;
  return summarySchema.parse(data);
}

// "IN" -> "India", "??" (not located) -> "Unknown".
export function countryName(code: string, locale = "en"): string {
  if (code === "??") return "Unknown";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
