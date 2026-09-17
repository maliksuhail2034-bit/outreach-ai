import { describe, expect, it } from "vitest";
import { TIMEZONES, getAllIanaTimezones, isValidIanaTimezone } from "./timezones";

describe("isValidIanaTimezone", () => {
  it("accepts well-known IANA identifiers", () => {
    expect(isValidIanaTimezone("UTC")).toBe(true);
    expect(isValidIanaTimezone("Asia/Riyadh")).toBe(true);
    expect(isValidIanaTimezone("Europe/London")).toBe(true);
    expect(isValidIanaTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidIanaTimezone("America/New_York")).toBe(true);
    expect(isValidIanaTimezone("America/Los_Angeles")).toBe(true);
  });

  it("rejects a nonsense string", () => {
    expect(isValidIanaTimezone("Not/A_Zone")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidIanaTimezone("")).toBe(false);
  });

  it("rejects a plain UTC offset string, not a real IANA identifier", () => {
    expect(isValidIanaTimezone("UTC+3")).toBe(false);
  });
});

describe("getAllIanaTimezones", () => {
  it("includes zones missing from the curated TIMEZONES list", () => {
    const all = getAllIanaTimezones();
    expect(all).toContain("Asia/Riyadh");
    expect(TIMEZONES as readonly string[]).not.toContain("Asia/Riyadh");
  });

  it("includes the zones this batch explicitly requires", () => {
    const all = getAllIanaTimezones();
    for (const zone of ["Asia/Riyadh", "Europe/London", "Asia/Kolkata", "America/New_York", "America/Los_Angeles"]) {
      expect(all).toContain(zone);
    }
  });

  it("returns a substantially larger list than the curated fallback", () => {
    // The real IANA database has ~400 zones; the curated list has ~23. A
    // huge gap confirms this is pulling from Intl.supportedValuesOf, not
    // silently falling back to the small list.
    expect(getAllIanaTimezones().length).toBeGreaterThan(100);
  });

  it("returns only real, individually-valid IANA identifiers", () => {
    const all = getAllIanaTimezones();
    for (const zone of all) {
      expect(isValidIanaTimezone(zone)).toBe(true);
    }
  });
});
