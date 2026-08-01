# Changelog

All notable changes to this project are documented in this file, derived from
the git commit history. Dates reflect the commit date.

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
