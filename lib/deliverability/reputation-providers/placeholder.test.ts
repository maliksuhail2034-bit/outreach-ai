import { describe, expect, it } from "vitest";
import { PlaceholderReputationProvider } from "./placeholder";

describe("PlaceholderReputationProvider", () => {
  it("returns every signal as null instead of a fabricated number", async () => {
    const signals = await new PlaceholderReputationProvider().checkMailbox("sender@example.com");

    expect(signals).toEqual({
      inboxPlacementRate: null,
      blacklisted: null,
      spamTestScore: null,
      reputationScore: null,
    });
  });
});
