import { describe, expect, it } from "vitest";
import { formatMoney, usdCentsToInrPaise, USD_TO_INR_RATE, ROUTE_CURRENCY } from "./currency";

describe("USD_TO_INR_RATE", () => {
  it("is the approved fixed conversion basis (96), not a live rate", () => {
    // Locks the approved value in a visible, deliberate assertion — a
    // future change to this rate should show up as an obvious diff here,
    // never as silent drift.
    expect(USD_TO_INR_RATE).toBe(96);
  });
});

describe("usdCentsToInrPaise", () => {
  it("converts Starter's $12 launch price at the fixed rate: 1200 * 96 = 115200", () => {
    expect(usdCentsToInrPaise(1200)).toBe(115200);
  });

  it("converts a 3-month discounted total exactly: 3420 * 96 = 328320", () => {
    expect(usdCentsToInrPaise(3420)).toBe(328320);
  });

  it("never produces floating-point drift for any configured plan's totals", () => {
    for (const usdCents of [1200, 2200, 5200, 17900, 3420, 6480, 11520]) {
      expect(Number.isInteger(usdCentsToInrPaise(usdCents))).toBe(true);
    }
  });
});

describe("formatMoney", () => {
  it("formats USD with a $ prefix and two decimals", () => {
    expect(formatMoney(1200, "USD")).toBe("$12.00");
  });

  it("formats INR with a ₹ prefix and two decimals", () => {
    expect(formatMoney(115200, "INR")).toBe("₹1,152.00");
  });

  it("formats a large INR amount with Indian digit grouping (lakhs), not Western grouping", () => {
    // Scale, 12-month, total USD $1718.40 -> 171840 cents -> * 96 = 16496640
    // paise -> ₹164,966.40 in Western grouping, ₹1,64,966.40 in Indian
    // grouping. Confirms formatMoney is genuinely currency/locale-aware,
    // not just a swapped prefix character.
    expect(formatMoney(16496640, "INR")).toBe("₹1,64,966.40");
  });

  it("never cross-contaminates currencies: the same amount formats differently per currency", () => {
    expect(formatMoney(1200, "USD")).not.toBe(formatMoney(1200, "INR"));
  });
});

describe("ROUTE_CURRENCY", () => {
  it("maps the Razorpay India route to INR and the international route to USD", () => {
    expect(ROUTE_CURRENCY.razorpay_india).toBe("INR");
    expect(ROUTE_CURRENCY.international).toBe("USD");
  });
});
