# Roadmap

This roadmap tracks feature areas for **outreach-ai**, an AI SDR platform.
Status is derived from the current codebase (`app/`, `lib/`, `supabase/migrations/`)
as of commit `0c15ba2`. See `CHANGELOG.md` for the commit-by-commit history.

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
  and warmup state machine.
- **Reply tracking** — inbound reply sync (`app/api/cron/sync-replies`).
- **Deliverability** — domain/mailbox health data model and settings route.
- **Analytics** — event model, metrics engine; campaign-level overview,
  timeline, trends, conversion funnel, sequence-step performance, mailbox
  intelligence insights, health score, and campaign comparison (Phase 2B
  and after); mailbox-level overview, timeline, trends, warmup analytics,
  deliverability analytics, and mailbox comparison (Phase 2C and after);
  domain-level analytics combining every mailbox linked to a domain, plus a
  domain health score weighing DNS verification alongside deliverability,
  bounce, and reply rate once a domain has real sending history.
- **Billing** — Stripe integration, webhook handler, plan gating.
- **Testing foundation** — Vitest, unit tests for scheduling, unsubscribe
  tokens, campaign metrics, and mailbox metrics.

## In progress / partially built

- **Deliverability** — data model, settings UI, and per-mailbox analytics
  exist; automated health checks/alerts are not yet wired up. The new
  reputation-provider seam (inbox placement, blacklist, spam testing,
  reputation score) is architecture only — every signal is `null` until a
  real provider is connected.
- **Warmup** — state machine, schema, and per-mailbox ramp/forecast
  analytics exist; scheduled warmup send automation and the stats
  -aggregation worker (`warmup_stats` has no writer yet) are not built, so
  historical warmup volume charts render an honest empty state today.
- **Analytics** — campaign-level, mailbox-level, and domain-level analytics
  shipped, along with campaign comparison and mailbox comparison views (the
  `compareCampaignMetrics`/`compareMailboxMetrics` seams both now have
  callers); org-level rollups across all three, and a domain comparison
  view, are not yet built.

## Not started

- **AI qualification / scoring** — no lead scoring or AI-driven
  qualification logic yet (`lib/ai/` does not exist).
- **AI-personalized outreach** — no AI-generated message content in the
  sending pipeline yet.
- **AI recommendations** — no recommendation engine for deliverability or
  warmup, mentioned as a placeholder in the Mailbox Analytics UI only.
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
