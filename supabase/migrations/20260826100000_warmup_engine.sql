-- Mailbox Warmup Engine: the execution layer behind the pre-existing
-- warmup_profiles/warmup_events/warmup_stats data model
-- (20260802100000_warmup.sql). Until now nothing wrote current_daily_volume
-- or ran a cycle — see lib/warmup/warmup-worker.ts, the first real caller.
-- Purely additive: every existing column, RLS policy, and function on
-- warmup_profiles/warmup_events/warmup_stats keeps its exact current
-- behavior; nothing in send-worker.ts/claim_due_sends()/reply-worker.ts is
-- touched by anything in this migration.
--
-- Scoped to the owner's own organization at the TypeScript call site (see
-- lib/warmup/owner-scope.ts), mirroring lib/billing/resolve-plan.ts's
-- INTERNAL_UNLIMITED_ORGANIZATION_ID precedent — this migration itself
-- stays fully generic/multi-tenant, same as every other table here.

-- New columns on warmup_profiles: a claim lease (mirrors
-- campaign_leads.locked_until / mailboxes.reply_sync_locked_until), a
-- "when can this mailbox next start a fresh conversation" clock, a ramp
-- clock kept deliberately separate from last_activity_at (see below), a
-- consecutive-failure counter for auto-pause, and this feature's own IMAP
-- sync cursor.
alter table public.warmup_profiles
  add column locked_until timestamptz,
  add column next_send_at timestamptz,
  add column last_ramp_increase_at timestamptz,
  add column consecutive_failures integer not null default 0
    constraint warmup_profiles_consecutive_failures_check check (consecutive_failures >= 0),
  add column imap_uid_validity bigint,
  add column imap_last_uid bigint;

comment on column public.warmup_profiles.locked_until is 'Claim lease set by claim_due_warmup_sends() while a warmup cycle is in flight for this profile. Mirrors campaign_leads.locked_until / mailboxes.reply_sync_locked_until.';
comment on column public.warmup_profiles.next_send_at is 'When this mailbox may next initiate a fresh warmup conversation. Null means eligible immediately.';
comment on column public.warmup_profiles.last_ramp_increase_at is 'Feeds forecastNextRamp()''s lastActivityAt input. Deliberately separate from last_activity_at (which the worker bumps on every send/receive) — using last_activity_at here would reset the 24h ramp timer on every message and the ramp would never advance.';
comment on column public.warmup_profiles.consecutive_failures is 'Consecutive non-bounce send failures since the last success. Reset to 0 on any successful send; the worker auto-pauses the profile once this crosses its threshold.';
comment on column public.warmup_profiles.imap_uid_validity is 'This feature''s own IMAP UIDVALIDITY, independent of mailboxes.imap_uid_validity (which belongs to the real reply-sync pipeline) so the two can never race on the same physical mailbox.';
comment on column public.warmup_profiles.imap_last_uid is 'This feature''s own IMAP sync cursor (highest UID processed), independent of mailboxes.imap_last_uid. Null means never synced — first sync starts from the mailbox''s current highest UID, never scanning history, same rule as mailboxes.imap_last_uid.';

-- The send/receive ledger this feature needs — doesn't fit warmup_events
-- (event_type is a closed 4-value audit-log enum) or warmup_stats (daily
-- aggregates only, no per-message detail). Never written to by anything
-- that also touches email_events/campaign_leads/send_attempts — this is a
-- fully separate accounting trail from the real campaign pipeline.
create table public.warmup_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  from_mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  to_mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  from_warmup_profile_id uuid not null references public.warmup_profiles (id) on delete cascade,
  message_type text not null
    constraint warmup_messages_message_type_check check (message_type in ('initial', 'reply')),
  provider_message_id text not null,
  in_reply_to text,
  subject text not null,
  status text not null default 'sent'
    constraint warmup_messages_status_check check (status in ('sent', 'bounced', 'failed')),
  reply_decision text not null default 'undecided'
    constraint warmup_messages_reply_decision_check
    check (reply_decision in ('undecided', 'pending', 'skipped', 'replied')),
  reply_due_at timestamptz,
  replied_at timestamptz,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.warmup_messages is 'Send/receive ledger for the warmup engine (lib/warmup/warmup-worker.ts) — one row per warmup email sent. Never read or written by the campaign send/reply pipeline (email_events/campaign_leads/send_attempts).';
comment on column public.warmup_messages.from_warmup_profile_id is 'Whose current_daily_volume this message counts against — sent-today is derived by counting message_type=''initial'' rows here, not a maintained counter, same reasoning claim_due_sends() already documents for email_events.';
comment on column public.warmup_messages.reply_decision is 'Only meaningful on message_type=''initial'' rows: set by the recipient''s own inbound-detection step to ''pending''/''skipped'', then ''replied'' once the auto-reply is sent. A message_type=''reply'' row never gets a reply itself, bounding every thread to one hop.';

-- provider_message_id is the send-side idempotency guard (inbound detection
-- looks a message up by this) — a partial unique index isn't needed here
-- since every row has a real provider_message_id (unlike email_events'
-- event_type-scoped case).
create unique index warmup_messages_provider_message_id_key on public.warmup_messages (provider_message_id);

create index warmup_messages_from_profile_sent_at_idx on public.warmup_messages (from_warmup_profile_id, sent_at);
create index warmup_messages_to_mailbox_reply_due_idx
  on public.warmup_messages (to_mailbox_id, reply_decision, reply_due_at)
  where reply_decision = 'pending';

alter table public.warmup_messages enable row level security;

-- Same shape as warmup_events (member select + member insert), not
-- warmup_stats' service-role-only shape — this is real per-message activity
-- a member should be able to see, and the trusted worker (service role)
-- bypasses RLS regardless.
create policy warmup_messages_select_member on public.warmup_messages
  for select using (public.is_organization_member(organization_id));

create policy warmup_messages_insert_member on public.warmup_messages
  for insert with check (public.is_organization_member(organization_id));

-- No update/delete policy for the RLS-scoped client — the worker (service
-- role) is the only thing that ever transitions reply_decision/status after
-- insert, mirroring warmup_stats' "worker-only mutation" carve-out.

-- Defense in depth, same pattern as check_warmup_profile_mailbox_org: every
-- fk on this row must actually belong to organization_id, even though RLS
-- already prevents referencing rows a caller can't see.
create or replace function public.check_warmup_message_org()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.mailboxes m
    join public.organization_members om on om.user_id = m.user_id
    where m.id = new.from_mailbox_id and om.organization_id = new.organization_id
  ) then
    raise exception 'warmup_messages.from_mailbox_id must belong to a member of organization_id';
  end if;

  if not exists (
    select 1
    from public.mailboxes m
    join public.organization_members om on om.user_id = m.user_id
    where m.id = new.to_mailbox_id and om.organization_id = new.organization_id
  ) then
    raise exception 'warmup_messages.to_mailbox_id must belong to a member of organization_id';
  end if;

  if not exists (
    select 1 from public.warmup_profiles wp
    where wp.id = new.from_warmup_profile_id and wp.organization_id = new.organization_id
  ) then
    raise exception 'warmup_messages.from_warmup_profile_id must belong to organization_id';
  end if;

  return new;
end;
$$;

create trigger warmup_messages_check_org
  before insert or update on public.warmup_messages
  for each row execute function public.check_warmup_message_org();

-- Atomic claim for one warmup cycle, same `for update skip locked` shape as
-- claim_due_sends()/claim_mailboxes_for_reply_sync() — an overlapping cron
-- invocation can never double-process the same profile. p_organization_id
-- is a required argument rather than hardcoded here (see lib/warmup/
-- owner-scope.ts) so this function itself stays fully generic.
--
-- The daily volume cap (current_daily_volume vs target_daily_volume) is
-- deliberately NOT checked here — it only gates new self-initiated
-- conversations, decided per-profile in the worker, so a profile already at
-- its cap for new sends can still be claimed to process a reply it owes.
-- Mirrors claim_due_sends()'s own split between coarse SQL-level filtering
-- and finer-grained re-validation in the worker.
create or replace function public.claim_due_warmup_sends(p_organization_id uuid, p_limit integer default 10)
returns setof public.warmup_profiles
language plpgsql
as $$
begin
  return query
  with candidates as (
    select wp.id
    from public.warmup_profiles wp
    join public.mailboxes m on m.id = wp.mailbox_id
    where wp.organization_id = p_organization_id
      and wp.status = 'enabled'
      and wp.stage in ('starting', 'warming', 'healthy', 'cooling')
      and m.status = 'active'
      and (wp.locked_until is null or wp.locked_until < now())
      and (
        (wp.next_send_at is null or wp.next_send_at <= now())
        or exists (
          select 1 from public.warmup_messages wm
          where wm.to_mailbox_id = wp.mailbox_id
            and wm.reply_decision = 'pending'
            and wm.reply_due_at <= now()
        )
      )
    order by wp.updated_at
    limit p_limit
    for update of wp skip locked
  )
  update public.warmup_profiles
  set locked_until = now() + interval '10 minutes'
  where id in (select id from candidates)
  returning *;
end;
$$;

comment on function public.claim_due_warmup_sends is 'Atomically claims warmup_profiles due for a cycle (fresh send and/or a reply owed) for one organization. Never touches campaign_leads, send_attempts, or claim_due_sends() at all.';
