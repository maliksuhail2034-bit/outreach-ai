import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { headers } from "next/headers";
import {
  billingRegionForCountry,
  countryFromHeaders,
  currencyForRegion,
  getBillingRegion,
} from "./region";

const mockHeaders = vi.mocked(headers);

function requestHeaders(values: Record<string, string>) {
  return new Headers(values);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("billingRegionForCountry", () => {
  it("maps IN to india", () => {
    expect(billingRegionForCountry("IN")).toBe("india");
  });

  it.each(["US", "GB", "DE", "AE", "SG", "NP"])("maps %s to international", (country) => {
    expect(billingRegionForCountry(country)).toBe("international");
  });

  it("maps a missing country to international — unknown never means India", () => {
    expect(billingRegionForCountry(null)).toBe("international");
  });
});

describe("countryFromHeaders", () => {
  it("reads Vercel's country header on Vercel", () => {
    expect(countryFromHeaders(requestHeaders({ "x-vercel-ip-country": "IN" }), true)).toBe("IN");
  });

  it("treats the header as missing when absent", () => {
    expect(countryFromHeaders(requestHeaders({}), true)).toBeNull();
  });

  // (Headers itself trims surrounding whitespace, so " IN" arrives as "IN".)
  it.each(["in", "IND", "I", "", "India", "IN,US", "XX1"])(
    "treats a malformed value (%j) as missing",
    (value) => {
      expect(countryFromHeaders(requestHeaders({ "x-vercel-ip-country": value }), true)).toBeNull();
    },
  );

  it("ignores the header entirely off Vercel, where any client could have set it", () => {
    expect(countryFromHeaders(requestHeaders({ "x-vercel-ip-country": "IN" }), false)).toBeNull();
  });

  it("never falls back to browser language, locale, or timezone signals", () => {
    const h = requestHeaders({
      "accept-language": "hi-IN,en-IN;q=0.9",
      "x-timezone": "Asia/Kolkata",
      "x-country": "IN",
      "cf-ipcountry": "IN",
    });
    expect(countryFromHeaders(h, true)).toBeNull();
  });
});

describe("currencyForRegion", () => {
  it("India bills in INR", () => {
    expect(currencyForRegion("india")).toBe("INR");
  });

  it("international bills in USD", () => {
    expect(currencyForRegion("international")).toBe("USD");
  });
});

describe("getBillingRegion", () => {
  it("resolves india from Vercel's header on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    mockHeaders.mockResolvedValue(requestHeaders({ "x-vercel-ip-country": "IN" }) as never);
    await expect(getBillingRegion()).resolves.toBe("india");
  });

  it.each([
    ["US", { "x-vercel-ip-country": "US" }],
    ["GB", { "x-vercel-ip-country": "GB" }],
    ["missing", {}],
    ["malformed", { "x-vercel-ip-country": "in" }],
  ])("resolves international for %s country", async (_label, values) => {
    vi.stubEnv("VERCEL", "1");
    mockHeaders.mockResolvedValue(requestHeaders(values as Record<string, string>) as never);
    await expect(getBillingRegion()).resolves.toBe("international");
  });

  it("resolves international off Vercel even when an IN header is present", async () => {
    vi.stubEnv("VERCEL", "");
    mockHeaders.mockResolvedValue(requestHeaders({ "x-vercel-ip-country": "IN" }) as never);
    await expect(getBillingRegion()).resolves.toBe("international");
  });

  it("resolves international for an Indian browser language when the country is not IN", async () => {
    vi.stubEnv("VERCEL", "1");
    mockHeaders.mockResolvedValue(
      requestHeaders({ "x-vercel-ip-country": "US", "accept-language": "hi-IN,en-IN" }) as never,
    );
    await expect(getBillingRegion()).resolves.toBe("international");
  });
});
