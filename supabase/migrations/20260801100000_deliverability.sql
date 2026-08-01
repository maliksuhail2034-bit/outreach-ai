-- Deliverability Foundation: infrastructure for domain/mailbox health
-- monitoring, ahead of warmup, inbox placement, and reputation features.
-- Purely additive — no existing table's ownership, RLS, or column
-- semantics changes; sending/reply-tracking/billing/organizations are
-- untouched.
--
-- Scoring itself is not a database concern (see lib/deliverability/scoring.ts)
-- — these tables only store the inputs (DNS check results, mailbox
-- reputation/bounce/reply data) and the last-computed score, the same way
-- billing's plan tiers live in a config module rather than a `plans` table
-- (20260731140000_billing.sql).

-- domains already tracks spf/dkim/dmarc_verified (20260728100020_domains.sql)
-- but has no MX check, no health score, and no record of when it was last
-- checked — all three needed for the Domain Health page.
alter table public.domains
  add column mx_verified boolean not null default false,
  add column health_score integer not null default 0
    constraint domains_health_score_check check (health_score between 0 and 100),
  add column last_checked_at timestamptz;

comment on column public.domains.mx_verified is 'Whether an MX record was found for this domain on the most recent check.';
comment on column public.domains.health_score is 'Placeholder deliverability score (0-100) — see lib/deliverability/scoring.ts. Recomputed whenever a DNS check runs.';
comment on column public.domains.last_checked_at is 'When the DNS verification engine last checked this domain. Null means never checked.';

-- Append-only log of individual DNS check runs (one row per record type per
-- check), independent of the domains.*_verified summary columns above,
-- which only hold the latest result. This is what a future check-history/
-- trend view or an AI deliverability advisor reads, and it's how a live DNS
-- provider (see lib/deliverability/dns-provider.ts) plugs in later: it
-- writes rows here exactly like the placeholder provider does today, no
-- schema change needed.
create table public.domain_dns_checks (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.domains (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  record_type text not null
    constraint domain_dns_checks_record_type_check check (record_type in ('spf', 'dkim', 'dmarc', 'mx')),
  status text not null default 'pending'
    constraint domain_dns_checks_status_check check (status in ('pending', 'pass', 'fail', 'error')),
  detail text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.domain_dns_checks is 'Append-only log of DNS verification checks (SPF/DKIM/DMARC/MX) per domain. domains.*_verified holds only the latest result; this table is the history.';

create index domain_dns_checks_domain_id_checked_at_idx
  on public.domain_dns_checks (domain_id, checked_at desc);

alter table public.domain_dns_checks enable row level security;

create policy domain_dns_checks_select_own on public.domain_dns_checks
  for select using (auth.uid() = user_id);

create policy domain_dns_checks_insert_own on public.domain_dns_checks
  for insert with check (auth.uid() = user_id);

-- No update/delete policy: it's a log, not mutable state — a fresh check
-- adds a new row instead of rewriting history.

-- Defense in depth, same pattern as mailboxes_check_domain_owner
-- (20260728100030_mailboxes.sql): a check's domain_id must belong to the
-- same user_id, even though RLS on both tables already prevents a user
-- from referencing a domain they can't see.
create or replace function public.check_domain_dns_check_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.domains d where d.id = new.domain_id and d.user_id = new.user_id
  ) then
    raise exception 'domain_dns_checks.domain_id must reference a domain owned by the same user';
  end if;
  return new;
end;
$$;

create trigger domain_dns_checks_check_owner
  before insert on public.domain_dns_checks
  for each row execute function public.check_domain_dns_check_owner();

-- One row per mailbox: the fields a future warmup/reputation system will
-- populate (Google Postmaster, Microsoft SNDS, bounce/reply data already
-- recorded elsewhere in email_events). Kept separate from mailboxes itself
-- — deliverability signals are a distinct concern from sending
-- configuration, and this keeps the sending engine's mailboxes reads/writes
-- (claim_due_sends, send-worker, etc.) completely untouched. No row for a
-- mailbox means its health hasn't been calculated yet, not zero/unhealthy.
create table public.mailbox_health (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reputation_score integer
    constraint mailbox_health_reputation_score_check check (reputation_score between 0 and 100),
  bounce_rate numeric(5, 2)
    constraint mailbox_health_bounce_rate_check check (bounce_rate between 0 and 100),
  reply_rate numeric(5, 2)
    constraint mailbox_health_reply_rate_check check (reply_rate between 0 and 100),
  warmup_status text not null default 'not_started'
    constraint mailbox_health_warmup_status_check check (warmup_status in ('not_started', 'warming', 'warmed', 'paused')),
  health_score integer not null default 0
    constraint mailbox_health_health_score_check check (health_score between 0 and 100),
  last_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailbox_health_mailbox_id_key unique (mailbox_id)
);

comment on table public.mailbox_health is 'Deliverability signals per mailbox (reputation, bounce/reply rate, warmup status) and the resulting placeholder health score — see lib/deliverability/scoring.ts. No row means health hasn''t been calculated yet.';

alter table public.mailbox_health enable row level security;

create policy mailbox_health_select_own on public.mailbox_health
  for select using (auth.uid() = user_id);

create policy mailbox_health_insert_own on public.mailbox_health
  for insert with check (auth.uid() = user_id);

create policy mailbox_health_update_own on public.mailbox_health
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy mailbox_health_delete_own on public.mailbox_health
  for delete using (auth.uid() = user_id);

-- Defense in depth, same pattern as check_domain_dns_check_owner above.
create or replace function public.check_mailbox_health_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.mailboxes m where m.id = new.mailbox_id and m.user_id = new.user_id
  ) then
    raise exception 'mailbox_health.mailbox_id must reference a mailbox owned by the same user';
  end if;
  return new;
end;
$$;

create trigger mailbox_health_check_owner
  before insert or update on public.mailbox_health
  for each row execute function public.check_mailbox_health_owner();

create trigger mailbox_health_set_updated_at
  before update on public.mailbox_health
  for each row execute function public.set_updated_at();
