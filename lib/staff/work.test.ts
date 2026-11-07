import { describe, expect, it } from "vitest";

import { formatDuration, secondsBetween, workDone, workTotals } from "./work";

const NOW = new Date("2026-11-07T12:00:00Z");
const session = (start: string, last: string, ended: string | null = null) => ({ started_at: start, last_activity_at: last, ended_at: ended });

describe("workTotals", () => {
  it("adds today's, this week's and this month's session time", () => {
    const totals = workTotals(
      [
        session("2026-11-07T09:00:00Z", "2026-11-07T10:30:00Z", "2026-11-07T10:30:00Z"), // 1.5 h today
        session("2026-11-05T09:00:00Z", "2026-11-05T11:00:00Z", "2026-11-05T11:00:00Z"), // 2 h this week
        session("2026-10-20T09:00:00Z", "2026-10-20T10:00:00Z", "2026-10-20T10:00:00Z"), // 1 h this month
      ],
      NOW,
    );
    expect(totals.todaySeconds).toBe(5400);
    expect(totals.weekSeconds).toBe(5400 + 7200);
    expect(totals.monthSeconds).toBe(5400 + 7200 + 3600);
    expect(totals.sessionsThisMonth).toBe(3);
  });

  it("counts an open session only up to its last activity, never to now", () => {
    const totals = workTotals([session("2026-11-07T11:00:00Z", "2026-11-07T11:20:00Z")], NOW);
    expect(totals.todaySeconds).toBe(1200);
  });

  it("splits a session that crosses midnight between the two days", () => {
    const totals = workTotals([session("2026-11-06T23:30:00Z", "2026-11-07T00:30:00Z", "2026-11-07T00:30:00Z")], NOW);
    expect(totals.todaySeconds).toBe(1800);
    const byDay = Object.fromEntries(totals.daily.map((day) => [day.date, day.seconds]));
    expect(byDay["2026-11-06"]).toBe(1800);
    expect(byDay["2026-11-07"]).toBe(1800);
    expect(totals.daily).toHaveLength(14);
  });

  it("never counts negative time for a malformed session", () => {
    expect(secondsBetween(session("2026-11-07T10:00:00Z", "2026-11-07T09:00:00Z"), 0, NOW.getTime())).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(45 * 60)).toBe("45 min");
    expect(formatDuration(3 * 3600)).toBe("3 h");
    expect(formatDuration(3 * 3600 + 25 * 60 + 59)).toBe("3 h 25 min");
  });
});

describe("workDone", () => {
  it("groups actions with readable labels and sums item volumes", () => {
    const rows = workDone([
      { action: "leads.uploaded", metadata: { inserted: 120 } },
      { action: "leads.uploaded", metadata: { inserted: 80 } },
      { action: "leads.status_retired", metadata: { count: 5 } },
      { action: "ip.blocked", metadata: {} },
      { action: "something.new", metadata: null },
    ]);
    expect(rows[0]).toEqual({ action: "leads.uploaded", label: "Lead batches uploaded", count: 2, items: 200 });
    expect(rows.find((row) => row.action === "leads.status_retired")).toMatchObject({ count: 1, items: 5 });
    expect(rows.find((row) => row.action === "ip.blocked")).toMatchObject({ label: "Addresses blocked", items: null });
    expect(rows.find((row) => row.action === "something.new")?.label).toBe("something.new");
  });
});
