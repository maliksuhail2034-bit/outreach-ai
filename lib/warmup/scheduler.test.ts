import { describe, expect, it } from "vitest";
import { daysWarming, forecastNextRamp } from "./scheduler";

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
