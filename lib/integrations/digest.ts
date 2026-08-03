import type { Client } from "@/lib/db";
import { listEmailEvents } from "@/lib/db";
import {
  buildOrganizationInsights,
  calculateOrganizationBenchmarks,
  loadOrganizationRollup,
} from "@/lib/analytics/organization-rollup";
import { getForecaster } from "@/lib/analytics/forecasting";
import { bucketByDay } from "@/lib/analytics/time-buckets";
import type { Tables } from "@/types/database.types";
import type { IntegrationPayload } from "./provider";

// How many days of "sent" email_events history feeds the send forecast
// below, and how many days out it projects — the same 14-day
// history/7-day horizon convention every other analytics page already uses
// (see e.g. app/(app)/analytics/page.tsx's CHART_WINDOW_DAYS and
// FORECAST_HORIZON_DAYS).
const FORECAST_HISTORY_DAYS = 14;
const FORECAST_HORIZON_DAYS = 7;
const DIGEST_EVENT_FETCH_LIMIT = 5000;

// Builds one organization's digest payload — the exact composition
// app/(app)/analytics/page.tsx's rollup section already performs
// (loadOrganizationRollup -> calculateOrganizationBenchmarks ->
// buildOrganizationInsights), reused here instead of a second assembly.
// The only new query this function makes is a 'sent' email_events fetch
// for the forecast's daily history — everything else comes from
// loadOrganizationRollup.
//
// `organization` is passed in (not looked up here) because the caller
// (lib/integrations/digest-worker.ts, admin-context, no signed-in user)
// already has it from listEnabledIntegrations' organization_id. Uses
// organization.owner_user_id as loadOrganizationRollup's userId — today's
// data model still keys mailboxes/campaigns/domains by user_id, not
// organization_id, since multi-member organizations aren't supported yet
// (see the warmup migration's comment) — this is that same, pre-existing
// limitation, not something new this function introduces.
export async function buildOrganizationDigest(
  supabase: Client,
  organization: Pick<Tables<"organizations">, "id" | "name" | "owner_user_id">,
): Promise<IntegrationPayload> {
  const rollup = await loadOrganizationRollup(supabase, organization.owner_user_id, organization.id);
  const benchmarks = calculateOrganizationBenchmarks(rollup);

  // Explicitly scoped to this organization's own mailboxes — same fix
  // applied to loadOrganizationRollup's own event fetch, necessary because
  // this runs under the admin client, which has no RLS to fall back on.
  const mailboxIds = rollup.mailboxSnapshots.map((snapshot) => snapshot.mailbox.id);
  const sentEvents = await listEmailEvents(supabase, undefined, {
    eventType: "sent",
    mailboxIds,
    limit: DIGEST_EVENT_FETCH_LIMIT,
  });
  const dailyVolume = bucketByDay((sentEvents ?? []).map((event) => event.created_at), FORECAST_HISTORY_DAYS);
  const sendForecast = await getForecaster().forecast(dailyVolume, FORECAST_HORIZON_DAYS);

  const insights = buildOrganizationInsights(rollup, benchmarks, sendForecast);

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    generatedAt: new Date().toISOString(),
    overview: {
      sentCount: rollup.overview.sentCount,
      replyRate: rollup.overview.replyRate,
      bounceRate: rollup.overview.bounceRate,
    },
    insights,
  };
}
