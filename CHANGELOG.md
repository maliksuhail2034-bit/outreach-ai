# Changelog

All notable changes to this project are documented in this file, derived from
the git commit history. Dates reflect the commit date.

## 2026-08-04 — Gmail Integration Complete: Production-Validated (`ca8aa7c`)

Closes out the Google Workspace / Gmail Integration milestone below —
production-validated end to end, no code changes outstanding.

- **Google OAuth** — consent/callback flow validated against real Google
  Cloud OAuth credentials (previously blocked on credential provisioning).
  Corrected `lib/email/google-constants.ts`'s `GMAIL_OAUTH_SCOPES`: this app
  authenticates directly against `smtp.gmail.com`/`imap.gmail.com` via
  XOAUTH2 rather than calling the Gmail REST API, so the REST-only
  `gmail.send`/`gmail.readonly` scopes originally requested don't work —
  Google's SMTP/IMAP servers only honor the broader `https://mail.google.com/`
  scope for XOAUTH2.
- **Refresh token encryption** — closed a field-exposure gap in
  `lib/db/mailboxes.ts`: `MailboxSafe`/`omitPassword` now also strips
  `encrypted_google_refresh_token` (previously only the SMTP/IMAP password
  fields were stripped), so a Gmail mailbox's refresh token can never reach a
  user-facing read path.
- **SMTP XOAUTH2 sending** — validated with a real send through
  `SmtpEmailProvider` against `smtp.gmail.com`.
- **IMAP XOAUTH2 reply sync** — validated with a real inbound reply fetched
  through `ImapReplyChecker` against `imap.gmail.com`.
- **Shared Message-ID normalization** — root-caused and fixed the bug that
  was blocking reply matching: `SmtpEmailProvider` stored `providerMessageId`
  with its raw angle brackets while `ImapReplyChecker` compared against a
  bracket-stripped `In-Reply-To`/`References`, so a real reply could never
  match its sent message. Extracted the existing (previously IMAP-only)
  `normalizeMessageId()` into a new shared `lib/email/message-id.ts` and
  applied it to `smtp.ts`'s returned `providerMessageId` too, so both sides
  of the send/reply comparison now use the same canonical form.
- **Campaign analytics validation** — confirmed a matched reply correctly
  advances `campaign_leads.status` to `'replied'` and clears
  `current_step_id`/`next_send_at`.
- **Mailbox analytics validation** — confirmed the Gmail-connected mailbox's
  send/reply activity is correctly reflected in mailbox analytics.
- **End-to-end production validation** — a real message sent via SMTP
  XOAUTH2, replied to from a live Gmail account, and matched via IMAP
  XOAUTH2 reply-sync, recorded as an `email_events` `'replied'` row
  (`matchedVia: "header"`) with the lead correctly advanced to `'replied'`.
- **Tests** — `npm run typecheck`, `npm run lint`, `npm run build`, and the
  affected Vitest suites (`lib/email`, 54 tests across 5 files) all passed.

## 2026-08-07 — Google Workspace / Gmail Integration

- Added the `gmail_oauth` migration: `mailboxes.email_provider`
  (`'smtp'` | `'gmail'`, default `'smtp'`) as the send-side seam symmetric to
  the existing `reply_provider` column, widened `reply_provider`'s check
  constraint to add `'gmail'` (exactly what that column's original comment
  in `20260731100000_mailboxes_imap.sql` already said would happen),
  widened `status` to add `'disconnected'`, relaxed
  `encrypted_smtp_password` to nullable with a conditional check (a Gmail
  mailbox has no SMTP password), and added nullable
  `encrypted_google_refresh_token`. Purely additive — every existing row
  defaults to `email_provider = 'smtp'`, its exact current behavior.
- Extended `lib/email/providers/smtp.ts`'s `SmtpEmailProvider` and
  `lib/email/reply-providers/imap.ts`'s `ImapReplyChecker` in place with an
  auth-resolution branch, rather than adding parallel Gmail-specific
  classes: `smtp.gmail.com`/`imap.gmail.com` accept OAuth2/XOAUTH2 over the
  same real SMTP/IMAP protocol these classes already speak (confirmed via
  `nodemailer`'s and `imapflow`'s own OAuth support before writing any code),
  so a `'gmail'` mailbox refreshes its stored refresh token into a
  short-lived access token and builds an OAuth2 auth object; a `'smtp'`/
  `'imap'` mailbox decrypts its password exactly as before. Every other
  line in both classes — address formatting, SMTP error classification,
  IMAP UID-cursor sync, MIME parsing, `ReplyMessage` normalization — is
  unchanged. `getEmailProvider()`/`getReplyProvider()`
  (`lib/email/get-provider.ts`/`get-reply-provider.ts`), `send-worker.ts`,
  `reply-worker.ts`, campaigns, analytics, warmup, and deliverability
  scoring needed zero changes — confirmed by inspection before
  implementation, not assumed.
- Added `lib/email/google-oauth.ts` (`buildGoogleAuthUrl`,
  `exchangeCodeForTokens`, `refreshGoogleAccessToken`, `getGoogleUserInfo`,
  `GoogleOAuthError`) and `lib/email/google-constants.ts` — plain `fetch`
  against Google's OAuth endpoints, no vendor SDK, matching this codebase's
  existing convention for every external HTTP integration. Only the refresh
  token is ever persisted; a fresh access token is resolved on every send/
  reply-sync rather than cached, the same "resolve credentials on every
  use" pattern the SMTP/IMAP password path already follows. The refresh
  token is encrypted with the exact same `lib/crypto/smtp-secret.ts`
  functions and `MAILBOX_ENCRYPTION_KEY` as SMTP/IMAP passwords — reused
  as-is (a Google refresh token is the same kind of secret: this mailbox's
  own send/receive credential), no new encryption key.
- Added `app/api/oauth/google/start` and `.../callback` Route Handlers —
  the OAuth consent/callback flow, following the same "Route Handler for a
  third-party callback" convention `app/auth/confirm/route.ts` already
  established for Supabase's own email-link flow. CSRF protection is a
  random-value double-submit cookie (no signing secret needed — an attacker
  who can't read/set the `httpOnly` cookie can't forge a matching `state`).
  The callback never trusts identity from Google's response, only which
  Google account consented; it re-derives the outreach-ai user from the
  existing session. A new `mailboxes` row is created (or an existing one
  reconnected) via the unchanged `createMailbox`/`updateMailbox` functions,
  with `email` set directly from Google's own account info rather than a
  hand-typed field.
- Added `lib/db/mailboxes.ts`'s `getMailboxByUserAndEmail`, a natural-key
  lookup mirroring `getIntegrationByProvider`/`getAiProviderKeyByProvider`'s
  shape, so the callback can tell a first-time connect from a reconnect.
- Added `disconnectGmailMailboxAction` (`app/(app)/mailboxes/actions.ts`):
  clears the stored refresh token and moves the mailbox to `status =
  'disconnected'` — on its own enough to stop `claim_due_sends()` and
  `listMailboxesForReplySync()` from using it, since both already filter on
  `status = 'active'`. Deliberately does not call Google's token-revocation
  endpoint in v1 (planned for a later security/compliance milestone).
- Added a "Connect Google Workspace" entry point and a Gmail/SMTP provider
  badge to `components/mailboxes/mailbox-list.tsx`; `mailbox-form.tsx`'s
  edit mode shows a read-only "connected via Google" state instead of
  SMTP/IMAP fields for a Gmail mailbox, while reusing the exact same
  `updateMailboxAction`/`mailboxSchema` path for every provider-agnostic
  setting (display name, limits, domain, status, warmup).
- Added unit tests for `lib/email/google-oauth.ts` (auth URL construction,
  token exchange/refresh, userinfo lookup, and
  retry/invalid_grant/failed error classification against a mocked
  `fetch`).

## 2026-08-06 — AI Recommendations v1 (BYOK)

- Added `lib/ai/provider.ts`'s `AiProvider` interface + `AiGenerationError`
  (retry/invalid_key/failed classification) — mirrors
  `lib/integrations/provider.ts`'s `IntegrationProvider` split exactly.
  `lib/ai/providers/{anthropic,openai,google}.ts` implement it against each
  provider's plain REST API via `fetch` — no vendor SDK dependency added,
  matching `WebhookIntegrationProvider`'s "no SDK for a single
  request/response call" precedent. `lib/ai/get-provider.ts` is the one
  factory every caller depends on, and the seam a future managed-AI option
  plugs into without touching prompt-building, storage, or the UI.
- Extracted `lib/crypto/aes-secret.ts`'s generic AES-256-GCM
  `encryptSecret`/`decryptSecret`/`parseEncryptionKey` out of
  `lib/crypto/smtp-secret.ts` (now a thin wrapper, behavior-preserving) so a
  second secret domain doesn't duplicate the cipher logic. Added
  `lib/crypto/ai-provider-key-secret.ts` as a second thin wrapper, keyed by
  a new `AI_PROVIDER_KEY_ENCRYPTION_KEY` — deliberately separate from
  `MAILBOX_ENCRYPTION_KEY`, same "independent blast radii" reasoning
  `UNSUBSCRIBE_TOKEN_SECRET` already established.
- Added the `ai_provider_keys` migration (organization-scoped, RLS from
  creation, unique on `(organization_id, provider)`) — an organization's own
  BYOK Claude/OpenAI/Gemini key, encrypted at rest, never returned to the
  client in full (only `key_preview`, e.g. last 4 characters). No managed/
  app-provided key in v1.
- Added the `ai_recommendations` migration (organization-scoped, RLS,
  append-only) storing every "Generate Recommendation" click's outcome —
  `input_snapshot` keeps the exact deterministic payload sent to the LLM for
  audit, so a recommendation's wording is always traceable back to the
  numbers that produced it.
- Added `lib/ai/snapshot.ts`'s `buildRecommendationSnapshot`, dispatching per
  entity type (campaign/mailbox/domain/organization) to that entity's
  already-existing analytics loader
  (`loadCampaignAnalyticsSnapshot`/`loadMailboxAnalyticsSnapshot`/
  `loadDomainAnalyticsSnapshot`/`loadOrganizationRollup` +
  `buildOrganizationInsights`) — the same loaders Comparison pages and the
  `/analytics` rollup already call. Nothing in this file or downstream
  calculates a rate, score, or trend; it only gathers what each entity's own
  engine already produced.
- Added `lib/ai/prompt.ts`'s `buildRecommendationPrompt`, a pure function
  turning a snapshot into the one fixed prompt sent to whichever provider is
  connected — explicitly instructs the model not to invent or recompute any
  number, structurally enforced by giving it nothing else to compute from.
- Added `lib/ai/recommendations.ts`'s `generateRecommendation`, the
  end-to-end orchestrator: load the organization's connected key for the
  requested provider, decrypt it for this request only, build the snapshot,
  call the provider, and persist the outcome (success or failure) as one
  audit row. Never called on a schedule — every call traces back to a
  Server Function triggered by a user's "Generate Recommendation" click.
- Added `/settings/ai` (`page.tsx`, `actions.ts`,
  `components/settings/ai-providers-panel.tsx`,
  `components/settings/ai-provider-key-form.tsx`) to connect/disconnect a
  BYOK key per provider, following `/settings/integrations`'s structure.
- Added `components/ai/recommendation-card.tsx`'s `RecommendationCard`,
  shared by all four analytics pages (campaign, mailbox, domain,
  organization) so "Generate Recommendation" renders identically everywhere.
  Each page passes its own colocated Server Function
  (`generate{Campaign,Mailbox,Domain,Organization}RecommendationAction`,
  each independently re-checking ownership) bound to that entity's id.
  Replaced the Mailbox Analytics page's former disabled "AI recommendations
  — Not available" placeholder.
- Added unit tests: `lib/crypto/aes-secret.test.ts` (encrypt/decrypt
  roundtrip, wrong-key and malformed-ciphertext failure), one test file per
  provider under `lib/ai/providers/` (success parsing plus
  retry/invalid_key/failed classification against a mocked `fetch`, no real
  API calls), and `lib/ai/prompt.test.ts` (prompt builder determinism).

## 2026-08-05 — Integrations Foundation (`60edfc4`)

- Added `lib/integrations/provider.ts`, a shared, provider-agnostic
  `IntegrationProvider` abstraction — mirrors `lib/email/provider.ts`'s
  `EmailProvider` split (interface + classified delivery error + factory)
  exactly, so a future provider (Slack, Zapier, a CRM) plugs in via
  `lib/integrations/get-provider.ts`'s factory without touching any caller.
- Added `lib/integrations/providers/webhook.ts`'s `WebhookIntegrationProvider`
  — a real (not placeholder) implementation, since a generic outbound
  webhook needs no vendor SDK or credentials beyond a URL, unlike
  `DnsProvider`/`ReputationProvider`, which still have no real data source
  to plug into. Posts the digest as JSON with a bounded timeout and
  classified retry/failed outcomes.
- Added `lib/integrations/digest.ts`'s `buildOrganizationDigest` — the
  reuse centerpiece of this milestone: it builds an organization's digest
  payload from `loadOrganizationRollup`, `calculateOrganizationBenchmarks`,
  `getForecaster`, and `buildOrganizationInsights` (all pre-existing
  engines), the same composition `/analytics`'s rollup page already
  performs, rather than a second assembly. Extracted
  `calculateOrganizationBenchmarks`/`buildOrganizationInsights` out of that
  page's inline logic into `lib/analytics/organization-rollup.ts` so both
  the page and the digest builder share one implementation — no duplicated
  business logic.
- Fixed `loadOrganizationRollup`'s org-wide event fetch to explicitly scope
  by the organization's own mailboxes instead of relying solely on RLS —
  required to make it safe to call from the new admin-context digest
  worker (which bypasses RLS entirely), and a genuine defense-in-depth
  improvement for the existing `/analytics` page too. Behavior-preserving
  for that page's existing output.
- Added `lib/integrations/digest-worker.ts`'s `runIntegrationsDigestWorker`,
  iterating every enabled integration across every organization with
  per-integration failure isolation — the same shape as
  `runDeliverabilityHealthCheckWorker`/`runReplySyncWorker`. Added
  `app/api/cron/integrations-digest`, following the same `CRON_SECRET`
  bearer-auth/GET+POST structure as the other three cron routes.
- Added `/settings/integrations` (`page.tsx`, `actions.ts`,
  `components/settings/integrations-panel.tsx`,
  `components/settings/webhook-integration-form.tsx`) to connect, enable/
  disable, send a test digest for, and disconnect a webhook — each Server
  Function independently re-checks organization ownership.
- Added the `integrations` migration (organization-scoped, RLS from its
  first migration, unique on `(organization_id, provider)`).

## 2026-08-03 — AI Insights (`5a08012`)

- Added `lib/analytics/insights.ts`, a shared deterministic, rule-based AI
  Insights engine — no LLM integration in this milestone, per its explicit
  scope. Every rule adapts an output another engine already computed rather
  than calculating anything new: `healthFactorsToInsights` maps a
  health-score engine's `HealthScoreFactor[]` (already plain-language)
  straight into the shared insight shape; `trendToInsight` and
  `benchmarkToInsight` both surface an already-computed `TrendResult`
  (period-over-period or entity-vs-peer-average); `forecastToInsight` runs
  a forecast's own first-vs-last projected day back through the same
  `calculateTrend` every other trend in the app uses. A `higherIsBetter`
  flag on each rule keeps inverse metrics (e.g. bounces) from being
  mislabeled "good" when they rise. `collectInsights` filters out rules
  that didn't fire and falls back to one steady-state insight so a panel is
  never confusingly empty.
- Added `components/analytics/insights-card.tsx` (`InsightList`,
  `InsightsCard`) — entity-agnostic rendering, the same convention
  `HealthScoreCard`/`RollupTable` already follow.
- Integrated an "AI Insights" section into all four existing analytics
  pages — campaign, mailbox, domain, and the `/analytics` organization
  rollup — each assembling its own candidate list from whichever signals it
  already has (health-score factors, trends, forecast trajectory, and for
  the organization rollup, the per-entity reply-rate benchmarks already
  computed for its rollup tables). No additional database queries: every
  insight is derived entirely from values each page already computed for
  an existing card or chart.
- Unified `lib/campaigns/mailbox-insights.ts`'s `MailboxInsight`/
  `MailboxInsightTone` to alias the new shared `Insight`/`InsightTone`
  instead of declaring a parallel copy of the same shape, and extracted
  `campaign-mailbox-insights.tsx`'s inline insight-list markup into the new
  `InsightList` so the app's two insight surfaces render identically
  instead of duplicating the same JSX.
- Added unit tests for every rule function and `collectInsights`.

## 2026-08-03 — Forecasting & Benchmarks (`9e42e85`)

- Filled the previously-unimplemented `Forecaster` seam
  (`lib/analytics/forecasting.ts`) with a real `LinearTrendForecaster`
  (least-squares trend extrapolation, confidence that grows with more
  history and decays further into the horizon) plus `summarizeForecast`.
  `getForecaster()` now returns this real implementation instead of the
  placeholder.
- Integrated forecasting across every existing analytics page — campaign,
  mailbox, domain, and organization rollup — each showing a "Projected
  sends, next 7 days" card fed by that page's own already-computed daily
  timeline (`bucketByDay`/`bucketByDayInRange` output). No new queries: the
  forecaster consumes the exact `{date, value}[]` series each page already
  builds for its own charts.
- Added `lib/analytics/benchmarks.ts`, a shared benchmarking engine:
  `calculatePeerAverage` (averages a metric across peers, excluding nulls
  rather than treating them as 0) and `compareToBenchmark`, which reuses
  `compareMetrics`/`calculateTrend` directly — "entity vs. peer average" is
  the same operation as "this period vs. last period," just given a
  different baseline, so no new comparison math was written.
- Wired the benchmarking engine into the `/analytics` organization rollup:
  each campaign/mailbox/domain row now shows a reply-rate-vs-organization-
  average column, computed from the snapshots `loadOrganizationRollup`
  already loads — no new queries, and never compares across organizations.
- Extracted `components/analytics/trend-badge.tsx` from
  `comparison-table.tsx`'s inline badge rendering so the new benchmark
  column and the existing A-vs-B comparison tables render trends
  identically instead of duplicating that logic.
- Added unit tests for `LinearTrendForecaster`, `summarizeForecast`,
  `calculatePeerAverage`, and `compareToBenchmark`.

## 2026-08-03 — Automated Deliverability Health Checks (`f99deee`)

- Added `lib/deliverability/health-check-worker.ts`'s
  `runDeliverabilityHealthCheckWorker`, which recalculates every active
  mailbox's health score on a schedule instead of requiring a user to click
  "Recalculate" one mailbox at a time — reusing the existing warmup state
  machine and `calculateMailboxHealthScore` engine rather than duplicating
  that logic. Per-mailbox failures are isolated (a try/catch per mailbox,
  bounded logging) so one bad row can't stop the run, the same
  failure-isolation shape as `runReplySyncWorker`.
- Added `app/api/cron/deliverability-health-check`, a scheduled endpoint
  following the same `CRON_SECRET` bearer-auth/GET+POST structure as
  `send-emails` and `sync-replies`.
- Added admin-scoped data-access helpers for the worker to use with no
  user/organization in the loop: `listActiveMailboxesForHealthCheck`
  (`lib/db/mailboxes.ts`), `getWarmupProfileByMailboxId`
  (`lib/db/warmup.ts`), and `getMailboxHealthByMailboxId`
  (`lib/db/deliverability.ts`).
- Extracted `STAGE_TO_DELIVERABILITY_STATUS` into
  `lib/deliverability/warmup-status.ts`, shared by the worker and the
  existing manual `recalculateMailboxHealthAction` so the warmup-stage-to-
  status mapping only lives in one place.
- Mailbox-level automation only — domain-side automated checks remain
  future work until a real DNS/provider integration exists (see
  ROADMAP.md).
- Added unit tests covering the worker's failure isolation (a failing
  lookup or upsert for one mailbox doesn't stop the rest of the run) and
  the new admin-scoped helpers.

## 2026-08-02 — Organization Analytics Rollup (`43c67e3`)

- Added an organization-wide rollup section to `/analytics`: an all-time
  sending overview across every mailbox, plus per-campaign, per-mailbox,
  and per-domain tables (sent count, reply rate, bounce rate, health
  score, linking out to that entity's own analytics page). Closes the
  last item in ROADMAP.md's Analytics track ("org-level rollups across
  all three... not yet built").
- Extracted `loadCampaignSnapshot`/`loadMailboxSnapshot` (previously
  private to their Compare pages) into `lib/campaigns/campaign-analytics.ts`
  and `lib/mailboxes/mailbox-analytics.ts`, mirroring
  `lib/deliverability/domain-analytics.ts`'s existing pattern, so the
  rollup and both Compare pages share one loader per entity instead of a
  second copy of the same fetch orchestration.
- Added `lib/analytics/organization-rollup.ts`'s `loadOrganizationRollup`,
  isolating the per-entity fan-out (one snapshot fetch per
  campaign/mailbox/domain) behind a single function so a future
  batched/bulk-query implementation — or a read from the still-unwritten
  `analytics_daily_rollups` table — can replace its body without any UI
  change.
- Added `components/analytics/rollup-table.tsx`'s generic `RollupTable`,
  used once each for campaigns, mailboxes, and domains instead of three
  near-identical tables.

## 2026-08-02 — Domain Comparison (`e11a4fa`)

- Added `/settings/deliverability/compare` to let a user pick two domains
  and see their overview metrics, per-metric trend (A vs. B), and health
  scores side by side. Closes the last named gap in ROADMAP.md's Analytics
  section, reusing `compareMailboxMetrics` directly per
  `lib/analytics/domain-metrics.ts`'s own comment that a domain-specific
  wrapper would just be a same-signature re-export.
- Extracted the domain analytics page's fetch orchestration (domain lookup,
  mailbox resolution, combined event fetch, overview summary, health score)
  into `lib/deliverability/domain-analytics.ts`'s
  `loadDomainAnalyticsSnapshot`, shared by both the single-domain page and
  the new comparison page instead of duplicating it a second time.

## 2026-08-02 — Domain Health Score (`0c15ba2`)

- Extended `calculateDomainHealthScore` (`lib/deliverability/scoring.ts`)
  beyond DNS-only: now also weighs a domain's real deliverability, bounce,
  and reply rate (already computed on the domain analytics page via
  `summarizeDomainMetrics`) and returns a good/warning factor breakdown
  alongside the score, instead of a bare number. The persisted
  `domains.health_score` (DNS-only, set by the settings page's "Check now"
  action) is unchanged; the analytics page's new Domain Health Score card
  is the richer, live-computed version.
- Generalized `CampaignHealthCard` into
  `components/analytics/health-score-card.tsx` (entity-agnostic
  title/description/empty-state props), now shared by Campaign Health and
  Domain Health instead of a second near-identical card.
- Added a shared `HealthScoreFactor` type to `lib/analytics/types.ts`,
  replacing the campaign-only `CampaignHealthFactor`.

## 2026-08-02 — Mailbox Comparison (`0852ddf`)

- Added `/mailboxes/compare` to let a user pick two mailboxes and see their
  overview metrics, per-metric trend (A vs. B), and stored health scores
  side by side. Fills the `compareMailboxMetrics` seam that shipped in
  Phase 2C with no caller.
- Generalized the campaign-only comparison table into
  `components/analytics/comparison-table.tsx` (entity-agnostic
  `aLabel`/`bLabel` props), now shared by Campaign Comparison and Mailbox
  Comparison instead of each having its own copy.
- Extracted `components/mailboxes/mailbox-health-summary.tsx` from the
  mailbox analytics page so the health-score block isn't duplicated a
  second time.

## 2026-08-01 — Domain Analytics Foundation (`867f92c`)

- Added `/settings/deliverability/[domainId]/analytics`: combined
  sent/delivered/open/click/reply/bounce metrics and trends across every
  mailbox linked to a domain, reusing `summarizeMailboxMetrics` directly
  instead of a domain-specific rate calculation.
- Added `lib/analytics/domain-metrics.ts` (`summarizeDomainMetrics`).
- Extracted the range-picker, overview-card, and DNS-status blocks shared
  with Campaign/Mailbox Analytics into `components/analytics/date-range-picker.tsx`,
  `components/analytics/mailbox-metrics-overview.tsx`, and
  `components/deliverability/domain-dns-status.tsx`.

## 2026-08-01 — Campaign Mailbox Intelligence (`35f7d0e`)

- Added plain-language mailbox insights (best/weakest mailbox, elevated
  bounce rate, redistribute-volume suggestion, all-healthy-consistent) to
  the campaign analytics page, covering the mailboxes a campaign actually
  sends from.
- Added `lib/campaigns/mailbox-insights.ts`, reusing `summarizeMailboxMetrics`
  and `resolveLeadMailboxId` rather than a new scoring engine.

## 2026-08-01 — Campaign Comparison (`7b8272f`)

- Added `/campaigns/compare` to let a user pick two campaigns and see their
  metrics, per-metric trend (A vs. B), and health scores side by side.
  Filled the `compareCampaignMetrics`/`calculateCampaignHealthScore` seams
  that had no caller.
- Added `lib/validations/campaigns.ts`'s `campaignCompareQuerySchema`.

## 2026-08-01 — Campaign Health Score (`0280748`)

- Added a weighted 0-100 campaign health score over whichever signals have
  real data today — bounce rate, reply rate, engagement trend, and biggest
  sequence-step drop-off — reusing the existing funnel/trends/sequence-step
  engines. Returns `null` (not a false 0) when no signal has data yet.
- Added `lib/campaigns/health-score.ts` and
  `components/campaigns/campaign-health-card.tsx`.

## 2026-08-01 — Sequence Step Analytics (`4f3a6a7`)

- Added a per-step performance breakdown (sent/opened/replied/drop-off per
  sequence step) to the campaign analytics page.
- Added `lib/analytics/sequence-step-metrics.ts` and
  `components/analytics/sequence-step-performance-table.tsx`.

## 2026-08-01 — Campaign Funnel Intelligence (`2fc1a71`)

- Added a conversion funnel breakdown to the campaign analytics page.
- Added `lib/analytics/funnel.ts` with unit tests.

## 2026-08-01 — Campaign Execution Experience (`91ff44f`)

- Added campaign launch readiness checks (`lib/campaigns/readiness.ts`) and
  a send queue view (`lib/campaigns/queue.ts`,
  `components/campaigns/campaign-queue-view.tsx`).
- Added `components/campaigns/campaign-execution-controls.tsx`
  (start/pause/resume) to the campaign detail page.

## 2026-08-01 — Campaign Sending Engine Foundation (`10638d1`)

- Added the `sending_limits` migration and daily/hourly sending-limit
  fields to the mailbox form and campaign detail page.

## 2026-08-01 — Phase 2C: Mailbox Analytics Platform

- Added a per-mailbox analytics page (`/mailboxes/[mailboxId]/analytics`):
  overview (sent/delivered/open/click/reply/bounce/spam-complaint rates,
  current daily volume, warmup stage, health score, reputation score),
  a Today/7d/30d/90d/custom timeline with daily charts, trend cards vs.
  the prior period, a Warmup Analytics section (ramp progress, next
  scheduled increase, historical volume, event history), and a
  Deliverability Analytics section (SPF/DKIM/DMARC/MX/domain verification,
  mailbox verification, mailbox health).
- Added `lib/analytics/mailbox-metrics.ts` (`summarizeMailboxMetrics`,
  `compareMailboxMetrics`), built on the existing Analytics Foundation
  engine (`rate`, `compareMetrics`) — the same pattern as
  `campaign-metrics.ts`.
- Extended `lib/db/email-events.ts`'s `listEmailEvents` with an optional
  `mailboxId` filter (additive; existing callers unaffected).
- Widened `components/analytics/activity-timeline.tsx` to accept a
  `warmup_event` source and a configurable title/description/empty label,
  so the Mailbox Analytics page could reuse it for warmup event history
  instead of building a second timeline component.
- Added a reputation-provider seam (`lib/deliverability/reputation-provider.ts`
  + `PlaceholderReputationProvider` + `get-reputation-provider.ts`), mirroring
  the existing `DnsProvider`/`Forecaster` interface-placeholder-factory
  pattern — architecture for inbox placement, blacklist monitoring, spam
  testing, and reputation scoring. No external integration yet; every
  signal returns `null` (never fabricated) until a real provider lands.
- Added a "View analytics" link from `components/mailboxes/mailbox-list.tsx`
  to each mailbox's new analytics page.
- No database migrations — built entirely on existing tables
  (`email_events`, `analytics_events`, `warmup_profiles`, `warmup_events`,
  `warmup_stats`, `mailbox_health`, `domains`).

## 2026-08-01 — Campaign Analytics (`926b655`)

- Added campaign-level analytics: overview metrics, timeline, trends, and a
  conversion funnel card on the campaign detail page.
- Added `lib/analytics/campaign-metrics.ts` with unit tests.

## 2026-08-01 — Analytics Foundation (`99186d9`)

- Added the analytics event data model and `analytics` migration.
- Added the metrics engine and validation schemas (`lib/validations/analytics.ts`).
- Added the dashboard framework analytics builds on top of.

## 2026-08-01 — Mailbox Warmup Foundation (`76bcf54`)

- Added mailbox warmup profiles, a warmup state machine
  (`lib/warmup/state-machine.ts`), and supporting types.
- Added the `warmup` migration and a warmup dashboard route
  (`app/(app)/warmup`).

## 2026-08-01 — Deliverability Foundation (`e94f038`)

- Added domain/mailbox health infrastructure: `lib/deliverability/types.ts`,
  validations, and the `deliverability` migration.
- Added deliverability settings route (`app/(app)/settings/deliverability`).

## 2026-07-31 — Stripe Billing and Plan Gating (`18ddfa4`)

- Added the `billing` migration and Stripe webhook handler
  (`app/api/webhooks/stripe`).
- Added the billing route (`app/(app)/billing`) and plan-gating logic.

## 2026-07-31 — Organization/Workspace Foundation (`c4daea9`)

- Added the `organizations` migration with RLS policies, plus two follow-up
  migrations fixing RLS recursion and owner bootstrap.
- Introduced multi-tenant organization/workspace data model.

## 2026-07-31 — Unsubscribe/Suppression Compliance & Lead Lifecycle (`80f283d`)

- Added unsubscribe token generation/validation
  (`lib/email/unsubscribe-token.ts`, `lib/email/unsubscribe.ts`) with tests.
- Added the unsubscribe route (`app/unsubscribe/[token]`) and lead lifecycle
  / suppression handling.

## 2026-07-31 — Testing Foundation (`f50ba8a`)

- Added Vitest (`vitest.config.mts`, `test` / `test:watch` scripts).
- Added the first unit tests, covering email scheduling.

## 2026-07-31 — Sending Engine Hardening (`c4c06c1`)

- Hardened `lib/email/send-worker.ts`, `lib/email/scheduling.ts`, and the SMTP
  provider (`lib/email/providers/smtp.ts`) with retry and failure handling.

## 2026-07-31 — Campaign Builder Foundation (`6749020`)

- Added the campaign setup wizard (`campaign-setup-wizard.tsx`), mailbox
  assignment step, and review step.

## 2026-07-31 — Reply Tracking Phase 2 (`4258f06`)

- Extended the mailbox form and mailbox list with IMAP-related fields and
  validations.

## 2026-07-30 — Reply Tracking Phase 1 (`47ba458`)

- Added the `mailboxes_imap` migration and IMAP-related database types.

## 2026-07-30 — Dashboard and Analytics Experience (`f72f551`)

- Added `lib/analytics/error-category.ts`, `lib/analytics/time-buckets.ts`,
  and `lib/db/send-attempts.ts`.
- Built out the early dashboard/analytics experience.

## 2026-07-30 — Cold Email Automation Pipeline v1 (`1c692aa`)

- Added `claim_due_sends` and `send_attempts` migrations (plus a nullable
  params fix).
- Introduced the sending pipeline that claims and processes due sends.

## 2026-07-30 — Mailbox Created Date Display (`6736229`)

- Minor UI fix: display mailbox created date in `mailbox-list.tsx`.

## 2026-07-30 — Campaign Sequence Foundation (`31a5017`)

- Added `components/sequences/sequence-steps-panel.tsx`,
  `lib/db/sequences.ts`, `lib/db/sequence-steps.ts`, and validations.

## 2026-07-30 — Campaign Lead Search and Filtering (`6c7cafa`)

- Reworked `campaign-lead-table.tsx` to support search and filtering.

## 2026-07-29 — Campaign Foundation (`4585466`)

- Added campaign and campaign-lead validation schemas.
- Added the `campaigns_default_mailbox` migration.

## 2026-07-29 — Bulk Lead Selection and Deletion (`4b1e270`)

- Added bulk selection and deletion to `lead-table.tsx` and the leads
  Server Function (`app/(app)/leads/actions.ts`).

## 2026-07-29 — Phase 2: Leads Management and CSV Import (`25d2f2a`)

- Initial commit: Next.js App Router scaffold, Supabase client layer,
  `settings` and `leads_status` migrations, and CSV-based lead import.
