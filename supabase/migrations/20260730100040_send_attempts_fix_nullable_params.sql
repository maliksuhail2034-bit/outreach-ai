-- record_send_success's p_next_step_id/p_next_send_at lacked `default null`,
-- so the generated TS types incorrectly required non-null values even
-- though campaign_leads.current_step_id/next_send_at are themselves
-- nullable and scheduleNextStep legitimately produces null for both when a
-- lead completes its final sequence step. This redefines the function with
-- the same body, only adding defaults — no behavior change.
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
  where id = p_campaign_lead_id;
end;
$$;
