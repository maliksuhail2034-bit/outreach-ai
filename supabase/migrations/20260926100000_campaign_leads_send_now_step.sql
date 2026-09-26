-- Sending-window enforcement with an explicit Send Now bypass.
--
-- The send worker now re-checks the campaign sending window immediately
-- before every send (lib/email/send-worker.ts), so a lead that became due
-- outside the window — a late worker run, a retry, a campaign resume, a
-- manual reactivation — is deferred to the next window opening instead of
-- sent. Send Now is the one intentional exception, and it needs persistent,
-- explicit state: previously it only set next_send_at = now(), which the
-- worker cannot tell apart from any other overdue lead.
--
-- send_now_step_id is that state. It records the sequence step the Send Now
-- request was made for, and the bypass is honored only while it equals
-- current_step_id — so it can never apply to a later step even if it were
-- somehow left set. The worker clears it immediately before the send attempt
-- (so a failed send's retry waits for the window like any other retry), on a
-- monthly-limit deferral, and a campaign leaving 'active' (pause, stop, any
-- status edit) clears any pending request via a trigger.

alter table public.campaign_leads
  add column send_now_step_id uuid references public.sequence_steps (id) on delete set null;

comment on column public.campaign_leads.send_now_step_id is 'Pending explicit Send Now request for this sequence step: bypasses the campaign sending window once. Only honored while it equals current_step_id; cleared right before the send attempt. Set only via request_send_now().';

-- campaign_leads_update_own lets an owner update any column of their own
-- rows, which would make this bypass settable directly through PostgREST,
-- skipping sendNowAction's validations and rate limit. Setting it to a
-- non-null value is therefore reserved for request_send_now() (security
-- definer, so current_user is its owner there) and the service role.
-- Clearing it stays allowed for everyone who can already update the row.
create or replace function public.guard_campaign_lead_send_now()
returns trigger
language plpgsql
as $$
begin
  if new.send_now_step_id is not null
    and (tg_op = 'INSERT' or new.send_now_step_id is distinct from old.send_now_step_id)
    and current_user in ('anon', 'authenticated')
  then
    raise exception 'campaign_leads.send_now_step_id can only be set through request_send_now()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger campaign_leads_guard_send_now
  before insert or update of send_now_step_id on public.campaign_leads
  for each row execute function public.guard_campaign_lead_send_now();

-- Atomic Send Now. Every eligibility condition is re-checked in the same
-- statement that sets the bypass, so it can't race the send worker:
--   - The lead must not be leased. If a claim_due_sends() transaction holds
--     the row, this UPDATE waits for it, then re-evaluates its WHERE against
--     the committed row (now leased) and updates nothing. If this commits
--     first, the claim returns the row with the bypass already set.
--   - The campaign row is locked FOR SHARE, which conflicts with the UPDATE
--     a pause makes: a pause either commits first (this sees 'paused' and
--     refuses) or waits until this commits (and its trigger then clears the
--     bypass — see clear_send_now_on_campaign_inactive below). Either way no
--     Send Now survives a pause.
-- Ownership: the campaign must belong to auth.uid(). Returns true when the
-- request was recorded, false when the lead/campaign was no longer eligible.
create or replace function public.request_send_now(p_campaign_lead_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_updated_id uuid;
begin
  select c.id into v_campaign_id
  from public.campaigns c
  join public.campaign_leads cl on cl.campaign_id = c.id
  where cl.id = p_campaign_lead_id
    and c.user_id = auth.uid()
    and c.status = 'active'
  for share of c;

  if v_campaign_id is null then
    return false;
  end if;

  update public.campaign_leads cl
  set next_send_at = now(),
      send_now_step_id = cl.current_step_id
  where cl.id = p_campaign_lead_id
    and cl.campaign_id = v_campaign_id
    and cl.status = 'active'
    and cl.current_step_id is not null
    and cl.mailbox_id is not null
    and (cl.locked_until is null or cl.locked_until < now())
  returning cl.id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

comment on function public.request_send_now(uuid) is 'Records an explicit Send Now for one campaign lead owned by the caller: sets next_send_at = now() and send_now_step_id = current_step_id atomically, only if the campaign is active and the lead is active, has a step and mailbox, and is not currently leased.';

revoke execute on function public.request_send_now(uuid) from public, anon;
grant execute on function public.request_send_now(uuid) to authenticated;

-- A campaign leaving 'active' (pauseCampaignAction, the raw status editor in
-- updateCampaignAction, stopping, or a direct table update) drops every
-- pending Send Now for it, so resuming later can't fire an old request
-- outside the sending window. A trigger rather than app code so no status
-- path can skip it, and in the same transaction as the status change: a
-- concurrent request_send_now() holds the campaign row FOR SHARE, so the
-- status UPDATE waits for it and this clear then sees its committed bypass;
-- one that starts after sees the new status and refuses. Security definer
-- only so the clear can't be narrowed by campaign_leads RLS; it can only
-- ever null out a bypass, never set one.
create or replace function public.clear_send_now_on_campaign_inactive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.campaign_leads
  set send_now_step_id = null
  where campaign_id = new.id
    and send_now_step_id is not null;
  return null;
end;
$$;

revoke execute on function public.clear_send_now_on_campaign_inactive() from public, anon, authenticated;

create trigger campaigns_clear_send_now_on_inactive
  after update of status on public.campaigns
  for each row
  when (old.status is distinct from new.status and new.status is distinct from 'active')
  execute function public.clear_send_now_on_campaign_inactive();
