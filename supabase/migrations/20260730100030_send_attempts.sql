-- The idempotency ledger for the send pipeline. claim_due_sends() (see
-- 20260730100020_claim_due_sends.sql) prevents two workers from claiming the
-- same LEAD concurrently, but not a duplicate SEND: if the worker crashes
-- after provider.send() succeeds but before recording it, a naive reclaim
-- would trigger a real second email. This table makes that structurally
-- impossible to do automatically — see claim_send_attempt() below.

create table public.send_attempts (
  id uuid primary key default gen_random_uuid(),
  campaign_lead_id uuid not null references public.campaign_leads (id) on delete cascade,
  sequence_step_id uuid not null references public.sequence_steps (id) on delete cascade,
  status text not null default 'pending'
    constraint send_attempts_status_check check (status in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 1
    constraint send_attempts_attempt_count_check check (attempt_count > 0),
  provider_message_id text,
  last_error text,
  claimed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_manually boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint send_attempts_lead_step_key unique (campaign_lead_id, sequence_step_id)
);

comment on table public.send_attempts is 'One row per (lead, sequence step) ever attempted. The unique constraint is what makes a duplicate send structurally impossible to create automatically.';
comment on column public.send_attempts.status is 'pending = claimed, send in flight or outcome unknown. sent = confirmed delivered to the SMTP server. failed = definitively did not send (safe to retry).';

create index send_attempts_campaign_lead_id_idx on public.send_attempts (campaign_lead_id);

alter table public.send_attempts enable row level security;

-- Ownership derived via campaign_lead_id -> campaign_leads -> campaigns ->
-- user_id, same derived-ownership shape as sequence_steps. Needed so
-- resolveSendAttemptAction (run with the user-scoped server client, not
-- admin) can read/update a user's own rows for manual crash recovery.
create policy send_attempts_select_own on public.send_attempts
  for select using (
    exists (
      select 1 from public.campaign_leads cl
      join public.campaigns c on c.id = cl.campaign_id
      where cl.id = send_attempts.campaign_lead_id and c.user_id = auth.uid()
    )
  );

create policy send_attempts_update_own on public.send_attempts
  for update using (
    exists (
      select 1 from public.campaign_leads cl
      join public.campaigns c on c.id = cl.campaign_id
      where cl.id = send_attempts.campaign_lead_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.campaign_leads cl
      join public.campaigns c on c.id = cl.campaign_id
      where cl.id = send_attempts.campaign_lead_id and c.user_id = auth.uid()
    )
  );

-- No insert/delete policy: rows are only ever created by the RPCs below,
-- which run via lib/supabase/admin.ts (service role, bypasses RLS) from the
-- worker — same carve-out as claim_due_sends/recordEmailEvent. Users never
-- insert or delete send_attempts rows directly.

create trigger send_attempts_set_updated_at
  before update on public.send_attempts
  for each row execute function public.set_updated_at();

-- 1. THE CLAIM. Called after claim_due_sends(), before any network I/O.
create or replace function public.claim_send_attempt(p_campaign_lead_id uuid, p_sequence_step_id uuid)
returns setof public.send_attempts
language plpgsql
as $$
begin
  begin
    return query
    insert into public.send_attempts (campaign_lead_id, sequence_step_id, status, attempt_count, claimed_at)
    values (p_campaign_lead_id, p_sequence_step_id, 'pending', 1, now())
    returning *;
    return;
  exception when unique_violation then
    -- A row already exists for this (lead, step). Only 'failed' — a
    -- definitive, resolved prior failure — is safe to retry. 'pending'
    -- (live concurrent attempt, or a crashed one with unknown outcome) and
    -- 'sent' are both refused; the worker inspects the existing row itself.
    return query
    update public.send_attempts
    set status = 'pending', attempt_count = attempt_count + 1, claimed_at = now(), last_error = null
    where campaign_lead_id = p_campaign_lead_id
      and sequence_step_id = p_sequence_step_id
      and status = 'failed'
    returning *;
  end;
end;
$$;

-- 2. RECORD SUCCESS. Called as the very next statement after
-- provider.send() returns. p_next_status/p_next_step_id/p_next_send_at are
-- computed by lib/email/scheduling.ts's scheduleNextStep() BEFORE this call
-- (it needs luxon for DST-safe timezone math, which has no clean plpgsql
-- equivalent) — this function's job is purely to persist that outcome
-- atomically alongside the ledger and audit-log writes, not to compute it.
create or replace function public.record_send_success(
  p_send_attempt_id uuid,
  p_campaign_lead_id uuid,
  p_campaign_id uuid,
  p_lead_id uuid,
  p_mailbox_id uuid,
  p_provider_message_id text,
  p_next_status text,
  p_next_step_id uuid,
  p_next_send_at timestamptz
)
returns void
language plpgsql
as $$
begin
  update public.send_attempts
  set status = 'sent', provider_message_id = p_provider_message_id, resolved_at = now()
  where id = p_send_attempt_id;

  insert into public.email_events (campaign_id, lead_id, mailbox_id, event_type, provider_message_id)
  values (p_campaign_id, p_lead_id, p_mailbox_id, 'sent', p_provider_message_id);

  update public.campaign_leads
  set status = p_next_status,
      current_step_id = p_next_step_id,
      next_send_at = p_next_send_at,
      locked_until = null,
      last_error = null
  where id = p_campaign_lead_id;
end;
$$;

-- 3. RECORD FAILURE. Called only on a SYNCHRONOUS provider.send() throw —
-- never for an ambiguous/unknown outcome, which the worker routes to
-- 'needs_review' directly (no RPC needed for that: it's just
-- campaign_leads.status = 'needs_review', locked_until = null, no
-- send_attempts write at all, since the row is already 'pending').
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
  update public.send_attempts
  set status = 'failed', last_error = left(p_error_message, 1000)
  where id = p_send_attempt_id;

  if p_outcome = 'retry' then
    update public.campaign_leads
    set status = 'active', next_send_at = p_next_send_at, last_error = left(p_error_message, 1000), locked_until = null
    where id = p_campaign_lead_id;

  elsif p_outcome = 'failed' then
    update public.campaign_leads
    set status = 'failed', next_send_at = null, last_error = left(p_error_message, 1000), locked_until = null
    where id = p_campaign_lead_id;

  elsif p_outcome = 'bounced' then
    update public.campaign_leads
    set status = 'bounced', next_send_at = null, last_error = left(p_error_message, 1000), locked_until = null
    where id = p_campaign_lead_id;

    insert into public.email_events (campaign_id, lead_id, mailbox_id, event_type, metadata)
    values (p_campaign_id, p_lead_id, p_mailbox_id, 'bounced', jsonb_build_object('error', p_error_message));

    select c.user_id into v_user_id from public.campaigns c where c.id = p_campaign_id;

    insert into public.suppressions (user_id, email, reason, source_campaign_id)
    select v_user_id, l.email, 'bounced', p_campaign_id
    from public.leads l where l.id = p_lead_id
    on conflict (user_id, email) do nothing;

  else
    raise exception 'record_send_failure: invalid p_outcome %', p_outcome;
  end if;
end;
$$;
