import { describe, expect, it } from "vitest";

import { isStaffIdle, STAFF_IDLE_TIMEOUT_MS } from "./idle";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("isStaffIdle", () => {
  it("is idle after 30 minutes without activity", () => {
    expect(isStaffIdle({ lastSeenAt: ago(STAFF_IDLE_TIMEOUT_MS + 1000), lastSignInAt: ago(3_600_000) }, NOW)).toBe(true);
    expect(isStaffIdle({ lastSeenAt: ago(STAFF_IDLE_TIMEOUT_MS - 1000), lastSignInAt: ago(3_600_000) }, NOW)).toBe(false);
  });

  it("never treats a fresh sign-in after a long break as idle", () => {
    expect(isStaffIdle({ lastSeenAt: ago(86_400_000), lastSignInAt: ago(10_000) }, NOW)).toBe(false);
  });

  it("isn't idle with no recorded times (first visit)", () => {
    expect(isStaffIdle({ lastSeenAt: null, lastSignInAt: null }, NOW)).toBe(false);
  });
});
