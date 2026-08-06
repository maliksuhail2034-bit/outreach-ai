# Changelog

All notable changes to this project are documented in this file, derived from
the git commit history. Dates reflect the commit date.

## 2026-08-06 — Enterprise Readiness — Production Readiness — Deliverability Trends Rollup Migration, Complete (Commit: 7dca187)

- **First Production Readiness item, discovered during the Scalability
  Track Phase E Exit Review and shipped as its own scoped, reviewed
  change** rather than folded into Phase E's cleanup-only scope. **Scope**:
  replace `DomainAnalyticsSnapshot.events` — permanently empty since the
  Scalability Phase D rollup cutover, so the Deliverability Analytics
  page's Trends / Forecast / AI Insights section was silently operating on
  an empty dataset — with real domain-scoped `analytics_daily_rollups`
  data. **Implementation complete, published, no migration created.**
  - **Files modified**: `lib/deliverability/domain-analytics.ts` and
    `app/(app)/settings/deliverability/[domainId]/analytics/page.tsx`,
    plus a new `lib/deliverability/domain-analytics.test.ts` — the first
    unit test coverage this file has had. No other analytics builder,
    worker, or route was touched.
  - **Implementation summary**: `loadDomainAnalyticsSnapshot` gained an
    optional `trendsRange` parameter and now fetches `subject_type='domain'`
    rows from `analytics_daily_rollups` — already written nightly by the
    existing rollup worker (`lib/analytics/rollup-worker.ts`'s
    `upsertDomainRollups`, live since the Scalability Track) — in place of
    the old `events: Tables<"email_events">[]` field. Domain Comparison's
    call site is unaffected, since it doesn't pass a range. The Trends
    section's day-bucketing was rewritten to read pre-aggregated rollup
    rows via a new page-local helper mirroring
    `lib/analytics/aggregations.ts`'s `bucketByDayInRange` loop exactly
    (same UTC cursor iteration, same zero-fill, same ordering), preserving
    the existing `DailyCount[]` output contract — forecasting,
    comparisons, insights, and every UI component downstream needed no
    changes.
  - **Verification summary**: new unit tests in `domain-analytics.test.ts`
    cover the new `dailyRollups` fetch (scoped correctly when a trends
    range is given, omitted when not, passed through to `listDailyRollups`
    unmodified). Read-only live verification against the linked
    development/staging project (`wxhulmbbobkfvtreaspo`) confirmed the
    Postgres session timezone is UTC, `rollup_date` serializes as a plain
    `YYYY-MM-DD` string matching the bucketing helper's lookup key
    exactly, the live column types match what the code assumes, and the
    new `subject_type='domain'` query executes cleanly against the real
    schema. Zero-fill and current-partial-day handling were demonstrated
    against the project's real rollup dates. All checks (typecheck, lint,
    build, full test suite — 525 tests, 70 files) passed before commit.
  - **Accepted limitation**: no write-based end-to-end validation of an
    actual domain rendering real Trends data was performed — the linked
    development/staging project has zero domains and zero mailboxes with
    `domain_id` set, so there is no representative domain to click
    through. Every underlying mechanism was instead verified live via the
    shared table/query/column types and real sibling rollup rows.
  - **Unchanged systems**: send-worker, retention worker, rollup worker,
    pagination, CSV import, the available-leads query, every other
    analytics builder (mailbox, campaign, organization), and Domain
    Comparison's page.
  - **No migration required or created** — `analytics_daily_rollups` and
    its `subject_type='domain'` write path already existed from the
    Scalability Track.
  - **Production behavior impact**: the Deliverability Analytics page's
    Trends/Forecast/AI Insights section now reflects real domain sending
    activity instead of an always-empty dataset — a real, user-visible
    change (previously all-zero charts/forecast/insights on this one
    page), scoped to reads only, with no writes or schema changes.

## 2026-08-06 — Enterprise Readiness — Scalability Track, Phase D (Incremental Cutover), Complete (Commits: ceaa989, 0e8494c, d80ccd2, 57fedd7, 6f851aa, 94c3418)

- **Fourth of five approved phases for the Scalability Track.** Objective:
  cut every Phase B capability over to real production behavior, one item
  at a time — the only phase in this track where real production behavior
  actually changes. Each of the six steps below was independently audited,
  implemented, verified (typecheck/lint/build/test), committed, and pushed
  before the next began; none were bundled. **Implementation complete,
  published, no migration pending.**
  - **Step 1 / Item 6 — mailbox, domain, and organization analytics cut
    over to rollups** (commit `ceaa989`) — `lib/mailboxes/mailbox-analytics.ts`,
    `lib/deliverability/domain-analytics.ts`, and
    `lib/analytics/organization-rollup.ts` now read from
    `analytics_daily_rollups` via `listDailyRollups()`/`sumByKey()`
    instead of fetching and summing raw `email_events` rows in Node.
    `lib/campaigns/campaign-analytics.ts` deliberately excluded — it needs
    raw per-step event rows for step-level drop-off/health-score
    computation, which the rollup granularity can't serve — and confirmed
    byte-for-byte unchanged both at this step and again just before Item
    10. Verified live against the linked development/staging project: the
    `/analytics` page's numbers (`Emails sent: 2, Reply rate: 50%`)
    matched Phase C's already-validated rollup numbers exactly.
  - **Step 2 / Item 7 — available-leads query wired in** (commit
    `0e8494c`) — the campaign detail page
    (`app/(app)/campaigns/[campaignId]/page.tsx`) now calls
    `listLeadsAvailableForCampaign()` (built in Phase B) instead of the
    old 10,000-row account-wide fetch diffed against enrolled leads in JS.
  - **Step 3 / Items 8/9 — pagination wired in, plus deferred composite
    indexes** (commit `d80ccd2`) — `/leads` and `/campaigns`
    (`app/(app)/leads/page.tsx`, `app/(app)/campaigns/page.tsx`,
    `components/leads/lead-table.tsx`,
    `components/campaigns/campaign-list.tsx`) now call
    `listLeadsPage()`/`listCampaignsPage()` with a new
    `components/ui/pagination.tsx` control, replacing the prior
    unbounded/capped `listLeads()`/`listCampaigns()` reads on those two
    pages specifically (both functions are kept — still used elsewhere,
    e.g. the campaign detail page's `{ limit: 10000 }` call). Adds the
    two composite indexes deferred from Phase B
    (`leads_user_id_created_at_idx`, `campaigns_user_id_created_at_idx`,
    migration `20260817100000_leads_campaigns_pagination_indexes.sql`).
    **Live browser testing at this step surfaced a real bug no mocked
    unit test had caught**: PostgREST rejects an out-of-range `.range()`
    offset outright (HTTP 416, error code `PGRST103`, "Requested range
    not satisfiable") rather than returning zero rows — navigating to
    `/leads?page=2` with only 2 real leads crashed the page. Fixed by
    having both paginated queries fall back to a count-only query and
    clamp to the last valid page on `PGRST103` instead of throwing,
    covered by new fallback tests in `lib/db/leads.test.ts` and a new
    `lib/db/campaigns.test.ts`, and re-verified live in the browser
    afterward — both pages now self-correct to page 1 instead of
    crashing on a stale/out-of-range page number.
  - **Item 10 — CSV batch-insert swap** (commit `57fedd7`) —
    `app/(app)/leads/import-actions.ts` still validates, dedups, and
    quota-checks each CSV row up front exactly as before, then makes one
    call to `createLeadsBatch()` (built in Phase B) instead of one
    `createLead()` round trip per row, mapping any batch-insert failure
    back to its original CSV row number so the existing
    `imported`/`skippedDuplicates`/`failed`/`failedRows` UX is
    unchanged. One narrow tradeoff was identified, evaluated, and
    explicitly documented rather than silently accepted: dedup/quota
    state is reserved optimistically before the batch runs rather than
    only after a confirmed insert, which can very rarely cause an
    over-conservative skip within a single import (never an
    under-conservative one) — the database's `leads_user_email_key`
    unique constraint remains the actual authority against duplicates
    regardless, and both `knownEmails` and `remainingQuota` are
    recomputed from the database on every import, so the tradeoff is
    self-correcting and cannot cause over-admission past quota.
  - **Item 11 — retention worker, dry-run to real delete** (commit
    `6f851aa`) — `lib/monitoring/retention-worker.ts` now calls
    `.delete({ count: "exact" })` instead of a count-only `.select()` for
    both `rate_limit_events` (7-day cutoff) and `job_runs` (90-day
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
    Phase B) is unchanged. Before implementing, every guarantee the
    change could plausibly threaten was traced against the actual code:
    the same-mailbox-never-concurrent invariant is structural
    (`inFlightMailboxIds`), holding regardless of the concurrency value;
    `claim_due_sends()`'s daily/hourly/cooldown checks are a claim-time
    snapshot never re-checked per send, so any batch-claim overshoot is a
    pre-existing property of that function alone, unaffected by worker
    concurrency; `send_attempts_lead_step_key`'s unique constraint plus
    each claimed lead being removed from the queue before dispatch makes
    a duplicate send structurally impossible at any concurrency; and
    `SmtpEmailProvider` creates a fresh, unshared transport per send, so
    parallel sends to different mailboxes can't race on shared state.
    This is the highest-risk item in the track — the only one enabling
    real concurrent outbound sends — and was deliberately implemented
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
    touch, and any other Phase A-D scaffolding kept for backward
    compatibility — was **not** implemented as part of Phase D and
    remains not started. Production Readiness findings from the original
    audit were also **not** implemented and remain not started.
  - Every step re-ran the full check sequence (typecheck, lint, build,
    test) before its own commit; the test suite grew from 508 (the Phase
    B/C baseline) to 523 tests (70 files) over the six steps, all passing
    at every step and confirmed once more in a final full run at the end
    of the phase.
  - **All six commits published on `origin/main`**: `ceaa989` → `0e8494c`
    → `d80ccd2` → `57fedd7` → `6f851aa` → `94c3418`, each pushed
    immediately after its own approval, none batched.

## 2026-08-16 — Enterprise Readiness — Scalability Track, Phase C (Shadow Validation), Complete (Verification only — no code commit)

- **Third of five approved phases for the Scalability Track.** Unlike every
  other entry in this file, this phase produced no code change and has no
  commit of its own — it exists entirely to prove Phase B's already-shipped
  infrastructure produces correct output, run directly against the linked
  development/staging Supabase project (`wxhulmbbobkfvtreaspo`) via two
  throwaway diagnostic scripts, neither committed (deleted immediately
  after use; confirmed via `git status` showing nothing left behind).
  Recorded here anyway since it's a real, completed milestone in the
  track, not a code artifact.
  - **Item 5 — backfill, run for real**: `runAnalyticsRollupWorker`
    invoked with `{since: "2026-08-04", until: "2026-08-16"}`, the full
    real `email_events` history on this project. Result: 6 rows computed
    and upserted, 0 failed, correctly split across campaign/mailbox/
    organization subject types — confirmed directly against
    `analytics_daily_rollups`, not just the worker's own return value.
  - **Item 6 — old vs new numbers**: raw `email_events` counts for a real
    campaign (`sent: 2, replied: 1`) compared against the newly-backfilled
    rollup rows summed for the same period — exact match on every
    `event_type`.
  - **Item 7 — available-leads query**: `listLeadsAvailableForCampaign`'s
    output compared against the old 10,000-row-fetch-and-JS-diff approach
    for a real campaign — identical single-lead result set.
  - **Item 10 — CSV batch-insert, against real Postgres constraints**: (a)
    5 rows via the batch path vs. 5 via the sequential path, both fully
    successful; (b) a batch containing one row that collides with a real
    `(user_id, email)` unique-constraint violation — the bulk insert
    failed as a whole, and the per-row fallback correctly isolated the
    failure to exactly that row while the other two succeeded, proving
    the one thing the mocked unit tests couldn't. All 13 test rows
    (tagged `@example.invalid` addresses, one test user) deleted
    immediately after, verified with a follow-up count query reporting 0
    remaining.
  - **Item 11 — retention worker, run for real**: both `rate_limit_events`
    (7-day cutoff) and `job_runs` (90-day cutoff) reported 0 candidates —
    expected, nothing on this project is old enough yet. Confirmed
    dry-run: no deletions occurred.
  - **Item 12 — deliberately not live-canaried.** A live send-worker
    concurrency test would mean actually claiming real `campaign_leads`
    and dispatching real outbound email — an external, irreversible
    action categorically different from every other item here. Left
    validated by Phase B's existing invariant test suite only, pending a
    separate, explicit approval if a live canary is ever wanted.
  - **Result: every comparison matched, no mismatches found.** The 6 rows
    now in `analytics_daily_rollups` are item 5's intended, expected
    output — not a side effect requiring cleanup.

## 2026-08-16 — Enterprise Readiness — Scalability Track, Phase B (Infrastructure), Complete (Commit: 0db7a98)

- **Second of five approved phases for the Scalability Track.** Objective:
  build the entire approved infrastructure with zero production behavior
  change — no analytics page reads from rollups, no page is wired to any
  new query, the CSV import action still inserts per row, and send-worker
  concurrency defaults to the prior sequential behavior.
  **Implementation complete, published, migration applied.**
  - **Item 4/5 — analytics rollup worker** (`lib/analytics/rollup-worker.ts`)
    — computes daily counts via a new SQL function,
    `compute_email_event_rollups()` (`supabase/migrations/20260816100000_scalability_phase_b_rollup_infrastructure.sql`),
    so raw `email_events` rows are never fetched into Node — grouping
    happens in Postgres, the exact pattern the original audit identified as
    the N+1 root cause in `lib/analytics/organization-rollup.ts`. Covers
    campaign/mailbox/organization subject types directly; domain-level
    rollups are summed from the mailbox-level rows by domain (a new
    `listMailboxDomainsByIds()` in `lib/db/mailboxes.ts`), mirroring
    `lib/deliverability/domain-analytics.ts`'s existing "resolve mailboxes
    for a domain, then aggregate" pattern rather than a fourth SQL branch.
    Writes only to `analytics_daily_rollups`, which nothing reads from yet.
    Wired through a new `app/api/cron/analytics-rollup/route.ts` and
    `.github/workflows/cron-analytics-rollup.yml`, mirroring every other
    cron worker's shape exactly (auth, `runCronJob()`, `job_runs`,
    heartbeat). Supports an explicit `{since, until}` range for a future
    backfill (item 5) — not invoked with one yet.
  - **Item 7 — available-leads query** (`listLeadsAvailableForCampaign`,
    `lib/db/leads.ts`) — pushes the "not yet enrolled" filter into SQL via
    a `.not("id", "in", ...)` filter built from a small, campaign-scoped
    enrolled-id lookup, instead of the campaign detail page's current
    10,000-row account-wide fetch diffed in JS. Built only, not called from
    any page yet.
  - **Item 8/9 — pagination** — `listLeadsPage()`/`listCampaignsPage()`
    (`lib/db/leads.ts`/`lib/db/campaigns.ts`), one query each combining
    `.range()` with `{ count: "exact" }` for the page of rows and the total
    count together, plus a new generic `components/ui/pagination.tsx`. The
    existing `listLeads()`/`listCampaigns()` functions the live `/leads`
    and `/campaigns` pages call are untouched. Their supporting composite
    indexes are deliberately deferred to Phase D — per the approved scope
    adjustment, they'd be dead weight against unreachable code until the
    pages actually cut over.
  - **Item 10 — CSV batch-insert helper** (`createLeadsBatch`,
    `lib/db/leads.ts`) — chunks lead inserts into array inserts (500 rows
    per round trip) instead of one round trip per row, falling back to
    per-row inserts within any chunk that fails as a whole so row-level
    error attribution isn't lost. Built only —
    `app/(app)/leads/import-actions.ts` still calls `createLead()` per row.
  - **Item 11 — retention worker, dry-run only**
    (`lib/monitoring/retention-worker.ts`) — counts candidates in
    `rate_limit_events` (7-day retention window) and `job_runs` (90-day
    window) past their cutoff, using the plain `created_at` indexes Phase A
    added specifically for this query shape; deletes nothing. Scoped only
    to those two operational-log tables — `email_events`/`send_attempts`/
    `analytics_events` are core business data this same track's rollup
    infrastructure depends on, and `audit_logs`' retention window is a
    compliance decision, not an engineering one, so neither is touched.
  - **Item 12 — bounded send-worker concurrency**
    (`lib/email/send-worker.ts`) — the prior sequential `for...of` loop
    replaced by a new exported `processClaimedLeads()`, processing up to
    `concurrency` claimed leads at once with one hard invariant: two leads
    for the same `mailbox_id` are never processed concurrently, since
    `mailboxes.cooldown_minutes`/`hourly_limit` and `claim_due_sends()`'s
    daily-limit check (a count taken at claim time, not re-checked per
    send) both assume one send per mailbox at a time. Defaults to
    `concurrency = 1`, reducing the new orchestration to exactly the prior
    loop's order and behavior — confirmed by a dedicated test file
    (`lib/email/send-worker.test.ts`, none existed before). `processOne` is
    injected (`processCampaignLead` in production) specifically so this new
    orchestration logic is unit-testable without re-mocking the entire send
    pipeline. `processCampaignLead()` itself is unchanged, diffed
    line-by-line to confirm.
  - **One migration, two additive changes** — flagged and approved before
    implementation, since the phase was originally scoped as needing no
    migration at all: widens `job_runs_job_check` to allow the two new job
    names (`analytics-rollup`, `retention-cleanup`) — without it, every
    invocation of the two new cron routes would silently fail to persist
    its `job_runs` row, the same observability every other cron job in
    this codebase relies on — and adds `compute_email_event_rollups()`.
  - **Migration applied, local and remote confirmed in sync**: applied to
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, confirmed by a follow-up `--dry-run` reporting
    `"upToDate":true` with an empty migrations list, and by
    `supabase migration list` showing `local == remote` for all 44
    migrations including this one.
  - **Schema changes confirmed live, including a real functional smoke
    test**: the widened `job_runs_job_check` constraint (all 7 job names
    present) and `compute_email_event_rollups`'s existence (`FUNCTION`,
    `security_type: INVOKER`, matching `claim_due_sends()`'s convention)
    both queried directly against the linked project. The function was
    also called live against real data — it returned correctly-computed,
    internally consistent rows (the same underlying events counted
    identically at the campaign, mailbox, and organization level),
    confirming the `email_events` -> `campaigns` -> `organization_members`
    join path is correct against the real schema, not just syntactically
    valid. `job_runs` confirmed to have exactly one changed constraint and
    zero added/removed indexes or RLS changes.
  - **Explicitly confirmed unchanged**: `claim_due_sends()`, the
    `send_attempts` RPC functions, `processCampaignLead()` (the actual send
    pipeline, diffed line-by-line), every production analytics read path
    (`lib/campaigns/campaign-analytics.ts`,
    `lib/mailboxes/mailbox-analytics.ts`,
    `lib/deliverability/domain-analytics.ts`,
    `lib/analytics/organization-rollup.ts`), the `/leads` and `/campaigns`
    pages, `import-actions.ts`, audit logging, and rate limiting.
  - All checks (typecheck, lint, build, full test suite — 508 tests, up
    from 475) passed before commit.

Commit: `0db7a98`

## 2026-08-15 — Enterprise Readiness — Scalability Track, Phase A (Foundation), Complete (Commit: a758bce)

- **First of five approved phases for the Scalability Track** (Phase A
  Foundation / B Infrastructure / C Shadow Validation / D Incremental
  Cutover / E Cleanup) — a separate category from the now-complete Security
  and Reliability tracks. The underlying audit was re-verified against the
  current repository rather than assuming the prior Security/Reliability
  audits still held. Phase A is strictly zero production behavior change —
  every item is prerequisite/hygiene work; the fixes with real user-facing
  effect (N+1 analytics rollup, campaign/leads pagination, CSV import
  batching, send-worker concurrency) land in later phases.
  **Implementation complete, published, both migrations applied.**
  - **Item 1 — cron worker admin-client cleanup** — `runCronJob()`
    (`lib/monitoring/run-cron-job.ts`) previously created one
    `createAdminClient()` instance, then every worker it wrapped created a
    second, redundant instance of its own. `run()`'s signature now takes
    the client as a parameter (`run: (supabase: Client) => Promise<T>`),
    and all 5 workers (`send-worker.ts`, `reply-worker.ts`,
    `bulk-worker.ts`, `digest-worker.ts`, `health-check-worker.ts`) and all
    5 `app/api/cron/*/route.ts` call sites were updated accordingly.
    `digest-worker.test.ts`/`health-check-worker.test.ts` updated to pass a
    stub client directly instead of mocking `createAdminClient`.
  - **Item 2 — defensive `.limit()` ceilings** — `listCampaigns`
    (`lib/db/campaigns.ts`), `listSendAttemptsForCampaignLeads`
    (`lib/db/send-attempts.ts`), `listEnabledIntegrations`
    (`lib/db/integrations.ts`), and `listActiveMailboxesForHealthCheck`
    (`lib/db/mailboxes.ts`) were completely unbounded queries identified
    during this track's audit. Each now has a `DEFENSIVE_LIST_LIMIT`
    (1000-5000, matching the `EVENT_FETCH_LIMIT` precedent already used
    across the analytics snapshot builders) as a stopgap ahead of real
    pagination/batching fixes in later phases — chosen after querying live
    row counts against the linked project (max 1 campaign/user, max 1
    send_attempt/campaign, 0 enabled integrations, 2 active mailboxes at
    audit time), confirming today's behavior is unaffected.
    `lib/billing/limits.test.ts`, `lib/db/integrations.test.ts`, and
    `lib/db/mailboxes.test.ts`'s mock query-builder chains updated to
    support the new `.limit()` call.
  - **Item 3 — `analytics_daily_rollups` constraint widening (narrowed
    scope)** — new migration
    (`supabase/migrations/20260815100000_analytics_daily_rollups_email_event_types.sql`)
    widens `analytics_daily_rollups_event_type_check` to accept
    `email_events`' vocabulary (`'sent'`/`'failed'` — the table previously
    only allowed `'email_sent'` and had no `'failed'` value at all,
    inherited from being built for the separate, mostly-unused
    `analytics_events` stream). The SQL grouped-aggregation function
    originally scoped alongside this was deliberately deferred to Phase
    B — designing it (organization-id derivation via `campaigns`,
    per-subject-type handling, domains having no direct `email_events`
    link) is worker-design work, not a schema prerequisite, and this
    narrowing was flagged explicitly rather than silently decided. Purely
    additive: the table has zero rows and no reader exists yet.
  - **Item 11 (migration portion) — retention indexes** — new migration
    (`supabase/migrations/20260815100010_retention_created_at_indexes.sql`)
    adds plain `created_at` indexes to `rate_limit_events` and `job_runs`,
    verified missing this session: both tables only had composite indexes
    leading with a different column (`(scope, identity, created_at)` and
    `(job, created_at)` respectively), which Postgres cannot use to satisfy
    a plain `where created_at < X` predicate — exactly the query a future
    retention/pruning worker (Phase B) will run, and exactly the two
    fastest-growing tables in the schema.
  - **Migrations applied, local and remote confirmed in sync**: applied to
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, confirmed by a follow-up `--dry-run` reporting
    `"upToDate":true` with an empty migrations list, and by
    `supabase migration list` showing `local == remote` for all 43
    migrations including both new ones.
  - **Schema changes confirmed live, not just read from the migration
    files**: the widened `analytics_daily_rollups_event_type_check`
    definition, and both `rate_limit_events_created_at_idx`/
    `job_runs_created_at_idx` as plain btree indexes on `created_at`, all
    queried directly against the linked project. Also confirmed no
    unexpected side effects: RLS remains enabled on all three affected
    tables, `rate_limit_events`/`job_runs` each gained exactly one index
    and nothing else, and `analytics_daily_rollups` retained the same 6
    constraints as before, only the `event_type` check's definition
    changed.
  - **Explicitly confirmed unchanged**: `claim_due_sends()`, the
    `send_attempts` RPC functions (`claim_send_attempt`,
    `record_send_success`, `record_send_failure` — as distinct from
    `listSendAttemptsForCampaignLeads`, the read-only analytics helper in
    the same file that Item 2 did modify), monitoring's actual logging/
    heartbeat/error-tracking behavior (`lib/monitoring/heartbeat.ts`/
    `error-tracking.ts` untouched; only `run-cron-job.ts`'s `run()`
    callback signature changed), audit logging, and rate limiting.
  - All checks (typecheck, lint, build, full test suite — 475 tests)
    passed before commit.
  - **Next milestone: Phase B (Infrastructure)** — not started. Phases C
    (Shadow Validation), D (Incremental Cutover), and E (Cleanup) also
    remain not started.

Commit: `a758bce`

## 2026-08-06 — Enterprise Readiness — Reliability Track, Complete (Commit: f78c643)

- **Six approved items from the Enterprise Readiness audit's Reliability
  section** — a separate category from the now-complete Security track
  (Phases 3A, 3B Parts 1-3, see below). Scoped to only the specific files
  each item touches rather than a repeat full-codebase audit.
  **Implementation complete, database migration applied.** Explicitly did
  not modify `claim_due_sends()`, `send_attempts`, monitoring, audit
  logging, or rate limiting — every change is isolated to its own worker/
  provider file.
  - **IMAP connection timeout** — `ImapFlow`
    (`lib/email/reply-providers/imap.ts`) had no connect/greeting/socket
    timeout, unlike SMTP since Track B's E4 (`SMTP_TIMEOUTS`,
    `lib/email/providers/smtp.ts`); a hung/unreachable mailbox could block
    `reply-worker.ts`'s sequential per-mailbox loop indefinitely. Added
    `IMAP_TIMEOUTS` mirroring SMTP's 10s/20s values, plus
    `friendlyImapTimeoutMessage()` translating ImapFlow's internal
    `CONNECT_TIMEOUT`/`GREETING_TIMEOUT`/`ETIMEOUT`/`UPGRADE_TIMEOUT` codes
    into one clear message, the same pattern `friendlySmtpTimeoutMessage`
    already established.
  - **Send worker invocation time budget** — `runSendWorker`
    (`lib/email/send-worker.ts`) previously claimed up to
    `DEFAULT_CLAIM_LIMIT` (25) leads and processed them fully sequentially
    with no wall-clock ceiling. Added `INVOCATION_TIME_BUDGET_MS` (4
    minutes), checked only between claimed leads, never mid-send — the
    worker now stops claiming new work once the budget is hit and returns a
    partial summary. Does not touch `claim_due_sends()`, `send_attempts`,
    or the retry ladder (`computeRetryDelay`): a lead left unprocessed
    simply stays claimed until its existing `locked_until` lease expires,
    then is reclaimed by the next cron tick like any other in-flight claim.
  - **Cron schedule verification** — all 5 `.github/workflows/cron-*.yml`
    schedules (send-emails */5min, sync-replies */10min, verify-leads
    */10min, deliverability-health-check hourly, integrations-digest daily)
    checked against their corresponding claim-lease durations
    (`claim_due_sends()`'s and `claim_due_verifications()`'s 10-minute
    leases). No drift or misconfiguration found — verification-only, no
    code change.
  - **Consistent retry/backoff across external providers** — the bulk
    verification worker's `processLead()` (`lib/verification/bulk-worker.ts`)
    previously discarded `VerificationError.outcome` entirely in its catch
    block and always wrote a terminal `verification_status: "error"`, even
    when MillionVerifier classified the failure as `"retry"` (network
    error, provider timeout/rate-limit). A `"retry"` outcome now calls the
    existing `queueLeadsForVerification()` to reset the lead to `pending`
    instead, so it self-heals on the next `verify-leads` cron tick once
    `claim_due_verifications()` picks it back up — matching how
    `send-worker.ts`/`reply-worker.ts` already treat their own transient
    failures. `VerificationWorkerSummary` gained a `retried` field
    (additive only).
  - **Explicit Stripe SDK network retries** — `getStripeClient()`
    (`lib/billing/stripe.ts`) previously called `new Stripe(secretKey)`,
    using the SDK's default `maxNetworkRetries: 0` — a transient network
    blip during a webhook/checkout-session call wasn't retried at all. Now
    passes `{ maxNetworkRetries: 2 }`, Stripe's own documented
    recommendation; safe because the SDK only retries requests it can
    prove are idempotent (idempotent GETs, and POSTs sent with an
    idempotency key), so this can't produce a duplicate charge or side
    effect.
  - **Reply-sync overlap protection** — unlike the claim-based send and
    verification pipelines (`campaign_leads.locked_until`/
    `claim_due_sends()`, `leads.verification_locked_until`/
    `claim_due_verifications()`), `runReplySyncWorker`
    (`lib/email/reply-worker.ts`) previously selected mailboxes via a plain
    `select` (`listMailboxesForReplySync`) with no claim/lease at all — a
    slow run still in flight when the next scheduled sync-replies
    invocation fired could process the same mailbox's inbox twice
    concurrently and race on `updateMailboxSyncCursor`'s plain update. New
    migration
    (`supabase/migrations/20260814100000_mailboxes_reply_sync_lock.sql`)
    adds `mailboxes.reply_sync_locked_until` and
    `claim_mailboxes_for_reply_sync()` (the same `for update skip locked`
    lease pattern as `claim_due_sends()`/`claim_due_verifications()`,
    scoped only to `mailboxes` — does not touch `campaign_leads`,
    `send_attempts`, or `claim_due_sends()` itself). `claimMailboxesForReplySync()`
    replaces the old plain-select function in `lib/db/mailboxes.ts`; the
    new `releaseMailboxReplySyncLock()` releases the lease on a per-mailbox
    IMAP failure, and `updateMailboxSyncCursor()` now also clears it on
    success — so a mailbox is never locked out longer than one run. No new
    RLS policy needed: `mailboxes`' existing 4 owner-scoped policies are
    unchanged, and the migration's only DDL is the new column and function.
  - **Migration applied, local and remote confirmed in sync**: applied to
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, confirmed by a follow-up `--dry-run` reporting
    `"upToDate":true` with an empty migrations list, and by
    `supabase migration list` showing `local == remote` for all 41
    migrations including this one.
  - **New column and function confirmed live**, queried directly against
    the linked project rather than only read from the migration file:
    `mailboxes.reply_sync_locked_until` (`timestamp with time zone`,
    nullable) and `claim_mailboxes_for_reply_sync` (`FUNCTION`,
    `security_type: INVOKER`, matching `claim_due_sends()`/
    `claim_due_verifications()`'s existing convention of running as
    invoker rather than security-definer) both confirmed to exist; `mailboxes`
    RLS confirmed still enabled (`relrowsecurity = true`) with the same 4
    pre-existing policies, nothing added or changed.
  - All checks (typecheck, lint, build, full test suite — 475 tests)
    passed before commit.
- **Confirmed out of scope, verified against the commit itself**:
  `claim_due_sends()`, `send_attempts`, monitoring (`lib/monitoring/`),
  audit logging (`lib/db/audit-log.ts`), and rate limiting
  (`lib/rate-limit/`) — none were touched by this commit.

Commit: `f78c643`

## 2026-08-05 — Phase 3B Part 3: Enterprise Readiness — Rate Limiting, Complete (Commit: b6dbaea)

- **Fourth and final sub-phase of the Enterprise Readiness Security track**,
  implementing Item 1 (rate limiting) — the last of the audit's 7 approved
  Security findings. **This closes the Security track entirely**: Phases
  3A, 3B Part 1, 3B Part 2, and 3B Part 3 together cover the full approved
  scope. **Implementation complete, database migration applied.**
  - **`rate_limit_events` table** — new migration
    (`supabase/migrations/20260813100000_rate_limit_events.sql`), append-
    only (mirrors `claim_due_sends()`'s own reasoning
    (`20260730100020_claim_due_sends.sql`): daily send limits are computed
    with a windowed `count(*)` rather than a running counter, explicitly to
    avoid write amplification and a drift-recovery problem for no benefit
    at this scale — the same logic applies to rate limiting). RLS enabled
    with zero policies, the same carve-out as `stripe_webhook_events`/
    `job_runs` — rate-limit bookkeeping must be writable from
    pre-authentication contexts (login/signup have no session yet, so no
    organization to scope a member-based policy to even if one existed)
    and isn't organization-owned data a user should ever read directly.
  - **`record_rate_limit_attempt()` RPC** — atomic check-and-record in a
    single statement, guarded by `pg_advisory_xact_lock(hashtext(scope ||
    ':' || identity))` (auto-released at transaction end) to close the
    race a plain "select count, then insert" would have under concurrent
    requests from the same caller. Returns `(allowed boolean,
    retry_after_seconds integer)` — the retry value is computed from the
    oldest attempt still inside the window, not just the static window
    length.
  - **Provider-agnostic architecture** (`lib/rate-limit/`) — a
    `RateLimiter` interface (`provider.ts`) + `PostgresRateLimiter` as its
    only implementation (`providers/postgres.ts`) + `getRateLimiter()` as
    the one factory seam (`get-provider.ts`), mirroring
    `lib/email/provider.ts`'s `EmailProvider` split and
    `lib/integrations/provider.ts`'s `IntegrationProvider` split exactly.
    No call site anywhere references Postgres, the RPC name, or the table
    — every one of the 19 protected actions imports only
    `checkRateLimit()`/`RateLimitError` from `check-rate-limit.ts`, so
    swapping in a distributed limiter later (Upstash Redis or similar)
    means changing `get-provider.ts` alone.
  - **Centralized configuration** (`lib/rate-limit/config.ts`) — one
    `RateLimitScope` union and one `windowSeconds`/`maxAttempts`/
    `failClosed` map per scope, so retuning a limit later means editing
    this one file, not hunting through every action that uses it.
    `failClosed` is a deliberate per-scope policy: `auth:sign_in`,
    `auth:sign_up`, `auth:forgot_password_ip`, `auth:forgot_password_email`,
    and `auth:reset_password` fail closed on an infrastructure error in
    the check itself (an outage on the least-protected surface in the app
    must not become an open brute-force window); every authenticated scope
    (`ai:generate`, `verification:*`, `mailbox:test_connection`,
    `integration:test_digest`, `campaign:*`, `leads:import`) fails open (a
    transient hiccup must never lock a paying customer out of their own
    campaign — RLS and `lib/billing/limits.ts`'s resource quotas remain
    the real security/fairness boundary on those paths; rate limiting
    there is abuse mitigation, not a hard gate). `forgot_password` is
    dual-keyed (both `_ip` and `_email` scopes checked) specifically
    because IP-only keying doesn't stop a distributed attacker rotating
    IPs from email-bombing one victim's inbox with reset emails.
  - **`lib/rate-limit/get-client-ip.ts`** — best-effort client IP via
    `headers().get("x-forwarded-for")` for the three unauthenticated auth
    scopes (reintroducing the `next/headers` usage Phase 3B Part 1 removed
    from `lib/actions/auth.ts` for a different purpose — `getOrigin()` —
    now used here instead). Falls back to a shared `"unknown"` bucket only
    relevant to local/direct testing; Vercel always sets the header in
    production.
  - **19 wired call sites**, the full catalog approved during scoping:
    - `lib/actions/auth.ts` — `signIn`, `signUp`, `forgotPassword` (dual-
      keyed), `resetPassword` (keyed by `user.id`, since it requires an
      already-established recovery session).
    - 4 AI-recommendation actions (`app/(app)/analytics/actions.ts`,
      `campaigns/[campaignId]/analytics/actions.ts`,
      `mailboxes/[mailboxId]/analytics/actions.ts`,
      `settings/deliverability/[domainId]/analytics/actions.ts`) —
      `ai:generate`, keyed by organization.
    - `app/(app)/leads/actions.ts` — `verifyLeadAction`
      (`verification:verify_single`), `queueLeadsVerificationAction`/
      `queueAllLeadsVerificationAction` (`verification:queue`, both newly
      resolving an organization for this purpose).
    - `app/(app)/mailboxes/actions.ts` — `testImapConnectionAction`/
      `testSmtpConnectionAction` (`mailbox:test_connection`) — both make a
      live outbound connection to a user-supplied `host:port`, an
      SSRF-adjacent primitive identified during scoping.
    - `app/(app)/settings/integrations/actions.ts` — `sendTestDigestAction`
      (`integration:test_digest`) — same SSRF-adjacent shape, a live
      outbound POST to a user-configured URL.
    - `app/(app)/campaigns/[campaignId]/actions.ts` —
      `launchCampaignAction` (`campaign:launch`), `enrollLeadAction`/
      `enrollLeadListAction` (`campaign:enroll`),
      `resolveSendAttemptAction` (`campaign:resolve_send_attempt`) — all
      newly resolving an organization purely for rate-limit identity
      (campaigns themselves stay `user_id`-scoped, unchanged).
    - `app/(app)/leads/import-actions.ts` — `importLeadsAction`
      (`leads:import`).
    Each call site matches its own existing error-surfacing convention —
    a thrown `Error` (the AI actions, `sendTestDigestAction`, the campaign
    actions), a returned `{ok, error}` (both test-connection actions), or
    a returned `{error, ...}` state shape (`lib/actions/auth.ts`,
    `importLeadsAction`) — rather than forcing one pattern everywhere.
  - **`RateLimitError`** — a fixed, generic message ("Too many attempts.
    Try again in ~.") that never mentions the scope, the count, or the
    identity, regardless of which of the 19 call sites throws it. A typed
    `retryAfterSeconds` field is exposed alongside the message so a future
    Route Handler could also set a real `Retry-After` HTTP header.
  - **Migration applied, local and remote confirmed in sync**: applied to
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, confirmed by a follow-up `--dry-run` reporting
    `"upToDate":true` with an empty migrations list, and by
    `supabase migration list` showing `local == remote` for this migration.
  - **RPC validated with live calls against the linked project, not just
    read from the migration file**: `record_rate_limit_attempt()` called
    twice with `max_attempts: 1` on the same scope/identity — first call
    returned `{allowed: true, retry_after_seconds: 0}` and recorded the
    attempt; second call returned `{allowed: false, retry_after_seconds:
    60}`, matching the configured window exactly.
  - **RLS confirmed enabled and enforcing, not just present in the
    migration file**: an anon-key direct `insert` and an anon-key call to
    the RPC itself were both rejected by Postgres with `"new row violates
    row-level security policy for table \"rate_limit_events\""`. The
    RPC-call rejection is a stronger signal than the direct-insert
    rejection alone — it confirms `record_rate_limit_attempt()` runs as
    invoker (the default), not `security definer`, so it cannot be used as
    a backdoor around the table's own RLS.
  - All checks (typecheck, lint, build, full test suite — 475 tests)
    passed before commit.
- **Enterprise Readiness Security track is now complete.** All 7 approved
  Security findings from the original audit are implemented, and every
  migration each phase introduced is applied and confirmed in sync.
  **Remaining from the original audit: the Reliability and Scalability
  tracks** — neither has started, and neither has been broken into
  sub-phases the way Security was across Phases 3A/3B. Production
  Readiness findings from the same audit also remain unstarted.

Commit: `b6dbaea`

## 2026-08-05 — Phase 3B Part 2: Enterprise Readiness — Audit Logging, Complete (Commit: a709094)

- **Third sub-phase of the Enterprise Readiness initiative**, implementing
  Item 7 (audit log for sensitive operations) — the last of the audit's 7
  approved Security findings, closing out the Security category entirely
  (Parts 1 and 2 together cover all 7; only Item 1, rate limiting, from a
  separate audit category, remains — see Phase 3B Part 3 note below).
  **Implementation complete, database migration applied.** No external
  account/credential dependency for this phase, so unlike Email
  Verification/Outlook there's no separate production-validation gate
  blocking usability — it's live and usable today. One thing genuinely still
  open, stated plainly rather than glossed over: no real end-to-end
  click-through in the running app (actually connecting a mailbox, an AI
  key, etc., and confirming the resulting row) has been performed —
  verification so far is direct DB-level (live queries against the linked
  project, see below) plus the unit test suite, not the full app flow.
  - **`audit_logs` table** — new migration
    (`supabase/migrations/20260812100000_audit_logs.sql`), modeled on
    `warmup_events` (`20260802100000_warmup.sql`): RLS enabled,
    `select`+`insert` policies scoped to organization members, no
    update/delete policy ("it's a log"). `actor_user_id` is nullable with
    `on delete set null`, a deliberate deviation from this schema's usual
    cascade-to-`auth.users` pattern — an audit log's entire purpose is to
    survive the thing it's logging, whether that's the acting user's
    account being deleted later or (for `billing_subscription_changed`)
    there being no interactive user at all, since that event is written
    from the Stripe webhook. `target_type`/`target_id` are a loosely-typed
    reference, the same pattern `analytics_events.subject_type`/`subject_id`
    already established, since the target lives in a different table per
    action. `metadata` is documented (migration column comment) as
    non-secret-only.
  - **`recordAuditEvent()` — the single centralized writer**
    (`lib/db/audit-log.ts`). Deliberately breaks this directory's otherwise
    universal "throw on error" convention: every other `lib/db/*.ts`
    function throws so a caller can react to a failure, but this one
    swallows and `console.error`s its own instead — an audit-log write
    failing must never be allowed to block the user action it's recording.
    Baking best-effort into the one writer, rather than trusting 13 call
    sites to each remember their own `.catch()`, is what actually makes
    "best-effort" a guarantee instead of a convention that could silently
    lapse at any one of them. 3 new unit tests, including one asserting a
    failed insert resolves cleanly rather than throwing.
  - **13 wired call sites**, the full set catalogued during Phase 3B
    scoping — every credential/access/billing-relevant action in the
    codebase, and nothing else (routine CRUD like campaigns/leads/sequence
    steps was deliberately excluded as out of scope, see the scoping
    discussion):
    - `app/(app)/mailboxes/actions.ts`: `mailbox_connected`
      (`createMailboxAction`), `mailbox_credentials_updated`
      (`updateMailboxAction`, only when a password field was actually
      submitted — not on every routine edit), `mailbox_deleted`,
      `mailbox_disconnected` ×2 (Gmail/Outlook).
    - `app/api/oauth/{google,microsoft}/callback/route.ts`:
      `mailbox_connected` for OAuth-based connects (both new-connect and
      reconnect branches).
    - `app/(app)/settings/ai/actions.ts`,
      `app/(app)/settings/verification/actions.ts`: `*_key_connected`/
      `*_key_disconnected`.
    - `app/(app)/settings/integrations/actions.ts`: `integration_connected`/
      `integration_disconnected` (webhook URL itself deliberately omitted
      from metadata — not a credential, but not something this log needs to
      surface either).
    - `app/api/webhooks/stripe/route.ts`: `billing_subscription_changed`,
      both the `checkout.session.completed` and `customer.subscription.*`
      branches, `actor_user_id: null` in both (no interactive user in a
      webhook), `metadata.stripeEventType` recording which specific Stripe
      event drove the change.
  - **Scope correction made during implementation**:
    `lib/billing/sync-subscription.ts`'s `syncSubscriptionFromStripe`
    previously returned `void`. Scoping had assumed the webhook route
    already had the resolved `organizationId` in scope at both call
    sites — true for `checkout.session.completed`, false for
    `customer.subscription.*`, where it was only resolved privately inside
    the function. Rather than duplicate that resolution logic in the route,
    the function now returns the id it resolved (or `null`), a minimal,
    non-breaking signature change (existing tests only `await`ed the call,
    never asserted on its return value) — one assertion updated
    (`toBeUndefined()` → `toBeNull()`) to match the new, intentional return.
  - **Migration applied, local and remote confirmed in sync**: applied to
    the linked development/staging Supabase project (`wxhulmbbobkfvtreaspo`)
    via `supabase db push`, confirmed by a follow-up `--dry-run` reporting
    `"upToDate":true` with an empty migrations list, and by
    `supabase migration list` showing `local == remote` for this migration.
  - **RLS confirmed enabled and enforcing, not just present in the migration
    file** — verified with live queries against the linked project after
    applying: the table is reachable via the service-role client; an
    anon-key (unauthenticated) read returns an empty result, not an error,
    consistent with the member-only select policy matching zero rows for a
    request with no organization membership; an anon-key insert attempt was
    rejected outright by Postgres itself — `"new row violates row-level
    security policy for table \"audit_logs\""` — the most direct possible
    confirmation that the insert policy is active and enforcing.
  - All checks (typecheck, lint, build, full test suite — 464 tests) passed
    before commit.
- **Phase 3B Part 3 (Item 1, rate limiting) has NOT started.** Across
  authentication, AI generation, verification, and campaign/send actions —
  still needs a new migration and the Postgres-vs-third-party-service
  architecture decision flagged during Phase 3B's original scoping.

Commit: `a709094`

## 2026-08-05 — Phase 3B Part 1: Enterprise Readiness — Security, Implementation Complete (Commit: 53034ab)

- **Second sub-phase of the Enterprise Readiness initiative** (see Phase 3A
  below for the first). Covers 5 of the audit's 7 approved Security
  findings. **No external account/credential dependency for any item in this
  phase** — unlike Email Verification or Outlook, there is no separate
  "production validation pending" gate here; every change is self-contained
  and already covered by the existing test suite (typecheck/lint/build/full
  suite — 461 tests — all passed before commit). **No database migrations.**
  Five items, all complete:
  - **Constant-time CRON secret comparison** — `isAuthorized()`
    (`lib/monitoring/run-cron-job.ts`) compared the bearer token with plain
    `===`, inconsistent with the rest of the codebase. Now `Buffer.from()` +
    a length check (`timingSafeEqual` throws on mismatched lengths) +
    `timingSafeEqual`, matching `lib/email/unsubscribe-token.ts` and the
    OAuth callbacks' `isValidState` exactly. Phase 3A's centralization of
    all five cron routes into one auth-check function meant this fix
    touched a single function instead of five separate route files.
  - **Host-header trust fix** — `lib/actions/auth.ts`'s `getOrigin()` built
    `signUp`/`forgotPassword` redirect URLs (`emailRedirectTo`/`redirectTo`)
    from the request's `origin`/`host` headers. Removed entirely; both now
    use `NEXT_PUBLIC_APP_URL` directly, matching how
    `lib/email/unsubscribe-token.ts` already avoided header-derived URLs for
    the same reason.
  - **Ownership validation for campaign-lead/sequence-step mutations** —
    `app/(app)/campaigns/[campaignId]/actions.ts` verified the caller owned
    *a* campaign (`getCampaign(user.id, campaignId)`) but never that the
    mutated `campaignLeadId`/`stepId` actually belonged to *that* campaign
    before touching it. RLS (`campaign_leads_update_own`/`_delete_own`,
    `check_campaign_lead_owner()`) already prevented real exploitation, so
    this is a defense-in-depth fix closing the app-level gap in front of it.
    New `assertCampaignLeadInCampaign` (equality check on an already-fetched
    row) and `assertSequenceInCampaign` (one extra lookup, since
    `sequence_steps` has no `campaign_id` column of its own) helpers, wired
    into `updateCampaignLeadAction`, `removeCampaignLeadAction`,
    `resolveSendAttemptAction`, `updateSequenceStepAction`,
    `deleteSequenceStepAction`, and `moveSequenceStepAction`. **Scope
    correction made during implementation**: the originally-scoped fix
    (changing `updateCampaignLead`/`removeCampaignLead`/`getCampaignLead`
    signatures in `lib/db/campaign-leads.ts`) would have rippled into
    `lib/email/send-worker.ts` and `lib/email/reply-worker.ts`, which call
    those same functions with their own already-trusted `campaignId` and
    were never part of the vulnerable surface — the check was added at the
    Server Function layer instead, so `lib/db/*.ts` and both workers are
    completely untouched.
  - **Merge-tag HTML escaping** — `lib/email/merge-tags.ts`'s
    `renderMergeTags` substituted lead data (company, title,
    `custom_fields.*` — free text with no HTML sanitization at the
    validation boundary) into outbound email HTML with zero escaping. Added
    an opt-in `escapeHtml` option, applied only to the substituted value,
    never the surrounding template (so an org's own intentional HTML in
    their step body is untouched). `lib/email/send-worker.ts`'s body call
    site (`html: body`) now passes `{ escapeHtml: true }`; the subject call
    site deliberately does not — escaping there would render literal
    `&amp;` in a mail client's Subject header instead of an actual
    ampersand. 5 new tests in `lib/email/merge-tags.test.ts`, including one
    proving the subject path stays unescaped.
  - **Security response headers** — `next.config.ts` was untouched
    `create-next-app` boilerplate. Added a `headers()` function setting
    `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
    `Referrer-Policy: strict-origin-when-cross-origin`, and
    `Strict-Transport-Security` on every response. Content-Security-Policy
    deliberately excluded from this phase — this app redirects through
    three third-party origins (Stripe Checkout/Portal, Google OAuth,
    Microsoft OAuth) plus `next/image` optimization, and writing a CSP
    without first cataloguing every one of those is the easiest way to
    silently break billing or a mailbox connect flow; scoped as its own
    follow-up.
  - **Session-refresh proxy — re-verified, not changed.** The original
    audit's "no `middleware.ts` in the repo" finding was a false positive:
    Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`
    (different file/export name, same mechanism — see
    `node_modules/next/dist/docs/.../proxy.md`), and the audit searched for
    the old filename. `proxy.ts` (project root) has correctly refreshed the
    Supabase session cookie on every matched request since the very first
    Phase 2 commit (`25d2f2a`, 2026-07-29) — confirmed by inspection this
    phase, no code change needed.
- **Deliberately not included in this phase**: **Item 7 (audit log design
  for sensitive operations)** and **Item 1 (rate limiting** across
  authentication, AI generation, verification, and campaign/send actions**)**
  — both require a new migration, and item 1 additionally requires an
  architecture decision (a Postgres-backed limiter, reusing the
  `claim_due_sends()`-style atomic-RPC pattern, vs. a third-party service
  like Upstash Redis) that has not been made yet. Neither has been started;
  both are scoped as separate future sub-tasks.

Commit: `53034ab`

## 2026-08-05 — Phase 3A: Enterprise Readiness — Operations & Monitoring Complete (Commit: 283851e)

- **Closes the Enterprise Readiness audit's top finding** — three of five
  cron jobs (`verify-leads`, `deliverability-health-check`,
  `integrations-digest`) had no scheduler wired up anywhere in the repo, and
  none of the five had anything watching them once running. First sub-phase
  of the Enterprise Readiness initiative; implements only the audit's
  Operations & Monitoring items. Five approved items, all complete:
  - **Cron scheduling** — added `.github/workflows/cron-verify-leads.yml`
    (*/10), `cron-deliverability-health-check.yml` (hourly), and
    `cron-integrations-digest.yml` (daily 08:00 UTC), joining the two
    workflows that already existed for `send-emails`/`sync-replies`. All
    five cron routes now have a confirmed in-repo scheduler.
  - **Heartbeat / dead-man's-switch** — new `lib/monitoring/heartbeat.ts`'s
    `pingHeartbeat()`, Healthchecks.io-compatible (a bare URL pings success,
    `<url>/fail` pings failure), opt-in per job via a `CRON_HEARTBEAT_URL_*`
    env var, no-op until configured — this is what actually detects "the
    scheduler stopped calling this route at all," which `job_runs` alone
    cannot.
  - **Centralized monitoring abstraction** — new
    `lib/monitoring/run-cron-job.ts` consolidates the auth-check/timing/
    logging shell every cron route previously duplicated five times over,
    now also persisting to `job_runs`, pinging the heartbeat, and forwarding
    to error tracking from one place; new `lib/monitoring/error-tracking.ts`'s
    `captureError()` forwards unexpected failures (every cron route's
    top-level catch, plus each worker's existing per-item failure catch in
    `reply-worker.ts`/`bulk-worker.ts`/`health-check-worker.ts`/
    `digest-worker.ts`/`send-worker.ts`) to an optional
    `ERROR_TRACKING_WEBHOOK_URL`, mirroring `WebhookIntegrationProvider`'s
    shape. Worker orchestration itself stays fully decoupled — this only
    wraps route-level plumbing, the same non-coupling `reply-worker.ts`'s
    route already called out.
  - **`/api/health`** — new unauthenticated Route Handler for external
    uptime monitoring, confirms database connectivity, returns 503 on
    failure.
  - **`job_runs` infrastructure** — new table (migration
    `20260811100000_job_runs.sql`), modeled on `stripe_webhook_events`: RLS
    enabled with zero policies (service-role only, no organization
    dimension — a cron run isn't org-owned data), persisting every cron
    invocation's outcome/duration/summary so a stuck or silently-failing job
    is queryable instead of living only in platform logs. **Migration
    applied**: confirmed live on the linked development/staging Supabase
    project (`wxhulmbbobkfvtreaspo`) via `supabase db push`, verified with a
    follow-up `--dry-run` reporting the remote database up to date with no
    pending migrations.
- All checks (typecheck, lint, build, full test suite — 456 tests) passed
  before commit.
- **Scope notes**: `captureError` is wired into every worker's existing
  "unexpected per-item failure" catch, but deliberately not into
  `send-worker.ts`'s expected `needs_review`/`skipped`/`retry`/`bounced`
  business-outcome branches (already recorded in `campaign_leads.status`,
  not incidents needing an alert) — only its terminal `"failed"` outcome
  forwards. Phase 3B (Reliability, Security, Scalability, Production
  Readiness findings from the same audit) not started.

Commit: `283851e`

## 2026-08-05 — UX & Reliability (Track B) Complete (Commit: 22570d8)

- **Second of two independent tracks in the same performance/reliability
  initiative as Backend Performance (Track A, below) — four approved items,
  all complete:**
  - **U2** — new `MotionProvider` (`components/motion/motion-provider.tsx`),
    a thin client wrapper around framer-motion's `MotionConfig` mirroring
    the existing `ThemeProvider` pattern, wired into `app/layout.tsx` with
    `reducedMotion="user"`. Applies to every existing `motion.*` usage
    app-wide with no per-component changes — suppresses transform-driven
    motion when the OS `prefers-reduced-motion` setting is on, while opacity
    fades still play.
  - **U3** — extracted a shared `ErrorFallback`
    (`components/ui/error-fallback.tsx`) out of the existing root
    `app/error.tsx` (no visual change) and reused it in a new nested
    `app/(app)/error.tsx`, a route-segment boundary for the entire
    authenticated app shell — a crash on any `(app)` page no longer bubbles
    to the root boundary shared with `(auth)`/marketing routes. New
    `WidgetErrorBoundary` (`components/ui/widget-error-boundary.tsx`, built
    on Next's `unstable_catchError` component-level boundary API) wraps the
    dashboard's six independent widgets (setup checklist, each stat card,
    recent campaigns table, quick actions, tips, recent sending activity),
    so one widget throwing no longer blanks the whole page.
  - **U4** — `components/motion/fade-in.tsx` now caps its `delay` prop at
    `0.3`. Some detail pages chain 15-20 sections at `+0.05s` increments —
    `/analytics` reached `1.3s` for its last section, over a second before
    below-the-fold content started appearing. The cap leaves the first ~6
    staggered items unchanged and flattens the long tail, fixing all 26
    `FadeIn` call sites from one place with no change to any page's own
    delay values.
  - **E4** — `lib/email/providers/smtp.ts`'s `resolveSmtpConnection`/
    `verifySmtpConnection` previously passed no timeout options to
    `nodemailer.createTransport()` at all, so a hung/unreachable mailbox
    could block `send-worker.ts` for up to nodemailer's 10-minute default
    per email — completely unbounded. Both now spread a shared
    `SMTP_TIMEOUTS` (`connectionTimeout`/`greetingTimeout`: 10s,
    `socketTimeout`: 20s) into their transport. Added
    `friendlySmtpTimeoutMessage()`: nodemailer reports every timeout as
    `code: "ETIMEDOUT"` with an internal string ("Greeting never received",
    etc.); that's now replaced with "Couldn't reach the mail server in time.
    Check the host and port, then try again." before it reaches
    `EmailSendError` or the test-connection action. The existing 10s
    `Promise.race` around the mailbox form's "Test connection" button
    (`app/(app)/mailboxes/actions.ts`) was left unchanged — this reinforces
    it, not a replacement.
- All checks (typecheck, lint, build, full test suite — 441 tests) passed
  before commit.
- **Scope notes**: E4 was scoped to SMTP only, as approved — the same
  no-timeout gap exists in `lib/email/reply-providers/imap.ts` and in the
  Gmail/Outlook OAuth token-refresh `fetch` calls inside
  `resolveSmtpConnection`, neither of which were touched. `WidgetErrorBoundary`
  is applied to the dashboard only, as a first example — other multi-widget
  pages (analytics, compare pages) are unchanged.

## 2026-08-05 — Backend Performance (Track A) Complete (Commit: feac349)

- **First of two independent tracks in a performance/reliability
  initiative — four approved items, all complete:**
  - **C1** — new `getUserOrganization()` helper (`lib/db/organizations.ts`),
    wrapping `getOrCreateOrganizationForUser()`. Replaces nine separate
    inline/local reimplementations of "derive a default workspace name from
    the user's email, then resolve the organization" across `analytics/`,
    `billing/`, `campaigns/`, `mailboxes/`,
    `settings/{ai,deliverability,integrations,verification}/`, and
    `warmup/` routes with one shared call — 20 route files touched, no
    behavior change.
  - **P2** — `getUser()` (`lib/supabase/auth.ts`) wrapped in React's
    `cache()` — every Server Component/Function in a single request now
    shares one `supabase.auth.getUser()` round trip instead of each
    repeating it.
  - **P4** — new migration
    `supabase/migrations/20260810100000_email_events_composite_indexes.sql`
    adds `email_events_campaign_id_created_at_idx` and
    `email_events_mailbox_id_created_at_idx` (`(campaign_id, created_at
    desc)` / `(mailbox_id, created_at desc)`), so `listEmailEvents`
    (`lib/db/email-events.ts`) can walk an index straight to its `order by
    created_at desc limit` instead of sorting the full matched set —
    bringing `email_events` in line with the composite shape
    `analytics_events` already had.
  - **P8** — the dashboard's "Recent campaigns" widget now calls a new
    `getCampaignLeadActivitySummary()` (`lib/db/campaign-leads.ts`): a count
    plus two extremal timestamps per campaign via three small,
    already-indexed (`campaign_id`) lookups run in parallel, instead of
    `listCampaignLeads` fetching every enrolled lead row per campaign on
    every dashboard load.
- **Migration applied to the linked development/staging Supabase project**
  (`wxhulmbbobkfvtreaspo`) via `supabase db push`, confirmed by a follow-up
  `supabase db push --dry-run` reporting the remote database up to date
  with no pending migrations.
- All checks (typecheck, lint, build, full test suite — 441 tests) passed
  before commit.
- **Reclassified 2026-08-05**: this work was originally documented as
  "Performance Phase 1." The approved scope also included four UX &
  Reliability items (U2, U3, U4, E4) that have no code behind them yet —
  those are split out as a separate, not-yet-started **UX & Reliability
  (Track B)** milestone (see ROADMAP.md), not incomplete work from this
  track. No code changed as part of this reclassification.

## 2026-08-05 — Email Verification: paused pending a real provider account

- **Status set to Implementation Complete, Production Validation Pending.**
  The BYOK architecture, encrypted key storage, provider abstraction
  (`lib/verification/provider.ts`, `get-provider.ts`), UI
  (`/settings/verification`, lead table badges/filter), worker
  (`lib/verification/bulk-worker.ts`), and queue
  (`claim_due_verifications()`, `app/api/cron/verify-leads`) are all
  complete and unchanged — reviewed against this pause and confirmed
  provider-agnostic: no BYOK assumptions are hardcoded into the engine, and
  a future `verification_mode` (BYOK vs. platform-managed) can be added at
  the key-lookup step alone with no change to workers, queues, the provider
  interface, or lead verification logic. No platform-credit fields or code
  were added.
- **Not blocking the roadmap** — work on other milestones proceeds; live
  production validation (real MillionVerifier or other provider key,
  connected via Settings -> Verification) resumes whenever a real account
  is available.

## 2026-08-09 — Email Verification Integration Complete (Commit: da9bf94)

- **BYOK email verification via MillionVerifier** — `/settings/verification`
  lets an organization connect its own MillionVerifier API key
  (`verification_provider_keys`, organization-scoped, one row per
  organization per provider). Outreach-ai never purchases verification
  credit on a user's behalf in v1.
- **New provider abstraction** — `lib/verification/provider.ts`
  (`VerificationProvider`, `VerificationError` with
  `retry`/`invalid_key`/`failed` outcomes) and `lib/verification/get-provider.ts`,
  mirroring `lib/ai/provider.ts`/`get-provider.ts` exactly. First and only
  implementation is `lib/verification/providers/millionverifier.ts` — plain
  `fetch`, no vendor SDK.
- **MillionVerifier's real-time API confirmed against the live endpoint**,
  not just its docs — its published `resultcode` table (1=ok, 2=catch_all,
  3=unknown, 4=error, 5=disposable, 6=invalid) does not match what the API
  actually returns for its own documented test keys, so classification maps
  off the self-describing `result` string only, never `resultcode`. The API
  always responds HTTP 200; account-level failures (bad key, no credits,
  blocked IP) surface as `{ result: "", error: "<message>" }` rather than a
  non-2xx status.
- **`leads` gains a single verification_status column** (`unverified` /
  `pending` / `valid` / `invalid` / `catch_all` / `unknown` / `error`), plus
  `verification_risk_score` (derived 0-100, not provider-native —
  MillionVerifier's API doesn't return a score), `verification_detail`
  (jsonb, raw provider signals), `verified_at`, and
  `verification_locked_until`. In-place only, no audit/history table in v1.
- **Individual verification is synchronous** — a "Verify" button on each
  lead row calls `verifyLeadAction` -> `lib/verification/verify.ts`
  directly, mirroring `generateRecommendation()`'s BYOK-key-lookup ->
  decrypt -> call -> persist shape.
- **Bulk verification is always queued, never a synchronous batch** — "Queue
  verification" flips selected leads to `verification_status = 'pending'`;
  a new `claim_due_verifications()` Postgres function
  (`supabase/migrations/20260809110000_leads_verification.sql`) claims due
  rows with the same atomic `for update skip locked` pattern as
  `claim_due_sends()`, driven by `lib/verification/bulk-worker.ts` and a new
  `app/api/cron/verify-leads` route (`CRON_SECRET`-gated, same shape as the
  other four cron routes).
- **New encryption key** — `VERIFICATION_PROVIDER_KEY_ENCRYPTION_KEY`
  (AES-256-GCM via `lib/crypto/verification-provider-key-secret.ts`, reusing
  the existing generic `lib/crypto/aes-secret.ts` cipher code), deliberately
  separate from `MAILBOX_ENCRYPTION_KEY`/`AI_PROVIDER_KEY_ENCRYPTION_KEY` —
  same blast-radius-isolation reasoning as those two.
- **Lead table UI** — verification status badge column, per-lead "Verify"
  button, bulk "Queue verification" action, and a verification-status filter
  dropdown (client-side over the already-loaded page of leads).
- **No changes to leads' multi-tenancy model** — `leads` stays
  `user_id`-scoped (unchanged); `verification_provider_keys` is
  `organization_id`-scoped like `ai_provider_keys`, resolved per-lead via
  the owning user's organization membership.
- **Live production validation is still pending** — implementation was
  verified against MillionVerifier's public demo/test API keys (confirming
  the real response shape and account-error handling) but not against a
  real paid account or a real lead's mailbox, the same gate Gmail/Outlook
  had before their own production validation.
- **All checks passed**: `npm run typecheck`, `npm run lint`, `npm run
  build`, and the full test suite (441 tests, no regressions).

Commit: `da9bf94`

## 2026-08-04 — Mailbox Validation & UX Complete (Commit: 1da3e26)

- **SMTP connection testing added** — `verifySmtpConnection()`
  (`lib/email/providers/smtp.ts`), `testSmtpConnectionAction`
  (`app/(app)/mailboxes/actions.ts`), and a "Test connection" button next to
  the SMTP password field in `mailbox-form.tsx`.
- **SMTP validation now reaches feature parity with IMAP validation** — the
  manual SMTP path previously had no live connection check, unlike the IMAP
  path's existing `testImapConnectionAction`; both now offer the same
  test-before-save experience.
- **Uses nodemailer's `transporter.verify()`** — connection + EHLO/STARTTLS
  + AUTH only, confirmed by tracing the nodemailer 9.0.3 source directly
  (not just its docs): `MAIL FROM`/`RCPT TO`/`DATA` are issued from exactly
  one method (`SMTPConnection.prototype.send`), which `verify()`'s call
  chain (`connect` → `login` → `quit`) never calls. It cannot send an email
  under any code path.
- **Reuses the existing SMTP provider architecture** — `verifySmtpConnection`
  calls the same `resolveSmtpConnection()` `send()` already uses, so it
  exercises the same Gmail/Outlook/manual auth branches a real send would;
  `send()` itself is unchanged. `getMailboxSmtpCredential`
  (`lib/db/mailboxes.ts`) mirrors the existing `getMailboxImapCredential`
  exactly.
- **No database migrations.**
- **No worker changes** — `send-worker.ts`/`reply-worker.ts` untouched.
- **No provider interface changes** — `EmailProvider`/`ReplyProvider` and
  both factories (`get-provider.ts`/`get-reply-provider.ts`) untouched.
- **No analytics changes** — `lib/analytics/` untouched.
- **All checks passed**: `npm run typecheck`, `npm run lint`, `npm run
  build`, and the full test suite (433 tests, no regressions).

Commit: `1da3e26`

## 2026-08-04 — Microsoft 365 / Outlook Integration Complete (Commit: 316856d)

- **Microsoft OAuth implementation** — `lib/email/microsoft-oauth.ts`:
  `buildMicrosoftAuthUrl`/`exchangeCodeForTokens`/`refreshMicrosoftAccessToken`/
  `getMicrosoftUserInfo`, classified `MicrosoftOAuthError`
  (`retry`/`invalid_grant`/`failed`), mirroring `google-oauth.ts`'s shape
  exactly. Uses Microsoft's `/common/` authorize+token endpoints so a single
  app registration supports both Microsoft 365 work/school accounts and
  personal Outlook.com accounts.
- **OAuth callback flow** — `app/api/oauth/microsoft/start` and `.../callback`
  Route Handlers, mirroring the Google OAuth routes: state-cookie CSRF
  protection, reconnect-vs-new-connect detection via the existing
  `getMailboxByUserAndEmail`, and the connected account's email read directly
  from the OAuth `id_token`'s claims rather than a Microsoft Graph call.
- **Refresh token encryption** — added nullable
  `mailboxes.encrypted_microsoft_refresh_token` (`microsoft_oauth`
  migration), encrypted with the exact same AES-256-GCM scheme and
  `MAILBOX_ENCRYPTION_KEY` as the SMTP/IMAP passwords and the Google refresh
  token; `MailboxSafe`/`omitPassword()` strips it from every user-facing
  read path.
- **SMTP XOAUTH2 support** — `SmtpEmailProvider`'s `resolveSmtpConnection`
  gained an `email_provider === "outlook"` branch, refreshing the stored
  Microsoft refresh token into a short-lived access token against
  `smtp.office365.com` fresh on every send.
- **IMAP XOAUTH2 support** — `ImapReplyChecker`'s `resolveImapConnection`
  gained the equivalent `reply_provider === "outlook"` branch against
  `outlook.office365.com`.
- **Outlook mailbox connect/disconnect** — a "Connect Microsoft 365" entry
  point and an Outlook badge in `components/mailboxes/mailbox-list.tsx`;
  `mailbox-form.tsx`'s edit mode shows the same read-only "connected via
  OAuth" state for an Outlook mailbox as it already does for Gmail;
  `disconnectOutlookMailboxAction` clears the stored refresh token and moves
  the mailbox to `status = 'disconnected'`.
- **Provider abstraction reused (no worker refactors)** — no new
  `EmailProvider`/`ReplyProvider` implementation, no factory branching added
  to `get-provider.ts`/`get-reply-provider.ts`: Outlook is another
  auth-resolution branch inside the existing SMTP/IMAP classes, the same
  shape the Gmail integration already established.
- **Message-ID normalization compatibility** — no changes needed to
  `lib/email/message-id.ts`; Outlook's SMTP/IMAP responses use standard
  RFC 5322 Message-IDs, so the existing shared normalization already applies
  without modification.
- **Full implementation completed** — schema migration
  (`20260808100000_microsoft_oauth.sql`, applied), token module with unit
  tests, OAuth routes, provider branches, mailbox UI, and `.env.example`
  documentation.
- **All checks passed**: `npm run typecheck`, `npm run lint`, `npm run
  build`, and the full test suite (433 tests).

Commit: `316856d`

### Engineering notes

- Zero modifications to `lib/email/send-worker.ts`.
- Zero modifications to `lib/email/reply-worker.ts`.
- Zero modifications to the analytics pipeline (`lib/analytics/`).
- Zero modifications to the campaign pipeline (`lib/campaigns/`).
- Outlook is implemented as a provider, not a second architecture — same
  `EmailProvider`/`ReplyProvider` interfaces, same factories, same workers.

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
