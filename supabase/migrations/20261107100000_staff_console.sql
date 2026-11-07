-- Staff console: owner / security / sales staff, the verified-lead pool and
-- its monthly allocation to paying customers, and the security data the
-- security panel reads.
--
-- Access model. None of these tables has an RLS policy that lets a customer
-- read or write them. Staff pages and actions read and write them through the
-- service-role client after lib/staff/auth.ts's requireStaff() has checked
-- the caller's staff role and 2-step login (aal2) itself; the only policy
-- here lets a signed-in staff member read their OWN staff_members row.
--
-- Verified leads are not downloadable by customers. A customer's copy of a
-- delivered lead (a public.leads row) holds a non-routable placeholder
-- address and a masked display address; the real address lives only in
-- verified_leads, which customers cannot read. The send pipeline resolves it
-- server-side (lib/verified-leads/contact.ts and the SQL changes at the end
-- of this file).

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null
    constraint staff_members_role_check check (role in ('owner', 'security', 'sales')),
  display_name text not null
    constraint staff_members_display_name_length check (char_length(display_name) between 1 and 120),
  status text not null default 'invited'
    constraint staff_members_status_check check (status in ('invited', 'active', 'disabled')),
  created_by uuid references auth.users (id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_members_user_id_key unique (user_id)
);

comment on table public.staff_members is 'Polimatiq staff (owner/security/sales). Created only by owner/security through the staff console or scripts/create-owner.mts — never by public sign-up.';

alter table public.staff_members enable row level security;

create trigger staff_members_set_updated_at
  before update on public.staff_members
  for each row execute function public.set_updated_at();

-- Append-only, hash-chained record of every staff action. No policy lets
-- anyone (including staff) read or write it through the API; the triggers
-- below reject UPDATE, DELETE and TRUNCATE for every role, so not even the
-- owner can rewrite history from the app. Each row's hash covers the
-- previous row's hash, so removing or editing a row (e.g. with direct
-- database access) breaks the chain detectably.
create table public.staff_audit_log (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  -- No foreign key: the record must outlive the staff account (an FK with
  -- "on delete set null" would UPDATE these rows, which the append-only
  -- trigger rejects, and block deleting the user).
  actor_user_id uuid,
  actor_role text,
  action text not null
    constraint staff_audit_log_action_length check (char_length(action) between 1 and 80),
  target_type text,
  target_id text,
  ip text,
  metadata jsonb not null default '{}'::jsonb,
  prev_hash text not null default '',
  hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_audit_log_seq_key unique (seq)
);

comment on table public.staff_audit_log is 'Append-only, hash-chained staff action log (lib/staff/audit.ts is the only writer). UPDATE/DELETE/TRUNCATE are rejected by trigger.';

create index staff_audit_log_created_at_idx on public.staff_audit_log (created_at desc);
create index staff_audit_log_actor_idx on public.staff_audit_log (actor_user_id, created_at desc);

alter table public.staff_audit_log enable row level security;

-- timezone is pinned so created_at::text renders identically here and in
-- staff_verify_audit_chain(), whatever the writing session's setting.
create function private.staff_audit_log_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_prev text;
begin
  -- Serialize writers so two concurrent inserts can't both chain off the
  -- same previous row.
  perform pg_advisory_xact_lock(hashtextextended('staff_audit_log_chain', 0));
  select a.hash into v_prev from public.staff_audit_log a order by a.seq desc limit 1;
  new.prev_hash := coalesce(v_prev, '');
  new.hash := encode(
    extensions.digest(
      new.prev_hash || '|' || new.seq::text || '|' || coalesce(new.actor_user_id::text, '') || '|' ||
      coalesce(new.actor_role, '') || '|' || new.action || '|' || coalesce(new.target_type, '') || '|' ||
      coalesce(new.target_id, '') || '|' || coalesce(new.ip, '') || '|' || new.metadata::text || '|' ||
      new.created_at::text,
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create function private.staff_audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'staff_audit_log is append-only';
end;
$$;

revoke all on function private.staff_audit_log_chain() from public, anon, authenticated, service_role;
revoke all on function private.staff_audit_log_immutable() from public, anon, authenticated, service_role;

create trigger staff_audit_log_chain
  before insert on public.staff_audit_log
  for each row execute function private.staff_audit_log_chain();

create trigger staff_audit_log_no_update
  before update or delete on public.staff_audit_log
  for each row execute function private.staff_audit_log_immutable();

create trigger staff_audit_log_no_truncate
  before truncate on public.staff_audit_log
  for each statement execute function private.staff_audit_log_immutable();

-- Recomputes every row's hash and checks each links to the row before it.
-- Returns how many rows were checked and the first seq that doesn't verify
-- (null when the whole chain is intact). Security panel, service role only.
create function public.staff_verify_audit_chain()
returns table (checked bigint, first_broken_seq bigint)
language sql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
  with ordered as (
    select
      a.seq,
      a.prev_hash,
      a.hash,
      coalesce(lag(a.hash) over (order by a.seq), '') as expected_prev,
      encode(
        extensions.digest(
          a.prev_hash || '|' || a.seq::text || '|' || coalesce(a.actor_user_id::text, '') || '|' ||
          coalesce(a.actor_role, '') || '|' || a.action || '|' || coalesce(a.target_type, '') || '|' ||
          coalesce(a.target_id, '') || '|' || coalesce(a.ip, '') || '|' || a.metadata::text || '|' ||
          a.created_at::text,
          'sha256'
        ),
        'hex'
      ) as recomputed
    from public.staff_audit_log a
  )
  select
    count(*)::bigint,
    min(o.seq) filter (where o.hash <> o.recomputed or o.prev_hash <> o.expected_prev)
  from ordered o;
$$;

revoke execute on function public.staff_verify_audit_chain() from public, anon, authenticated;
grant execute on function public.staff_verify_audit_chain() to service_role;

-- ---------------------------------------------------------------------------
-- Security data
-- ---------------------------------------------------------------------------

-- Requests from these addresses are refused by proxy.ts (cached ~60 s).
create table public.ip_blocklist (
  id uuid primary key default gen_random_uuid(),
  cidr inet not null,
  reason text not null
    constraint ip_blocklist_reason_length check (char_length(reason) between 1 and 500),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ip_blocklist_cidr_key unique (cidr)
);

comment on table public.ip_blocklist is 'IP addresses/ranges blocked from the app by the security team (enforced in proxy.ts).';

alter table public.ip_blocklist enable row level security;

create trigger ip_blocklist_set_updated_at
  before update on public.ip_blocklist
  for each row execute function public.set_updated_at();

-- Sign-in outcomes recorded by lib/actions/auth.ts's signIn (successes by
-- user id; failures only by a SHA-256 of the address tried, never the raw
-- email). Feeds the security panel's sign-in map and alerts. Kept 90 days
-- (lib/monitoring/retention-worker.ts).
create table public.auth_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null
    constraint auth_events_event_type_check
    check (event_type in ('sign_in_success', 'sign_in_failure', 'sign_in_rate_limited')),
  user_id uuid references auth.users (id) on delete set null,
  email_hash text,
  ip text,
  country text
    constraint auth_events_country_length check (country is null or char_length(country) = 2),
  user_agent text
    constraint auth_events_user_agent_length check (user_agent is null or char_length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.auth_events is 'Sign-in successes/failures for the security panel. Failures carry only a hash of the email tried. Retained 90 days.';

create index auth_events_created_at_idx on public.auth_events (created_at desc);
create index auth_events_ip_created_at_idx on public.auth_events (ip, created_at desc);
create index auth_events_user_created_at_idx on public.auth_events (user_id, created_at desc);

alter table public.auth_events enable row level security;

create trigger auth_events_set_updated_at
  before update on public.auth_events
  for each row execute function public.set_updated_at();

-- Compliance checklist the security/owner panels track.
create table public.grc_controls (
  id uuid primary key default gen_random_uuid(),
  control_key text not null
    constraint grc_controls_key_format check (control_key ~ '^[a-z0-9_]{2,60}$'),
  framework text not null,
  title text not null,
  description text not null default '',
  status text not null default 'not_started'
    constraint grc_controls_status_check check (status in ('not_started', 'in_progress', 'done', 'not_applicable')),
  notes text not null default ''
    constraint grc_controls_notes_length check (char_length(notes) <= 2000),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grc_controls_control_key_key unique (control_key)
);

alter table public.grc_controls enable row level security;

create trigger grc_controls_set_updated_at
  before update on public.grc_controls
  for each row execute function public.set_updated_at();

insert into public.grc_controls (control_key, framework, title, description) values
  ('gdpr_dpa', 'GDPR', 'Data Processing Agreement published', 'Art. 28 DPA customers can sign, covering lead data Polimatiq processes for them.'),
  ('gdpr_subprocessors', 'GDPR', 'Sub-processor list published', 'Supabase, Hostinger, Google, Microsoft, AI and verification providers, with locations.'),
  ('gdpr_transfers', 'GDPR', 'International transfer basis documented', 'Hosting regions named; SCCs or the EU-US Data Privacy Framework for transfers outside the EEA.'),
  ('gdpr_art14_verified_leads', 'GDPR', 'Art. 14 notice for verified leads', 'People in the verified-lead pool are told where their data came from (privacy notice + email footer line).'),
  ('gdpr_lia_verified_leads', 'GDPR', 'Legitimate interest assessment for the verified-lead pool', 'Documented balancing test for collecting and sharing B2B contact data.'),
  ('gdpr_breach_runbook', 'GDPR', 'Breach notification runbook (72 h)', 'docs/security-operations.md section 6.6, with named contacts.'),
  ('canspam_postal_address', 'CAN-SPAM / CASL', 'Sender postal address in every email', 'A required sender address setting appended to the compliance footer.'),
  ('tracking_opt_out', 'ePrivacy', 'Per-campaign open/click tracking switch', 'Lets customers disable tracking pixels for EU recipients.'),
  ('staff_mfa', 'Access control', '2-step login for all staff', 'Enforced by the staff console (aal2).'),
  ('staff_access_review', 'Access control', 'Quarterly staff access review', 'Owner/security review who has which staff role and disable stale accounts.'),
  ('secrets_rotation', 'Security operations', 'Secret rotation drill', 'Rotate the rotatable platform secrets on a schedule (see docs/security-operations.md).'),
  ('backups_restore_test', 'Security operations', 'Backup restore tested', 'Restore a database backup into a scratch project and verify it.'),
  ('siem_wazuh', 'Security operations', 'SIEM (Wazuh) on a separate server', 'Second Hostinger VPS with the Wazuh manager; agent on the app server.'),
  ('crowdsec', 'Security operations', 'CrowdSec IP blocking on the app server', 'Automatic blocking of scanners and brute-force sources at the firewall.'),
  ('dependency_audit', 'Security operations', 'Dependency audit in CI', 'npm audit / Dependabot on the repository.');

-- ---------------------------------------------------------------------------
-- Verified-lead pool
-- ---------------------------------------------------------------------------

create table public.verified_lead_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references auth.users (id) on delete set null,
  file_name text not null
    constraint verified_lead_batches_file_name_length check (char_length(file_name) between 1 and 255),
  source text not null,
  row_count integer not null default 0 constraint verified_lead_batches_row_count_check check (row_count >= 0),
  inserted_count integer not null default 0 constraint verified_lead_batches_inserted_check check (inserted_count >= 0),
  duplicate_count integer not null default 0 constraint verified_lead_batches_duplicate_check check (duplicate_count >= 0),
  rejected_count integer not null default 0 constraint verified_lead_batches_rejected_check check (rejected_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.verified_lead_batches enable row level security;

create trigger verified_lead_batches_set_updated_at
  before update on public.verified_lead_batches
  for each row execute function public.set_updated_at();

create table public.verified_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null
    constraint verified_leads_email_lowercase check (email = lower(email) and email like '%_@_%.__%'),
  first_name text,
  last_name text,
  company text,
  title text,
  website text,
  linkedin text,
  phone text,
  city text,
  country text,
  industry text,
  custom_fields jsonb not null default '{}'::jsonb,
  -- Provenance: required, so every delivered lead can answer "where did
  -- you get my details?" (GDPR Art. 14).
  source text not null
    constraint verified_leads_source_length check (char_length(source) between 1 and 200),
  verified_at timestamptz not null,
  verification_result text not null default 'valid'
    constraint verified_leads_verification_result_check check (verification_result in ('valid', 'catch_all', 'risky')),
  status text not null default 'active'
    constraint verified_leads_status_check check (status in ('active', 'retired', 'suppressed')),
  suppressed_at timestamptz,
  suppressed_reason text,
  times_delivered integer not null default 0
    constraint verified_leads_times_delivered_check check (times_delivered >= 0),
  last_delivered_at timestamptz,
  batch_id uuid references public.verified_lead_batches (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verified_leads_email_key unique (email)
);

comment on table public.verified_leads is 'Polimatiq-verified B2B leads (staff-only). Customers never read this table; they get masked copies in public.leads.';

create index verified_leads_allocation_idx on public.verified_leads (status, times_delivered, last_delivered_at);
create index verified_leads_batch_id_idx on public.verified_leads (batch_id);

alter table public.verified_leads enable row level security;

create trigger verified_leads_set_updated_at
  before update on public.verified_leads
  for each row execute function public.set_updated_at();

-- Verified-lead quota per plan, editable by the owner only (enforced in the
-- owner panel's Server Function; no API role can write it).
create table public.plan_lead_quotas (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null
    constraint plan_lead_quotas_plan_id_check check (plan_id in ('free', 'starter', 'growth', 'pro', 'scale')),
  leads_per_month integer not null
    constraint plan_lead_quotas_leads_per_month_check check (leads_per_month between 0 and 100000),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_lead_quotas_plan_id_key unique (plan_id)
);

alter table public.plan_lead_quotas enable row level security;

create trigger plan_lead_quotas_set_updated_at
  before update on public.plan_lead_quotas
  for each row execute function public.set_updated_at();

insert into public.plan_lead_quotas (plan_id, leads_per_month) values
  ('free', 0), ('starter', 100), ('growth', 300), ('pro', 1000), ('scale', 3000);

-- One row per organization per monthly period, written when that period's
-- allocation completes — makes the allocation job idempotent.
create table public.verified_lead_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period text not null
    constraint verified_lead_allocations_period_format check (period ~ '^\d{4}-\d{2}$'),
  plan_id text not null,
  quota integer not null constraint verified_lead_allocations_quota_check check (quota >= 0),
  delivered_count integer not null default 0 constraint verified_lead_allocations_delivered_check check (delivered_count >= 0),
  lead_list_id uuid references public.lead_lists (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verified_lead_allocations_org_period_key unique (organization_id, period)
);

create index verified_lead_allocations_period_idx on public.verified_lead_allocations (period);

alter table public.verified_lead_allocations enable row level security;

-- Customers may see their own allocation summary (count, period) — never
-- which pool leads it contains.
create policy verified_lead_allocations_select_member on public.verified_lead_allocations
  for select using (public.is_organization_member(organization_id));

create trigger verified_lead_allocations_set_updated_at
  before update on public.verified_lead_allocations
  for each row execute function public.set_updated_at();

create table public.verified_lead_deliveries (
  id uuid primary key default gen_random_uuid(),
  verified_lead_id uuid not null references public.verified_leads (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  period text not null,
  delivered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Never the same verified lead to the same customer twice.
  constraint verified_lead_deliveries_lead_org_key unique (verified_lead_id, organization_id)
);

create index verified_lead_deliveries_org_period_idx on public.verified_lead_deliveries (organization_id, period);
create index verified_lead_deliveries_lead_id_idx on public.verified_lead_deliveries (lead_id);

alter table public.verified_lead_deliveries enable row level security;

create trigger verified_lead_deliveries_set_updated_at
  before update on public.verified_lead_deliveries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Table privileges, stated explicitly (same pattern as lead_segments and
-- email_replies): hosted projects grant ALL on new public tables to the API
-- roles — including TRUNCATE, which RLS does not apply to — while newer
-- local images grant none, not even to service_role. Customers (anon,
-- authenticated) get nothing except reading their own allocation summary
-- (RLS: verified_lead_allocations_select_member). Everything else is the
-- service role only: the staff console, the allocation worker, sign-in
-- logging and the proxy's IP blocklist.
-- ---------------------------------------------------------------------------

revoke all on table
  public.staff_members, public.staff_audit_log, public.ip_blocklist, public.auth_events,
  public.grc_controls, public.verified_lead_batches, public.verified_leads, public.plan_lead_quotas,
  public.verified_lead_allocations, public.verified_lead_deliveries
from anon, authenticated, service_role;

grant select on table public.verified_lead_allocations to authenticated;

grant select, insert, update, delete on table
  public.staff_members, public.ip_blocklist, public.auth_events, public.grc_controls,
  public.verified_lead_batches, public.verified_leads, public.plan_lead_quotas,
  public.verified_lead_allocations, public.verified_lead_deliveries
to service_role;

-- Append-only: the app only ever inserts and reads.
grant select, insert on table public.staff_audit_log to service_role;

-- ---------------------------------------------------------------------------
-- Customer copies of delivered leads
-- ---------------------------------------------------------------------------

alter table public.leads
  add column verified_lead_id uuid references public.verified_leads (id) on delete restrict,
  add column display_email text
    constraint leads_display_email_length check (display_email is null or char_length(display_email) <= 320);

comment on column public.leads.verified_lead_id is 'Set only for leads delivered from the Polimatiq verified pool (by the allocation worker, service role). email then holds a non-routable placeholder; the real address is resolved server-side at send time.';
comment on column public.leads.display_email is 'Masked address shown to the customer for a verified lead, e.g. j••••@acme.com.';

create index leads_verified_lead_id_idx on public.leads (verified_lead_id) where verified_lead_id is not null;

-- Customers can never create or alter the link to the verified pool, nor
-- the placeholder/masked address of a delivered lead: otherwise a customer
-- who learned a verified_leads id could point a lead at it and have the send
-- pipeline mail the real address. Only the service role (the allocation
-- worker) and direct database sessions may.
create function private.leads_guard_verified_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and (new.verified_lead_id is not null or new.display_email is not null) then
      raise exception 'verified lead columns are managed by Polimatiq' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (
      new.verified_lead_id is distinct from old.verified_lead_id
      or new.display_email is distinct from old.display_email
      or (old.verified_lead_id is not null and new.email is distinct from old.email)
    ) then
      raise exception 'verified lead columns are managed by Polimatiq' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.leads_guard_verified_columns() from public, anon, authenticated, service_role;

create trigger leads_guard_verified_columns
  before insert or update on public.leads
  for each row execute function private.leads_guard_verified_columns();

-- An unsubscribe or bounce of a verified lead's REAL address, through any
-- customer, pulls it from the pool for everyone (and claimable_due_sends
-- below stops every pending send to it). A customer's own 'manual'
-- suppression only affects that customer.
create function private.verified_leads_apply_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reason in ('unsubscribed', 'bounced') then
    update public.verified_leads
    set status = 'suppressed', suppressed_at = now(), suppressed_reason = new.reason
    where email = lower(new.email) and status <> 'suppressed';
  end if;
  return null;
end;
$$;

revoke all on function private.verified_leads_apply_suppression() from public, anon, authenticated, service_role;

create trigger suppressions_apply_to_verified_leads
  after insert on public.suppressions
  for each row execute function private.verified_leads_apply_suppression();

-- ---------------------------------------------------------------------------
-- Staff helper: end every session of a user (security panel "sign out
-- everywhere"). Deleting auth.sessions also revokes their refresh tokens
-- (auth.refresh_tokens.session_id cascades), so the user's current access
-- token stops refreshing within its lifetime (jwt_expiry). Service role only.
-- ---------------------------------------------------------------------------

create function public.staff_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.staff_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.staff_revoke_user_sessions(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Send pipeline: read a verified lead's real address. Each body below is
-- copied verbatim from its latest migration with only the address lookup
-- changed (coalesce(vl.email, l.email)); signatures are unchanged, so grants
-- carry over and are restated where the original stated them.
-- ---------------------------------------------------------------------------

create or replace function public.claimable_due_sends(p_mailbox_ids uuid[] default null)
returns table (id uuid, mailbox_id uuid, campaign_id uuid, next_send_at timestamptz, campaign_capacity bigint)
language sql
stable
as $$
  with due as (
    select cl.id, cl.mailbox_id, cl.campaign_id, cl.next_send_at, cl.lead_id, c.user_id, c.daily_limit
    from public.campaign_leads cl
    join public.campaigns c on c.id = cl.campaign_id
    join public.mailboxes m on m.id = cl.mailbox_id
    where (p_mailbox_ids is null or cl.mailbox_id = any (p_mailbox_ids))
      and cl.status = 'active'
      and cl.next_send_at is not null and cl.next_send_at <= now()
      and (cl.locked_until is null or cl.locked_until < now())
      and c.status = 'active'
      and cl.mailbox_id is not null and m.status = 'active'
  ),
  mailbox_usage as (
    select
      m.id as mailbox_id,
      m.daily_limit,
      m.hourly_limit,
      today.c as sent_today,
      this_hour.c as sent_this_hour,
      last_sent.created_at as last_sent_at,
      m.cooldown_minutes * 60.0 as min_gap_seconds
    from public.mailboxes m
    cross join lateral (
      select count(*) as c from public.email_events e
      where e.mailbox_id = m.id and e.event_type = 'sent' and e.created_at >= date_trunc('day', now())
    ) today
    cross join lateral (
      select count(*) as c from public.email_events e
      where e.mailbox_id = m.id and e.event_type = 'sent' and e.created_at >= now() - interval '1 hour'
    ) this_hour
    left join lateral (
      select e.created_at from public.email_events e
      where e.mailbox_id = m.id and e.event_type = 'sent'
      order by e.created_at desc
      limit 1
    ) last_sent on true
    where m.id in (select d.mailbox_id from due d)
  ),
  campaign_usage as (
    select
      c.id as campaign_id,
      today.c as sent_today,
      in_flight.c as in_flight
    from public.campaigns c
    cross join lateral (
      select count(*) as c from public.email_events e
      where e.campaign_id = c.id and e.event_type = 'sent' and e.created_at >= date_trunc('day', now())
    ) today
    cross join lateral (
      select count(*) as c from public.campaign_leads f
      where f.campaign_id = c.id and f.locked_until >= now()
    ) in_flight
    where c.id in (select d.campaign_id from due d)
  )
  select
    d.id,
    d.mailbox_id,
    d.campaign_id,
    d.next_send_at,
    d.daily_limit - cu.sent_today - cu.in_flight as campaign_capacity
  from due d
  join mailbox_usage mu on mu.mailbox_id = d.mailbox_id
  join campaign_usage cu on cu.campaign_id = d.campaign_id
  where mu.sent_today < mu.daily_limit
    and mu.sent_this_hour < mu.hourly_limit
    and (
      mu.min_gap_seconds = 0
      or mu.last_sent_at is null
      or mu.last_sent_at <= now() - make_interval(
        secs => mu.min_gap_seconds
          * (1 + 0.5 * (abs(hashtext(d.mailbox_id::text || mu.last_sent_at::text)::bigint) % 1000) / 1000.0)
      )
    )
    and d.daily_limit - cu.sent_today - cu.in_flight > 0
    and not exists (
      select 1 from public.campaign_leads f
      where f.mailbox_id = d.mailbox_id and f.locked_until >= now()
    )
    and not exists (
      select 1 from public.suppressions s
      join public.leads l on l.id = d.lead_id
      left join public.verified_leads vl on vl.id = l.verified_lead_id
      where s.user_id = d.user_id and s.email = coalesce(vl.email, l.email)
    )
    -- A verified lead that opted out or bounced through ANY customer is out
    -- of everyone's sends (see verified_leads.status).
    and not exists (
      select 1 from public.leads l
      join public.verified_leads vl on vl.id = l.verified_lead_id
      where l.id = d.lead_id and vl.status = 'suppressed'
    )
$$;

create or replace function public.record_send_failure(
  p_send_attempt_id uuid,
  p_campaign_lead_id uuid,
  p_campaign_id uuid,
  p_lead_id uuid,
  p_mailbox_id uuid,
  p_error_message text,
  p_outcome text, -- 'retry' | 'failed' | 'bounced'
  p_next_send_at timestamptz default null
)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  if p_outcome not in ('retry', 'failed', 'bounced') then
    raise exception 'record_send_failure: invalid p_outcome %', p_outcome;
  end if;

  update public.send_attempts
  set status = 'failed', last_error = left(p_error_message, 1000)
  where id = p_send_attempt_id;

  update public.campaign_leads
  set status = case p_outcome when 'retry' then 'active' else p_outcome end,
      next_send_at = case when p_outcome = 'retry' then p_next_send_at else null end,
      last_error = left(p_error_message, 1000),
      locked_until = null
  where id = p_campaign_lead_id
    and status = 'active';

  if not found then
    update public.campaign_leads
    set locked_until = null
    where id = p_campaign_lead_id;
  end if;

  if p_outcome = 'bounced' then
    insert into public.email_events (campaign_id, lead_id, mailbox_id, event_type, metadata)
    values (p_campaign_id, p_lead_id, p_mailbox_id, 'bounced', jsonb_build_object('error', p_error_message));

    select c.user_id into v_user_id from public.campaigns c where c.id = p_campaign_id;

    insert into public.suppressions (user_id, email, reason, source_campaign_id)
    select v_user_id, coalesce(vl.email, l.email), 'bounced', p_campaign_id
    from public.leads l
    left join public.verified_leads vl on vl.id = l.verified_lead_id
    where l.id = p_lead_id
    on conflict (user_id, email) do nothing;
  end if;
end;
$$;

create or replace function private.enforce_plan_row_limit()
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

    -- Verified leads delivered by Polimatiq are an included benefit, not
    -- part of the customer's own lead allowance.
    execute format(
      'select count(*) from public.%I where user_id = $1' || case when tg_table_name = 'leads' then ' and verified_lead_id is null' else '' end,
      tg_table_name
    )
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

revoke execute on function public.claimable_due_sends(uuid[]) from public, anon, authenticated;
grant execute on function public.claimable_due_sends(uuid[]) to service_role;
revoke all on function private.enforce_plan_row_limit() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Monthly verified-lead allocation (lib/verified-leads/allocation.ts calls
-- this once per paying organization per day). Atomic and idempotent per
-- (organization, period): a second call in the same period delivers nothing,
-- unless the quota grew (an upgrade), in which case it tops up the
-- difference. Eligible leads, in order of fewest deliveries, then longest
-- since last delivered, then most recently verified:
--   * status 'active', verified within p_max_age_days;
--   * delivered to fewer than p_max_shares customers, never to this one;
--   * not delivered to anyone in the last p_min_gap_days;
--   * not suppressed by this customer and not already one of their leads.
-- Rows are locked (skip locked) so concurrent runs never over-share a lead.
-- Service role only.
-- ---------------------------------------------------------------------------

create function public.allocate_verified_leads(
  p_organization_id uuid,
  p_user_id uuid,
  p_period text,
  p_plan_id text,
  p_quota integer,
  p_max_shares integer default 3,
  p_min_gap_days integer default 30,
  p_max_age_days integer default 180
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation public.verified_lead_allocations%rowtype;
  v_needed integer;
  v_list_id uuid;
  v_delivered integer := 0;
  v_lead record;
  v_new_lead_id uuid;
begin
  if p_quota < 0 or p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'allocate_verified_leads: invalid quota or period';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('verified_lead_allocation:' || p_organization_id::text, 0));

  select * into v_allocation from public.verified_lead_allocations
  where organization_id = p_organization_id and period = p_period;

  v_needed := p_quota - coalesce(v_allocation.delivered_count, 0);
  if v_needed <= 0 then
    if v_allocation.id is null then
      insert into public.verified_lead_allocations (organization_id, period, plan_id, quota, delivered_count)
      values (p_organization_id, p_period, p_plan_id, p_quota, 0);
    end if;
    return 0;
  end if;

  v_list_id := v_allocation.lead_list_id;
  if v_list_id is null then
    insert into public.lead_lists (user_id, name, description)
    values (p_user_id, 'Verified leads ' || p_period, 'Delivered by Polimatiq for ' || p_period || '. Addresses are masked and stay inside Polimatiq.')
    returning id into v_list_id;
  end if;

  for v_lead in
    select vl.*
    from public.verified_leads vl
    where vl.status = 'active'
      and vl.verified_at > now() - make_interval(days => p_max_age_days)
      and vl.times_delivered < p_max_shares
      and (vl.last_delivered_at is null or vl.last_delivered_at <= now() - make_interval(days => p_min_gap_days))
      and not exists (
        select 1 from public.verified_lead_deliveries d
        where d.verified_lead_id = vl.id and d.organization_id = p_organization_id
      )
      and not exists (
        select 1 from public.suppressions s
        where s.user_id = p_user_id and lower(s.email) = vl.email
      )
      and not exists (
        select 1 from public.leads l
        where l.user_id = p_user_id and lower(l.email) = vl.email
      )
    order by vl.times_delivered, vl.last_delivered_at nulls first, vl.verified_at desc
    limit v_needed
    for update of vl skip locked
  loop
    insert into public.leads (
      user_id, list_id, first_name, last_name, company, title, website, linkedin, phone, city, country,
      custom_fields, email, display_email, verified_lead_id, verification_status
    ) values (
      p_user_id, v_list_id, v_lead.first_name, v_lead.last_name, v_lead.company, v_lead.title, v_lead.website,
      v_lead.linkedin, v_lead.phone, v_lead.city, v_lead.country,
      v_lead.custom_fields || case when v_lead.industry is null then '{}'::jsonb else jsonb_build_object('industry', v_lead.industry) end,
      'verified+' || v_lead.id::text || '@leads.polimatiq.invalid',
      left(split_part(v_lead.email, '@', 1), 1) || '••••@' || split_part(v_lead.email, '@', 2),
      v_lead.id,
      case v_lead.verification_result when 'valid' then 'valid' when 'catch_all' then 'catch_all' else 'unknown' end
    )
    returning id into v_new_lead_id;

    insert into public.verified_lead_deliveries (verified_lead_id, organization_id, user_id, lead_id, period)
    values (v_lead.id, p_organization_id, p_user_id, v_new_lead_id, p_period);

    update public.verified_leads
    set times_delivered = times_delivered + 1, last_delivered_at = now()
    where id = v_lead.id;

    v_delivered := v_delivered + 1;
  end loop;

  -- Nothing eligible: don't leave a freshly created empty list behind.
  if v_delivered = 0 and v_allocation.lead_list_id is null then
    delete from public.lead_lists where id = v_list_id;
    v_list_id := null;
  end if;

  insert into public.verified_lead_allocations (organization_id, period, plan_id, quota, delivered_count, lead_list_id)
  values (p_organization_id, p_period, p_plan_id, p_quota, v_delivered, v_list_id)
  on conflict (organization_id, period) do update
    set quota = excluded.quota,
        plan_id = excluded.plan_id,
        delivered_count = public.verified_lead_allocations.delivered_count + v_delivered,
        lead_list_id = coalesce(public.verified_lead_allocations.lead_list_id, excluded.lead_list_id);

  return v_delivered;
end;
$$;

revoke execute on function public.allocate_verified_leads(uuid, uuid, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.allocate_verified_leads(uuid, uuid, text, text, integer, integer, integer, integer) to service_role;

-- job_runs records every cron run; its job list gains the new job (same
-- list as 20260826110000_job_runs_warmup_cycle.sql plus verified-leads).
alter table public.job_runs
  drop constraint job_runs_job_check;

alter table public.job_runs
  add constraint job_runs_job_check
  check (job in (
    'send-emails', 'sync-replies', 'verify-leads', 'deliverability-health-check',
    'integrations-digest', 'analytics-rollup', 'retention-cleanup', 'warmup-cycle',
    'verified-leads'
  ));

-- ---------------------------------------------------------------------------
-- Schedule: the verified-lead allocation runs daily at 03:20 UTC. A new
-- calendar month starts each customer's fresh allocation; daily runs pick up
-- customers who subscribed or upgraded mid-month (top-up). The dispatcher's
-- allowlist below is copied verbatim from
-- 20261008100000_monitoring_jobs_pg_cron.sql with the one new path added.
-- Like every other job it only fires once the Vault secrets exist.
-- ---------------------------------------------------------------------------

create or replace function private.invoke_cron_endpoint(p_path text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_app_url text;
  v_cron_secret text;
begin
  if p_path is null or p_path not in (
    '/api/cron/send-emails',
    '/api/cron/sync-replies',
    '/api/cron/warmup-cycle',
    '/api/cron/verify-leads',
    '/api/cron/deliverability-health-check',
    '/api/cron/analytics-rollup',
    '/api/cron/retention-cleanup',
    '/api/cron/integrations-digest',
    '/api/cron/verified-leads'
  ) then
    raise exception 'invoke_cron_endpoint: path % is not allowed', p_path
      using errcode = '42501';
  end if;

  select ds.decrypted_secret into v_app_url
  from vault.decrypted_secrets ds
  where ds.name = 'cron_app_url';

  select ds.decrypted_secret into v_cron_secret
  from vault.decrypted_secrets ds
  where ds.name = 'cron_secret';

  if v_app_url is null or v_cron_secret is null then
    raise notice 'invoke_cron_endpoint: Vault secrets cron_app_url/cron_secret not configured, skipping %', p_path;
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_app_url, '/') || p_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cron_secret,
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 240000
  );
end;
$$;

comment on function private.invoke_cron_endpoint(text) is 'pg_cron dispatcher: POSTs to an allowlisted app cron route (only /api/cron/send-emails, /api/cron/sync-replies, /api/cron/warmup-cycle, /api/cron/verify-leads, /api/cron/deliverability-health-check, /api/cron/analytics-rollup, /api/cron/retention-cleanup, /api/cron/integrations-digest and /api/cron/verified-leads) with the CRON_SECRET bearer token, both read from Vault. Returns the pg_net request id, or null when the Vault secrets are not configured.';

revoke all on function private.invoke_cron_endpoint(text) from public, anon, authenticated, service_role;

select cron.schedule(
  'verified-leads',
  '20 3 * * *',
  $$select private.invoke_cron_endpoint('/api/cron/verified-leads')$$
);
