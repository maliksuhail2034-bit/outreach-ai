# Roadmap

This roadmap tracks feature areas for **outreach-ai**, an AI SDR platform.
Status is derived from the current codebase (`app/`, `lib/`, `supabase/migrations/`)
as of commit `da9bf94`. See `CHANGELOG.md` for the commit-by-commit history.

**Last completed milestone:** Email Verification Integration (BYOK) —
Implementation Complete, Production Validation Pending
(2026-08-09, commit `da9bf94`).

## Integration status

Completed
- ✓ Gmail
- ✓ Microsoft 365 / Outlook
- ✓ Generic SMTP / IMAP
- ✓ Email Verification (BYOK, provider-agnostic; MillionVerifier connected) —
  implementation complete, production validation pending

Current
- (none — next milestone not yet selected)

Planned
- AI Providers
- CRM Integrations
- Lead Enrichment
- Automation Platforms

## Done

- **Auth & multi-tenancy** — login/signup/password reset routes
  (`app/(auth)/...`), organization/workspace data model with RLS
  (`organizations` migration).
- **Leads management** — CSV import, bulk selection/deletion, lead lifecycle
  and unsubscribe/suppression compliance.
- **Campaign builder & execution** — campaign foundation, setup wizard,
  mailbox assignment step, review step, campaign lead search/filtering,
  launch readiness checks, a send queue view, start/pause/resume execution
  controls, and per-mailbox/campaign sending limits.
- **Sequences** — sequence steps panel and data access.
- **Sending engine** — claim-due-sends pipeline, send attempts tracking,
  retry/failure hardening, SMTP provider.
- **Mailbox management** — mailbox CRUD, IMAP configuration, warmup profiles
  and warmup state machine. **Google Workspace / Gmail Integration — COMPLETE
  (production-validated 2026-08-04, see CHANGELOG.md `ca8aa7c`).** A mailbox
  can now be connected via Google OAuth instead of a manually-entered SMTP/
  IMAP password. Not a new provider pipeline: `smtp.gmail.com`/
  `imap.gmail.com` accept OAuth2/XOAUTH2 over the same real SMTP/IMAP
  protocol `SmtpEmailProvider`/`ImapReplyChecker` already speak, so both
  classes gained a small in-place auth-resolution branch
  (`mailboxes.email_provider`/`reply_provider = 'gmail'`) rather than a
  parallel Gmail-specific pipeline — `getEmailProvider()`/
  `getReplyProvider()`, `send-worker.ts`/`reply-worker.ts`, campaigns,
  analytics, warmup, and health scoring are all unchanged. New Route
  Handlers (`app/api/oauth/google/start`, `.../callback`) drive the OAuth
  consent flow; only the refresh token is persisted (encrypted with the
  same `MAILBOX_ENCRYPTION_KEY`/AES-256-GCM scheme as SMTP/IMAP passwords,
  and now correctly stripped from every user-facing read path, see
  `MailboxSafe`), refreshed into a short-lived access token fresh on every
  send/reply-sync. Disconnecting a Gmail mailbox clears the local credential
  and marks it `disconnected` — Google's token-revocation endpoint is
  deliberately not called yet (planned for a later security/compliance
  milestone). Real OAuth credentials, a real SMTP XOAUTH2 send, and a real
  IMAP XOAUTH2 reply-sync match (via the shared `lib/email/message-id.ts`
  normalization, fixing a bug where the SMTP and IMAP sides compared
  Message-IDs in different forms) were all validated end to end against a
  live Gmail account, with campaign and mailbox analytics confirmed to
  reflect the resulting activity correctly.
- **Reply tracking** — inbound reply sync (`app/api/cron/sync-replies`).
- **Deliverability** — domain/mailbox health data model and settings route.
  Automated deliverability health checks (mailbox-level) — every active
  mailbox's health score is now recalculated automatically through a
  scheduled worker/cron (`lib/deliverability/health-check-worker.ts`,
  `app/api/cron/deliverability-health-check`), reusing the existing warmup
  and scoring engines.
- **Analytics** — event model, metrics engine; campaign-level overview,
  timeline, trends, conversion funnel, sequence-step performance, mailbox
  intelligence insights, health score, and campaign comparison (Phase 2B
  and after); mailbox-level overview, timeline, trends, warmup analytics,
  deliverability analytics, and mailbox comparison (Phase 2C and after);
  domain-level analytics combining every mailbox linked to a domain, plus a
  domain health score weighing DNS verification alongside deliverability,
  bounce, and reply rate once a domain has real sending history, and domain
  comparison; an organization-wide rollup on `/analytics` (all-time overview
  plus per-campaign/mailbox/domain tables) closing out the last open item in
  this track. Forecasting & Benchmarks — a shared linear-trend forecasting
  engine (`lib/analytics/forecasting.ts`) is now available across campaign,
  mailbox, domain, and organization analytics, projecting sends over the
  next 7 days from each page's own daily timeline; a shared benchmarking
  engine (`lib/analytics/benchmarks.ts`) computes peer-group averages and
  currently surfaces reply-rate benchmarks (entity vs. organization average)
  in the `/analytics` organization rollup's campaign/mailbox/domain tables.
  AI Insights — a shared, deterministic rule-based insights engine
  (`lib/analytics/insights.ts`) is now available across campaign, mailbox,
  domain, and organization analytics, surfacing plain-language callouts by
  reusing each entity's already-computed health scores, trends, forecasts,
  and benchmarks rather than a second calculation. No LLM integration yet.
- **AI Recommendations** — v1, Bring Your Own Key (BYOK) only: an
  organization connects its own Claude/OpenAI/Gemini API key
  (`/settings/ai`, `ai_provider_keys`); outreach-ai never provides a managed
  key. A shared, provider-agnostic `lib/ai/` abstraction
  (`lib/ai/provider.ts`, mirroring `EmailProvider`/`IntegrationProvider`)
  wraps plain `fetch` calls to each provider's REST API — no vendor SDKs.
  Generation is manual-only: a "Generate Recommendation" button on the
  campaign, mailbox, domain, and organization analytics pages calls a Server
  Function that assembles a fixed, deterministic snapshot from each entity's
  already-computed health score/insights (reusing the existing
  analytics/forecasting/benchmarks/AI Insights engines — no new
  calculation), sends it to the connected provider, and stores the result in
  `ai_recommendations` for audit. No scheduled worker and no cron route
  exist for this feature, unlike every other automated milestone in this
  list — see Notes.
- **Integrations** — Integrations Foundation: a shared, provider-agnostic
  integration abstraction (`lib/integrations/provider.ts`, mirroring the
  existing `EmailProvider`/`ReputationProvider` pattern) with a real
  webhook provider as its first implementation. An organization digest
  builder (`lib/integrations/digest.ts`) reuses the existing organization
  rollup, benchmarking, forecasting, and AI Insights engines rather than a
  new data pipeline, delivered by a scheduled digest worker/cron
  (`lib/integrations/digest-worker.ts`, `app/api/cron/integrations-digest`).
  A `/settings/integrations` page lets an organization connect, test, and
  manage a webhook.
- **Billing** — Stripe integration, webhook handler, plan gating.
- **Testing foundation** — Vitest, unit tests for scheduling, unsubscribe
  tokens, campaign metrics, and mailbox metrics.
- **Microsoft 365 / Outlook Integration — COMPLETE (implementation,
  2026-08-04, see CHANGELOG.md commit `316856d`).** Follows the Gmail
  integration above as the template, same non-Graph reasoning: a mailbox can
  now be connected via Microsoft OAuth (work/school or personal Outlook.com,
  through Microsoft's `/common/` endpoint) instead of a manually-entered
  SMTP/IMAP password. Not a new provider pipeline —
  `smtp.office365.com`/`outlook.office365.com` accept OAuth2/XOAUTH2 over the
  same real SMTP/IMAP protocol `SmtpEmailProvider`/`ImapReplyChecker` already
  speak, so both classes gained another in-place auth-resolution branch
  (`mailboxes.email_provider`/`reply_provider = 'outlook'`) rather than a
  parallel pipeline — `getEmailProvider()`/`getReplyProvider()`,
  `send-worker.ts`/`reply-worker.ts`, campaigns, and analytics are all
  unchanged. The connected account's email is read from the OAuth
  `id_token`'s claims, not Microsoft Graph. New Route Handlers
  (`app/api/oauth/microsoft/start`, `.../callback`) drive the OAuth consent
  flow; only the refresh token is persisted (same `MAILBOX_ENCRYPTION_KEY`/
  AES-256-GCM scheme as every other mailbox credential, stripped from every
  user-facing read path). All checks (typecheck/lint/build/full test suite,
  433 tests) passed. **Live production validation (a real OAuth connect and
  a real SMTP/IMAP send+reply-sync round trip) is still pending** — blocked
  on a real Azure app registration's `MICROSOFT_OAUTH_CLIENT_ID`/`SECRET`,
  the same gate Gmail had before its own production validation.
- **Generic SMTP / IMAP Integration — COMPLETE (2026-08-04, see
  CHANGELOG.md commit `1da3e26`).** Connecting any standard SMTP/IMAP
  provider — Zoho, Hostinger, Namecheap, GoDaddy, Fastmail, cPanel mail,
  Exchange SMTP, custom corporate servers — reuses the Gmail/Outlook
  provider architecture: it's the same manual host/port/username/password
  path `SmtpEmailProvider`/`ImapReplyChecker` have supported since before
  either OAuth integration existed, not a new pipeline. The **Mailbox
  Validation & UX** milestone closed the one remaining gap, SMTP connection
  testing, bringing it to parity with IMAP's existing test button — see the
  CHANGELOG entry above for details (`verifySmtpConnection()`, uses
  nodemailer's `transporter.verify()`, connection/auth only, never sends a
  message).
- **Email Verification Integration — IMPLEMENTATION COMPLETE, PRODUCTION
  VALIDATION PENDING (2026-08-09, see CHANGELOG.md commit `da9bf94`).**
  Bring Your Own Key (BYOK) only, same shape as AI Recommendations: an
  organization connects its own verification provider API key
  (`/settings/verification`, `verification_provider_keys`); outreach-ai
  never purchases verification credit on a user's behalf, and there is no
  platform-managed-credit mode in v1. The provider seam is fully abstract —
  `lib/verification/provider.ts` (`VerificationProvider` interface) and
  `lib/verification/get-provider.ts` (name + key -> implementation) are the
  only things workers, the queue, and `lib/verification/verify.ts` depend
  on; neither knows or assumes BYOK versus a future platform-managed key, so
  a later `verification_mode` (BYOK vs. Platform) can be introduced by
  adding a branch at the key-lookup step alone, with no change to the
  provider interface, workers, queue, or lead verification logic.
  `lib/verification/providers/millionverifier.ts` is the first and
  currently only implementation, wrapping a plain `fetch` call to
  MillionVerifier's real-time API — confirmed against the live endpoint
  directly, since its published resultcode table doesn't match actual
  behavior. `leads` gains a single `verification_status` column (in-place
  only, no audit/history table) plus a derived risk score and raw provider
  detail. Individual verification is a synchronous "Verify" button; bulk
  verification is always queued (`verification_status = 'pending'`) and
  picked up by a new `claim_due_verifications()`-driven cron worker
  (`app/api/cron/verify-leads`), the same atomic claim pattern
  `claim_due_sends()` uses for campaign sends — never a synchronous batch.
  **Paused pending a real provider account**: live production validation
  (a real API key connected via Settings -> Verification, single and bulk
  verification run against real leads, worker/queue/DB/UI all confirmed
  end to end) is deferred until a real verification provider account is
  available — the same gate Gmail/Outlook had before their own production
  validation — but this is not blocking other milestones from proceeding.

## Current milestone

No milestone currently in progress — the next milestone has not been
selected yet.

## In progress / partially built

- **Deliverability** — mailbox-level automated health checks now run on a
  schedule (see Done); domain-side automation is still future work, deferred
  until a real DNS/provider integration exists that can produce meaningful
  domain verification results. The reputation-provider seam (inbox
  placement, blacklist, spam testing, reputation score) is architecture
  only — every signal is `null` until a real provider is connected.
- **Warmup** — state machine, schema, and per-mailbox ramp/forecast
  analytics exist; scheduled warmup send automation and the stats
  -aggregation worker (`warmup_stats` has no writer yet) are not built, so
  historical warmup volume charts render an honest empty state today.

## Not started

- **AI qualification / scoring** — no lead scoring or AI-driven
  qualification logic yet. `lib/ai/` now exists (see AI Recommendations,
  Done) but is scoped to turning already-computed metrics into
  recommendation text, not scoring/qualifying leads.
- **AI-personalized outreach** — no AI-generated message content in the
  sending pipeline yet.
- **Managed AI** — AI Recommendations v1 is BYOK-only (see Done); a
  managed/app-provided key option is a deliberately deferred future
  extension of the same `lib/ai/get-provider.ts` seam, not started.
- **Additional channels** (e.g. LinkedIn) — email-only today, per
  `CLAUDE.md` §1.
- **Documentation** — this `ROADMAP.md` and `CHANGELOG.md` were backfilled
  from git history on 2026-08-01 after an earlier session was interrupted
  before either file was written to disk, then backfilled again on
  2026-08-02 to cover nine commits (`10638d1`–`0852ddf`) that had landed
  without a doc update.

## Notes

- This file should be updated whenever a feature area moves between the
  buckets above — prefer updating it as part of the PR that makes the
  change, not as a separate cleanup pass.
