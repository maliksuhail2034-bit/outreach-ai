import { describe, expect, it } from "vitest";
import { isOvernightWindow, sendingWindowSchema, type SendingWindow } from "./sending-window";

function validWindow(overrides: Partial<SendingWindow> = {}) {
  return {
    days: ["mon", "tue", "wed", "thu", "fri"],
    startHour: 9,
    endHour: 17,
    timezone: "UTC",
    ...overrides,
  };
}

describe("sendingWindowSchema — timezone validation", () => {
  it("accepts a valid IANA timezone", () => {
    const result = sendingWindowSchema.safeParse(validWindow({ timezone: "Asia/Riyadh" }));
    expect(result.success).toBe(true);
  });

  it("accepts every zone this batch explicitly requires", () => {
    for (const timezone of ["Asia/Riyadh", "Europe/London", "Asia/Kolkata", "America/New_York", "America/Los_Angeles"]) {
      const result = sendingWindowSchema.safeParse(validWindow({ timezone }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects a string that isn't a real IANA timezone", () => {
    const result = sendingWindowSchema.safeParse(validWindow({ timezone: "Not/A_Real_Zone" }));
    expect(result.success).toBe(false);
  });

  it("rejects an empty timezone string", () => {
    const result = sendingWindowSchema.safeParse(validWindow({ timezone: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects a plain UTC-offset string instead of an IANA identifier", () => {
    const result = sendingWindowSchema.safeParse(validWindow({ timezone: "UTC+3" }));
    expect(result.success).toBe(false);
  });

  it("rejects an equal start and end hour alongside timezone validation", () => {
    const result = sendingWindowSchema.safeParse(validWindow({ startHour: 9, endHour: 9 }));
    expect(result.success).toBe(false);
  });

  it("still requires at least one allowed day", () => {
    const result = sendingWindowSchema.safeParse(validWindow({ days: [] }));
    expect(result.success).toBe(false);
  });
});

describe("sendingWindowSchema — overnight windows", () => {
  it.each([
    [22, 6],
    [23, 1],
    [17, 9],
  ])("accepts an overnight window %i -> %i", (startHour, endHour) => {
    expect(sendingWindowSchema.safeParse(validWindow({ startHour, endHour })).success).toBe(true);
  });

  it("still accepts a same-day 09 -> 17 window and the 0 -> 24 all-day window", () => {
    expect(sendingWindowSchema.safeParse(validWindow({ startHour: 9, endHour: 17 })).success).toBe(true);
    expect(sendingWindowSchema.safeParse(validWindow({ startHour: 0, endHour: 24 })).success).toBe(true);
  });

  it.each([9, 23])("rejects start === end (%i) as ambiguous", (hour) => {
    const result = sendingWindowSchema.safeParse(validWindow({ startHour: hour, endHour: hour }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Start and end hour can't be the same.");
  });

  it("rejects 0 -> 0 (all day is 0 -> 24; endHour's range already excludes 0)", () => {
    expect(sendingWindowSchema.safeParse(validWindow({ startHour: 0, endHour: 0 })).success).toBe(false);
  });
});

describe("isOvernightWindow", () => {
  it("is true only when the end hour comes before the start hour", () => {
    expect(isOvernightWindow({ startHour: 22, endHour: 6 })).toBe(true);
    expect(isOvernightWindow({ startHour: 23, endHour: 1 })).toBe(true);
    expect(isOvernightWindow({ startHour: 9, endHour: 17 })).toBe(false);
    expect(isOvernightWindow({ startHour: 0, endHour: 24 })).toBe(false);
    expect(isOvernightWindow({ startHour: 22, endHour: 24 })).toBe(false);
  });
});
