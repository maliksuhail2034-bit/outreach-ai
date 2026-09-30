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
import { PricingPreview } from "./pricing-preview";

const mockHeaders = vi.mocked(headers);

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
  it("India: monthly INR prices", async () => {
    const html = await renderWith({ "x-vercel-ip-country": "IN" });

    for (const amount of ["₹1,152.00", "₹2,112.00", "₹4,992.00", "₹17,184.00"]) expect(html).toContain(amount);
    expect(html).not.toMatch(/\$\d/);
  });

  it.each([
    ["US", { "x-vercel-ip-country": "US" }],
    ["GB", { "x-vercel-ip-country": "GB" }],
    ["missing country", {}],
  ])("%s: monthly USD prices and no INR anywhere", async (_label, values) => {
    const html = await renderWith(values as Record<string, string>);

    for (const amount of ["$12.00", "$22.00", "$52.00", "$179.00"]) expect(html).toContain(amount);
    for (const regular of ["$19.00", "$29.00", "$79.00", "$199.00"]) expect(html).toContain(regular);
    expect(html).not.toContain("₹");
    expect(html).not.toContain("Charged as");
  });

  it("defaults to USD off Vercel even with an IN header, and ignores browser language", async () => {
    const offVercel = await renderWith({ "x-vercel-ip-country": "IN" }, false);
    expect(offVercel).toContain("$12.00");
    expect(offVercel).not.toContain("₹");

    const indianLanguage = await renderWith({ "x-vercel-ip-country": "US", "accept-language": "hi-IN,en-IN" });
    expect(indianLanguage).toContain("$12.00");
    expect(indianLanguage).not.toContain("₹");
  });
});
