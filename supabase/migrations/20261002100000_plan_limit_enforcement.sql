-- Database-level enforcement of plan limits (pre-launch security audit H1).
--
-- Until now every plan limit was checked only in app code
-- (lib/billing/limits.ts, called from Server Functions). RLS lets a signed-in
-- user write their own leads/campaigns/mailboxes directly through PostgREST
-- with the public anon key + their own session, so those checks could be
-- skipped entirely. The monthly email cap was computed by counting 'sent'
-- email_events, which a user could delete — directly (email_events_delete_own)
-- or by deleting a campaign (email_events, campaign_leads and therefore
-- send_attempts all cascade from it). This migration:
--
-- 1. Adds public.email_send_usage, a per-user, per-UTC-month counter of
--    successful sends. It has no foreign key to anything a user can delete
--    and users can only read their own rows, so usage can no longer be
--    reset. It is incremented by a trigger on send_attempts becoming 'sent',
--    which record_send_success() does in the same transaction that inserts
--    the 'sent' email_events row the old count was based on.
-- 2. Mirrors plan resolution (lib/billing/resolve-plan.ts +
--    lib/billing/subscription-view.ts) and the mailbox/campaign/lead limits
--    (lib/billing/plans.ts) in private functions, and enforces them with
--    statement-level AFTER INSERT triggers on leads, campaigns and mailboxes.
-- 3. Drops email_events_delete_own: no app code path deletes email_events
--    (cascades and the service-role retention job don't need the policy).
--
-- The app's own checks stay as they are (they give the friendly error before
-- any write); these triggers are the security boundary behind them.

-- ---------------------------------------------------------------------------
-- Plan resolution
-- ---------------------------------------------------------------------------

-- Keep in sync with PLANS in lib/billing/plans.ts — lib/billing/plan-limit-
-- enforcement.test.ts fails if the rows between the markers drift from it.
-- Only the limits enforced here are mirrored; the monthly email cap is
-- enforced by the send worker against email_send_usage, and dailySends only
-- bounds configured campaign capacity.
create function private.plan_limit(p_plan_id text, p_resource text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_limits record;
begin
  -- lib/billing/resolve-plan.ts's INTERNAL_UNLIMITED_PLAN.
  if p_plan_id = 'internal_unlimited' then
    return null;
  end if;

  select * into v_limits
  from (values
    -- plan-limits:begin
    ('free', 1, 1, 200),
    ('starter', 3, 5, 500),
    ('growth', 9, 15, 3000),
    ('pro', 20, 40, 10000),
    ('scale', 50, 100, 50000)
    -- plan-limits:end
  ) as l (plan_id, mailboxes, campaigns, leads)
  where l.plan_id = p_plan_id;

  if not found then
    raise exception 'Unknown plan id %', p_plan_id;
  end if;

  -- A CASE statement (not expression): an unknown resource raises
  -- case_not_found instead of returning null, which would mean unlimited.
  case p_resource
    when 'mailboxes' then return v_limits.mailboxes;
    when 'campaigns' then return v_limits.campaigns;
    when 'leads' then return v_limits.leads;
  end case;
end;
$$;

-- The plan a user's limits come from: getPlanForOrganization() for the
-- organization the user belongs to. Mirrors it exactly for every case that
-- can grant access in production:
--   - the internal unlimited workspace (INTERNAL_UNLIMITED_ORGANIZATION_ID);
--   - a subscriptions_v2 row with a known provider, a granting status
--     (active/trialing/past_due), a paid internal_plan_id and now() before
--     current_period_end + ENTITLEMENT_PERIOD_GRACE_MS (72 hours);
--   - otherwise 'free'.
-- The legacy Stripe subscriptions table is not consulted: it only grants
-- when its stripe_price_id maps to a configured STRIPE_PRICE_* env var, and
-- production has none (Stripe is retired), so it can never grant there.
-- A user with several memberships gets the most generous of them, so this
-- can only be as strict as the app, never stricter.
create function private.effective_plan_id(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.plan_id
      from (
        select case
          when m.organization_id = '7ef89392-80ba-4447-a7b7-ba642ff00a53'::uuid then 'internal_unlimited'
          when s.provider in ('stripe', 'razorpay', 'paypal')
            and s.normalized_status in ('active', 'trialing', 'past_due')
            and s.internal_plan_id in ('starter', 'growth', 'pro', 'scale')
            and s.current_period_end is not null
            and now() < s.current_period_end + interval '72 hours'
            then s.internal_plan_id
          else 'free'
        end as plan_id
        from public.organization_members m
        left join public.subscriptions_v2 s on s.organization_id = m.organization_id
        where m.user_id = p_user_id
      ) p
      order by array_position(array['free', 'starter', 'growth', 'pro', 'scale', 'internal_unlimited'], p.plan_id) desc
      limit 1
    ),
    'free'
  );
$$;

revoke all on function private.plan_limit(text, text) from public, anon, authenticated, service_role;
revoke all on function private.effective_plan_id(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mailbox / campaign / lead limits
-- ---------------------------------------------------------------------------

-- Statement-level, so a bulk insert (CSV import) is checked once per owner
-- rather than once per row, and the whole statement is rejected if it would
-- end over the limit. Race-safe: the per-owner, per-table advisory lock
-- serializes concurrent inserts for the same owner, and the count after it
-- runs on a fresh READ COMMITTED snapshot, so it sees every insert that
-- committed while this one waited. (PostgREST runs every request at READ
-- COMMITTED; API callers cannot choose another isolation level.)
--
-- Enforced for every request made with an end-user JWT (auth.uid() set).
-- Service-role and direct database sessions — the workers, migrations, test
-- fixtures — are trusted and exempt; none of them create these rows today.
create function private.enforce_plan_row_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_limit integer;
  v_count bigint;
begin
  if auth.uid() is null then
    return null;
  end if;

  for v_user_id in select distinct user_id from inserted_rows order by user_id loop
    perform pg_advisory_xact_lock(hashtextextended('plan_limit:' || tg_table_name || ':' || v_user_id::text, 0));

    v_limit := private.plan_limit(private.effective_plan_id(v_user_id), tg_table_name);
    continue when v_limit is null;

    execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
      into v_count
      using v_user_id;

    if v_count > v_limit then
      raise exception 'Plan limit reached: your plan allows up to % %. Upgrade to add more.', v_limit, tg_table_name
        using errcode = 'P0001', detail = 'plan_limit_exceeded';
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function private.enforce_plan_row_limit() from public, anon, authenticated, service_role;

create trigger leads_enforce_plan_limit
  after insert on public.leads
  referencing new table as inserted_rows
  for each statement execute function private.enforce_plan_row_limit();

create trigger campaigns_enforce_plan_limit
  after insert on public.campaigns
  referencing new table as inserted_rows
  for each statement execute function private.enforce_plan_row_limit();

create trigger mailboxes_enforce_plan_limit
  after insert on public.mailboxes
  referencing new table as inserted_rows
  for each statement execute function private.enforce_plan_row_limit();

-- ---------------------------------------------------------------------------
-- Monthly email usage
-- ---------------------------------------------------------------------------

create table public.email_send_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  sent_count integer not null default 0 check (sent_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_send_usage_user_month_key unique (user_id, month),
  constraint email_send_usage_month_start_check check (month = date_trunc('month', month)::date)
);

comment on table public.email_send_usage is
  'Successful campaign sends per user per UTC calendar month. Written only by a trigger on send_attempts; the plan''s monthly email cap is checked against it.';

create trigger email_send_usage_set_updated_at
  before update on public.email_send_usage
  for each row execute function public.set_updated_at();

alter table public.email_send_usage enable row level security;

create policy email_send_usage_select_own on public.email_send_usage
  for select using (auth.uid() = user_id);

-- Explicit grants, same pattern as lead_segments/email_replies (hosted and
-- local default privileges differ). Users may only read; there is no
-- insert/update/delete policy and no write privilege either, so usage can't
-- be changed through the API even if a permissive policy were ever added by
-- mistake. The service role (send worker) only reads it too: the counter is
-- written solely by the SECURITY DEFINER trigger below.
revoke all on table public.email_send_usage from anon, authenticated, service_role;
grant select on table public.email_send_usage to authenticated, service_role;

-- send_attempts becomes 'sent' exactly once per delivered email, inside
-- record_send_success(). The campaign owner is the user whose quota is used
-- — the same owner the old email_events count was scoped to. SECURITY
-- DEFINER because the counter isn't writable by the calling role.
create function private.record_email_send_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if new.status <> 'sent' or (tg_op = 'UPDATE' and old.status = 'sent') then
    return null;
  end if;

  select c.user_id into v_user_id
  from public.campaign_leads cl
  join public.campaigns c on c.id = cl.campaign_id
  where cl.id = new.campaign_lead_id;

  if v_user_id is null then
    return null;
  end if;

  insert into public.email_send_usage (user_id, month, sent_count)
  values (v_user_id, date_trunc('month', now() at time zone 'utc')::date, 1)
  on conflict (user_id, month) do update
    set sent_count = public.email_send_usage.sent_count + 1;

  return null;
end;
$$;

revoke all on function private.record_email_send_usage() from public, anon, authenticated, service_role;

create trigger send_attempts_record_email_send_usage
  after insert or update of status on public.send_attempts
  for each row execute function private.record_email_send_usage();

-- Backfill the current month from the count the app used until now, so the
-- switch-over neither resets nor double-counts anyone's usage. Runs after the
-- trigger exists: creating it locked send_attempts against concurrent
-- record_send_success() calls, which update send_attempts before inserting
-- their email_events row, so every send lands in exactly one of the two.
insert into public.email_send_usage (user_id, month, sent_count)
select c.user_id, date_trunc('month', now() at time zone 'utc')::date, count(*)
from public.email_events e
join public.campaigns c on c.id = e.campaign_id
where e.event_type = 'sent'
  and e.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
group by c.user_id;

-- ---------------------------------------------------------------------------
-- email_events: no direct deletes by users
-- ---------------------------------------------------------------------------

drop policy email_events_delete_own on public.email_events;
