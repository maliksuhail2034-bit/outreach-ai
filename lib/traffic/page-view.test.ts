import { describe, expect, it } from "vitest";

import {
  buildPageView,
  deviceFromUserAgent,
  isBot,
  isPageLoad,
  normalizePath,
  referrerHost,
  utmSource,
  visitorHash,
} from "./page-view";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/604.1";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const headers = (values: Record<string, string>) => new Headers(values);
const documentHeaders = (extra: Record<string, string> = {}) => headers({ "user-agent": CHROME, "sec-fetch-dest": "document", ...extra });

describe("isBot", () => {
  it.each([
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "facebookexternalhit/1.1",
    "curl/8.5.0",
    "python-requests/2.32",
    "Mozilla/5.0 HeadlessChrome/130.0",
    "UptimeRobot/2.0",
  ])("treats %s as a bot", (agent) => expect(isBot(agent)).toBe(true));

  it("treats a missing or tiny user agent as a bot", () => {
    expect(isBot(null)).toBe(true);
    expect(isBot("x")).toBe(true);
  });

  it("counts real browsers", () => {
    expect(isBot(CHROME)).toBe(false);
    expect(isBot(IPHONE)).toBe(false);
  });
});

describe("isPageLoad", () => {
  it("counts a top-level document request", () => {
    expect(isPageLoad("GET", "/pricing", documentHeaders())).toBe(true);
  });

  it("falls back to the Accept header when Sec-Fetch-Dest is absent", () => {
    expect(isPageLoad("GET", "/", headers({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(isPageLoad("GET", "/", headers({ accept: "*/*" }))).toBe(false);
  });

  it("skips in-app navigation, prefetches and non-document fetches", () => {
    expect(isPageLoad("GET", "/leads", documentHeaders({ rsc: "1" }))).toBe(false);
    expect(isPageLoad("GET", "/leads", documentHeaders({ "next-router-prefetch": "1" }))).toBe(false);
    expect(isPageLoad("GET", "/leads", documentHeaders({ "sec-purpose": "prefetch;prerender" }))).toBe(false);
    expect(isPageLoad("GET", "/leads", headers({ "sec-fetch-dest": "empty" }))).toBe(false);
    expect(isPageLoad("POST", "/login", documentHeaders())).toBe(false);
  });

  it("never counts staff, API, auth-callback or asset paths", () => {
    for (const path of ["/console", "/console/traffic", "/api/oauth/google/callback", "/auth/confirm", "/_next/data/x.json", "/robots.txt", "/brand/logo.png"]) {
      expect(isPageLoad("GET", path, documentHeaders())).toBe(false);
    }
  });
});

describe("normalizePath", () => {
  it("replaces ids, numbers and tokens with :id", () => {
    expect(normalizePath("/leads/0b3c7a3e-7a2f-4f0e-9a51-0d7f3c2b1a9e")).toBe("/leads/:id");
    expect(normalizePath("/unsubscribe/abcDEF1234567890abcdef12")).toBe("/unsubscribe/:id");
    expect(normalizePath("/campaigns/42/analytics")).toBe("/campaigns/:id/analytics");
  });

  it("keeps ordinary paths, lowercased, and caps depth and length", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/Pricing/")).toBe("/pricing");
    expect(normalizePath("/a/b/c/d/e/f/g/h/i/j").split("/").length - 1).toBe(8);
    expect(normalizePath(`/${"x".repeat(15)}-y`.repeat(30)).length).toBeLessThanOrEqual(300);
  });
});

describe("deviceFromUserAgent", () => {
  it("classifies phones, tablets and desktops", () => {
    expect(deviceFromUserAgent(IPHONE)).toBe("mobile");
    expect(deviceFromUserAgent(IPAD)).toBe("tablet");
    expect(deviceFromUserAgent(ANDROID_TABLET)).toBe("tablet");
    expect(deviceFromUserAgent(CHROME)).toBe("desktop");
  });
});

describe("referrerHost / utmSource", () => {
  it("keeps only external referrer hosts", () => {
    expect(referrerHost("https://www.google.com/search?q=polimatiq", "polimatiq.com")).toBe("google.com");
    expect(referrerHost("https://polimatiq.com/pricing", "polimatiq.com")).toBeNull();
    expect(referrerHost("https://www.polimatiq.com/", "polimatiq.com")).toBeNull();
    expect(referrerHost("not a url", "polimatiq.com")).toBeNull();
    expect(referrerHost(null, "polimatiq.com")).toBeNull();
  });

  it("normalises utm_source and drops anything unsafe", () => {
    expect(utmSource(new URLSearchParams("utm_source=LinkedIn"))).toBe("linkedin");
    expect(utmSource(new URLSearchParams("utm_source=<script>"))).toBe("script");
    expect(utmSource(new URLSearchParams("utm_source=%3C%3E"))).toBeNull();
    expect(utmSource(new URLSearchParams(""))).toBeNull();
  });
});

describe("visitorHash", () => {
  it("is stable within a day and changes across days, addresses and secrets", () => {
    const base = visitorHash("secret", "2026-11-07", "203.0.113.7", CHROME);
    expect(base).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorHash("secret", "2026-11-07", "203.0.113.7", CHROME)).toBe(base);
    expect(visitorHash("secret", "2026-11-08", "203.0.113.7", CHROME)).not.toBe(base);
    expect(visitorHash("secret", "2026-11-07", "203.0.113.8", CHROME)).not.toBe(base);
    expect(visitorHash("other", "2026-11-07", "203.0.113.7", CHROME)).not.toBe(base);
  });
});

describe("buildPageView", () => {
  const input = {
    method: "GET",
    url: new URL("http://127.0.0.1:3000/signup?utm_source=newsletter&email=jane@acme.com"),
    headers: documentHeaders({ referer: "https://news.ycombinator.com/item?id=1" }),
    ip: "203.0.113.7",
    country: "IN",
    signedIn: false,
    secret: "secret",
    ownHost: "polimatiq.com",
    now: new Date("2026-11-07T10:00:00Z"),
  };

  it("builds a row with no IP, user agent or query string in it", () => {
    const row = buildPageView(input);
    expect(row).toEqual({
      day: "2026-11-07",
      path: "/signup",
      referrer_host: "news.ycombinator.com",
      utm_source: "newsletter",
      country: "IN",
      device: "desktop",
      visitor_hash: expect.stringMatching(/^[0-9a-f]{32}$/),
      signed_in: false,
    });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("203.0.113.7");
    expect(serialized).not.toContain("Chrome");
    expect(serialized).not.toContain("jane@acme.com");
  });

  it("records nothing for bots, non-page requests or without a secret", () => {
    expect(buildPageView({ ...input, headers: headers({ "user-agent": "Googlebot/2.1", "sec-fetch-dest": "document" }) })).toBeNull();
    expect(buildPageView({ ...input, headers: documentHeaders({ rsc: "1" }) })).toBeNull();
    expect(buildPageView({ ...input, secret: "" })).toBeNull();
  });

  it("doesn't count pages that don't exist (404s, bot probes)", () => {
    expect(buildPageView({ ...input, url: new URL("http://127.0.0.1:3000/pricing") })).toBeNull();
    expect(buildPageView({ ...input, url: new URL("http://127.0.0.1:3000/wp-admin") })).toBeNull();
  });

  it("drops a malformed country", () => {
    expect(buildPageView({ ...input, country: "india" })?.country).toBeNull();
  });
});
