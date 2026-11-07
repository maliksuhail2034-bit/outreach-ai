import { createHmac } from "node:crypto";

import { isCountedRoute } from "./routes";

// Decides whether a request is a page load worth counting and turns it into
// a privacy-safe page_views row (see supabase/migrations/20261108100000_page_views.sql).
// Pure apart from the clock, so every rule is unit-tested; proxy.ts does the
// write after the response is sent.

export type Device = "desktop" | "mobile" | "tablet";

export interface PageViewRow {
  day: string;
  path: string;
  referrer_host: string | null;
  utm_source: string | null;
  country: string | null;
  device: Device;
  visitor_hash: string;
  signed_in: boolean;
}

type HeaderSource = Pick<Headers, "get">;

// Automated clients: crawlers, link previews, uptime checks, scripts.
const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|pagespeed|facebookexternalhit|embedly|whatsapp|telegram|discord|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|libwww|httpclient|scrapy|phantom|selenium|playwright|puppeteer/i;

// Staff, machine and token-bearing routes are never counted.
const EXCLUDED_PREFIXES = ["/console", "/api", "/_next", "/auth/", "/monitoring"];

export function isBot(userAgent: string | null): boolean {
  return !userAgent || userAgent.length < 10 || BOT_PATTERN.test(userAgent);
}

// A real top-level page load: not a client-side navigation (RSC fetch), not a
// prefetch, not an asset or API call.
export function isPageLoad(method: string, pathname: string, headers: HeaderSource): boolean {
  if (method !== "GET") return false;
  if (EXCLUDED_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) return false;
  if (/\.[a-z0-9]{2,5}$/i.test(pathname)) return false;
  if (headers.get("rsc") || headers.get("next-router-prefetch") || headers.get("next-router-state-tree")) return false;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return false;
  const dest = headers.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (headers.get("accept") ?? "").includes("text/html");
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[A-Za-z0-9_-]{16,})$/i;

// Ids, numbers and tokens (unsubscribe links, invites) never leave the
// request: "/unsubscribe/abc…xyz" is stored as "/unsubscribe/:id".
export function normalizePath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean).slice(0, 8);
  const cleaned = segments.map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment.toLowerCase().slice(0, 60)));
  return `/${cleaned.join("/")}`.slice(0, 300);
}

export function deviceFromUserAgent(userAgent: string): Device {
  if (/ipad|tablet|playbook|silk|kindle|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(userAgent)) return "mobile";
  return "desktop";
}

// External referrers only, as a bare host; visits from Polimatiq's own pages
// are internal navigation, not a source.
export function referrerHost(referer: string | null, ownHost: string): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === ownHost.toLowerCase().replace(/^www\./, "")) return null;
    return host.slice(0, 253);
  } catch {
    return null;
  }
}

export function utmSource(searchParams: URLSearchParams): string | null {
  const value = searchParams.get("utm_source")?.trim().toLowerCase();
  return value ? value.replace(/[^a-z0-9._-]/g, "").slice(0, 100) || null : null;
}

// Keyed with a server secret and the UTC day, so the same person is one
// visitor within a day and unlinkable across days or without the secret.
export function visitorHash(secret: string, day: string, ip: string | null, userAgent: string): string {
  return createHmac("sha256", secret).update(`page-view:${day}|${ip ?? "unknown"}|${userAgent}`).digest("hex").slice(0, 32);
}

export interface PageViewInput {
  method: string;
  url: URL;
  headers: HeaderSource;
  ip: string | null;
  country: string | null;
  signedIn: boolean;
  secret: string;
  // The site's public host (from NEXT_PUBLIC_APP_URL): behind the reverse
  // proxy the request URL's own host is the loopback address.
  ownHost: string;
  now?: Date;
}

export function buildPageView(input: PageViewInput): PageViewRow | null {
  const userAgent = input.headers.get("user-agent");
  if (!input.secret || isBot(userAgent) || !isPageLoad(input.method, input.url.pathname, input.headers)) return null;
  // Only real pages: a probe for /wp-admin or a mistyped link is a 404, not a visit.
  if (!isCountedRoute(input.url.pathname)) return null;
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  return {
    day,
    path: normalizePath(input.url.pathname),
    referrer_host: referrerHost(input.headers.get("referer"), input.ownHost),
    utm_source: utmSource(input.url.searchParams),
    country: input.country && /^[A-Z]{2}$/.test(input.country) ? input.country : null,
    device: deviceFromUserAgent(userAgent!),
    visitor_hash: visitorHash(input.secret, day, input.ip, userAgent!),
    signed_in: input.signedIn,
  };
}
