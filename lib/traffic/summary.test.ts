import { describe, expect, it, vi } from "vitest";

import type { Client } from "@/lib/db/shared";
import { countryName, getTrafficSummary, parseTrafficRange, percentChange, trafficWindows } from "./summary";

describe("parseTrafficRange", () => {
  it("accepts the offered ranges and defaults to 30 days", () => {
    expect(parseTrafficRange("7")).toBe(7);
    expect(parseTrafficRange("90")).toBe(90);
    expect(parseTrafficRange("365")).toBe(30);
    expect(parseTrafficRange(undefined)).toBe(30);
  });
});

describe("trafficWindows", () => {
  it("ends today (UTC) and compares with the same-length window before it", () => {
    expect(trafficWindows(7, new Date("2026-11-07T23:30:00Z"))).toEqual({
      current: { from: "2026-11-01", to: "2026-11-07" },
      previous: { from: "2026-10-25", to: "2026-10-31" },
    });
  });
});

describe("percentChange", () => {
  it("rounds the change and has nothing to compare against zero", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe("countryName", () => {
  it("names countries and the not-located bucket", () => {
    expect(countryName("IN")).toBe("India");
    expect(countryName("??")).toBe("Unknown");
  });
});

describe("getTrafficSummary", () => {
  it("calls traffic_summary() and validates what comes back", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        page_views: 3,
        visitors: 2,
        signed_in_views: 1,
        countries_count: 1,
        daily: [{ date: "2026-11-07", views: 3, visitors: 2 }],
        countries: [{ key: "IN", views: 3, visitors: 2 }],
        pages: [],
        referrers: [],
        devices: [],
      },
      error: null,
    });
    const summary = await getTrafficSummary({ rpc } as unknown as Client, "2026-11-01", "2026-11-07", 5);
    expect(rpc).toHaveBeenCalledWith("traffic_summary", { p_from: "2026-11-01", p_to: "2026-11-07", p_limit: 5 });
    expect(summary.visitors).toBe(2);
  });

  it("rejects a malformed result instead of rendering it", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { page_views: "lots" }, error: null });
    await expect(getTrafficSummary({ rpc } as unknown as Client, "a", "b")).rejects.toThrow();
  });
});
