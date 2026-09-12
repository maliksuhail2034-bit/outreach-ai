import { describe, expect, it } from "vitest";
import { normalizeRazorpaySubscriptionStatus } from "./razorpay-status";

describe("normalizeRazorpaySubscriptionStatus", () => {
  // The approved mapping table — every value CONFIRMED in the Phase 0/final
  // design review, tested individually so a future accidental edit to the
  // internal map is caught immediately rather than discovered downstream.
  it.each([
    ["created", "pending"],
    ["authenticated", "pending"],
    ["active", "active"],
    ["pending", "past_due"],
    ["halted", "suspended"],
    ["paused", "suspended"],
    ["cancelled", "cancelled"],
    ["expired", "expired"],
    ["completed", "completed"],
  ] as const)("maps Razorpay status %s to normalized status %s", (razorpayStatus, expected) => {
    expect(normalizeRazorpaySubscriptionStatus(razorpayStatus)).toBe(expected);
  });

  it("fails safe (suspended, not active) for an unrecognized status", () => {
    expect(normalizeRazorpaySubscriptionStatus("some_future_status_not_yet_mapped")).toBe("suspended");
  });

  it("fails safe for an empty string", () => {
    expect(normalizeRazorpaySubscriptionStatus("")).toBe("suspended");
  });

  it("never returns a status that implies access for an unrecognized input", () => {
    const ACCESS_GRANTING = new Set(["active", "past_due"]);
    expect(ACCESS_GRANTING.has(normalizeRazorpaySubscriptionStatus("totally_unknown"))).toBe(false);
  });
});
