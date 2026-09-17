// Curated common IANA timezones for settings pickers (profile/org settings —
// see app/(app)/settings/profile-form.tsx and settings-form.tsx) that don't
// need the full list. The campaign scheduling picker
// (components/campaigns/timezone-select.tsx) uses getAllIanaTimezones()
// below instead, precisely because a curated list is the wrong tool there —
// a campaign's sending window must accept any real IANA zone, not just the
// common ones.
export const TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

// Validates a string as a real IANA time zone identifier by asking the
// platform's own ICU data, via the same technique Intl.DateTimeFormat
// itself uses to validate its `timeZone` option (it throws a RangeError for
// anything it doesn't recognize) — no hand-maintained list of valid zones
// to keep in sync, and correct on every runtime with real ICU data (Node
// and every evergreen browser). Used both for the campaign sending-window
// schema's server-side check (lib/validations/sending-window.ts) and by the
// timezone picker for its own defensive fallback.
export function isValidIanaTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// Every IANA zone identifier the current runtime knows about (~400 entries)
// — the actual list a campaign's sending-window timezone picker searches,
// deliberately not the curated TIMEZONES list above. Intl.supportedValuesOf
// is available in Node 18+ and every evergreen browser; the curated list is
// only a defensive fallback for a runtime old enough to lack it, so the
// picker still works (just with fewer options) rather than crashing.
//
// Merged with TIMEZONES rather than returned alone: supportedValuesOf()
// normalizes to tzdata's canonical id, which isn't always the name people
// actually search for — e.g. it returns "Asia/Calcutta", never
// "Asia/Kolkata", even though "Asia/Kolkata" is a real, valid, widely-used
// IANA identifier that Intl.DateTimeFormat itself accepts (see
// isValidIanaTimezone). The curated list's entries backfill exactly these
// common-name gaps; both the canonical and common names end up selectable,
// which is harmless duplication, not the "tiny hardcoded list" problem this
// function exists to fix (that was about having *only* ~20 options, not
// about a comprehensive list also including a few familiar aliases).
export function getAllIanaTimezones(): string[] {
  let base: string[] = [...TIMEZONES];
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      base = Intl.supportedValuesOf("timeZone");
    } catch {
      // Keep the curated fallback assigned above.
    }
  }
  return [...new Set([...base, ...TIMEZONES])].sort();
}
