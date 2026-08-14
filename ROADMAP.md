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
- ✅ Production Readiness — UX / Visual Refinement — Complete (commit
  `09d0032`). A dedicated UX/visual-design pass: polished light and dark
  theming in `app/globals.css` with a warm-orange brand accent (accessible
  primary-foreground treatment, new success/warning/info tokens, tuned
  dark-mode shadow depth), plus five presentational-component fixes so
  brand orange no longer doubles as success/warning/error color (Badge
  semantic variants, analytics insight tones, deliverability score
  badges, dashboard stat-card tone support, and the warmup warning
  color). No business logic, database, migration, or security-system
  change. See Production Readiness under Done.
- ✅ Production Readiness — First-Customer Readiness Audit & Remediation
  — Complete (commit `e1d2b67`). A focused, read-only audit assessed
  whether the product could safely go in front of a first paying
  customer across 12 surfaces (auth/tenant isolation, mailbox
  connection/sending, lead management, campaigns/sequences,
  deliverability safeguards, analytics accuracy, error handling,
  security boundaries, production configuration, core UX reliability,
  responsiveness, billing). Result: 0 must-fix findings, 1 should-fix
  finding, 2 safe-to-defer findings — overall recommendation READY FOR
  CONTROLLED FIRST CUSTOMER. All three findings were then approved and
  remediated in one commit: (1) the Warmup page/dialog now discloses
  that it doesn't yet auto-adjust real campaign sending limits — a
  mailbox's Daily/Hourly limit is what controls that today; (2)
  unexpected database/infrastructure errors in seven campaign Server
  Functions are now sanitized to a generic message before reaching the
  browser instead of a raw `Error.message` passthrough, while
  deliberate business-rule messages are unaffected; (3) the Google and
  Microsoft OAuth mailbox-connect callbacks now sanitize unexpected
  errors the same way before placing them in a redirect query
  parameter. No migration, database, or authentication-architecture
  change. See Production Readiness under Done.
- ✅ Production Readiness — First-Customer Smoke Test & Remediation —
  Complete (commit `ca96c48`). A manual, browser-driven smoke test of the
  live application across the full first-customer journey (login,
  dashboard, mailboxes, leads, campaigns, warmup, analytics, settings,
  both themes, tablet-width responsiveness) using the environment's
  existing disposable E2E test fixtures — no new test data, no real
  mailbox/customer data. Result: READY WITH NON-BLOCKING ISSUES, zero
  launch blockers, four concrete findings approved and fixed: (1) a
  failed send's raw infrastructure error is now classified into a
  customer-safe label via the existing `classifyErrorCategory()`, raw
  text kept in a debug tooltip; (2) the campaign-detail and
  organization-analytics "Failed" stat cards now use the danger/red tone
  already shipped for the dashboard's card; (3) horizontal overflow at
  tablet width on Mailboxes and campaign detail — fixed via `flex-wrap`
  on two button-row headers plus, on campaign detail specifically, a
  `min-w-0` grid-item fix and a `contain: layout` fix on the Enrolled
  Leads table's scroll wrapper (root-caused via live DOM measurement, not
  assumed); (4) a campaign detail breadcrumb no longer mangles a UUID
  route segment. No migration, database, or authentication-architecture
  change. See Production Readiness under Done.
- ✅ Production Readiness — Final First-Customer Smoke Test & Remediation
  — Complete (commit `bf4b31e`). A final, test-only smoke test re-walked
  the full first-customer journey and re-verified all 11 previously-fixed
  items from the prior smoke test as passing, using the environment's
  existing disposable E2E test fixtures. Result: **GO**, zero P0
  findings, one new P1 finding — the Leads page had the same page-level
  horizontal-overflow bug already fixed on Mailboxes and campaign detail,
  just not yet applied there. Fixed with the identical proven pattern
  (`min-w-0` on the grid item, `flex-wrap` on the `CardHeader` and its
  button group, `contain: layout` on the table's scroll wrapper), plus
  one refinement found during verification: the button group's
  pre-existing `shrink-0` class was silently defeating `flex-wrap` and
  was removed to exactly match the already-working `mailbox-list.tsx`
  pattern. Browser-verified zero page-level overflow at ~820px with the
  Leads table still able to scroll internally, and no regression at
  desktop width or on the campaign detail page. No migration, database,
  or authentication-architecture change. See Production Readiness under
  Done.
- **Remaining**: no further Production Readiness items are currently
  itemized as approved work, and none are pending from the Security Gate.
  The Security Gate was intentionally scoped to its two findings, not
  framed as an exhaustive security review, and it did not produce a
  separate enumerated list of additional deferred findings — so there is
  no known security backlog to itemize here. A future security concern
  surfaced by a fresh audit, bug report, penetration test, or other
  evidence would be evaluated and scoped as its own new item at that time.

**Design System initiative status** (a separate, dedicated, phased
visual-design refinement, approved and tracked apart from the Production
Readiness backlog above):
- ✅ Phase 1 — Surface Hierarchy — Complete (2026-08-09, commit
  `3732a2d`). Established a page -> card -> surface-2 -> popover
  elevation hierarchy: light-mode `--card`/`--popover` moved off pure
  white onto the same off-white recipe `--sidebar` already used;
  dark-mode `--popover` became genuinely lighter than `--card` instead of
  equaling it; a new `--surface-2` token was added (defined, not yet
  consumed — reserved for a later phase); `Dialog`/`Sheet` switched from
  `bg-background` to `bg-popover`, fixing a real bug where both blended
  into the page instead of visually lifting off it. No component API
  changes. See Design System — Phase 1 under Done.
- ✅ Phase 2 — Semantic Color Hierarchy — Complete (2026-08-09, commit
  `d5c017b`). Extended `StatCard`'s existing `tone` prop pattern to
  `TrendCard`, `PercentageCard`, and `FunnelCard` so brand orange is no
  longer the default color for every metric icon/fill; corrected
  components where color contradicted meaning (warmup score badges,
  mailbox "Active" status, and the health-score checkmark now use
  success/warning/destructive tokens instead of brand orange; daily bar
  charts default to a neutral fill instead of orange; the organization
  Analytics page's "Success rate"/"Failure rate" cards now match the tone
  of their "Failed" sibling instead of staying brand orange). The
  duplicated `TrendBadge`/`TrendCard` direction-badge logic was
  deliberately left untouched, flagged for a later phase rather than
  refactored here. No database, Supabase, authentication, API, or
  business-logic change. See Design System — Phase 2 under Done.
- ✅ Phase 3 — Semantic Color Consistency Sweep — Complete (2026-08-14,
  commit `afcd588`). A read-only audit of every remaining status/
  verification badge Phase 2 didn't reach (deliverability, leads,
  mailboxes, warmup, dashboard, analytics, global tokens), followed by
  remediation of only the four genuine inconsistencies it found —
  explicitly not a second redesign pass. Root cause for two of the four:
  `StatusTone` (`components/dashboard/status-card.tsx`) had no `success`
  option even though `Badge` already did, so any status routed through
  `StatusCard` fell back to brand orange. Fixed: mailbox "Active" status
  now renders `success` in both `mailbox-health-list.tsx` and the mailbox
  analytics page's `StatusCard` (previously only `mailbox-list.tsx` had
  this right, from Phase 2); domain "Verified"/"Pass" now renders
  `success` in `domain-health-list.tsx` and `domain-dns-status.tsx`; lead
  verification "Valid" now renders `success` in `lead-table.tsx`.
  Confirmed intentional and left unchanged: campaign/warmup
  "Active"/"Enabled" brand orange (a lifecycle-in-progress marker, not a
  health verdict), and the `TrendBadge`/`TrendCard` duplication's
  `up -> default` mapping (deliberately polarity-neutral, since coloring
  "up" green unconditionally would mislabel a rising bounce rate as good).
  No new color tokens, no `globals.css` change, no database/Supabase/
  auth/API/business-logic change. See Design System — Phase 3 under Done.
- ✅ Phase 4 — Composition & Spacing Consistency — Complete (2026-08-14,
  commit `6ab9903`). A read-only audit of card composition, spacing
  rhythm, typography hierarchy, and border/radius/shadow consistency —
  found the system already substantially consistent, no launch blockers
  — followed by three narrow fixes: `mailboxes`/`warmup`/`settings`
  (+ its three sub-pages) standardized onto the same responsive
  `space-y-6 sm:space-y-8` page-container rhythm every other top-level
  page already used (max-widths unchanged); the inert `bg-card/60
  backdrop-blur-sm` pattern Phase 1 reserved for a later phase — a no-op
  over the flat page background across 13 components — replaced with
  solid `bg-card` (border/shadow/radius/padding/typography unchanged, no
  new glassmorphism added); and `DropdownMenuSubContent`'s
  shadow-bigger-than-its-parent inversion fixed (`shadow-lg` ->
  `shadow-md`, matching `DropdownMenuContent`). Premium purple and any
  new glassmorphism were explicitly evaluated and left for a future,
  separately-approved phase. No database, Supabase, authentication, API,
  or business-logic change. See Design System — Phase 4 under Done.
- ✅ Phase 5 — Premium Visual Polish — Complete (2026-08-14, commit
  `8845449`). Implemented the premium-purple accent and intentional
  glassmorphism the Phase 4 audit evaluated and deferred, scoped tightly
  to the roles that audit identified: two new tokens
  (`--accent-purple`/`-foreground`) used only for AI-recommendation
  surfaces (`RecommendationCard`'s icon chip) and the active-navigation
  state (sidebar/mobile-nav) — the established orange brand/CTA color is
  unchanged everywhere else. `Dialog`/`Sheet` overlays gained
  `backdrop-blur-sm` (content itself stays fully opaque); this was the
  one glass treatment the Phase 4 audit judged genuinely justified. No
  Phase 1-4 semantic-color or surface-hierarchy work was touched;
  mailbox "Active" still renders green, health scores still render red.
  No database, Supabase, authentication, API, or business-logic change.
  See Design System — Phase 5 under Done.
- ✅ Phase 6 — Orange → Premium Purple Rebrand — Complete (2026-08-14,
  commit `8b1d561`). An intentional visual rebrand, preceded by a
  read-only audit of every orange usage in the app: promoted Phase 5's
  already-validated purple from a scoped secondary/AI accent to the
  product's primary brand color (`--primary`/`--primary-foreground`/
  `--ring`/`--sidebar-primary`/`-foreground`/`--sidebar-ring` in
  `app/globals.css`, reusing Phase 5's exact values — no new palette).
  Because every orange pixel in the app already traced back to those six
  tokens (zero hardcoded color, confirmed by audit), buttons, badges,
  links, the hero, checklist, quick actions, icon chips, and every
  campaign/warmup "default"-variant lifecycle badge recolored
  automatically — only 4 files needed direct edits, 3 of them just
  repointing Phase 5's now-redundant `--accent-purple` tokens (removed)
  to `--primary`. Semantic colors untouched: mailbox "Active" still
  green, health/failure scores still red, warnings still amber; campaign
  "Active"/warmup "Enable" (brand-orange purely by old convention, not
  semantic) now render purple. `Dialog`/`Sheet` glassmorphism (Phase 5)
  preserved unmodified. No database, Supabase, authentication, API, or
  business-logic change. See Design System — Phase 6 under Done.
- Phase 7 (shared table system, logo/brand mark, visual-hierarchy
  polish, final consistency sweep) — not started.

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
    Readiness Security track (see Phase 3B, above), and not an exhaustive
    security review of the application. Two real findings were
    identified and both were remediated; the audit did not produce a
    separate enumerated list of additional deferred findings — see
    "Scope clarification" below.
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
  - **Scope clarification**: this item resolved exactly the two findings
    above, no more and no less. There is no known deferred security
    backlog left behind by this audit — it was intentionally scoped to
    these two findings rather than framed as an exhaustive review, and
    it produced no separate list of other findings to track. This is not
    a claim that the application has been exhaustively security-audited
    or is vulnerability-free — only that these two specific, identified
    issues are resolved. A future security concern (from a fresh audit,
    bug report, penetration test, or other evidence) would be evaluated
    and scoped as its own new item at that time, not folded into this
    one.
  - All checks (typecheck, lint, build, full test suite — 525 tests, 70
    files) passed before commit. Commit `83f8e5d` is published on
    `origin/main`; local `HEAD` was verified equal to `origin/main` after
    the push.
- **Enterprise Readiness — Production Readiness — UX / Visual Refinement
  — COMPLETE (2026-08-09, commit `09d0032`).** Third tracked item under
  Production Readiness. Objective: a dedicated UX/visual-design pass —
  polished light and dark theming with a warm-orange brand accent, and
  correcting the places where brand color had been doing double duty as
  semantic success/warning/error color. **Implementation complete,
  published, no migration created.**
  - **Stage 1 — theme tokens, `app/globals.css` only**: replaced the
    indigo/violet `--primary` with a warm-orange token pair for light and
    dark mode, with an accessible `--primary-foreground` treatment
    (near-black text on the orange fill instead of white — verified at
    5.84:1 contrast in light mode and 8.42:1 in dark mode, both passing
    WCAG AA; white text on the same orange only reached 3.4:1). Added
    first-class `--success`/`--warning`/`--info` tokens, each with its
    own `-foreground` pairing independently contrast-checked, so semantic
    color no longer has to borrow from `--primary` or `--destructive`.
    Raised dark-mode shadow opacity so `shadow-sm`/`shadow-lg` stay
    visible against near-black surfaces — same neutral black, no color
    tint, no glow.
  - **Stage 2 — semantic-color component fixes**, five files:
    `components/ui/badge.tsx` (added `success`/`warning`/`info` Badge
    variants alongside the existing `default`/`secondary`/`destructive`/
    `outline` set), `components/analytics/insights-card.tsx` (good/
    warning/info tones now map to their matching semantic token instead
    of `text-primary`/`text-destructive`/`text-muted-foreground`),
    `components/deliverability/score-badge.tsx` (healthy scores >=80
    render `success`, mid-range 50-79 render `warning`, poor scores <50
    still render `destructive` — a healthy score no longer looks
    brand-colored), `components/dashboard/stat-card.tsx` (added an
    optional `tone` prop — `brand`/`success`/`warning`/`danger` —
    defaulting to `brand` so every existing caller renders unchanged),
    and `components/warmup/warmup-dashboard.tsx` (replaced the one
    hardcoded `text-amber-600 dark:text-amber-500` with the centralized
    `--warning` token).
  - **Explicitly unchanged**: business logic, analytics computation,
    authentication, the database/Supabase layer, workers, migrations,
    email sending, lead import, pagination, and routes — this item
    touched only the six files above (one CSS file, five presentational
    components).
  - **Verified live in both themes**: healthy/poor deliverability scores
    render success/destructive correctly, "good" analytics insights
    render success rather than brand orange, the warmup warning text
    renders in the warning token distinct from both the brand-colored
    button and the destructive badge next to it, and the brand-orange
    treatment (hero glow, buttons, focus states) reads as intended in
    both themes with no added gradients or decorative effects.
  - **Known, explicitly out-of-scope observations — not implemented in
    this item**: the dashboard's "Failed sends" stat still renders with
    the brand-tone icon chip, since its caller
    (`app/(app)/dashboard/page.tsx`) was outside this item's approved
    file list — `stat-card.tsx`'s new `danger` tone exists but isn't
    wired up there yet. (Closed shortly after, as its own small, separate
    fix — commit `d959c1f` wires that one caller to `tone="danger"`; see
    the dashboard route's own history for that change.) Several other
    components still map "positive/active" states to brand orange via
    their own duplicated `STATUS_VARIANT`-style logic (e.g. campaign/
    mailbox "Active" badges, the setup checklist's completed-step
    circles) — pre-existing, unrelated to this item's five-file scope,
    not touched.
  - All checks (typecheck, lint, build — 37/37 routes, full test suite —
    525 tests, 70 files) passed before commit. Commit `09d0032` is
    published on `origin/main`; local `HEAD` was verified equal to
    `origin/main` after the push.
- **Enterprise Readiness — Production Readiness — First-Customer
  Readiness Audit & Remediation — COMPLETE (2026-08-09, commit
  `e1d2b67`).** Fourth tracked item under Production Readiness.
  Objective: a focused, read-only audit answering one practical
  question — "could we safely put this in front of the first real
  paying customer?" — followed by remediation of every approved
  finding. **Implementation complete, published, no migration created.**
  - **Audit scope**: 12 customer-critical surfaces — authentication/
    account isolation, mailbox connection and sending, lead management
    (including CSV import), campaigns/sequences, deliverability
    safeguards, analytics accuracy, error handling, security boundaries
    (RLS/IDOR/credential exposure), production configuration, core UX
    reliability, responsive behavior, and billing/payment (found
    implemented — Stripe — and audited, not assumed). Deliberately not a
    general code-quality audit; only realistic first-customer risks
    (data exposure, credential leakage, broken/incorrect sending,
    corrupted leads, materially misleading analytics, broken core
    journeys) were in scope.
  - **Result**: 0 must-fix (A) findings, 1 should-fix-before-public-
    launch (B) finding, 2 safe-to-defer (C) findings. Multi-tenant
    isolation (RLS on every table, IDOR guards in campaign Server
    Functions), credential handling (encrypted mailbox/OAuth/provider
    secrets, never exposed to Client Components), cron-endpoint auth,
    send-worker idempotency/retry/suppression handling, CSV import
    limits/dedup/quota enforcement, campaign launch readiness checks,
    Stripe webhook signature verification and idempotency, and
    session/proxy handling were all inspected and found sound — no
    finding recorded against any of them. Overall recommendation: READY
    FOR CONTROLLED FIRST CUSTOMER.
  - **B finding, remediated — Warmup disclosure**: the Warmup page/
    dialog previously implied that enabling warmup automatically ramps
    a mailbox's real sending volume; it doesn't — `claim_due_sends()`
    (the live send gate) only ever reads a mailbox's own `daily_limit`/
    `hourly_limit`/`cooldown_minutes`, never `warmup_profiles`. Fixed as
    a disclosure/UX change only, in `components/warmup/warmup-dashboard.tsx`
    and `components/warmup/warmup-settings-form.tsx`: both now state
    plainly that warmup doesn't yet change what a live campaign actually
    sends, and point to the mailbox's own Daily/Hourly limit as the real
    control today. No automatic warmup throttling was implemented — that
    remains a separate, larger, not-yet-scoped item.
  - **C findings, remediated — error-message sanitization**: (1)
    `app/(app)/campaigns/[campaignId]/actions.ts` — seven Server
    Functions whose Client Components display a caught error's message
    (`launchCampaignAction`, `pauseCampaignAction`, `resumeCampaignAction`,
    `stopCampaignAction`, `enrollLeadAction`, `enrollLeadListAction`,
    `resolveSendAttemptAction`) now run inside a small `runUserFacing()`
    wrapper; a new `UserFacingError` class marks the file's existing
    deliberate business-rule messages (unchanged text), and anything
    else — a raw `PostgrestError` from `unwrap()`, or an unexpected bug
    — is logged in full server-side and replaced with a generic message
    before it can reach the browser. (2) The Google and Microsoft OAuth
    mailbox-connect callbacks (`app/api/oauth/google/callback/route.ts`,
    `app/api/oauth/microsoft/callback/route.ts`) previously redirected
    with any non-`GoogleOAuthError`/`MicrosoftOAuthError` error's raw
    message; both now allow-list only `GoogleOAuthError`/
    `MicrosoftOAuthError` (the providers' own public OAuth error text)
    and `PlanLimitError`, logging anything else server-side and
    redirecting with a generic message instead. The OAuth flow, RLS,
    rate limiting, and every DB query in all three files are
    byte-for-byte unchanged — confirmed via a dedicated post-
    implementation review (`git diff --ignore-all-space` against `HEAD`)
    showing the campaigns-actions diff was genuinely limited to the
    error-class renames and wrapper insertion, with no statement,
    query, ownership check, return value, or state-transition changed;
    verdict SAFE, approved before commit.
  - **Explicitly unchanged**: business logic, analytics computation,
    authentication architecture, the database/Supabase layer, workers,
    migrations, the sending engine, `claim_due_sends()`, warmup
    automation, billing logic, and every unrelated route.
  - All checks (typecheck, lint, build — 37/37 routes, full test suite —
    525 tests, 70 files) passed before commit. Commit `e1d2b67` is
    published on `origin/main`; local `HEAD` was verified equal to
    `origin/main` after the push.
- **Design System — Phase 1: Surface Hierarchy — COMPLETE (2026-08-09,
  commit `3732a2d`).** First of a new, dedicated, phased visual-design
  refinement, separate from the Production Readiness track above.
  Objective: establish a real page -> card -> surface-2 -> popover
  elevation hierarchy — light-mode `--card`/`--popover` previously
  equaled `--background` exactly (a card was only a border, not a
  surface) and dark-mode `--popover` equaled `--card` (a dialog/dropdown
  didn't visually lift off the card behind it). **Implementation
  complete, published, no migration created.**
  - `app/globals.css` — light-mode `--card`/`--popover` moved from pure
    white onto the same off-white recipe `--sidebar` already used
    (`240 20% 99%`); dark-mode `--popover` changed from equaling `--card`
    to a genuinely lighter `240 10% 12%`. A new `--surface-2` token was
    added for both themes, defined but not yet consumed by any component
    — reserved for a later phase.
  - `components/ui/dialog.tsx` and `components/ui/sheet.tsx` — both
    switched from `bg-background` to `bg-popover text-popover-foreground`,
    fixing a real bug where the Dialog and the mobile-nav Sheet blended
    into the page instead of visually elevating off it, especially in
    dark mode.
  - No component API changes.
  - All checks (typecheck, lint, build — 37/37 routes, full test suite —
    525 tests, 70 files) passed before commit. Verified live via
    computed-style comparison before/after in both light and dark mode.
    Commit `3732a2d` is published on `origin/main`; local `HEAD` was
    verified equal to `origin/main` after the push.
- **Design System — Phase 2: Semantic Color Hierarchy — COMPLETE
  (2026-08-09, commit `d5c017b`).** Second phase of the same initiative
  (Phase 1 immediately above). Objective: make color communicate meaning
  instead of brand orange being the default decoration on every metric
  card, chart, and status badge. **Implementation complete, published, no
  migration created.**
  - **Extended the tone system**: `stat-card.tsx` already had a `tone`
    prop (`brand`/`success`/`warning`/`danger`) from the earlier UX/
    Visual Refinement pass (commit `09d0032`); the same pattern was added
    to `components/dashboard/trend-card.tsx`,
    `components/dashboard/percentage-card.tsx`, and
    `components/dashboard/funnel-card.tsx`, all defaulting to `brand` so
    every existing call site renders unchanged unless it opts in.
  - **Fixed genuine color/meaning mismatches**:
    `components/warmup/warmup-dashboard.tsx`'s `scoreVariant()` now
    returns `success`/`warning`/`destructive` (previously
    `default`/`secondary`/`destructive`), matching
    `components/deliverability/score-badge.tsx`'s thresholds instead of
    contradicting them; `components/mailboxes/mailbox-list.tsx`'s
    "Active" mailbox status now renders `success` instead of the
    brand-orange `default`; `components/analytics/health-score-card.tsx`'s
    "good" factor checkmark now uses `text-success` instead of
    `text-primary`.
  - **Neutralized default chart coloring**:
    `components/analytics/daily-bar-chart.tsx`'s default `barClassName`
    changed from `bg-primary` to the neutral `bg-secondary-foreground/70`
    this file's own "opens/replies/clicks" callers already used, so
    ordinary volume charts (e.g. "Daily sends") no longer default to
    orange.
  - **`app/(app)/analytics/page.tsx`** — the organization overview's
    "Failure rate" card now passes `tone="danger"` (matching its "Failed"
    sibling) and "Success rate" now passes `tone="success"`, resolving a
    live mismatch where "Failed: 1" was red but "Failure rate: 100%"
    stayed brand orange on the same page.
  - **Deliberately not touched**: `components/dashboard/status-card.tsx`
    (outside approved scope), and the duplicated `TrendBadge`/`TrendCard`
    direction-badge logic — flagged for a later phase rather than
    refactored here. No database, Supabase, authentication, API, or
    business-logic change.
  - All checks (typecheck, lint, build — 37/37 routes, full test suite —
    525 tests, 70 files) passed before commit. Browser-verified live in
    both light and dark mode across the campaign detail, mailboxes,
    analytics, dashboard, and warmup pages — confirmed ordinary counts
    stayed neutral, "Active"/"Failed"/"Failure rate" render their
    intended semantic colors in both themes, and no layout regressions.
    Commit `d5c017b` is published on `origin/main`; local `HEAD` was
    verified equal to `origin/main` after the push.
- **Design System — Phase 3: Semantic Color Consistency Sweep — COMPLETE
  (2026-08-14, commit `afcd588`).** Third phase of the same initiative
  (Phase 2 immediately above). Objective: audit every remaining status/
  verification badge for genuine color/meaning mismatches Phase 2 didn't
  reach — explicitly not a second redesign pass. **Implementation
  complete, published, no migration created.**
  - **Audit**: inspected deliverability (`components/deliverability/*`,
    its settings routes), leads (verification-status badges), mailboxes,
    warmup, dashboard, analytics, and the global `--success`/`--warning`/
    `--destructive`/`--info` tokens in `app/globals.css` for genuine
    inconsistencies vs. intentional brand usage vs. neutral styling. Root
    cause found for two of the four fixes: `StatusTone`
    (`components/dashboard/status-card.tsx`) had no `success` option even
    though `Badge` already did, so any status routed through `StatusCard`
    had no correct color available and fell back to brand orange.
  - **Fixed**: `StatusTone` widened to include `success`.
    `components/deliverability/mailbox-health-list.tsx`'s and the mailbox
    analytics page's (`app/(app)/mailboxes/[mailboxId]/analytics/page.tsx`)
    "Active" mailbox status now render `success` — previously only
    `components/mailboxes/mailbox-list.tsx` had this right, from Phase 2.
    `components/deliverability/domain-health-list.tsx`'s "Verified"/"Pass"
    and `domain-dns-status.tsx`'s "Verified" now render `success` instead
    of brand orange, next to a `ScoreBadge` on the same page that already
    used green for "good." `components/leads/lead-table.tsx`'s "Valid"
    verification status now renders `success`, matching "Invalid"/"Error"
    which already correctly rendered `destructive`.
  - **Confirmed intentional, left unchanged**: campaign "Active"/"Running"
    and warmup "Enabled" (consistently brand orange — a
    lifecycle-in-progress marker rather than a health verdict; neither has
    a failure state the way mailbox/domain/lead status does); the
    duplicated `TrendBadge`/`TrendCard` direction-badge logic's
    `up -> default` mapping (`TrendResult` carries no metric-polarity
    information, so coloring "up" green unconditionally would mislabel a
    rising bounce rate as good — a deliberate design constraint, not an
    oversight; per the standing decision from Phase 2, this duplication
    stays untouched absent a genuine bug); the activity timeline's
    event-type badges. Two secondary candidates matching the same
    asymmetry pattern — the lead pipeline's "Qualified" status and the
    send-attempt "Sent" status — were flagged but deliberately left
    unchanged, since (unlike the four fixes above) no existing canonical
    counter-example elsewhere in the codebase established which color is
    correct; out of this phase's approved scope.
  - **No database, Supabase, authentication, API, or business-logic
    change. No new color tokens, no `globals.css` change.**
  - **Verification**: `npm run typecheck`, `npm run lint`, and
    `npm run build` (37/37 routes) all passed, and the full test suite
    (`npm test` — 525 tests, 70 files) passed unchanged, re-run once more
    immediately before commit. Browser-verified live in both light and
    dark mode against the linked development/staging project
    (`wxhulmbbobkfvtreaspo`): the mailbox "Active" fix confirmed rendering
    green in both `mailbox-health-list.tsx` and the mailbox analytics
    page's `StatusCard`, no regression on the neutral "Unverified" lead
    badge or on Dashboard/Analytics/Warmup. **Accepted limitation**: the
    domain "Verified"/"Pass" and lead "Valid" fixes were not visually
    confirmed with live green pixels — the linked project has no domain
    and no lead in the `valid` state, and creating one was out of scope
    without separate approval; confirmed instead via `tsc`/`build`
    type-correctness and the identical `Badge`/`success`-variant rendering
    mechanism already visually confirmed live via the mailbox fix. Commit
    `afcd588` is published on `origin/main`; local `HEAD` was verified
    equal to `origin/main` after the push.
- **Design System — Phase 4: Composition & Spacing Consistency —
  COMPLETE (2026-08-14, commit `6ab9903`).** Fourth phase of the same
  initiative (Phase 3 immediately above). Objective: audit card
  composition, spacing rhythm, typography hierarchy, and border/radius
  /shadow consistency for genuine inconsistencies — not a redesign, and
  explicitly not the premium-purple/glassmorphism expansion discussed as
  a possible future direction. **Implementation complete, published, no
  migration created.**
  - **Audit**: inspected card composition, the metric-card family
    (`StatCard`/`TrendCard`/`PercentageCard`/`FunnelCard`/`StatusCard`
    /`ComparisonCard` and their analytics/mailbox counterparts), page
    -level spacing rhythm, typography hierarchy, and border/radius/shadow
    usage across dashboard, analytics, mailboxes, campaigns, leads,
    warmup, deliverability, and settings. Conclusion: the system was
    already substantially consistent (identical page-title/section-title
    classes on 20+ pages, identical card radius/shadow, identical
    metric-card label/value typography) — zero P0 launch blockers found.
  - **Fixed — page-container spacing rhythm**:
    `app/(app)/mailboxes/page.tsx`, `app/(app)/warmup/page.tsx`,
    `app/(app)/settings/page.tsx`, and `app/(app)/settings/ai/page.tsx`,
    `.../verification/page.tsx`, `.../integrations/page.tsx` had three
    different, undocumented `space-y-*` values for the same page-shell
    role (a flat `space-y-8`, a flat `space-y-10`, vs. the responsive
    `space-y-6 sm:space-y-8` every other top-level page already used).
    All six now use the responsive value; each page's max-width and
    every other layout decision is unchanged.
  - **Fixed — inert glass/blur removed**: the `bg-card/60
    backdrop-blur-sm` pattern — explicitly reserved by Phase 1's own code
    comment for a later phase — was applied across 13 components sitting
    on the flat page background with nothing behind them to blur,
    costing a compositing layer per card for zero visible depth. Now
    solid `bg-card` in `components/dashboard/stat-card.tsx`,
    `trend-card.tsx`, `percentage-card.tsx`, `funnel-card.tsx`,
    `status-card.tsx`, `comparison-card.tsx`,
    `components/mailboxes/mailbox-health-summary.tsx`,
    `components/analytics/comparison-table.tsx`, `rollup-table.tsx`, and
    the picker `<form>` in
    `app/(app)/settings/deliverability/compare/page.tsx`,
    `app/(app)/mailboxes/compare/page.tsx`,
    `app/(app)/campaigns/compare/page.tsx`. Border, shadow, radius,
    padding, and typography are unchanged in every one; no new
    glassmorphism was introduced anywhere.
  - **Fixed — shadow-elevation inversion**:
    `components/ui/dropdown-menu.tsx`'s `DropdownMenuSubContent` rendered
    `shadow-lg`, a bigger shadow than its own parent
    `DropdownMenuContent`'s `shadow-md` — backwards for a surface
    floating deeper than its parent. Now `shadow-md`, matching the
    parent; the parent's own shadow is untouched.
  - **Explicitly out of scope for this phase**: extracting a shared
    metric-card primitive, replacing the ~7 components that hand-roll
    `Card`'s exact classes instead of importing it, adding a `CardHeader`
    flex-row variant, a premium purple accent, any new glassmorphism, and
    any new design token — all flagged by the audit as legitimate future
    work but deliberately not implemented here. No database, Supabase,
    authentication, API, business-logic, or route change.
  - **Verification**: `npm run typecheck`, `npm run lint`, and
    `npm run build` (37/37 routes) all passed, and the full test suite
    (`npm test` — 525 tests, 70 files) passed unchanged. Browser-verified
    live in both light and dark mode: Mailboxes, Warmup, Settings, and
    Settings -> AI all render with the tightened, consistent spacing and
    no overflow or layout regression; the Dashboard `StatCard` grid
    renders solid and crisp with no visible seam from the removed blur;
    every Phase 1-3 semantic color ("Active" green, "Failed" red, etc.)
    renders unchanged. **Accepted limitation**: the three compare-page
    picker forms could not be screenshotted (the linked development
    /staging project has fewer than two mailboxes/domains, so those
    pages render their empty state instead of the form) and
    `DropdownMenuSubContent` has no live consumer anywhere in the
    current app — both verified instead via source inspection and the
    passing build/typecheck rather than a live screenshot. Commit
    `6ab9903` is published on `origin/main`; local `HEAD` was verified
    equal to `origin/main` after the push.
- **Design System — Phase 5: Premium Visual Polish — COMPLETE (2026-08-14,
  commit `8845449`).** Fifth phase of the same initiative (Phase 4
  immediately above). Objective: implement the premium-purple accent and
  intentional glassmorphism the Phase 4 audit evaluated and explicitly
  deferred — scoped tightly to the roles that audit identified as
  justified, not a rebrand and not glass applied indiscriminately.
  **Implementation complete, published, no migration created.**
  - **Premium purple accent tokens**: `--accent-purple`/
    `--accent-purple-foreground` added to `app/globals.css` (light + dark),
    wired into `@theme inline` identically to `--success`/`--warning`/
    `--destructive`/`--info`. Light: white foreground (~5.67:1 contrast).
    Dark: near-black foreground (~6.0:1) — white would only reach ~3.36:1
    and fail AA, mirroring exactly how `--primary`'s own dark-mode value
    already solves the same problem. A deliberate secondary/AI accent, not
    a replacement for `--primary` — the established orange brand/CTA color
    is unchanged everywhere it already appears.
  - **AI recommendation surfaces**: `components/ai/recommendation-card.tsx`
    now renders a purple icon chip (`bg-accent-purple/10 text-accent-purple`,
    the same icon-chip shape already used elsewhere in the app) next to
    "AI Recommendation" in both its empty-state and populated-state
    headers — the one consistent "this is AI-generated" marker across all
    four analytics pages (campaign/mailbox/domain/organization) that share
    this component. The separate, deterministic "AI Insights" card
    (`insights-card.tsx`) was deliberately left untouched — it's rule-based
    output, not LLM output, and correctly keeps its existing
    `text-success`/`text-warning`/`text-info` tones. The "Generate
    Recommendation" button stays the standard orange `default` variant,
    unchanged.
  - **Active-navigation accent**: `components/shell/sidebar.tsx` and
    `components/shell/mobile-nav.tsx`'s active-nav state moved from
    neutral (`bg-sidebar-accent`/`text-sidebar-accent-foreground` — a gray
    identical to the hover state) to `bg-accent-purple/10`/
    `text-accent-purple`, giving the app's primary "where am I" signal an
    actual brand touchpoint it previously lacked. Hover state on inactive
    items is unchanged.
  - **Intentional glassmorphism**: `components/ui/dialog.tsx` and
    `components/ui/sheet.tsx`'s overlay (`bg-black/50`) gained
    `backdrop-blur-sm` — the one glass treatment the Phase 4 audit judged
    genuinely justified, since a modal overlay always has real page
    content directly behind it. Dialog/Sheet *content* itself
    (`bg-popover`) is untouched and stays fully opaque; this does not
    revive the inert `bg-card/60 + backdrop-blur-sm` pattern Phase 4
    removed — that pattern blurred nothing (flat page background behind
    it), this blurs real content behind a modal.
  - **No Phase 1-4 work reopened**: no change to `--success`/`--warning`/
    `--destructive`/`--info` or any consumer, no change to any status
    badge, no database, Supabase, authentication, API, business-logic, or
    route change, no new packages. Exactly six files changed.
  - **Verification**: `npm run typecheck`, `npm run lint`, and
    `npm run build` (37/37 routes) all passed, and the full test suite
    (`npm test` — 525 tests, 70 files) passed unchanged, re-run once more
    immediately before commit. Browser-verified live in both light and
    dark mode: the Dialog overlay (Leads → "Add a lead") and the Sheet
    overlay (mobile nav) both show real page content behind them visibly
    and softly blurred, while the dialog/sheet content stays fully opaque
    and crisp with no washed-out text; the AI Recommendation card's
    purple icon chip reads clearly distinct from the orange icon chips
    beside it, in both themes; the active-nav purple pill is legible
    against the sidebar in both themes; inputs, labels, placeholders,
    focus rings, and CTAs all remained readable. Confirmed unchanged:
    mailbox "Active" still renders green, mailbox health score still
    renders red. **Accepted limitation**: the desktop `Sidebar` component
    (as opposed to the mobile nav, which was directly screenshotted) could
    not be visually confirmed — this environment's display is capped
    below the `lg:` breakpoint even after a window resize — verified
    instead via source inspection, since it shares the identical
    `bg-accent-purple/10`/`text-accent-purple` classes already confirmed
    rendering correctly in the mobile nav. Commit `8845449` is published
    on `origin/main`; local `HEAD` was verified equal to `origin/main`
    after the push.
- **Design System — Phase 6: Orange → Premium Purple Rebrand — COMPLETE
  (2026-08-14, commit `8b1d561`).** Sixth phase of the same initiative
  (Phase 5 immediately above). Objective: an intentional visual
  rebrand — promote Phase 5's already-validated premium purple from a
  scoped secondary/AI accent to the product's primary brand color,
  replacing orange everywhere it represented brand identity, while
  leaving every semantic color untouched. Preceded by a read-only audit
  classifying every orange usage in the app before any edit was made.
  **Implementation complete, published, no migration created.**
  - **Audit**: a full-repo search confirmed every "orange" pixel in the
    app traced back to exactly six CSS custom properties in
    `app/globals.css` (`--primary`, `--primary-foreground`, `--ring`,
    `--sidebar-primary`, `--sidebar-primary-foreground`,
    `--sidebar-ring`) — zero hardcoded orange anywhere. This meant the
    rebrand was architecturally almost entirely a single-file change:
    buttons, badges, links, the hero, setup checklist, quick actions,
    icon chips (settings/auth/billing/dashboard), campaign/warmup
    /mailbox-provider/lead "default"-variant status badges,
    `TrendBadge`'s "up" direction, checkbox accents, and every focus
    ring all recolor automatically from the token change alone.
  - **`app/globals.css`**: `--primary`/`--primary-foreground` (light +
    dark) swapped to Phase 5's already-validated purple values exactly
    — no new palette invented. Light: `262 83% 58%` with white
    foreground (`~5.67:1` contrast). Dark: `263 85% 70%` with near-black
    foreground (`~6.0:1`) — white would only reach `~3.36:1` and fail
    AA, mirroring exactly how the previous orange token solved the same
    light/dark contrast problem. `--ring`/`--sidebar-primary`
    /`--sidebar-primary-foreground`/`--sidebar-ring` continue mirroring
    `--primary`/`--primary-foreground` exactly, unchanged in structure.
    The now-redundant `--accent-purple`/`--accent-purple-foreground`
    pair from Phase 5 and their `@theme inline` entries were removed —
    reusing, not duplicating, the validated value.
    `--success`/`--warning`/`--destructive`/`--info` untouched.
  - **Repointed Phase 5's `--accent-purple` consumers**:
    `components/ai/recommendation-card.tsx`'s icon chip and
    `components/shell/sidebar.tsx`/`components/shell/mobile-nav.tsx`'s
    active-nav state now use `--primary` directly — identical resulting
    color, removing the token duplication Phase 5 had introduced as a
    scoped accent.
  - **Semantic colors and lifecycle-state distinctions preserved
    exactly**: mailbox "Active" (a health signal, Phase 3) still renders
    `success` green everywhere checked (mailboxes list, deliverability
    mailbox health); health/failure scores still render red; warmup's
    "Not warming up" text still renders `warning` amber; lead
    "Unverified"/"New" badges stay neutral. Campaign "Active" and
    warmup "Enable" — brand-colored purely because orange was the old
    brand, not a semantic signal — now render purple, confirmed live in
    both themes.
  - **Glassmorphism preserved, not redesigned**: `Dialog`/`Sheet`
    overlay `backdrop-blur-sm` (Phase 5) received no changes; only
    re-verified live that it still blurs real content behind it
    correctly against the new purple, with dialog/sheet content itself
    staying fully opaque.
  - **No Phase 1-5 work reopened**: no change to `--success`/`--warning`/
    `--destructive`/`--info` or any consumer, no surface-hierarchy or
    composition/spacing change, no database, Supabase, authentication,
    API, business-logic, or route change, no new packages. Exactly four
    files changed.
  - **Verification**: `npm run typecheck`, `npm run lint`, and
    `npm run build` (37/37 routes) all passed, and the full test suite
    (`npm test` — 525 tests, 70 files) passed unchanged, re-run once
    more immediately before commit. Browser-verified live in both light
    and dark mode across dashboard (hero, stat cards, setup checklist,
    quick actions), leads (Add-lead dialog, verification badges),
    mailboxes (Active badge green), campaigns (Active badge purple),
    warmup, deliverability (domain/mailbox health), settings category
    cards, billing (plan cards), and the mobile-nav sheet — purple
    CTAs/links/focus-rings/icon-chips readable in both themes, no
    washed-out text, no accidental purple on any semantic badge.
    **Accepted limitations**: no live auth screen could be
    screenshotted, since this session's authenticated state redirects
    `/signup`/`/forgot-password` to `/dashboard` — verified instead via
    source (identical `bg-primary/10 text-primary` pattern already
    confirmed rendering correctly on Settings/Billing icon chips); the
    desktop `Sidebar` component could not be visually confirmed — this
    environment's display is capped below the `lg:` breakpoint — verified
    instead via source inspection plus the mobile-nav sheet screenshot,
    which uses the identical classes and is now confirmed working.
    Commit `8b1d561` is published on `origin/main`; local `HEAD` was
    verified equal to `origin/main` after the push.

## Current milestone

Enterprise Readiness — Production Readiness — in progress. The
Scalability Track (Phases A through E) is fully complete. Production
Readiness has six completed items so far: the Deliverability Trends
Rollup Migration (commit `7dca187`, discovered during the Scalability
Phase E Exit Review), the Security Gate remediation (commit `83f8e5d`, a
targeted security audit intentionally scoped to two findings — provider
API-key exposure and IMAP/SMTP test-connection error leakage — both of
which were found and fixed), the UX / Visual Refinement (commit
`09d0032`, a warm-orange theme pass in `app/globals.css` plus corrected
semantic-color usage across five presentational components), the
First-Customer Readiness Audit & Remediation (commit `e1d2b67`, a
12-surface readiness audit — 0 must-fix, 1 should-fix, 2 safe-to-defer
findings, recommendation READY FOR CONTROLLED FIRST CUSTOMER — followed
by remediation of all three findings: a Warmup disclosure fix and two
unexpected-error-sanitization fixes), the First-Customer Smoke Test
& Remediation (commit `ca96c48`, a manual browser-driven smoke test of
the live application — overall verdict READY WITH NON-BLOCKING ISSUES,
zero launch blockers — followed by remediation of all four findings: a
raw-error-display fix in the campaign leads table, danger-tone fixes on
two "Failed" stat cards, a tablet-width horizontal-overflow fix on
Mailboxes and campaign detail, and a UUID-breadcrumb display fix), and
the Final First-Customer Smoke Test & Remediation (commit `bf4b31e`, a
test-only re-verification of all 11 previously-fixed items — all passed
— that surfaced exactly one new P1 finding: the Leads page had the same
tablet-width horizontal-overflow bug already fixed elsewhere, just not
yet applied there; fixed with the identical proven pattern). All
six are complete (see Done). No further Production Readiness items are
currently itemized as approved work, and none are known to be pending
from the Security Gate, either First-Customer smoke test, or the
First-Customer Readiness audit: none of these produced a separate
enumerated list of other deferred findings beyond what's documented
above, so there is no known backlog to carry forward. This is not a
claim that the application has been exhaustively security-audited, is
fully visually polished, or is production-ready for a general public
launch — only that these six specific items are resolved and that the
audit judged the product safe for a controlled first customer. Future
security, UX, or readiness work would be scoped as new work at that
time.

**Since then**, a separate Design System initiative has started (see
Design System initiative status above and Done for detail): Phase 1
(Surface Hierarchy, commit `3732a2d`) and Phase 2 (Semantic Color
Hierarchy, commit `d5c017b`) were both complete the same day as the
Production Readiness work above; Phase 3 (Semantic Color Consistency
Sweep, commit `afcd588`), Phase 4 (Composition & Spacing Consistency,
commit `6ab9903`), Phase 5 (Premium Visual Polish, commit `8845449`),
and Phase 6 (Orange -> Premium Purple Rebrand, commit `8b1d561`) all
followed on 2026-08-14. All six are complete. Phase 7 (final
visual-hierarchy/consistency sweep) has not started; no further Design
System work is currently approved.

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
