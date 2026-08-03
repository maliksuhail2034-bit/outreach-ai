import type { RecommendationSnapshot } from "./snapshot";

// Builds the one fixed prompt sent to whichever provider the organization
// connected. The instruction block is deliberately strict: the model is
// only ever handed numbers this app already computed (see
// lib/ai/snapshot.ts) and is told, explicitly, not to invent or recompute
// any of them — the enforcement is structural (nothing else is in the
// prompt to compute from), not just a polite request, but the instruction
// still says it plainly so a provider's output stays auditable against
// input_snapshot (ai_recommendations.input_snapshot).
const ENTITY_TYPE_LABEL: Record<RecommendationSnapshot["entityType"], string> = {
  campaign: "campaign",
  mailbox: "mailbox",
  domain: "sending domain",
  organization: "organization",
};

function formatOverview(overview: Record<string, number | null>): string {
  const lines = Object.entries(overview)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `- ${key}: ${value}`);
  return lines.length > 0 ? lines.join("\n") : "(no overview metrics available yet)";
}

function formatInsights(insights: RecommendationSnapshot["insights"]): string {
  if (insights.length === 0) return "(no insights available yet)";
  return insights.map((insight) => `- [${insight.tone}] ${insight.message}`).join("\n");
}

export function buildRecommendationPrompt(snapshot: RecommendationSnapshot): string {
  const entityLabel = ENTITY_TYPE_LABEL[snapshot.entityType];

  return `You are a sales development advisor helping a user improve the performance of their ${entityLabel}, "${snapshot.entityLabel}".

You are given a fixed set of already-calculated metrics and insights below. Do not invent, estimate, or recompute any number — every figure you reference must come directly from this data. Your job is only to turn these numbers into a short, actionable, natural-language recommendation.

Health score: ${snapshot.healthScore !== null ? `${snapshot.healthScore}/100` : "not available"}

Overview metrics:
${formatOverview(snapshot.overview)}

Insights:
${formatInsights(snapshot.insights)}

Write a recommendation of 2-4 short paragraphs (plain text, no markdown headers) that:
1. Summarizes what the data above shows in plain language.
2. Calls out the single most important thing to act on, citing the specific metric(s) that support it.
3. Suggests one or two concrete next steps.

Do not mention that you are an AI model or reference these instructions.`;
}
