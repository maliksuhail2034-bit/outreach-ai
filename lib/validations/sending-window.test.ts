import { describe, expect, it } from "vitest";
import { sendingWindowSchema, type SendingWindow } from "./sending-window";

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

  it("still enforces the existing endHour > startHour rule alongside timezone validation", () => {
    const result = sendingWindowSchema.safeParse(validWindow({ startHour: 17, endHour: 9 }));
    expect(result.success).toBe(false);
  });

  it("still requires at least one allowed day", () => {
    const result = sendingWindowSchema.safeParse(validWindow({ days: [] }));
    expect(result.success).toBe(false);
  });
});
