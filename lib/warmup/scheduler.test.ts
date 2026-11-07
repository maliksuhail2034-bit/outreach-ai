import { describe, expect, it } from "vitest";
import { daysWarming, forecastNextRamp, nextIncreaseStatus, randomizedNextSendDelayMinutes } from "./scheduler";

const NOW = new Date("2026-08-02T00:00:00.000Z");

describe("forecastNextRamp", () => {
  it("forecasts a minimum starting volume when a starting-stage profile has never sent anything", () => {
    const forecast = forecastNextRamp(
      { stage: "starting", targetDailyVolume: 30, currentDailyVolume: 0, rampUpPercent: 20, lastActivityAt: null },
      NOW,
    );
    expect(forecast.nextVolume).toBe(5);
    expect(forecast.nextIncreaseAt).toBe(new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString());
  });

  it("increases volume by the configured ramp percentage while warming", () => {
    const forecast = forecastNextRamp(
      {
        stage: "warming",
        targetDailyVolume: 30,
        currentDailyVolume: 10,
        rampUpPercent: 20,
        lastActivityAt: "2026-08-01T00:00:00.000Z",
      },
      NOW,
    );
    // 10 + round(10 * 0.2) = 12.
    expect(forecast.nextVolume).toBe(12);
    expect(forecast.nextIncreaseAt).toBe(new Date(Date.parse("2026-08-01T00:00:00.000Z") + 24 * 60 * 60 * 1000).toISOString());
  });

  it("caps the next volume at the target instead of overshooting", () => {
    const forecast = forecastNextRamp(
      { stage: "warming", targetDailyVolume: 30, currentDailyVolume: 28, rampUpPercent: 50, lastActivityAt: null },
      NOW,
    );
    expect(forecast.nextVolume).toBe(30);
  });

  it("returns no forecast once already at target volume", () => {
    const forecast = forecastNextRamp(
      { stage: "warming", targetDailyVolume: 30, currentDailyVolume: 30, rampUpPercent: 20, lastActivityAt: null },
      NOW,
    );
    expect(forecast).toEqual({ nextVolume: null, nextIncreaseAt: null });
  });

  it("returns no forecast for disabled, paused, or healthy stages", () => {
    for (const stage of ["disabled", "paused", "healthy"] as const) {
      const forecast = forecastNextRamp(
        { stage, targetDailyVolume: 30, currentDailyVolume: 10, rampUpPercent: 20, lastActivityAt: null },
        NOW,
      );
      expect(forecast).toEqual({ nextVolume: null, nextIncreaseAt: null });
    }
  });
});

describe("daysWarming", () => {
  it("returns 0 for a profile that has never started", () => {
    expect(daysWarming(null, NOW)).toBe(0);
  });

  it("returns whole days elapsed since started_at", () => {
    expect(daysWarming("2026-07-30T00:00:00.000Z", NOW)).toBe(3);
  });

  it("never goes negative for a startedAt in the future", () => {
    expect(daysWarming("2026-08-10T00:00:00.000Z", NOW)).toBe(0);
  });
});

describe("randomizedNextSendDelayMinutes", () => {
  const WINDOW = { startHour: 9, endHour: 17 }; // 8-hour window

  it("stays within the clamped min/max bounds across many samples", () => {
    for (let i = 0; i < 200; i++) {
      const delay = randomizedNextSendDelayMinutes(10, WINDOW);
      expect(delay).toBeGreaterThanOrEqual(20);
      expect(delay).toBeLessThanOrEqual(240);
    }
  });

  it("produces a longer average delay for a lower daily volume", () => {
    const lowVolumeSamples = Array.from({ length: 50 }, () => randomizedNextSendDelayMinutes(2, WINDOW));
    const highVolumeSamples = Array.from({ length: 50 }, () => randomizedNextSendDelayMinutes(20, WINDOW));

    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(average(lowVolumeSamples)).toBeGreaterThan(average(highVolumeSamples));
  });

  it("never returns a fixed constant — samples vary", () => {
    const samples = new Set(Array.from({ length: 30 }, () => randomizedNextSendDelayMinutes(10, WINDOW)));
    expect(samples.size).toBeGreaterThan(1);
  });

  it("clamps to the minimum even for a very high daily volume", () => {
    const delay = randomizedNextSendDelayMinutes(10_000, WINDOW);
    expect(delay).toBeGreaterThanOrEqual(20);
  });

  it("clamps to the maximum even for a very low daily volume", () => {
    const delay = randomizedNextSendDelayMinutes(1, { startHour: 0, endHour: 24 });
    expect(delay).toBeLessThanOrEqual(240);
  });
});

describe("nextIncreaseStatus", () => {
  const now = new Date("2026-11-06T12:00:00.000Z");

  it("reports an overdue increase as due, not as a past date (a profile the worker hasn't processed yet)", () => {
    const forecast = forecastNextRamp(
      { stage: "warming", targetDailyVolume: 30, currentDailyVolume: 10, rampUpPercent: 20, lastActivityAt: "2026-11-02T08:00:00.000Z" },
      now,
    );
    expect(forecast.nextIncreaseAt).toBe("2026-11-03T08:00:00.000Z");
    expect(nextIncreaseStatus(forecast, now)).toEqual({ kind: "due" });
  });

  it("treats an increase due exactly now as due", () => {
    expect(nextIncreaseStatus({ nextVolume: 12, nextIncreaseAt: now.toISOString() }, now)).toEqual({ kind: "due" });
  });

  it("keeps a future increase as a scheduled date", () => {
    const at = "2026-11-07T08:00:00.000Z";
    expect(nextIncreaseStatus({ nextVolume: 12, nextIncreaseAt: at }, now)).toEqual({ kind: "scheduled", at });
  });

  it("reports nothing when there is nothing left to ramp (healthy, paused, or at target)", () => {
    expect(nextIncreaseStatus({ nextVolume: null, nextIncreaseAt: null }, now)).toEqual({ kind: "none" });
    const atTarget = forecastNextRamp(
      { stage: "warming", targetDailyVolume: 30, currentDailyVolume: 30, rampUpPercent: 20, lastActivityAt: null },
      now,
    );
    expect(nextIncreaseStatus(atTarget, now)).toEqual({ kind: "none" });
  });
});
