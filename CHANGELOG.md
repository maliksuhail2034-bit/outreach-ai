# Changelog

All notable changes to this project are documented in this file, derived from
the git commit history. Dates reflect the commit date.

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
