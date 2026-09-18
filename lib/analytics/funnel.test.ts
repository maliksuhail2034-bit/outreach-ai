import { describe, expect, it } from "vitest";
import type { FunnelStage } from "@/components/dashboard/funnel-card";
import { calculateFunnelConversions, calculateFunnelDropOffs, identifyBiggestDropOff } from "./funnel";

const STAGES: FunnelStage[] = [
  { key: "leads", label: "Leads", value: 1000 },
  { key: "queued", label: "Queued", value: 800 },
  { key: "sent", label: "Sent", value: 800 },
  { key: "delivered", label: "Delivered", value: 760 },
  { key: "opened", label: "Opened", value: 300 },
  { key: "clicked", label: "Clicked", value: 50 },
  { key: "replied", label: "Replied", value: 40 },
  { key: "positive_reply", label: "Positive reply", value: 10 },
  { key: "meeting_booked", label: "Meeting booked", value: 4 },
  { key: "won", label: "Won", value: 0, placeholder: true },
];

describe("calculateFunnelConversions", () => {
  it("computes each stage's percentage of the first real stage", () => {
    const result = calculateFunnelConversions(STAGES);
    expect(result.find((s) => s.key === "leads")?.conversionFromStart).toBe(100);
    expect(result.find((s) => s.key === "queued")?.conversionFromStart).toBe(80);
    expect(result.find((s) => s.key === "meeting_booked")?.conversionFromStart).toBe(0.4);
  });

  it("never computes a percentage for a placeholder stage", () => {
    const result = calculateFunnelConversions(STAGES);
    expect(result.find((s) => s.key === "won")?.conversionFromStart).toBeNull();
  });

  it("returns null for every stage when the first real stage is 0, instead of dividing by zero", () => {
    const emptyStages: FunnelStage[] = [
      { key: "leads", label: "Leads", value: 0 },
      { key: "sent", label: "Sent", value: 0 },
    ];
    const result = calculateFunnelConversions(emptyStages);
    expect(result.every((s) => s.conversionFromStart === null)).toBe(true);
  });

  it("passes raw values through unchanged", () => {
    const result = calculateFunnelConversions(STAGES);
    expect(result.map((s) => s.value)).toEqual(STAGES.map((s) => s.value));
  });
});

describe("calculateFunnelDropOffs", () => {
  it("computes dropped count and percent for every consecutive real-stage pair", () => {
    const result = calculateFunnelDropOffs(STAGES);
    // opened (300) -> clicked (50): dropped 250, 83.3%
    const openedToClicked = result.find((d) => d.fromKey === "opened" && d.toKey === "clicked");
    expect(openedToClicked?.droppedCount).toBe(250);
    expect(openedToClicked?.dropOffPercent).toBeCloseTo(83.3, 1);
  });

  it("excludes any pair touching a placeholder stage", () => {
    const result = calculateFunnelDropOffs(STAGES);
    expect(result.some((d) => d.fromKey === "won" || d.toKey === "won")).toBe(false);
  });

  it("returns a null percent (not a fabricated 0%) when the starting stage is 0", () => {
    const stages: FunnelStage[] = [
      { key: "a", label: "A", value: 0 },
      { key: "b", label: "B", value: 0 },
    ];
    const result = calculateFunnelDropOffs(stages);
    expect(result[0].dropOffPercent).toBeNull();
  });

  it("clamps a negative drop (more at a later stage than an earlier one) to zero rather than a negative count", () => {
    const stages: FunnelStage[] = [
      { key: "a", label: "A", value: 10 },
      { key: "b", label: "B", value: 15 },
    ];
    const result = calculateFunnelDropOffs(stages);
    expect(result[0].droppedCount).toBe(0);
  });

  it("returns an empty array with fewer than two real stages", () => {
    expect(calculateFunnelDropOffs([{ key: "a", label: "A", value: 10 }])).toEqual([]);
  });
});

describe("identifyBiggestDropOff", () => {
  it("picks the transition with the highest drop-off percentage among tracked stages", () => {
    // Only 'delivered' is untracked (see UNTRACKED_STAGE_KEYS) — Sent
    // bridges past it straight to Opened. Among all tracked-stage pairs in
    // this fixture, Opened (300) -> Clicked (50) has the highest drop-off:
    // dropped 250, 83.3%.
    const result = identifyBiggestDropOff(STAGES);
    expect(result?.fromKey).toBe("opened");
    expect(result?.toKey).toBe("clicked");
    expect(result?.dropOffPercent).toBeCloseTo(83.3, 1);
  });

  it("returns null when there are fewer than two real stages", () => {
    expect(identifyBiggestDropOff([{ key: "a", label: "A", value: 10 }])).toBeNull();
  });

  it("returns null when every transition has a zero starting value", () => {
    const stages: FunnelStage[] = [
      { key: "a", label: "A", value: 0 },
      { key: "b", label: "B", value: 0 },
      { key: "c", label: "C", value: 0 },
    ];
    expect(identifyBiggestDropOff(stages)).toBeNull();
  });

  it("never selects a transition touching a placeholder stage", () => {
    const stages: FunnelStage[] = [
      { key: "a", label: "A", value: 10 },
      { key: "b", label: "B", value: 9 },
      { key: "fake", label: "Fake", value: 0, placeholder: true },
    ];
    const result = identifyBiggestDropOff(stages);
    expect(result?.toKey).not.toBe("fake");
    expect(result?.fromKey).toBe("a");
    expect(result?.toKey).toBe("b");
  });

  it("bridges past the untracked 'delivered' stage instead of reporting a misleading 100% at Sent -> Delivered", () => {
    // Mirrors real production data: 'delivered' has no producer anywhere
    // (no ESP delivery-webhook infrastructure), so it's always exactly 0 —
    // not "0 because nothing converted," but "0 because nothing is
    // written." Without the untracked-stage exclusion, this would
    // mechanically report Sent -> Delivered at 100% for any campaign that
    // ever sent anything. 'opened'/'clicked' DO have real producers as of
    // Batch 9C and participate normally, not bridged over.
    const stages: FunnelStage[] = [
      { key: "leads", label: "Leads", value: 100 },
      { key: "sent", label: "Sent", value: 90 },
      { key: "delivered", label: "Delivered", value: 0 },
      { key: "opened", label: "Opened", value: 60 },
      { key: "clicked", label: "Clicked", value: 20 },
      { key: "replied", label: "Replied", value: 15 },
    ];

    const result = identifyBiggestDropOff(stages);

    // Opened (60) -> Clicked (20) bridges past the untracked 'delivered'
    // stage and beats every other tracked pair: dropped 40, ~66.7%. Never
    // "Sent -> Delivered" (which would misleadingly read as 100%).
    expect(result?.toKey).not.toBe("delivered");
    expect(result?.fromKey).toBe("opened");
    expect(result?.toKey).toBe("clicked");
    expect(result?.dropOffPercent).toBeCloseTo(66.7, 1);
  });

  it("returns null when only one tracked stage remains after excluding untracked ones", () => {
    const stages: FunnelStage[] = [
      { key: "sent", label: "Sent", value: 100 },
      { key: "delivered", label: "Delivered", value: 0 },
    ];
    expect(identifyBiggestDropOff(stages)).toBeNull();
  });
});

describe("calculateFunnelDropOffs vs. identifyBiggestDropOff candidate pools", () => {
  it("calculateFunnelDropOffs still reports the untracked 'delivered' pair that identifyBiggestDropOff excludes", () => {
    const dropOffs = calculateFunnelDropOffs(STAGES);
    expect(dropOffs.some((d) => d.fromKey === "sent" && d.toKey === "delivered")).toBe(true);

    // identifyBiggestDropOff never returns the 'delivered' pair as the
    // winner, even though calculateFunnelDropOffs computed it — but it CAN
    // (and, for this fixture, does) pick Opened -> Clicked, since that pair
    // has real producers as of Batch 9C and is no longer excluded.
    const biggest = identifyBiggestDropOff(STAGES);
    expect(biggest?.fromKey === "sent" && biggest?.toKey === "delivered").toBe(false);
    expect(biggest?.fromKey).toBe("opened");
    expect(biggest?.toKey).toBe("clicked");
  });
});
