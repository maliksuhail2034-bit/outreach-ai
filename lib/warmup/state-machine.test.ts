import { describe, expect, it } from "vitest";
import { canTransition, InvalidWarmupTransitionError, nextStageForStatusChange, transition } from "./state-machine";

describe("canTransition", () => {
  it("allows the documented happy path", () => {
    expect(canTransition("disabled", "starting")).toBe(true);
    expect(canTransition("starting", "warming")).toBe(true);
    expect(canTransition("warming", "healthy")).toBe(true);
    expect(canTransition("healthy", "cooling")).toBe(true);
    expect(canTransition("cooling", "warming")).toBe(true);
  });

  it("allows disabling from any active stage", () => {
    for (const stage of ["starting", "warming", "healthy", "cooling", "paused"] as const) {
      expect(canTransition(stage, "disabled")).toBe(true);
    }
  });

  it("rejects skipping straight from disabled to warming", () => {
    expect(canTransition("disabled", "warming")).toBe(false);
  });

  it("rejects a self-transition that isn't explicitly listed", () => {
    expect(canTransition("disabled", "disabled")).toBe(false);
  });
});

describe("transition", () => {
  it("returns the target stage for a valid transition", () => {
    expect(transition("starting", "warming")).toBe("warming");
  });

  it("throws InvalidWarmupTransitionError for an invalid transition", () => {
    expect(() => transition("disabled", "healthy")).toThrow(InvalidWarmupTransitionError);
  });
});

describe("nextStageForStatusChange", () => {
  it("moves a disabled profile to starting when enabled", () => {
    expect(nextStageForStatusChange("disabled", "enabled")).toBe("starting");
  });

  it("resumes a paused profile at warming, not starting, when re-enabled", () => {
    expect(nextStageForStatusChange("paused", "enabled")).toBe("warming");
  });

  it("leaves a mid-flow stage untouched when re-enabled", () => {
    expect(nextStageForStatusChange("healthy", "enabled")).toBe("healthy");
    expect(nextStageForStatusChange("cooling", "enabled")).toBe("cooling");
  });

  it("moves any active stage to paused when paused", () => {
    expect(nextStageForStatusChange("warming", "paused")).toBe("paused");
  });

  it("moves any stage to disabled when disabled", () => {
    expect(nextStageForStatusChange("healthy", "disabled")).toBe("disabled");
  });

  it("is idempotent for a status that doesn't change the target stage", () => {
    expect(nextStageForStatusChange("disabled", "disabled")).toBe("disabled");
    expect(nextStageForStatusChange("paused", "paused")).toBe("paused");
  });
});
