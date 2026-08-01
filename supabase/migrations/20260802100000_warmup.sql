-- Mailbox Warmup Foundation: data model for the future warmup engine to
-- plug into. Purely additive — no existing table's ownership, RLS, or
-- column semantics changes; sending/reply-tracking/billing/deliverability
-- are untouched except where Deliverability's Mailbox Health explicitly
-- reads from warmup_profiles for display (see lib/db/warmup.ts and
-- app/(app)/settings/deliverability/actions.ts — read-only, no write path
-- back into these tables from deliverability code).
--
-- Organization-scoped (organization_id, not user_id) per this task's
-- explicit "Organization ownership" requirement — the first user-writable
-- table to use organization_id as its RLS boundary (billing's org-scoped
-- tables are webhook-only writes; see 20260731140000_billing.sql). Written
-- with is_organization_member(organization_id) throughout so multi-member
-- organizations (not supported yet — see 20260731110000_organizations.sql)
-- work without another RLS migration once they exist.
--
-- No real warmup network, provider integration, or scheduler execution
-- exists yet (see lib/warmup/provider.ts and lib/warmup/queue.ts) — these
-- tables only hold configuration/state (warmup_profiles), an append-only
-- audit log (warmup_events), and a place for a future stats-aggregation
-- worker to write daily numbers (warmup_stats, no client insert policy —
-- same "webhook/worker only" shape as billing_customers/subscriptions).

-- One row per mailbox: the on/off control (`status`) and the state
-- machine's current position (`stage`) are deliberately separate columns
-- — see lib/warmup/state-machine.ts. A profile can be 'enabled' while its
-- stage progresses starting -> warming -> healthy; disabling always drives
-- the stage back to 'disabled' regardless of where it was.
create table public.warmup_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  status text not null default 'disabled'
    constraint warmup_profiles_status_check check (status in ('enabled', 'paused', 'disabled')),
  stage text not null default 'disabled'
    constraint warmup_profiles_stage_check
    check (stage in ('disabled', 'starting', 'warming', 'healthy', 'cooling', 'paused')),
  target_daily_volume integer not null default 30
    constraint warmup_profiles_target_daily_volume_check check (target_daily_volume > 0),
  current_daily_volume integer not null default 0
    constraint warmup_profiles_current_daily_volume_check check (current_daily_volume >= 0),
  ramp_up_percent numeric(5, 2) not null default 20
    constraint warmup_profiles_ramp_up_percent_check check (ramp_up_percent > 0),
  health_score integer not null default 0
    constraint warmup_profiles_health_score_check check (health_score between 0 and 100),
  started_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warmup_profiles_mailbox_id_key unique (mailbox_id)
);

comment on table public.warmup_profiles is 'Warmup configuration and state machine position per mailbox. No row means warmup was never configured for that mailbox.';
comment on column public.warmup_profiles.status is 'User-facing on/off control (mirrors mailboxes.status''s shape). Distinct from stage, which is where the state machine currently sits.';
comment on column public.warmup_profiles.stage is 'State machine position — see lib/warmup/state-machine.ts for the transition graph.';
comment on column public.warmup_profiles.ramp_up_percent is 'Percentage current_daily_volume grows by at each scheduled increase — see lib/warmup/scheduler.ts.';
comment on column public.warmup_profiles.current_daily_volume is 'Always 0 until a real scheduler/sender exists — this foundation never sends warmup email, so nothing advances this column yet.';

create index warmup_profiles_organization_id_idx on public.warmup_profiles (organization_id);
create index warmup_profiles_stage_idx on public.warmup_profiles (stage);

alter table public.warmup_profiles enable row level security;

create policy warmup_profiles_select_member on public.warmup_profiles
  for select using (public.is_organization_member(organization_id));

create policy warmup_profiles_insert_member on public.warmup_profiles
  for insert with check (public.is_organization_member(organization_id));

create policy warmup_profiles_update_member on public.warmup_profiles
  for update using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create policy warmup_profiles_delete_member on public.warmup_profiles
  for delete using (public.is_organization_member(organization_id));

-- Defense in depth, same pattern as mailboxes_check_domain_owner
-- (20260728100030_mailboxes.sql): the mailbox must belong to a user who is
-- actually a member of organization_id, even though RLS already prevents a
-- caller from referencing an organization they don't belong to.
create or replace function public.check_warmup_profile_mailbox_org()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.mailboxes m
    join public.organization_members om on om.user_id = m.user_id
    where m.id = new.mailbox_id and om.organization_id = new.organization_id
  ) then
    raise exception 'warmup_profiles.mailbox_id must belong to a member of organization_id';
  end if;
  return new;
end;
$$;

create trigger warmup_profiles_check_mailbox_org
  before insert or update on public.warmup_profiles
  for each row execute function public.check_warmup_profile_mailbox_org();

create trigger warmup_profiles_set_updated_at
  before update on public.warmup_profiles
  for each row execute function public.set_updated_at();

-- Append-only audit log of what happened to a profile (status/stage
-- changes, future volume adjustments, warnings) — same "log, not mutable
-- state" shape as domain_dns_checks (20260801100000_deliverability.sql).
create table public.warmup_events (
  id uuid primary key default gen_random_uuid(),
  warmup_profile_id uuid not null references public.warmup_profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_type text not null
    constraint warmup_events_event_type_check
    check (event_type in ('status_changed', 'stage_changed', 'volume_adjusted', 'warning')),
  detail text,
  created_at timestamptz not null default now()
);

comment on table public.warmup_events is 'Append-only history of warmup profile changes (status/stage transitions, future volume adjustments and warnings).';

create index warmup_events_warmup_profile_id_created_at_idx
  on public.warmup_events (warmup_profile_id, created_at desc);

alter table public.warmup_events enable row level security;

create policy warmup_events_select_member on public.warmup_events
  for select using (public.is_organization_member(organization_id));

create policy warmup_events_insert_member on public.warmup_events
  for insert with check (public.is_organization_member(organization_id));

-- No update/delete policy: it's a log.

create or replace function public.check_warmup_event_profile_org()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.warmup_profiles p
    where p.id = new.warmup_profile_id and p.organization_id = new.organization_id
  ) then
    raise exception 'warmup_events.warmup_profile_id must belong to organization_id';
  end if;
  return new;
end;
$$;

create trigger warmup_events_check_profile_org
  before insert on public.warmup_events
  for each row execute function public.check_warmup_event_profile_org();

-- Daily stats per profile — architecture only (see this migration's header
-- comment). No insert/update/delete policy for the RLS-scoped client: the
-- only writer is a future stats-aggregation worker running as the service
-- role, same carve-out as billing_customers/subscriptions
-- (20260731140000_billing.sql). Select-only today means nothing in this
-- phase can populate fake numbers even by accident.
create table public.warmup_stats (
  id uuid primary key default gen_random_uuid(),
  warmup_profile_id uuid not null references public.warmup_profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  stat_date date not null,
  emails_sent integer not null default 0,
  emails_received integer not null default 0,
  reply_rate numeric(5, 2),
  bounce_rate numeric(5, 2),
  spam_rate numeric(5, 2),
  positive_interactions integer not null default 0,
  warmup_score integer
    constraint warmup_stats_warmup_score_check check (warmup_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warmup_stats_profile_date_key unique (warmup_profile_id, stat_date)
);

comment on table public.warmup_stats is 'Daily warmup statistics per profile (emails sent/received, reply/bounce/spam rate, warmup score). Written only by a future stats-aggregation worker — no rows exist yet.';

create index warmup_stats_warmup_profile_id_stat_date_idx
  on public.warmup_stats (warmup_profile_id, stat_date desc);

alter table public.warmup_stats enable row level security;

create policy warmup_stats_select_member on public.warmup_stats
  for select using (public.is_organization_member(organization_id));

create trigger warmup_stats_set_updated_at
  before update on public.warmup_stats
  for each row execute function public.set_updated_at();
