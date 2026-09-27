-- Closes the claim-to-send status race (launch audit P2: "dispatch doesn't
-- re-check campaign_leads.status just before sending").
--
-- claim_due_sends() only admits status = 'active' leads, but after the claim
-- the worker renders, downloads attachments and calls the provider from its
-- claimed copy of the row. Nothing that takes a lead out of 'active' honors
-- the claim lease: the reply worker ('replied'), unsubscribe
-- ('unsubscribed'), stopping a campaign ('cancelled') and removing a lead
-- (delete) all write the row directly, and pausing only changes the
-- campaign. So a lead could be sent to after it replied, and
-- record_send_success() / record_send_failure() then overwrote the newer
-- status with 'active'/'completed', restarting a replied lead's sequence.
--
-- Two parts:
--   1. confirm_send_attempt_eligible(), called by the worker immediately
--      before provider.send(). It locks the lead row, so a status change
--      that is committing right now is waited for and seen, and refuses
--      unless the lead is still 'active' on the claimed step and its
--      campaign is still 'active'. On refusal nothing was sent, so the
--      pending send_attempts row is deleted (a later legitimate claim of the
--      same step, e.g. after a resume, then inserts afresh instead of being
--      mistaken for an unknown outcome) and the lease is released. The lead's
--      status, step, next_send_at and send_now_step_id are left as they are.
--   2. record_send_success() / record_send_failure() only advance or reset a
--      lead that is still 'active'. A lead that left 'active' between that
--      check and the provider call keeps its newer status; only its lease is
--      cleared. The send_attempts ledger, the 'sent'/'bounced' email_events
--      rows and the bounce suppression are always recorded, since the send
--      (or the bounce) really happened.
--
-- The window between the check and the provider call can't be closed from
-- the database (the provider is an external system). Part 2 makes a status
-- change that lands inside it win regardless.
--
-- Signatures of the two existing functions are unchanged, so their grants
-- are preserved by create or replace.

create or replace function public.confirm_send_attempt_eligible(
  p_send_attempt_id uuid,
  p_campaign_lead_id uuid,
  p_sequence_step_id uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.campaign_leads%rowtype;
  v_campaign_status text;
  v_reason text;
begin
  select * into v_lead
  from public.campaign_leads
  where id = p_campaign_lead_id
  for update;

  if not found then
    v_reason := 'lead_removed';
  else
    select c.status into v_campaign_status
    from public.campaigns c
    where c.id = v_lead.campaign_id;

    if v_lead.status <> 'active' then
      v_reason := 'lead_' || v_lead.status;
    elsif v_lead.current_step_id is distinct from p_sequence_step_id then
      v_reason := 'step_changed';
    elsif v_campaign_status is distinct from 'active' then
      v_reason := 'campaign_' || coalesce(v_campaign_status, 'missing');
    else
      return 'ok';
    end if;

    update public.campaign_leads
    set locked_until = null
    where id = p_campaign_lead_id;
  end if;

  delete from public.send_attempts
  where id = p_send_attempt_id
    and campaign_lead_id = p_campaign_lead_id
    and sequence_step_id = p_sequence_step_id
    and status = 'pending';

  return v_reason;
end;
$$;

comment on function public.confirm_send_attempt_eligible(uuid, uuid, uuid) is 'Send worker only, immediately before the provider call: returns ok if the claimed lead is still active on this step in an active campaign; otherwise deletes the unsent pending attempt, releases the lease and returns the reason.';

-- Worker-only, like the rest of the send pipeline. Explicit grant because
-- newer local images give new functions no default execute grants.
revoke execute on function public.confirm_send_attempt_eligible(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_send_attempt_eligible(uuid, uuid, uuid) to service_role;

create or replace function public.record_send_success(
  p_send_attempt_id uuid,
  p_campaign_lead_id uuid,
  p_campaign_id uuid,
  p_lead_id uuid,
  p_mailbox_id uuid,
  p_provider_message_id text,
  p_next_status text,
  p_next_step_id uuid default null,
  p_next_send_at timestamptz default null
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
  where id = p_campaign_lead_id
    and status = 'active';

  if not found then
    update public.campaign_leads
    set locked_until = null
    where id = p_campaign_lead_id;
  end if;
end;
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
    select v_user_id, l.email, 'bounced', p_campaign_id
    from public.leads l where l.id = p_lead_id
    on conflict (user_id, email) do nothing;
  end if;
end;
$$;
