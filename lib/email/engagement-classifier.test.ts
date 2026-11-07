import { describe, expect, it } from "vitest";
import { classifyEngagement } from "./engagement-classifier";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const GMAIL_PROXY = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
const OUTLOOK_DESKTOP = "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17928; Pro)";
const SENT_AT = new Date("2026-11-07T10:00:00Z");

function at(seconds: number): Date {
  return new Date(SENT_AT.getTime() + seconds * 1000);
}

describe("classifyEngagement", () => {
  it("treats an ordinary browser well after sending as a person", () => {
    expect(classifyEngagement({ kind: "clicked", userAgent: CHROME, sentAt: SENT_AT, now: at(3600) })).toEqual({
      isBot: false,
      reason: null,
    });
  });

  it("treats Gmail's image proxy as a person's open", () => {
    expect(classifyEngagement({ kind: "opened", userAgent: GMAIL_PROXY, sentAt: SENT_AT, now: at(600) }).isBot).toBe(false);
  });

  it("marks a missing or blank user agent as a bot", () => {
    expect(classifyEngagement({ kind: "opened", userAgent: null, sentAt: null })).toEqual({ isBot: true, reason: "no user agent" });
    expect(classifyEngagement({ kind: "opened", userAgent: "   ", sentAt: null }).isBot).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (compatible; Barracuda Sentinel)",
    "Proofpoint URL Defense",
    "python-requests/2.31.0",
    "curl/8.4.0",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "Mozilla/5.0 HeadlessChrome/120.0",
  ])("marks scanner user agent %s as a bot", (userAgent) => {
    expect(classifyEngagement({ kind: "clicked", userAgent, sentAt: null })).toEqual({
      isBot: true,
      reason: "scanner user agent",
    });
  });

  it("counts Outlook desktop's image fetch as a person's open but its link check as a bot click", () => {
    expect(classifyEngagement({ kind: "opened", userAgent: OUTLOOK_DESKTOP, sentAt: SENT_AT, now: at(600) }).isBot).toBe(false);
    expect(classifyEngagement({ kind: "clicked", userAgent: OUTLOOK_DESKTOP, sentAt: SENT_AT, now: at(600) })).toEqual({
      isBot: true,
      reason: "office link check",
    });
  });

  it("marks an open within 5s and a click within 20s of sending as a bot", () => {
    expect(classifyEngagement({ kind: "opened", userAgent: CHROME, sentAt: SENT_AT, now: at(4) }).isBot).toBe(true);
    expect(classifyEngagement({ kind: "opened", userAgent: CHROME, sentAt: SENT_AT, now: at(5) }).isBot).toBe(false);
    expect(classifyEngagement({ kind: "clicked", userAgent: CHROME, sentAt: SENT_AT, now: at(19) })).toEqual({
      isBot: true,
      reason: "within 20s of sending",
    });
    expect(classifyEngagement({ kind: "clicked", userAgent: CHROME, sentAt: SENT_AT, now: at(20) }).isBot).toBe(false);
  });

  it("skips the timing rule when the send time is unknown or in the future (clock skew)", () => {
    expect(classifyEngagement({ kind: "clicked", userAgent: CHROME, sentAt: null }).isBot).toBe(false);
    expect(classifyEngagement({ kind: "clicked", userAgent: CHROME, sentAt: SENT_AT, now: at(-30) }).isBot).toBe(false);
  });
});
