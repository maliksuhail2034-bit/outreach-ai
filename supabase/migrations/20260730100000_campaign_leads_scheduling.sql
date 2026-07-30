-- Scheduling and retry state for the send pipeline. enrolled_at anchors the
-- first step's day_delay; current_step_id/next_send_at track where a lead is
-- in its sequence and when it's next due. locked_until is a claim lease used
-- by claim_due_sends() (see 20260730100020_claim_due_sends.sql) to make
-- dispatch safe under overlapping worker invocations. Per-attempt send
-- history/counting lives on send_attempts (20260730100030) instead of here —
-- last_error below is lead-level current-state, not attempt history.

alter table public.campaign_leads
  add column enrolled_at timestamptz not null default now(),
  add column current_step_id uuid references public.sequence_steps (id) on delete set null,
  add column next_send_at timestamptz,
  add column last_error text,
  add column locked_until timestamptz;

comment on column public.campaign_leads.enrolled_at is 'When this lead was enrolled; anchors the first sequence step''s day_delay.';
comment on column public.campaign_leads.current_step_id is 'The sequence step this lead is waiting on or last sent. Null means not yet scheduled.';
comment on column public.campaign_leads.next_send_at is 'When the next send is due. Null means not currently scheduled (draft campaign, exhausted sequence, or paused).';
comment on column public.campaign_leads.locked_until is 'Claim lease set by claim_due_sends() while a send is in flight.';
comment on column public.campaign_leads.last_error is 'Why this lead is currently failed/needs_review — lead-level current state, distinct from send_attempts.last_error which is per-attempt history.';

-- 'failed' (our-side: mailbox/config error) is distinct from 'bounced'
-- (recipient-side: drives suppression) so the two failure modes don't get
-- conflated — see lib/email/send-worker.ts. 'needs_review' is a third,
-- deliberately non-automatic state: a send whose outcome is unknown after a
-- crash (see claim_send_attempt in 20260730100030_send_attempts.sql),
-- excluded from claim_due_sends()'s status = 'active' filter until a human
-- resolves it via resolveSendAttemptAction.
alter table public.campaign_leads drop constraint campaign_leads_status_check;
alter table public.campaign_leads add constraint campaign_leads_status_check
  check (status in ('pending', 'active', 'replied', 'bounced', 'unsubscribed', 'completed', 'failed', 'needs_review'));

-- Partial index: the claim query only ever looks at active, scheduled rows.
create index campaign_leads_due_idx on public.campaign_leads (next_send_at) where status = 'active';
