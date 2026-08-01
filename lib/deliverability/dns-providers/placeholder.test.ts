import { describe, expect, it } from "vitest";
import { PlaceholderDnsProvider } from "./placeholder";

describe("PlaceholderDnsProvider", () => {
  it("returns a pending result for all four record types", async () => {
    const results = await new PlaceholderDnsProvider().verifyDomain("example.com");

    expect(results).toHaveLength(4);
    expect(results.map((r) => r.recordType).sort()).toEqual(["dkim", "dmarc", "mx", "spf"]);
    expect(results.every((r) => r.status === "pending")).toBe(true);
  });

  it("mentions the checked domain in each result's detail", async () => {
    const results = await new PlaceholderDnsProvider().verifyDomain("acme.co");

    expect(results.every((r) => r.detail?.includes("acme.co"))).toBe(true);
  });
});
