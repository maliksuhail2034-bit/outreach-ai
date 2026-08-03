import type { Client } from "@/lib/db";
import { getCampaign, getMailbox, getOrganization, listEmailEvents } from "@/lib/db";
import { loadCampaignAnalyticsSnapshot } from "@/lib/campaigns/campaign-analytics";
import { loadMailboxAnalyticsSnapshot } from "@/lib/mailboxes/mailbox-analytics";
import { loadDomainAnalyticsSnapshot } from "@/lib/deliverability/domain-analytics";
import {
  buildOrganizationInsights,
  calculateOrganizationBenchmarks,
  loadOrganizationRollup,
} from "@/lib/analytics/organization-rollup";
import { getForecaster } from "@/lib/analytics/forecasting";
import { bucketByDay } from "@/lib/analytics/time-buckets";
import { healthFactorsToInsights, type Insight } from "@/lib/analytics/insights";

export type RecommendationEntityType = "campaign" | "mailbox" | "domain" | "organization";

// The fixed, deterministic payload lib/ai/prompt.ts turns into natural
// language. Every field here is already computed by an existing
// engine — nothing in this file (or anything downstream) calculates a rate,
// score, or trend; it only gathers what each entity's own analytics loader
// already produced, the same reuse lib/integrations/digest.ts established
// for the organization digest.
export interface RecommendationSnapshot {
  entityType: RecommendationEntityType;
  entityLabel: string;
  healthScore: number | null;
  overview: Record<string, number | null>;
  insights: Insight[];
}

const FORECAST_HISTORY_DAYS = 14;
const FORECAST_HORIZON_DAYS = 7;
const ORG_EVENT_FETCH_LIMIT = 5000;

// Same score bands components/deliverability/score-badge.tsx already uses to
// color a health score — reused here so an insight's tone matches the badge
// the user is already looking at, not a second, independently-tuned cutoff.
function toneForScore(score: number): "good" | "warning" {
  return score >= 50 ? "good" : "warning";
}

async function buildCampaignSnapshot(supabase: Client, userId: string, organizationId: string, campaignId: string) {
  const campaign = await getCampaign(supabase, userId, campaignId); // throws if not owned
  const snapshot = await loadCampaignAnalyticsSnapshot(supabase, organizationId, campaign);
  return {
    entityType: "campaign" as const,
    entityLabel: campaign.name,
    healthScore: snapshot.healthScore.score,
    overview: snapshot.overview as unknown as Record<string, number | null>,
    insights: healthFactorsToInsights(snapshot.healthScore.factors),
  };
}

async function buildMailboxSnapshot(supabase: Client, userId: string, organizationId: string, mailboxId: string) {
  const mailbox = await getMailbox(supabase, userId, mailboxId); // throws if not owned
  const snapshot = await loadMailboxAnalyticsSnapshot(supabase, organizationId, mailbox);
  const health = snapshot.health;

  // mailbox_health has no HealthScoreFactor[] producer today (see
  // lib/deliverability/scoring.ts's calculateMailboxHealthScore, which
  // returns a bare number) — this states the already-stored score/rates
  // factually. Only the overall score gets a tone, reusing
  // score-badge.tsx's already-established band rather than inventing a new
  // per-metric threshold; bounce/reply rate are reported as plain facts and
  // left for the LLM to phrase in context of the score and the rest of the
  // snapshot.
  const insights: Insight[] = health
    ? [
        {
          key: "health_score",
          tone: toneForScore(health.health_score),
          message: `Mailbox health score is ${health.health_score}/100.`,
        },
        ...(health.bounce_rate != null
          ? [{ key: "bounce_rate", tone: "info" as const, message: `Bounce rate is ${health.bounce_rate}%.` }]
          : []),
        ...(health.reply_rate != null
          ? [{ key: "reply_rate", tone: "info" as const, message: `Reply rate is ${health.reply_rate}%.` }]
          : []),
      ]
    : [{ key: "no_health_data", tone: "info" as const, message: "No health data has been calculated for this mailbox yet." }];

  return {
    entityType: "mailbox" as const,
    entityLabel: mailbox.display_name || mailbox.email,
    healthScore: health?.health_score ?? null,
    overview: snapshot.overview as unknown as Record<string, number | null>,
    insights,
  };
}

async function buildDomainSnapshot(supabase: Client, userId: string, domainId: string) {
  const snapshot = await loadDomainAnalyticsSnapshot(supabase, userId, domainId); // throws if not owned
  return {
    entityType: "domain" as const,
    entityLabel: snapshot.domain.domain,
    healthScore: snapshot.healthScore.score,
    overview: snapshot.overview as unknown as Record<string, number | null>,
    insights: healthFactorsToInsights(snapshot.healthScore.factors),
  };
}

async function buildOrganizationSnapshot(supabase: Client, userId: string, organizationId: string) {
  const organization = await getOrganization(supabase, organizationId); // throws if not owned/found
  const rollup = await loadOrganizationRollup(supabase, userId, organizationId);
  const benchmarks = calculateOrganizationBenchmarks(rollup);

  const mailboxIds = rollup.mailboxSnapshots.map((snapshot) => snapshot.mailbox.id);
  const sentEvents = await listEmailEvents(supabase, undefined, {
    eventType: "sent",
    mailboxIds,
    limit: ORG_EVENT_FETCH_LIMIT,
  });
  const dailyVolume = bucketByDay((sentEvents ?? []).map((event) => event.created_at), FORECAST_HISTORY_DAYS);
  const sendForecast = await getForecaster().forecast(dailyVolume, FORECAST_HORIZON_DAYS);

  // Reuses the exact same composition buildOrganizationDigest uses for the
  // integrations digest — insights already blend benchmark and forecast
  // callouts, so there is no separate org health score to report here.
  const insights = buildOrganizationInsights(rollup, benchmarks, sendForecast);

  return {
    entityType: "organization" as const,
    entityLabel: organization.name,
    healthScore: null,
    overview: rollup.overview as unknown as Record<string, number | null>,
    insights,
  };
}

// One dispatcher per entity type, each reusing that entity's own existing
// analytics loader (the same ones Comparison pages and the /analytics
// rollup already call) rather than a second, recommendation-specific data
// fetch. `entityId` is ignored for entityType 'organization' (the migration
// enforces entity_id is null there — see
// supabase/migrations/20260806100010_ai_recommendations.sql).
export async function buildRecommendationSnapshot(
  supabase: Client,
  userId: string,
  organizationId: string,
  entityType: RecommendationEntityType,
  entityId: string | null,
): Promise<RecommendationSnapshot> {
  switch (entityType) {
    case "campaign":
      if (!entityId) throw new Error("entityId is required for entityType 'campaign'.");
      return buildCampaignSnapshot(supabase, userId, organizationId, entityId);
    case "mailbox":
      if (!entityId) throw new Error("entityId is required for entityType 'mailbox'.");
      return buildMailboxSnapshot(supabase, userId, organizationId, entityId);
    case "domain":
      if (!entityId) throw new Error("entityId is required for entityType 'domain'.");
      return buildDomainSnapshot(supabase, userId, entityId);
    case "organization":
      return buildOrganizationSnapshot(supabase, userId, organizationId);
    default:
      throw new Error(`Unknown entity type '${entityType satisfies never}'.`);
  }
}
