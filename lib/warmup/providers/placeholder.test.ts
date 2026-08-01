import { describe, expect, it } from "vitest";
import { PlaceholderWarmupProvider } from "./placeholder";

describe("PlaceholderWarmupProvider", () => {
  it("reports that it did not run anything", async () => {
    const result = await new PlaceholderWarmupProvider().runCycle("mailbox-1");
    expect(result.ran).toBe(false);
  });

  it("mentions the mailbox in its detail", async () => {
    const result = await new PlaceholderWarmupProvider().runCycle("mailbox-42");
    expect(result.detail).toContain("mailbox-42");
  });
});
