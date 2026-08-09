# Roadmap

This roadmap tracks feature areas for **outreach-ai**, an AI SDR platform.
Status is derived from the current codebase (`app/`, `lib/`, `supabase/migrations/`)
as of commit `94c3418`. See `CHANGELOG.md` for the commit-by-commit history.

**Last completed milestone:** Enterprise Readiness — Scalability Track,
Phase E (Cleanup) — Complete (2026-08-06, commit `c7f7755`). Fifth and
final of five phases (A Foundation / B Infrastructure / C Shadow
Validation / D Incremental Cutover / E Cleanup) — the Scalability Track is
now fully complete. See Scalability Track under Done for the full
item-by-item breakdown, and the status summary immediately below for where
the wider Enterprise Readiness initiative stands.

**Enterprise Readiness initiative status:**
- ✅ Phase 3A — Operations & Monitoring — Complete
- ✅ Phase 3B Part 1 — Security: core fixes (constant-time comparison,
  host-header trust, ownership validation, merge-tag escaping, security
  headers) — Complete
- ✅ Phase 3B Part 2 — Security: audit logging — Complete
- ✅ Phase 3B Part 3 — Security: rate limiting — Complete
- **The Enterprise Readiness Security track is complete** — all 7 approved
  Security findings from the original audit are implemented and their
  migrations applied.
- ✅ Reliability Track — Complete (6 approved items: IMAP connection
  timeout, send worker invocation time budget, cron schedule verification,
  consistent retry/backoff across external providers, explicit Stripe SDK
  network retries, reply-sync overlap protection). See Reliability Track
  under Done.
- ✅ Scalability Track — Phase A (Foundation) — Complete. See Scalability
  Track under Done.
- ✅ Scalability Track — Phase B (Infrastructure) — Complete. The entire
  approved infrastructure (analytics rollup worker + SQL aggregation
  function, available-leads/paginated leads/paginated campaigns queries,
  CSV batch-insert helper, dry-run-only retention worker, bounded send
  -worker concurrency) is built with zero production behavior change — no
  analytics page reads from rollups, no page is wired to the new queries,
  concurrency defaults to the prior sequential behavior. See Scalability
  Track under Done.
- ✅ Scalability Track — Phase C (Shadow Validation) — Complete. Every
  Phase B capability run for real against the linked development/staging
  project and compared against the existing raw-fetch path (items 5, 6, 7,
  10, 11) — every comparison matched, no mismatches found. Item 12 (send
  -worker concurrency) deliberately not live-canaried — a real send-worker
  run risks dispatching real outbound email, which is a different kind of
  approval than anything else in this track; it remains validated only by
  Phase B's invariant test suite. See Scalability Track under Done.
- ✅ Scalability Track — Phase D (Incremental Cutover) — Complete. All
  seven approved items (6 through 12) cut over to real production behavior,
  each as its own independently-approved, committed, and pushed step: the
  three analytics builders now read from rollups, the campaign detail page
  uses the available-leads query, `/leads` and `/campaigns` are paginated,
  CSV import batches its inserts, the retention worker deletes for real,
  and send-worker concurrency is raised from 1 to 5. All six commits
  (`ceaa989`, `0e8494c`, `d80ccd2`, `57fedd7`, `6f851aa`, `94c3418`) are
  published on `origin/main`. See Scalability Track under Done.
- ✅ Scalability Track — Phase E (Cleanup) — Complete (commit `c7f7755`).
  Fifth and final phase: removed the one genuinely superseded pre-cutover
  code path Phase D left behind (`lib/analytics/domain-metrics.ts` and its
  test, confirmed zero real importers) and updated the stale comments that
  pointed at it. `DomainAnalyticsSnapshot.events` was inspected but
  deliberately not removed — it is still consumed by the Deliverability
  Analytics page's Trends section, so it was not superseded/dead code and
  removing it would have changed live production UI behavior, outside
  Phase E's cleanup-only scope; tracked instead as a Production Readiness
  item, now complete (see Done). **The Enterprise Readiness Scalability
  Track is now fully complete** — all five phases (A through E) done.
- ✅ Production Readiness — Deliverability Trends Rollup Migration —
  Complete (commit `7dca187`). The item Phase E's Exit Review discovered
  and deferred, now shipped: the Deliverability Analytics page's Trends
  section is rewired from the always-empty
  `DomainAnalyticsSnapshot.events` to real domain-scoped
  `analytics_daily_rollups` data. See Production Readiness under Done.
- ✅ Production Readiness — Security Gate — Complete (commit `83f8e5d`).
  A targeted security audit of the Production Readiness surface found and
  remediated two real findings: (1) Medium — provider API-key exposure,
  where `lib/db/ai-provider-keys.ts` and
  `lib/db/verification-provider-keys.ts` selected full rows (including
  `encrypted_api_key`) for reads consumed by Client Component settings
  panels; fixed with explicit safe-column selections and new
  `AiProviderKeySafe`/`VerificationProviderKeySafe` types, while
  server-only decrypt paths keep full-row access. (2) Low — IMAP/SMTP
  test-connection error leakage, where `app/(app)/mailboxes/actions.ts`
  returned raw provider error text to the browser; fixed by classifying
  connection errors into safe, user-facing messages, with full detail
  still logged server-side. No migration required; no RLS/authentication
  architecture changes. See Production Readiness under Done.
- **Remaining**: no further Production Readiness items are currently
  itemized as approved work. The original audit's other observations were
  outside this Security Gate's two-finding scope and remain
  deferred/theoretical until separately scoped and approved.

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
- **Backend Performance (Track A) — COMPLETE (2026-08-05, commit
  `feac349`).** First of two independent tracks in a performance/reliability
  initiative — see **UX & Reliability (Track B)** immediately below for the
  second track, also complete. Four approved items, all complete:
  - **C1** — extracted `getUserOrganization()` (`lib/db/organizations.ts`),
    replacing nine separate inline/local reimplementations of "derive a
    default workspace name from the user's email, then
    `getOrCreateOrganizationForUser`" across analytics, billing, campaigns,
    mailboxes, settings, and warmup routes with one shared call.
  - **P2** — request-level `getUser()` caching (`lib/supabase/auth.ts`),
    wrapped in React's `cache()` so every Server Component/Function in a
    request shares one `supabase.auth.getUser()` round trip instead of each
    repeating it.
  - **P4** — composite indexes for `email_events`
    (`supabase/migrations/20260810100000_email_events_composite_indexes.sql`):
    `(campaign_id, created_at desc)` and `(mailbox_id, created_at desc)`, so
    `listEmailEvents` can walk an index straight to its `order by created_at
    desc limit` instead of sorting the full matched set, matching the shape
    `analytics_events` already had. **Migration applied**: confirmed live on
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, verified with a follow-up `--dry-run` reporting
    the remote database up to date with no pending migrations.
  - **P8** — removed the dashboard's N+1 query: the "Recent campaigns"
    widget now calls `getCampaignLeadActivitySummary()`
    (`lib/db/campaign-leads.ts`), three small already-indexed lookups
    (count, next-send, last-activity) per campaign, instead of fetching
    every `campaign_leads` row per campaign on every dashboard load.
- **UX & Reliability (Track B) — COMPLETE (2026-08-05, commit
  `22570d8`).** Second of two independent tracks in the same
  performance/reliability initiative as Backend Performance (Track A,
  above). Four approved items, all complete:
  - **U2** — respect `prefers-reduced-motion`: a new `MotionProvider`
    (`components/motion/motion-provider.tsx`), a thin wrapper around
    framer-motion's `MotionConfig` mirroring the existing `ThemeProvider`
    pattern, wired into `app/layout.tsx` with `reducedMotion="user"`. Applies
    globally to every existing `motion.*` usage with no per-component
    changes — transform-driven motion is suppressed when the OS preference
    is set, while opacity fades still play.
  - **U3** — nested error boundaries: extracted a shared `ErrorFallback`
    (`components/ui/error-fallback.tsx`) used by both the existing root
    `app/error.tsx` and a new nested `app/(app)/error.tsx` (an authenticated
    -app-shell boundary, so a crash there no longer bubbles to the root
    boundary shared with `(auth)`/marketing routes). A new
    `WidgetErrorBoundary` (`components/ui/widget-error-boundary.tsx`, built
    on Next's `unstable_catchError`) wraps the dashboard's six independent
    widgets, so one widget failing no longer blanks the whole page.
  - **U4** — reduced long stagger animations: `components/motion/fade-in.tsx`
    now caps its `delay` prop at `0.3`. Some detail pages chain 15-20
    sections at `+0.05s` increments — `/analytics` reached `1.3s` for its
    last section — so below-the-fold content on those pages now appears
    roughly a second sooner, with no change to any page's own delay values.
  - **E4** — SMTP connection timeout improvements:
    `lib/email/providers/smtp.ts`'s `resolveSmtpConnection`/
    `verifySmtpConnection` previously passed no timeout options at all to
    `nodemailer.createTransport()`, so a hung/unreachable mailbox could
    block `send-worker.ts` for up to nodemailer's 10-minute default per
    email. Both now apply explicit `connectionTimeout`/`greetingTimeout`
    (10s) and `socketTimeout` (20s), and nodemailer's raw `ETIMEDOUT`
    messages ("Greeting never received", etc.) are replaced with one clear,
    user-facing message. The existing 10s `Promise.race` around the mailbox
    form's "Test connection" button was left unchanged — this reinforces it
    rather than replacing it.
- **Phase 3A — Enterprise Readiness: Operations & Monitoring — COMPLETE
  (2026-08-05, commit `283851e`).** First sub-phase of the Enterprise
  Readiness initiative — a full-codebase audit covering monitoring,
  reliability, security, scalability, and production readiness produced a
  prioritized roadmap; this sub-phase implements only the audit's
  Operations & Monitoring items (its Critical finding was that three of
  five cron jobs had no confirmed scheduler, and nothing was watching any
  of them once running). Five approved items, all complete:
  - **Cron scheduling** — added `.github/workflows/cron-verify-leads.yml`
    (*/10), `cron-deliverability-health-check.yml` (hourly), and
    `cron-integrations-digest.yml` (daily 08:00 UTC), joining the two
    workflows that already existed for `send-emails`/`sync-replies`. All
    five cron routes (`app/api/cron/*/route.ts`) now have a confirmed
    in-repo scheduler.
  - **Heartbeat / dead-man's-switch** — `lib/monitoring/heartbeat.ts`'s
    `pingHeartbeat()`, Healthchecks.io-compatible (a bare URL pings success,
    `<url>/fail` pings failure), opt-in per job via a `CRON_HEARTBEAT_URL_*`
    env var, no-op until configured — this is what actually detects "the
    scheduler stopped calling this route at all," which `job_runs` alone
    cannot.
  - **Centralized monitoring abstraction** — `lib/monitoring/run-cron-job.ts`
    consolidates the auth-check/timing/logging shell every cron route
    previously duplicated five times over, now also persisting to
    `job_runs`, pinging the heartbeat, and forwarding to error tracking from
    one place; `lib/monitoring/error-tracking.ts`'s `captureError()`
    forwards unexpected failures (every cron route's top-level catch, plus
    each worker's existing per-item failure catch) to an optional
    `ERROR_TRACKING_WEBHOOK_URL`, mirroring `WebhookIntegrationProvider`'s
    shape. Worker orchestration itself stays fully decoupled — this only
    wraps route-level plumbing, the same non-coupling `reply-worker.ts`'s
    route already called out.
  - **`/api/health`** — new unauthenticated Route Handler for external
    uptime monitoring, confirms database connectivity, returns 503 on
    failure.
  - **`job_runs` infrastructure** — new table
    (`supabase/migrations/20260811100000_job_runs.sql`), modeled on
    `stripe_webhook_events`: RLS enabled with zero policies (service-role
    only, no organization dimension — a cron run isn't org-owned data),
    persisting every cron invocation's outcome/duration/summary so a stuck
    or silently-failing job is queryable instead of living only in platform
    logs. **Migration applied**: confirmed live on the linked
    development/staging Supabase project (`wxhulmbbobkfvtreaspo`) via
    `supabase db push`, verified with a follow-up `--dry-run` reporting the
    remote database up to date with no pending migrations.
- **Phase 3B Part 1 — Enterprise Readiness: Security — IMPLEMENTATION
  COMPLETE (2026-08-05, commit `53034ab`).** Second sub-phase of the
  Enterprise Readiness initiative (see Phase 3A above for the first). Covers
  5 of the audit's 7 approved Security findings — no external
  account/credential dependency exists for any of them, so unlike Email
  Verification/Outlook there is no separate "production validation pending"
  gate; each is a self-contained code change already covered by the existing
  test suite. No database migrations. Five items, all complete:
  - **Constant-time CRON secret comparison** — `isAuthorized()`
    (`lib/monitoring/run-cron-job.ts`) compared the bearer token with plain
    `===`; now uses `Buffer.from()` + a length check + `timingSafeEqual`,
    matching the pattern already established by
    `lib/email/unsubscribe-token.ts` and the OAuth callbacks' `isValidState`.
    Phase 3A's centralization of all five cron routes into one auth check
    meant this touched a single function instead of five.
  - **Host-header redirect fix** — `lib/actions/auth.ts`'s `getOrigin()`
    built `signUp`/`forgotPassword` redirect URLs from request headers;
    removed entirely in favor of the fixed `NEXT_PUBLIC_APP_URL`, matching
    how `lib/email/unsubscribe-token.ts` already avoided header-derived URLs
    for the same reason.
  - **Ownership validation for campaign-lead/sequence-step mutations** —
    `app/(app)/campaigns/[campaignId]/actions.ts` verified the caller owned
    *a* campaign but never that the mutated `campaignLeadId`/step belonged to
    *that* campaign before touching it (RLS already prevented real
    exploitation; this closes the app-level gap in front of it). New
    `assertCampaignLeadInCampaign`/`assertSequenceInCampaign` helpers, wired
    into all six affected actions. `lib/db/*.ts` and the send/reply workers
    are untouched — the scoped fix (changing shared DB function signatures)
    would have rippled into both workers, which were never part of the
    vulnerable surface, so the check was added at the Server Function layer
    instead.
  - **Merge-tag HTML escaping** — `lib/email/merge-tags.ts`'s
    `renderMergeTags` gained an opt-in `escapeHtml` option, applied only to
    substituted lead-data values, never the surrounding template.
    `lib/email/send-worker.ts`'s body call site now passes it; the subject
    call site deliberately doesn't (escaping there would show literal
    `&amp;` in a mail client's Subject header instead of an ampersand).
  - **Security response headers** — `next.config.ts` now sets
    `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and
    `Strict-Transport-Security` on every response. No
    Content-Security-Policy yet — deliberately deferred until this app's
    third-party redirect origins (Stripe Checkout/Portal, Google OAuth,
    Microsoft OAuth) are catalogued, so a too-strict policy doesn't silently
    break one of them.
  - **Session-refresh proxy — verified, not changed.** The audit's original
    "no middleware.ts" finding was a false positive: Next.js 16 renamed
    `middleware.ts` to `proxy.ts` (different file/export name, same
    mechanism), and `proxy.ts` has correctly implemented session-cookie
    refresh since the very first Phase 2 commit (`25d2f2a`). Re-confirmed
    working during this phase; no code changed.
  - **Not included in this phase**: Audit log design (7) and rate limiting
    (1) — both need a new migration, and rate limiting additionally needs an
    architecture decision (Postgres-backed vs. a third-party service) not
    yet made. Neither has been started.
- **Phase 3B Part 2 — Enterprise Readiness: Audit Logging — COMPLETE
  (2026-08-05, commit `a709094`).** Third sub-phase of the Enterprise
  Readiness initiative, implementing Item 7 (audit log for sensitive
  operations) — the last of the audit's 7 approved Security findings.
  **Implementation complete, database migration applied.** No external
  account/credential dependency, so — unlike Email Verification/Outlook —
  there is no separate production-validation gate blocking this from being
  usable; it's ready today. The one open item, noted honestly rather than
  glossed over: no real end-to-end click-through in the running app (e.g.
  actually connecting a mailbox and confirming the resulting row) has been
  performed yet — verification so far is direct DB-level (live queries
  against the linked project) and the unit test suite, not the full app
  flow. Not a blocker, just not yet exercised.
  - **`audit_logs` table** — new migration
    (`supabase/migrations/20260812100000_audit_logs.sql`), modeled on
    `warmup_events`: RLS enabled, `select`+`insert` policies for
    organization members, no update/delete ("it's a log"). `actor_user_id`
    is nullable with `on delete set null` (not the usual cascade to
    `auth.users`) — an audit log must survive both the acting user's account
    being deleted later and system-initiated events with no interactive
    user at all (the Stripe webhook). `target_type`/`target_id` are a
    loosely-typed reference, same pattern as `analytics_events`.
  - **`recordAuditEvent()` — the single centralized writer**
    (`lib/db/audit-log.ts`). Deliberately breaks this directory's usual
    "throw on error" convention: it swallows and logs its own failures
    instead, so every call site can `await` it with no `.catch()` of its
    own — best-effort logging is guaranteed by this one function, not by
    13 individual call sites remembering to wrap it correctly.
  - **13 wired call sites**, covering every credential/access/billing-
    relevant action identified during scoping: mailbox connect (manual +
    both OAuth callbacks), credentials-updated (only when a password field
    actually changed), delete, and disconnect (Gmail/Outlook) in
    `app/(app)/mailboxes/actions.ts` and the two OAuth callback routes; AI
    and verification provider key connect/disconnect
    (`settings/ai/actions.ts`, `settings/verification/actions.ts`); webhook
    integration connect/disconnect (`settings/integrations/actions.ts`);
    and billing subscription changes, both webhook branches
    (`app/api/webhooks/stripe/route.ts`, `actor_user_id` null — no
    interactive user in a webhook). `metadata` never contains a secret —
    only already-safe-to-display identifiers (email, provider name, masked
    `key_preview`, which fields changed).
  - **Scope correction made during implementation**:
    `lib/billing/sync-subscription.ts` previously returned `void`; changed
    to return the resolved `organizationId` (or `null`), since the webhook
    route needs it to log the `customer.subscription.*` branch's audit
    event and that id was only resolved privately inside the function
    before, not actually in the route's own scope as originally assumed
    during scoping.
  - **Migration applied and confirmed in sync**: applied to the linked
    development/staging Supabase project (`wxhulmbbobkfvtreaspo`) via
    `supabase db push`, confirmed by a follow-up `--dry-run` reporting the
    remote database up to date with no pending migrations
    (`supabase migration list` also shows `local == remote` for this
    migration). Live-queried directly against the project after applying:
    the table is reachable via the service-role client; an anon-key read
    returns an empty result (not an error) consistent with the member-only
    select policy; an anon-key insert attempt was rejected outright by
    Postgres with "new row violates row-level security policy for table
    audit_logs" — direct confirmation RLS is enabled and its policies are
    enforcing, not just present in the migration file.
  - **Explicitly not started: Phase 3B Part 3 (Item 1, rate limiting)** —
    across authentication, AI generation, verification, and campaign/send
    actions. Still needs a new migration and the Postgres-vs-third-party
    architecture decision flagged during Phase 3B's original scoping.
- **Phase 3B Part 3 — Enterprise Readiness: Rate Limiting — COMPLETE
  (2026-08-05, commit `b6dbaea`).** Fourth sub-phase of the Enterprise
  Readiness initiative, implementing Item 1 (rate limiting) — the last of
  the audit's 7 approved Security findings, closing the entire Security
  track. **Implementation complete, database migration applied.**
  - **`rate_limit_events` table** — new migration
    (`supabase/migrations/20260813100000_rate_limit_events.sql`), append-
    only (mirrors `claim_due_sends()`'s own reasoning: a windowed
    `count(*)` rather than a running counter table, to avoid the write-
    amplification/drift-recovery problem a counter would add for no
    benefit at this scale). RLS enabled with zero policies — same
    "nothing but the service role ever needs to touch this table" carve-
    out as `stripe_webhook_events`/`job_runs`, since rate-limit bookkeeping
    must be writable from pre-authentication contexts (login/signup have
    no session yet) and isn't organization-owned data a user should read.
  - **`record_rate_limit_attempt()` RPC** — atomic check-and-record in one
    statement, advisory-lock-guarded (keyed by `hashtext(scope || identity)`,
    auto-released at transaction end) to close the race a plain
    count-then-insert would have under concurrent requests from the same
    caller. Returns both `allowed` and a computed `retry_after_seconds`
    (from the oldest attempt in the window, not just the static window
    length).
  - **Provider-agnostic architecture** (`lib/rate-limit/`) — a
    `RateLimiter` interface + `PostgresRateLimiter` as its only
    implementation + `getRateLimiter()` factory, mirroring
    `EmailProvider`/`IntegrationProvider` exactly. Every call site imports
    only `checkRateLimit()`/`RateLimitError` — no Postgres-specific
    knowledge anywhere outside `lib/rate-limit/`, so a future distributed
    limiter (e.g. Upstash Redis) is a change to the factory alone.
  - **Centralized configuration** (`lib/rate-limit/config.ts`) — one
    scope -> `{windowSeconds, maxAttempts, failClosed}` map. `failClosed`
    is a per-scope policy, not a blanket choice: the three unauthenticated
    auth scopes (sign-in, sign-up, forgot-password) fail closed on an
    infrastructure error in the check itself (an outage there must not
    become an open brute-force window); every authenticated scope fails
    open (a transient hiccup must not lock a paying customer out of their
    own campaign — RLS and billing limits remain the real security
    boundary on those paths). `forgot-password` is dual-keyed by IP *and*
    email, since IP-only doesn't stop a distributed attacker rotating IPs
    to email-bomb one victim.
  - **19 protected call sites**, the full catalog approved during scoping:
    `lib/actions/auth.ts` (4, IP-based), 4 AI-recommendation actions, both
    mailbox test-connection actions, the integration test-digest action,
    4 campaign actions, 3 lead-verification actions, and CSV import (11,
    all organization-based). Each matches its own call site's existing
    error-surfacing convention (a thrown `Error`, a returned
    `{ok, error}`, or a returned `{error, ...}` state shape) rather than
    forcing one pattern app-wide.
  - **`RateLimitError` never leaks implementation details** — a fixed,
    generic message ("Too many attempts. Try again in ~.") regardless of
    scope, count, or identity, plus a typed `retryAfterSeconds` field.
  - **Migration applied, local and remote confirmed in sync**: applied to
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, confirmed by a follow-up `--dry-run` reporting
    `"upToDate":true` with an empty migrations list, and by
    `supabase migration list` showing `local == remote`.
  - **RPC validated live, not just read from the migration file**: called
    `record_rate_limit_attempt()` twice with `max_attempts: 1` against the
    linked project — first call returned `{allowed: true}` and recorded
    the attempt, second call on the same scope/identity returned
    `{allowed: false, retry_after_seconds: 60}` — the windowed count, the
    block, and the computed retry-after all behave exactly as designed.
  - **RLS confirmed enabled and enforcing**: an anon-key direct insert and
    an anon-key call to the RPC itself were both rejected by Postgres with
    `"new row violates row-level security policy for table
    \"rate_limit_events\""` — the RPC-call rejection additionally confirms
    the function runs as invoker, not security-definer, so it can't be
    used as a backdoor around the table's own RLS.
  - **Enterprise Readiness Security track is now fully complete** — all 7
    approved Security findings from the original audit (Phases 3B Parts
    1-3) are implemented and their migrations applied. Remaining from the
    original audit: the Reliability and Scalability tracks, neither
    started, neither yet broken into sub-phases.
- **Enterprise Readiness — Reliability Track — COMPLETE (2026-08-06, commit
  `f78c643`).** Six approved items from the same original audit's
  Reliability section (a separate category from the now-complete Security
  track above), scoped to the specific files each item touches rather than a
  repeat full-codebase audit. Explicitly did not modify `claim_due_sends()`,
  `send_attempts`, monitoring, audit logging, or rate limiting — every
  change is isolated to its own worker/provider file. All six:
  - **IMAP connection timeout** — `ImapFlow` (`lib/email/reply-providers/imap.ts`)
    had no connect/greeting/socket timeout, unlike SMTP since Track B's E4
    (`SMTP_TIMEOUTS`); a hung/unreachable mailbox could block
    `reply-worker.ts`'s sequential per-mailbox loop indefinitely. Mirrors
    SMTP's 10s/20s timeout values, with the same friendly-timeout-message
    pattern.
  - **Send worker invocation time budget** — `runSendWorker`
    (`lib/email/send-worker.ts`) now stops claiming new work after a
    4-minute wall-clock budget instead of running unbounded across a full
    claimed batch of slow/timing-out sends. Never aborts a send already in
    flight; a lead left unprocessed simply stays claimed until its existing
    lease expires and is reclaimed by the next cron tick, the same self-heal
    every other early-return path in this file already relies on.
  - **Cron schedule verification** — all 5 `.github/workflows/cron-*.yml`
    schedules checked against their corresponding claim-lease durations
    (`claim_due_sends()`/`claim_due_verifications()`); no drift or
    misconfiguration found. Verification-only, no code change.
  - **Consistent retry/backoff across external providers** — the bulk
    verification worker (`lib/verification/bulk-worker.ts`) previously
    discarded `VerificationError`'s `"retry"` classification entirely and
    always wrote a terminal `error` status, even for a transient network/
    rate-limit failure. It now requeues those to `pending` (via the existing
    `queueLeadsForVerification`) so they self-heal on the next cron tick,
    matching how `send-worker.ts`/`reply-worker.ts` already treat their own
    transient failures.
  - **Explicit Stripe SDK network retries** — `getStripeClient()`
    (`lib/billing/stripe.ts`) now passes `maxNetworkRetries: 2` (Stripe's
    own documented recommendation) instead of the SDK default of 0. Safe
    because the SDK only retries requests it can prove are idempotent.
  - **Reply-sync overlap protection** — unlike the claim-based send and
    verification pipelines, `runReplySyncWorker` previously selected
    mailboxes via a plain `select` with no lease of any kind, so an
    overlapping invocation (a slow run still in flight when the next
    scheduled sync-replies trigger fired) could process the same mailbox's
    inbox twice concurrently. New migration
    (`supabase/migrations/20260814100000_mailboxes_reply_sync_lock.sql`)
    adds `mailboxes.reply_sync_locked_until` + `claim_mailboxes_for_reply_sync()`
    (same `for update skip locked` lease pattern as `claim_due_sends()`/
    `claim_due_verifications()`, scoped only to `mailboxes`), with the lease
    released on both success (`updateMailboxSyncCursor`) and per-mailbox
    failure. No new RLS policy was needed — `mailboxes`' existing 4
    owner-scoped policies are unchanged and still enforcing; this migration
    only adds a column and a function.
  - **Migration applied, local and remote confirmed in sync**: applied to
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, confirmed by a follow-up `--dry-run` reporting
    `"upToDate":true` with an empty migrations list, and by
    `supabase migration list` showing `local == remote` for all 41
    migrations including this one.
  - **New column and function confirmed live, not just read from the
    migration file**: queried directly against the linked project —
    `mailboxes.reply_sync_locked_until` (`timestamp with time zone`,
    nullable) and `claim_mailboxes_for_reply_sync` (`FUNCTION`,
    `security_type: INVOKER` — not security-definer, matching
    `claim_due_sends()`/`claim_due_verifications()`'s existing convention)
    both exist.
  - All checks (typecheck, lint, build, full test suite — 475 tests) passed
    before commit.
- **Enterprise Readiness — Scalability Track, Phase A (Foundation) —
  COMPLETE (2026-08-15, commit `a758bce`).** First of five approved phases
  for the Scalability track (Phase A Foundation / B Infrastructure /
  C Shadow Validation / D Incremental Cutover / E Cleanup), scoped to only
  the specific files each item touches rather than a repeat full-codebase
  audit, and re-verified against the current repository rather than
  assuming the prior Security/Reliability audits still held. Phase A is
  strictly zero production behavior change — every item here is
  prerequisite/hygiene work; the fixes with real user-facing effect land in
  later phases. **Implementation complete, published, both migrations
  applied.**
  - **Item 1 — cron worker admin-client cleanup**: `runCronJob()`
    (`lib/monitoring/run-cron-job.ts`) now passes its one
    `createAdminClient()` instance into each worker's `run()` callback
    instead of every worker creating a redundant second instance. Touches
    all 5 cron routes and all 5 workers (`send-worker.ts`,
    `reply-worker.ts`, `bulk-worker.ts`, `digest-worker.ts`,
    `health-check-worker.ts`) plus the two workers' test suites, updated to
    pass a stub client directly instead of mocking `createAdminClient`.
  - **Item 2 — defensive `.limit()` ceilings**: `listCampaigns`,
    `listSendAttemptsForCampaignLeads`, `listEnabledIntegrations`, and
    `listActiveMailboxesForHealthCheck` were completely unbounded queries
    identified during this track's audit; each now has a generous ceiling
    (1000-5000, matching the `EVENT_FETCH_LIMIT` precedent already used
    across the analytics snapshot builders) as a stopgap ahead of their
    real pagination/batching fixes in later phases. Verified live against
    the linked project before choosing values: current real row counts
    were trivially small (max 1 campaign/user, max 1 send_attempt/campaign,
    0 enabled integrations, 2 active mailboxes), so today's behavior is
    unchanged.
  - **Item 3 — rollup constraint migration (narrowed scope)**: widens
    `analytics_daily_rollups_event_type_check` to accept `email_events`'
    vocabulary (`'sent'`/`'failed'`, previously only `'email_sent'` was
    allowed and `'failed'` wasn't a valid value at all). The grouped SQL
    aggregation function originally planned alongside this was deliberately
    deferred to Phase B — designing it (organization-id derivation via
    `campaigns`, per-subject-type handling, domains having no direct
    `email_events` link) is worker-design work, not a schema prerequisite.
    Purely additive; the table has zero rows and no reader exists yet.
  - **Item 11 (migration portion) — retention indexes**: adds plain
    `created_at` indexes to `rate_limit_events` and `job_runs`, verified
    missing this session — both tables only had composite indexes leading
    with a different column, which a future retention/pruning worker's
    `delete where created_at < ...` (Phase B) could not have used, forcing
    a full table scan on the two fastest-growing tables in the schema.
  - **Migrations applied, local and remote confirmed in sync**: both
    applied to the linked development/staging Supabase project
    (`wxhulmbbobkfvtreaspo`) via `supabase db push`, confirmed by a
    follow-up `--dry-run` reporting `"upToDate":true` with an empty
    migrations list, and by `supabase migration list` showing
    `local == remote` for all 43 migrations including both new ones.
  - **Schema changes confirmed live, not just read from the migration
    files**: queried directly against the linked project — the widened
    `analytics_daily_rollups_event_type_check` constraint definition
    matches exactly, both `rate_limit_events_created_at_idx` and
    `job_runs_created_at_idx` exist as plain btree indexes on `created_at`.
    Also confirmed no unexpected side effects: RLS remains enabled on all
    three affected tables, `rate_limit_events` and `job_runs` each have
    exactly one additional index (nothing else added or removed), and
    `analytics_daily_rollups` has the same 6 constraints as before this
    migration, only the `event_type` check's definition changed.
  - **Explicitly confirmed unchanged**: `claim_due_sends()`, the
    `send_attempts` RPC functions (`claim_send_attempt`,
    `record_send_success`, `record_send_failure`), monitoring's actual
    logging/heartbeat/error-tracking behavior (only `run-cron-job.ts`'s
    `run()` callback signature changed, not what gets recorded or when),
    audit logging, and rate limiting.
  - All checks (typecheck, lint, build, full test suite — 475 tests) passed
    before commit.
  - **Next milestone: Phase B (Infrastructure)** — not started. Phases C
    (Shadow Validation), D (Incremental Cutover), and E (Cleanup) also
    remain not started.
- **Enterprise Readiness — Scalability Track, Phase B (Infrastructure) —
  COMPLETE (2026-08-16, commit `0db7a98`).** Second of five approved
  phases. Objective: build the entire approved infrastructure with zero
  production behavior change — no analytics page reads from rollups, no
  page is wired to any new query, the CSV import action still inserts per
  row, and send-worker concurrency defaults to the prior sequential
  behavior. **Implementation complete, published, migration applied.**
  - **Item 4/5 — analytics rollup worker** (`lib/analytics/rollup-worker.ts`)
    — computes daily counts via a new SQL function,
    `compute_email_event_rollups()`, so raw `email_events` rows are never
    fetched into Node — grouping happens in Postgres, the exact pattern the
    original audit identified as missing (the N+1 root cause in
    `lib/analytics/organization-rollup.ts`). Covers campaign/mailbox/
    organization subject types directly; domain-level rollups are summed
    from the mailbox-level rows by domain, mirroring
    `lib/deliverability/domain-analytics.ts`'s existing "resolve mailboxes
    for a domain, then aggregate" pattern rather than a fourth SQL branch.
    Writes only to `analytics_daily_rollups`, which nothing reads from yet.
    Wired through a new `app/api/cron/analytics-rollup` route and
    `.github/workflows/cron-analytics-rollup.yml`, mirroring every other
    cron worker's shape exactly. Supports an explicit `{since, until}`
    range for a future backfill (item 5) — not invoked with one yet, that's
    Phase C.
  - **Item 7 — available-leads query** (`listLeadsAvailableForCampaign`,
    `lib/db/leads.ts`) — pushes the "not yet enrolled" filter into SQL via
    a `.not("id", "in", ...)` filter built from a small, campaign-scoped
    enrolled-id lookup, instead of the campaign detail page's current
    10,000-row account-wide fetch diffed in JS. Built only — the page
    itself is untouched.
  - **Item 8/9 — pagination** (`listLeadsPage`/`listCampaignsPage`, one
    query each combining `.range()` with `{ count: "exact" }`) plus a new
    generic `components/ui/pagination.tsx`. The existing `listLeads()`/
    `listCampaigns()` functions the live pages call are untouched. Their
    supporting composite indexes are deliberately deferred to Phase D, per
    the approved scope adjustment — they'd be dead weight against
    unreachable code until the pages actually cut over.
  - **Item 10 — CSV batch-insert helper** (`createLeadsBatch`,
    `lib/db/leads.ts`) — chunks lead inserts into array inserts (500 rows
    at a time) instead of one round trip per row, falling back to per-row
    inserts within any chunk that fails as a whole so row-level error
    attribution isn't lost. Built only —
    `app/(app)/leads/import-actions.ts` still calls `createLead()` per row,
    unchanged.
  - **Item 11 — retention worker, dry-run only**
    (`lib/monitoring/retention-worker.ts`) — counts candidates in
    `rate_limit_events` (7-day window) and `job_runs` (90-day window) past
    their retention cutoff using the plain `created_at` indexes Phase A
    added specifically for this query shape; deletes nothing. Deliberately
    scoped to only those two operational-log tables — `email_events`/
    `send_attempts`/`analytics_events` are core business data this same
    track's rollup infrastructure depends on, and `audit_logs`' retention
    window is a compliance decision, not an engineering one, so neither is
    touched.
  - **Item 12 — bounded send-worker concurrency**
    (`lib/email/send-worker.ts`) — the prior sequential `for...of` loop
    replaced by `processClaimedLeads()`, processing up to `concurrency`
    claimed leads at once with one hard invariant: two leads for the same
    `mailbox_id` are never processed concurrently, since
    `mailboxes.cooldown_minutes`/`hourly_limit` and `claim_due_sends()`'s
    daily-limit check (a count taken at claim time, not re-checked per
    send) both assume one send per mailbox at a time. Defaults to
    `concurrency = 1`, which reduces the new orchestration to exactly the
    prior loop's order and behavior — confirmed by a dedicated test.
    `processCampaignLead()` itself (the actual send pipeline) is
    unchanged, diffed line-by-line to confirm.
  - **One migration, two additive changes**: widens `job_runs_job_check` to
    allow the two new job names (`analytics-rollup`, `retention-cleanup`) —
    without it, every invocation of the two new cron routes would silently
    fail to persist its `job_runs` row — and adds
    `compute_email_event_rollups()`. Both flagged and approved before
    implementation, since the phase was originally scoped as needing no
    migration at all.
  - **Migration applied, local and remote confirmed in sync**: applied to
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, confirmed by a follow-up `--dry-run` reporting
    `"upToDate":true` with an empty migrations list, and by
    `supabase migration list` showing `local == remote` for all 44
    migrations including this one.
  - **Schema changes confirmed live, including a real functional smoke
    test, not just read from the migration file**: the widened
    `job_runs_job_check` constraint definition (all 7 job names present)
    and `compute_email_event_rollups`'s existence (`FUNCTION`,
    `security_type: INVOKER`, matching `claim_due_sends()`'s convention)
    both queried directly against the linked project. The function was
    also called live against real data
    (`compute_email_event_rollups('2020-01-01', '2030-01-01')`) — it
    returned correctly-computed, internally consistent rows (the same
    underlying events counted identically at the campaign, mailbox, and
    organization level), confirming the `email_events` -> `campaigns` ->
    `organization_members` join path is correct against the real schema,
    not just syntactically valid. `job_runs` confirmed to have exactly one
    changed constraint and zero added/removed indexes or RLS changes.
  - **Explicitly confirmed unchanged**: `claim_due_sends()`, the
    `send_attempts` RPC functions, `processCampaignLead()` (the actual send
    pipeline, diffed line-by-line), every production analytics read path
    (`lib/campaigns/campaign-analytics.ts`, `lib/mailboxes/mailbox-analytics.ts`,
    `lib/deliverability/domain-analytics.ts`,
    `lib/analytics/organization-rollup.ts`), the `/leads` and `/campaigns`
    pages, `import-actions.ts`, audit logging, and rate limiting.
  - All checks (typecheck, lint, build, full test suite — 508 tests, up
    from 475) passed before commit.
  - **Next milestone: Phase C (Shadow Validation)** — not started. Phases D
    (Incremental Cutover) and E (Cleanup) also remain not started.
- **Enterprise Readiness — Scalability Track, Phase C (Shadow Validation) —
  COMPLETE (2026-08-16, verification-only — no application code changed,
  no commit of its own).** Third of five approved phases. Objective: prove
  every Phase B capability produces correct output before anything is
  allowed to affect a real user — read-only/observe-only wherever that
  concept applies, run directly against the linked development/staging
  Supabase project (`wxhulmbbobkfvtreaspo`) via two throwaway diagnostic
  scripts, neither committed (deleted immediately after use; confirmed via
  `git status` showing nothing left behind).
  - **Item 5 — backfill, run for real**: `runAnalyticsRollupWorker`
    invoked with `{since: "2026-08-04", until: "2026-08-16"}`, the full
    real `email_events` history on this project (3 raw events, one day).
    Result: 6 rows computed and upserted, 0 failed — split correctly
    across campaign/mailbox/organization subject types, confirmed by a
    direct follow-up query against `analytics_daily_rollups`. No
    domain-level row, correctly, since that mailbox has no `domain_id` set.
  - **Item 6 — old vs new numbers**: raw `email_events` counts for the
    campaign (`sent: 2, replied: 1`) compared against the newly-backfilled
    rollup rows summed for the same period — **exact match on every
    event_type**, no discrepancy.
  - **Item 7 — available-leads query**: `listLeadsAvailableForCampaign`'s
    output compared against the old 10,000-row-fetch-and-JS-diff approach
    for a real campaign — both returned the identical single-lead result
    set.
  - **Item 10 — CSV batch-insert, against real Postgres constraints, not
    just mocks**: two live tests, cleaned up afterward. (a) 5 rows via the
    batch path vs. 5 via the sequential path, both fully successful. (b)
    the one thing a mock can't prove — a batch containing one row that
    collides with a real `(user_id, email)` unique-constraint violation:
    the bulk insert failed as a whole, and the per-row fallback correctly
    isolated the failure to exactly that row while the other two
    succeeded. All 13 test rows (obviously-fake `@example.invalid`
    addresses, tagged and scoped to one test user) deleted immediately
    after, verified with a follow-up count query reporting 0 remaining.
  - **Item 11 — retention worker, run for real**: `rate_limit_events`
    (7-day cutoff) and `job_runs` (90-day cutoff) both reported 0
    candidates — expected, nothing on this project is old enough yet.
    Confirmed dry-run: no deletions occurred.
  - **Item 12 — deliberately not live-canaried.** Every other item above
    is read-only or, at most, writes to a table nothing else reads from
    yet (`analytics_daily_rollups`) or to rows created and deleted within
    the same script. A live send-worker concurrency canary is categorically
    different — it would mean actually claiming real `campaign_leads` and
    dispatching real outbound email via SMTP/OAuth, an external,
    irreversible action, not a "shadow" of anything. Left validated by
    Phase B's existing invariant test suite only, pending a separate,
    explicit approval if a live canary is ever wanted.
  - **No migration, no code commit** — this phase was entirely
    verification against already-shipped Phase B infrastructure. The 6
    rollup rows it produced in `analytics_daily_rollups` are the one
    persistent effect, and they are the intended, expected output of item
    5, not a side effect requiring cleanup.
  - **Next milestone: Phase D (Incremental Cutover)** — complete, see
    below. Phase E (Cleanup) is now the next milestone.
- **Enterprise Readiness — Scalability Track, Phase D (Incremental
  Cutover) — COMPLETE (2026-08-06, six commits: `ceaa989`, `0e8494c`,
  `d80ccd2`, `57fedd7`, `6f851aa`, `94c3418`).** Fourth of five approved
  phases. Objective: cut every Phase B capability over to real production
  behavior, one item at a time, each independently audited, implemented,
  verified, committed, and pushed before the next began — the only phase
  in this track where real production behavior actually changes.
  **Implementation complete, published, no migration pending.**
  - **Step 1 / Items 6 — mailbox, domain, and organization analytics cut
    over to rollups** (commit `ceaa989`) — `lib/mailboxes/mailbox-analytics.ts`,
    `lib/deliverability/domain-analytics.ts`, and
    `lib/analytics/organization-rollup.ts` now read from
    `analytics_daily_rollups` (via `listDailyRollups()`/`sumByKey()`)
    instead of fetching and summing raw `email_events` rows in Node.
    `lib/campaigns/campaign-analytics.ts` deliberately excluded and
    confirmed unchanged — it needs raw per-step event rows for
    step-level drop-off/health-score computation, which the rollup
    granularity can't serve; re-audited before Item 10 and reconfirmed
    byte-for-byte unchanged. Verified live on the linked development
    /staging project: `/analytics` page numbers (`Emails sent: 2, Reply
    rate: 50%`) matched Phase C's already-validated rollup numbers
    exactly.
  - **Step 2 / Item 7 — available-leads query wired in** (commit
    `0e8494c`) — the campaign detail page
    (`app/(app)/campaigns/[campaignId]/page.tsx`) now calls
    `listLeadsAvailableForCampaign()` (built in Phase B) instead of the
    old 10,000-row account-wide fetch diffed against enrolled leads in
    JS.
  - **Step 3 / Items 8/9 — pagination wired in, plus deferred composite
    indexes** (commit `d80ccd2`) — `/leads` and `/campaigns`
    (`app/(app)/leads/page.tsx`, `app/(app)/campaigns/page.tsx`,
    `components/leads/lead-table.tsx`,
    `components/campaigns/campaign-list.tsx`) now call
    `listLeadsPage()`/`listCampaignsPage()` with the new
    `components/ui/pagination.tsx` control, replacing the prior
    unbounded/capped `listLeads()`/`listCampaigns()` reads on those two
    pages (both functions are kept — still used elsewhere, e.g. the
    campaign detail page's `{ limit: 10000 }` call). Adds the two
    composite indexes deferred from Phase B
    (`leads_user_id_created_at_idx`, `campaigns_user_id_created_at_idx`,
    migration `20260817100000_leads_campaigns_pagination_indexes.sql`).
    **Live browser testing during this step found a real bug not caught
    by any mocked unit test**: PostgREST rejects an out-of-range
    `.range()` offset outright (HTTP 416, error code `PGRST103`,
    "Requested range not satisfiable") instead of returning zero
    rows — navigating to `/leads?page=2` with only 2 real leads crashed
    the page. Fixed by having both paginated queries fall back to a
    count-only query and clamp to the last valid page on `PGRST103`
    instead of throwing, covered by new fallback tests in
    `lib/db/leads.test.ts` and a new `lib/db/campaigns.test.ts`, and
    re-verified live in the browser afterward — both pages now
    self-correct to page 1 instead of crashing on a stale/out-of-range
    page number.
  - **Item 10 — CSV batch-insert swap** (commit `57fedd7`) —
    `app/(app)/leads/import-actions.ts` now validates, dedups, and
    quota-checks each CSV row up front exactly as before, then makes one
    call to `createLeadsBatch()` (built in Phase B) instead of one
    `createLead()` round trip per row, mapping any batch-insert failure
    back to its original CSV row number so the existing
    `imported`/`skippedDuplicates`/`failed`/`failedRows` UX is
    unchanged. One narrow, explicitly-documented tradeoff was evaluated
    and accepted: dedup/quota state is reserved optimistically before
    the batch runs rather than only after a confirmed insert, which can
    very rarely cause an over-conservative skip within a single import
    (never an under-conservative one) — the database's
    `leads_user_email_key` unique constraint remains the actual
    authority against duplicates regardless, and both `knownEmails` and
    `remainingQuota` are recomputed from the database on every import,
    so the tradeoff is self-correcting and cannot cause over-admission
    past quota.
  - **Item 11 — retention worker, dry-run to real delete** (commit
    `6f851aa`) — `lib/monitoring/retention-worker.ts` now calls
    `.delete({ count: "exact" })` instead of a count-only `.select()`
    for both `rate_limit_events` (7-day cutoff) and `job_runs` (90-day
    cutoff), reporting `deletedCount` instead of `candidateCount`. Same
    two tables, same two retention windows, same `created_at` indexes as
    the dry-run had. No new migration needed — `job_runs_job_check`
    already allowed the `retention-cleanup` job name from Phase B.
    Confirmed via the migrations directly that neither table has foreign
    keys pointing at it, so there are no cascading child rows to worry
    about.
  - **Item 12 — bounded send-worker concurrency, raised from 1 to 5**
    (commit `94c3418`) — `DEFAULT_CONCURRENCY` in
    `lib/email/send-worker.ts` raised from 1 to 5; the
    `processClaimedLeads()` orchestration itself (built and tested in
    Phase B) is unchanged. Before implementing, traced every guarantee
    the change could plausibly threaten: the same-mailbox-never
    -concurrent invariant is structural (`inFlightMailboxIds`), holding
    regardless of the concurrency value; `claim_due_sends()`'s daily
    /hourly/cooldown checks are a claim-time snapshot never re-checked
    per send, so any batch-claim overshoot is a pre-existing property of
    that function alone, unaffected by worker concurrency;
    `send_attempts_lead_step_key`'s unique constraint plus each claimed
    lead being removed from the queue before dispatch makes a duplicate
    send structurally impossible at any concurrency; and
    `SmtpEmailProvider` creates a fresh, unshared transport per send, so
    parallel sends to different mailboxes can't race on shared state.
    This is the highest-risk item in the track (the only one enabling
    real concurrent outbound sends) and was deliberately implemented
    last.
  - **No migrations created by this phase's implementation work.** The
    one migration among these six commits
    (`20260817100000_leads_campaigns_pagination_indexes.sql`, Step 3) was
    already applied to the linked development/staging project
    (`wxhulmbbobkfvtreaspo`) in an earlier, separately-approved step and
    confirmed live before Item 10 began. **No pending migrations remain
    for Phase D.**
  - **Confirmed out of scope for this milestone**: Phase E (Cleanup) —
    removing the now-superseded raw-fetch analytics code paths, the
    unbounded `listLeads()`/`listCampaigns()` callers this phase didn't
    touch, and any other Phase A-D scaffolding left behind for
    backward compatibility — was **not** implemented as part of Phase D
    and remains not started. Production Readiness findings from the
    original audit were also **not** implemented and remain not started.
  - Every step re-ran the full check sequence (typecheck, lint, build,
    test) before its own commit; the test suite grew from 508 (the Phase
    B/C baseline) to 523 tests (70 files) over the course of the six
    steps, all passing at each step and confirmed once more in a final
    full run at the end of the phase.
  - **Next milestone: Phase E (Cleanup)** — complete, see below. Phase E
    was the final phase of the Scalability Track.
- **Enterprise Readiness — Scalability Track, Phase E (Cleanup) — COMPLETE
  (2026-08-06, commit `c7f7755`).** Fifth and final of five approved
  phases. Objective: remove the pre-cutover code paths Phase D's real
  production cutover left behind, without touching any production
  behavior, analytics output, or the already-cut-over read paths
  themselves. **Implementation complete, published, no migration
  created.**
  - **Zero-import verification, re-run immediately before deleting**:
    `lib/analytics/domain-metrics.ts` (`summarizeDomainMetrics`) had
    exactly one importer — its own test file — confirmed by a full-repo
    grep before any file was touched.
  - **Deleted** — `lib/analytics/domain-metrics.ts` and
    `lib/analytics/domain-metrics.test.ts`. This was the only item in
    Phase D's original "superseded pre-cutover code paths" description
    that turned out to be genuinely dead code.
  - **`DomainAnalyticsSnapshot.events` — inspected, not removed.** The
    approved order also called for removing this field, but inspection
    found its own doc-comment's claim ("confirmed unused by every real
    caller") was inaccurate:
    `app/(app)/settings/deliverability/[domainId]/analytics/page.tsx`
    still consumes it to drive the Trends / Forecast / AI Insights
    section. It has been unconditionally `[]` since Phase D's domain
    cutover, so that section has been rendering an empty dataset since
    — a real gap, not dead code, so removing it was out of scope for a
    cleanup-only phase. Deferred to Production Readiness (see Not
    started) rather than silently expanding Phase E's scope or breaking
    the page's typecheck.
  - **5 stale comments updated** — `lib/analytics/organization-rollup.ts`,
    `lib/deliverability/domain-analytics.ts`,
    `lib/deliverability/scoring.ts`, `lib/db/email-events.ts`, and
    `app/(app)/settings/deliverability/compare/page.tsx` each had a
    comment pointing at `lib/analytics/domain-metrics.ts`'s file path;
    updated to point at its replacement
    (`lib/deliverability/domain-analytics.ts`) or state the fact
    directly, with no logic change.
  - **Explicitly confirmed unchanged**: send-worker, retention worker,
    rollup worker, pagination, CSV import, the available-leads query, and
    every analytics output — this phase touched only the two deleted
    files and five comments.
  - All checks (typecheck, lint, build, full test suite — 520 tests, 69
    files) passed before commit. No migration created or applied.
  - **Enterprise Readiness Scalability Track is now fully complete** —
    all five phases (A Foundation, B Infrastructure, C Shadow Validation,
    D Incremental Cutover, E Cleanup) done.
  - **Next milestone: Production Readiness** — in progress. The
    Deliverability Trends Rollup Migration item discovered during this
    phase's Exit Review is its first tracked item, now complete — see
    below.
- **Enterprise Readiness — Production Readiness — Deliverability Trends
  Rollup Migration — COMPLETE (2026-08-06, commit `7dca187`).** First
  tracked item under Production Readiness, the milestone that followed
  Scalability Track completion (discovered during the Scalability Phase E
  Exit Review — see Scalability Track, Phase E above). Objective: replace
  `DomainAnalyticsSnapshot.events` (permanently empty since the
  Scalability Phase D rollup cutover) with real data, so the
  Deliverability Analytics page's Trends / Forecast / AI Insights section
  stops operating on an empty dataset. **Implementation complete,
  published, no migration created.**
  - **Migration**: `lib/deliverability/domain-analytics.ts`'s
    `loadDomainAnalyticsSnapshot` gained an optional `trendsRange`
    parameter and now fetches domain-scoped (`subject_type='domain'`)
    rows from `analytics_daily_rollups` — already written nightly by the
    existing rollup worker — replacing the old
    `events: Tables<"email_events">[]` field. Domain Comparison's call
    site is unaffected, since it doesn't pass a range.
  - **Preserved output contract**: the Trends section's day-bucketing was
    rewritten to read pre-aggregated rollup rows via a new page-local
    helper that mirrors `lib/analytics/aggregations.ts`'s
    `bucketByDayInRange` loop exactly (same UTC cursor iteration, same
    zero-fill, same ordering) — its output is still the same
    `DailyCount[]` shape, so forecasting, comparisons, insights, and
    every UI component downstream (`TrendCard`, `DailyBarChart`,
    `StatCard`, `InsightsCard`) needed no changes.
  - **Parity verification**: the new bucketing helper's loop is a
    structural mirror of `bucketByDayInRange`, which already has 3 passing
    tests covering exactly this loop shape (zero-fill, ordering, inverted
    -range short-circuit) in `lib/analytics/aggregations.test.ts`. New
    unit tests were added in `lib/deliverability/domain-analytics.test.ts`
    (the first test coverage this file has ever had) covering the new
    `dailyRollups` fetch: scoped correctly when a trends range is given,
    omitted when not (matching Domain Comparison's usage), and passed
    through to `listDailyRollups` unmodified — confirming no clamping of
    the current/partial day happens in this function.
  - **Live schema verification against the linked development/staging
    project** (`wxhulmbbobkfvtreaspo`), read-only, no writes: confirmed
    the Postgres session timezone is UTC (closing the audit's flagged
    timezone-alignment risk), confirmed `rollup_date` comes back as a
    plain `YYYY-MM-DD` string matching the bucketing helper's lookup key
    exactly, confirmed `analytics_daily_rollups`' live column types match
    what the code assumes, and confirmed the new `subject_type='domain'`
    query shape executes cleanly against the real schema. Zero-fill and
    current-partial-day handling were demonstrated using the project's
    real rollup dates (most recent row `2026-08-04`, live `current_date`
    `2026-08-06`): walking a realistic 7-day range through the bucketing
    logic correctly zero-fills every day with no activity, including
    today.
  - **Accepted, documented limitation**: no write-based end-to-end
    validation of an actual domain rendering real Trends data was
    performed, because the linked development/staging project has zero
    rows in `domains` and zero mailboxes with `domain_id` set — there is
    no representative domain to click through. Every mechanical piece the
    domain path depends on (the shared `analytics_daily_rollups` table,
    the shared `listDailyRollups()` query function, the exact column
    types, real sibling rows of the identical shape) was verified live
    instead. Creating test data to close this gap would be a write action
    outside a read-only validation pass and was not authorized.
  - **No migration required or created** — `analytics_daily_rollups` and
    its `subject_type='domain'` write path already existed, built and
    tested in earlier Scalability Track phases.
  - All checks (typecheck, lint, build, full test suite — 525 tests, 70
    files) passed before commit.
- **Enterprise Readiness — Production Readiness — Security Gate —
  COMPLETE (2026-08-09, commit `83f8e5d`).** Second tracked item under
  Production Readiness. Objective: run a targeted security audit of the
  Production Readiness surface and remediate any real findings found.
  **Implementation complete, published, no migration created.**
  - **Audit scope**: a targeted pass, not a re-audit of the Enterprise
    Readiness Security track (see Phase 3B, above). Two real findings
    were identified; both were remediated. No other observations from
    this pass were implemented — see "Not implemented" below.
  - **Finding 1 (Medium) — provider API-key exposure.**
    `listAiProviderKeys()` (`lib/db/ai-provider-keys.ts`) and
    `listVerificationProviderKeys()` (`lib/db/verification-provider-keys.ts`)
    selected `*`, so the `encrypted_api_key` ciphertext was included in
    query results that flow into `AiProvidersPanel` and
    `VerificationProvidersPanel` — both Client Components — meaning the
    ciphertext was reaching the RSC flight payload sent to the browser,
    unused by either panel.
    - **Fix**: both list functions now select an explicit safe column set
      (`id, organization_id, provider, key_preview[, model], created_at,
      updated_at`) excluding `encrypted_api_key`, and return new
      `AiProviderKeySafe`/`VerificationProviderKeySafe` types
      (`Omit<Tables<...>, "encrypted_api_key">`). The single-row
      `getAiProviderKeyByProvider`/`getVerificationProviderKeyByProvider`
      lookups are unchanged and still select the full row, since they
      feed server-only decrypt paths (`lib/ai/recommendations.ts`,
      `lib/verification/verify.ts`, `lib/verification/bulk-worker.ts`)
      that are never reachable from the browser.
    - **Consuming panels updated**:
      `components/settings/ai-providers-panel.tsx` and
      `components/settings/verification-providers-panel.tsx` now type
      their local state against the new `*Safe` types instead of the raw
      `Tables<...>` row type.
  - **Finding 2 (Low) — IMAP/SMTP test-connection error leakage.**
    `testImapConnectionAction`/`testSmtpConnectionAction`
    (`app/(app)/mailboxes/actions.ts`) returned the caught error's raw
    `.message` to the browser verbatim on connection failure, which could
    surface internal nodemailer/ImapFlow error codes or raw IMAP/SMTP
    server response text to the client.
    - **Fix**: added `classifyTestConnectionError(error, kind)`, which
      logs the full error server-side (`console.error`) and returns one
      of a small set of generic, user-facing messages based on the
      error's `code`/`responseCode`/`responseStatus` — unreachable host,
      TLS/certificate problem, rejected credentials, or a generic
      per-protocol fallback. Plain `Error`s carrying no provider error
      code (the existing timeout/friendly-message paths in
      `lib/email/providers/smtp.ts` and
      `lib/email/reply-providers/imap.ts`, and the 10s test-connection
      timeout) still pass their message through unchanged, since those
      are already sanitized by this codebase.
  - **No migration required or created** — both fixes are read-column and
    error-handling changes only; no schema change.
  - **No RLS or authentication architecture changes** — this remediation
    did not touch policy definitions or session/auth handling.
  - **Not implemented**: any other, unrelated observations from the
    audit — only the two findings above were scoped, approved, and
    remediated as part of this item.
  - All checks (typecheck, lint, build, full test suite — 525 tests, 70
    files) passed before commit. Commit `83f8e5d` is published on
    `origin/main`; local `HEAD` was verified equal to `origin/main` after
    the push.

## Current milestone

Enterprise Readiness — Production Readiness — in progress. The
Scalability Track (Phases A through E) is fully complete. Production
Readiness has two completed items so far: the Deliverability Trends
Rollup Migration (commit `7dca187`, discovered during the Scalability
Phase E Exit Review) and the Security Gate remediation (commit `83f8e5d`,
a targeted security audit that found and fixed two issues — provider
API-key exposure and IMAP/SMTP test-connection error leakage). Both are
complete (see Done). No further Production Readiness items are currently
itemized as approved work; other observations from the original audit
remain deferred/theoretical until separately scoped and approved.

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
