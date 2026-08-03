import { describe, expect, it } from "vitest";
import { buildRecommendationPrompt } from "./prompt";
import type { RecommendationSnapshot } from "./snapshot";

const SNAPSHOT: RecommendationSnapshot = {
  entityType: "campaign",
  entityLabel: "Q3 Outbound",
  healthScore: 72,
  overview: { sentCount: 500, replyRate: 8, bounceRate: 1 },
  insights: [
    { key: "reply_rate", tone: "good", message: "Reply rate is 8%, a strong result." },
    { key: "bounce_rate", tone: "warning", message: "Bounce rate is 1%, well within a healthy range." },
  ],
};

describe("buildRecommendationPrompt", () => {
  it("is a pure function of its snapshot input — same input, same output", () => {
    expect(buildRecommendationPrompt(SNAPSHOT)).toBe(buildRecommendationPrompt(SNAPSHOT));
  });

  it("includes the entity label, health score, overview metrics, and insight messages verbatim", () => {
    const prompt = buildRecommendationPrompt(SNAPSHOT);
    expect(prompt).toContain("Q3 Outbound");
    expect(prompt).toContain("72/100");
    expect(prompt).toContain("sentCount: 500");
    expect(prompt).toContain("replyRate: 8");
    expect(prompt).toContain("Reply rate is 8%, a strong result.");
    expect(prompt).toContain("Bounce rate is 1%, well within a healthy range.");
  });

  it("instructs the model not to invent or recompute numbers", () => {
    expect(buildRecommendationPrompt(SNAPSHOT)).toMatch(/do not invent, estimate, or recompute/i);
  });

  it("omits null overview metrics rather than printing 'null'", () => {
    const withNulls: RecommendationSnapshot = { ...SNAPSHOT, overview: { sentCount: 10, replyRate: null } };
    const prompt = buildRecommendationPrompt(withNulls);
    expect(prompt).not.toContain("null");
    expect(prompt).toContain("sentCount: 10");
  });

  it("renders a fallback line when there are no insights", () => {
    const noInsights: RecommendationSnapshot = { ...SNAPSHOT, insights: [] };
    expect(buildRecommendationPrompt(noInsights)).toContain("(no insights available yet)");
  });

  it("reports 'not available' when there is no health score", () => {
    const noScore: RecommendationSnapshot = { ...SNAPSHOT, healthScore: null };
    expect(buildRecommendationPrompt(noScore)).toContain("Health score: not available");
  });
});
