import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { headers } from "next/headers";
import { PAID_PLAN_IDS } from "@/lib/billing/plans";
import { razorpayPlanEnvVar } from "@/lib/billing/offerings";
import { PricingPreview } from "./pricing-preview";

const mockHeaders = vi.mocked(headers);

const USD_PRICES = ["$12.00", "$22.00", "$52.00", "$179.00"];
const USD_REGULAR_PRICES = ["$19.00", "$29.00", "$79.00", "$199.00"];

// The preview shows monthly prices, so only the 1-month INR plans matter.
function configureInrMonthlyPlans() {
  for (const planId of PAID_PLAN_IDS) vi.stubEnv(razorpayPlanEnvVar(planId, "1_month", "INR"), `plan_inr_${planId}_1m`);
}

// The price figures a card shows (total and crossed-out regular), in order.
function displayedPrices(html: string): string[] {
  return [...html.matchAll(/(?:tracking-tight">|line-through">)([$₹][^<]+)</g)].map((match) => match[1]);
}

// The real region resolver runs; only the request headers are mocked.
async function renderWith(values: Record<string, string>, onVercel = true) {
  vi.stubEnv("VERCEL", onVercel ? "1" : "");
  mockHeaders.mockResolvedValue(new Headers(values) as never);
  return renderToStaticMarkup(await PricingPreview());
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("PricingPreview (marketing) by billing region", () => {
  it("India: monthly USD prices, each disclosing its INR charge", async () => {
    configureInrMonthlyPlans();
    const html = await renderWith({ "x-vercel-ip-country": "IN" });

    for (const amount of USD_PRICES) expect(html).toContain(amount);
    for (const regular of USD_REGULAR_PRICES) expect(html).toContain(regular);
    for (const charge of ["₹1,152.00", "₹2,112.00", "₹4,992.00", "₹17,184.00"]) {
      expect(html).toContain(`Charged as ${charge} via Razorpay`);
    }
  });

  it("India without INR plans configured: USD prices and no INR disclosure", async () => {
    const html = await renderWith({ "x-vercel-ip-country": "IN" });

    for (const amount of USD_PRICES) expect(html).toContain(amount);
    expect(html).not.toContain("₹");
  });

  it.each([
    ["US", { "x-vercel-ip-country": "US" }],
    ["GB", { "x-vercel-ip-country": "GB" }],
    ["missing country", {}],
  ])("%s: monthly USD prices and no INR anywhere, even with INR plans configured", async (_label, values) => {
    configureInrMonthlyPlans();
    const html = await renderWith(values as Record<string, string>);

    for (const amount of USD_PRICES) expect(html).toContain(amount);
    for (const regular of USD_REGULAR_PRICES) expect(html).toContain(regular);
    expect(html).not.toContain("₹");
    expect(html).not.toContain("Charged as");
  });

  it("India, international and unknown country all display the same USD prices", async () => {
    configureInrMonthlyPlans();
    const india = displayedPrices(await renderWith({ "x-vercel-ip-country": "IN" }));

    expect(india).toEqual(["$12.00", "$19.00", "$22.00", "$29.00", "$52.00", "$79.00", "$179.00", "$199.00"]);
    expect(displayedPrices(await renderWith({ "x-vercel-ip-country": "US" }))).toEqual(india);
    expect(displayedPrices(await renderWith({}))).toEqual(india);
  });

  it("defaults to USD off Vercel even with an IN header, and ignores browser language", async () => {
    configureInrMonthlyPlans();
    const offVercel = await renderWith({ "x-vercel-ip-country": "IN" }, false);
    expect(offVercel).toContain("$12.00");
    expect(offVercel).not.toContain("₹");

    const indianLanguage = await renderWith({ "x-vercel-ip-country": "US", "accept-language": "hi-IN,en-IN" });
    expect(indianLanguage).toContain("$12.00");
    expect(indianLanguage).not.toContain("₹");
  });
});
