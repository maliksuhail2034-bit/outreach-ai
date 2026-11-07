-- CRM leads and conditional sequences.
--
-- 1. email_events.is_bot: opens and clicks made by security scanners, link
--    checkers and image prefetchers rather than a person. Set when the event
--    is recorded (lib/email/engagement-classifier.ts). Every count and every
--    step condition below uses human events only.
-- 2. sequence_steps.condition / condition_step_id: a step can be sent only
--    if the lead opened / didn't open / clicked / didn't click an earlier
--    step (or any earlier step). The send worker skips a step whose
--    condition isn't met and moves on to the next one.
-- 3. lead_notes: free-text notes on a lead (CRM).
-- 4. More lead statuses for a sales pipeline.
-- 5. crm_leads() and the crm_* computed fields: the Leads page's engagement
--    filter and per-lead engagement columns. RLS applies (security invoker).
-- 6. campaign_engagement(): accurate campaign and per-step analytics —
--    unique people, bots excluded — instead of raw event counts.

-- 1. Bot-classified engagement ---------------------------------------------------------
alter table public.email_events add column is_bot boolean not null default false;
comment on column public.email_events.is_bot is 'True for opens/clicks made by a scanner, link checker or prefetcher, not a person. Excluded from engagement counts and step conditions.';

create index email_events_lead_type_idx on public.email_events (lead_id, event_type) where not is_bot;
create index email_events_campaign_type_idx on public.email_events (campaign_id, event_type) where not is_bot;

-- 2. Step conditions -------------------------------------------------------------------
alter table public.sequence_steps
  add column condition text not null default 'always',
  add column condition_step_id uuid references public.sequence_steps (id) on delete set null,
  add constraint sequence_steps_condition_check
    check (condition in ('always', 'opened', 'not_opened', 'clicked', 'not_clicked')),
  add constraint sequence_steps_condition_step_consistent
    check (condition <> 'always' or condition_step_id is null);

comment on column public.sequence_steps.condition is 'When this step is sent: always, or only if the lead opened / did not open / clicked / did not click condition_step_id (any earlier step when null). Unmet = skipped.';

-- 3. Lead notes ------------------------------------------------------------------------
create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null constraint lead_notes_body_length check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_notes_lead_id_idx on public.lead_notes (lead_id, created_at desc);
create index lead_notes_user_id_idx on public.lead_notes (user_id);

alter table public.lead_notes enable row level security;

create policy lead_notes_select_own on public.lead_notes for select using (auth.uid() = user_id);
create policy lead_notes_insert_own on public.lead_notes for insert with check (
  auth.uid() = user_id and exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())
);
create policy lead_notes_update_own on public.lead_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy lead_notes_delete_own on public.lead_notes for delete using (auth.uid() = user_id);

create trigger lead_notes_set_updated_at before update on public.lead_notes
  for each row execute function public.set_updated_at();

revoke all on table public.lead_notes from anon, authenticated;
grant select, insert, update, delete on table public.lead_notes to authenticated;
grant all on table public.lead_notes to service_role;

-- 4. Pipeline statuses -----------------------------------------------------------------
alter table public.leads drop constraint leads_status_check;
alter table public.leads add constraint leads_status_check check (status in (
  'new', 'contacted', 'replied', 'interested', 'meeting_booked', 'qualified', 'won', 'lost', 'unqualified'
));

-- 5. CRM lead list ---------------------------------------------------------------------
-- The Leads page reads crm_leads() through PostgREST, which applies the
-- page's other filters (status, list, verification, segment rules), the
-- sort, pagination and the exact count on top, exactly as on the leads
-- table, so only the engagement filter is SQL. Per-lead engagement for the
-- table's columns and sorting comes from the computed fields below.
--
-- p_engagement: any | opened | not_opened | clicked | not_clicked | replied |
-- no_engagement | never_contacted. p_campaign_id / p_step_id narrow it to one
-- campaign / one step (e.g. did not open step 2 of one campaign); with
-- 'any', p_campaign_id alone means enrolled in that campaign. Human
-- engagement only (is_bot); a click counts as an open (images blocked).

-- A person engaged (one of p_types) with this lead's emails, optionally in one campaign / for one step.
create function public.crm_engaged(p_lead_id uuid, p_types text[], p_campaign_id uuid, p_step_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.email_events e
    where e.lead_id = p_lead_id and e.event_type = any (p_types) and not e.is_bot
      and (p_campaign_id is null or e.campaign_id = p_campaign_id)
      and (p_step_id is null or e.metadata ->> 'sequenceStepId' = p_step_id::text)
  );
$$;

-- The lead was sent this step (send log), else any email in this campaign / at all.
create function public.crm_was_sent(p_lead_id uuid, p_campaign_id uuid, p_step_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_step_id is not null then exists (
      select 1 from public.send_attempts sa
      join public.campaign_leads cl on cl.id = sa.campaign_lead_id
      where cl.lead_id = p_lead_id and sa.sequence_step_id = p_step_id and sa.status = 'sent')
    else exists (
      select 1 from public.email_events e
      where e.lead_id = p_lead_id and e.event_type = 'sent' and not e.is_bot
        and (p_campaign_id is null or e.campaign_id = p_campaign_id))
  end;
$$;

create function public.crm_leads(
  p_engagement text default 'any',
  p_campaign_id uuid default null,
  p_step_id uuid default null
)
returns setof public.leads
language sql
stable
security invoker
set search_path = ''
as $$
  select l.*
  from public.leads l
  where l.user_id = auth.uid()
    and case coalesce(p_engagement, 'any')
      when 'any' then p_campaign_id is null
        or exists (select 1 from public.campaign_leads cl where cl.lead_id = l.id and cl.campaign_id = p_campaign_id)
      when 'opened' then public.crm_engaged(l.id, array['opened', 'clicked'], p_campaign_id, p_step_id)
      when 'not_opened' then public.crm_was_sent(l.id, p_campaign_id, p_step_id)
        and not public.crm_engaged(l.id, array['opened', 'clicked'], p_campaign_id, p_step_id)
      when 'clicked' then public.crm_engaged(l.id, array['clicked'], p_campaign_id, p_step_id)
      when 'not_clicked' then public.crm_was_sent(l.id, p_campaign_id, p_step_id)
        and not public.crm_engaged(l.id, array['clicked'], p_campaign_id, p_step_id)
      -- A reply belongs to the thread, not to one step.
      when 'replied' then public.crm_engaged(l.id, array['replied'], p_campaign_id, null)
      when 'no_engagement' then public.crm_was_sent(l.id, p_campaign_id, p_step_id)
        and not public.crm_engaged(l.id, array['opened', 'clicked'], p_campaign_id, p_step_id)
        and not public.crm_engaged(l.id, array['replied'], p_campaign_id, null)
      when 'never_contacted' then not public.crm_was_sent(l.id, p_campaign_id, p_step_id)
      else false
    end;
$$;

-- Computed fields (PostgREST): selectable and sortable on leads and on
-- crm_leads() as crm_sent, crm_opens, crm_clicks, crm_replies and
-- crm_last_activity_at. Across all campaigns, people only.
create function public.crm_sent(public.leads) returns bigint
language sql stable security invoker set search_path = ''
as $$ select count(*) from public.email_events e where e.lead_id = $1.id and e.event_type = 'sent' and not e.is_bot; $$;

create function public.crm_opens(public.leads) returns bigint
language sql stable security invoker set search_path = ''
as $$ select count(*) from public.email_events e where e.lead_id = $1.id and e.event_type = 'opened' and not e.is_bot; $$;

create function public.crm_clicks(public.leads) returns bigint
language sql stable security invoker set search_path = ''
as $$ select count(*) from public.email_events e where e.lead_id = $1.id and e.event_type = 'clicked' and not e.is_bot; $$;

create function public.crm_replies(public.leads) returns bigint
language sql stable security invoker set search_path = ''
as $$ select count(*) from public.email_events e where e.lead_id = $1.id and e.event_type = 'replied' and not e.is_bot; $$;

create function public.crm_last_activity_at(public.leads) returns timestamptz
language sql stable security invoker set search_path = ''
as $$ select max(e.created_at) from public.email_events e where e.lead_id = $1.id and not e.is_bot; $$;

revoke all on function public.crm_engaged(uuid, text[], uuid, uuid) from public, anon;
revoke all on function public.crm_was_sent(uuid, uuid, uuid) from public, anon;
revoke all on function public.crm_leads(text, uuid, uuid) from public, anon;
revoke all on function public.crm_sent(public.leads) from public, anon;
revoke all on function public.crm_opens(public.leads) from public, anon;
revoke all on function public.crm_clicks(public.leads) from public, anon;
revoke all on function public.crm_replies(public.leads) from public, anon;
revoke all on function public.crm_last_activity_at(public.leads) from public, anon;
grant execute on function public.crm_engaged(uuid, text[], uuid, uuid) to authenticated, service_role;
grant execute on function public.crm_was_sent(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.crm_leads(text, uuid, uuid) to authenticated, service_role;
grant execute on function public.crm_sent(public.leads) to authenticated, service_role;
grant execute on function public.crm_opens(public.leads) to authenticated, service_role;
grant execute on function public.crm_clicks(public.leads) to authenticated, service_role;
grant execute on function public.crm_replies(public.leads) to authenticated, service_role;
grant execute on function public.crm_last_activity_at(public.leads) to authenticated, service_role;

-- 6. Accurate campaign analytics -------------------------------------------------------
-- Unique people, bots excluded, over every row (no read cap). Sends come
-- from the send log (one row per email actually sent, with its step);
-- opens and clicks belong to the step whose tracking token they came from,
-- and a click counts as an open (images blocked). A reply belongs to the
-- step whose message it answers (In-Reply-To / References against the
-- send log's provider_message_id, as lib/email/reply-worker.ts matches it);
-- a reply matched by address only counts for the campaign, not a step.
create function public.campaign_engagement(p_campaign_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with sends as (
    select sa.sequence_step_id as step_id, cl.lead_id, sa.provider_message_id
    from public.send_attempts sa
    join public.campaign_leads cl on cl.id = sa.campaign_lead_id
    where cl.campaign_id = p_campaign_id and sa.status = 'sent'
  ),
  ev as (
    select e.event_type, e.lead_id, e.is_bot, e.metadata, nullif(e.metadata ->> 'sequenceStepId', '') as step_id
    from public.email_events e
    where e.campaign_id = p_campaign_id and e.event_type in ('opened', 'clicked', 'replied', 'bounced', 'unsubscribed')
  ),
  human as (
    select * from ev where not is_bot
  ),
  step_replies as (
    select distinct s.step_id, h.lead_id
    from human h
    join sends s on s.provider_message_id is not null and (
      s.provider_message_id = h.metadata ->> 'inReplyTo'
      or (jsonb_typeof(h.metadata -> 'references') = 'array' and h.metadata -> 'references' ? s.provider_message_id)
    )
    where h.event_type = 'replied'
  ),
  steps as (
    select ss.id, ss.step_order, ss.subject, ss.condition
    from public.sequence_steps ss
    join public.sequences sq on sq.id = ss.sequence_id
    where sq.campaign_id = p_campaign_id
  )
  select jsonb_build_object(
    'emails_sent', (select count(*) from sends),
    'leads_contacted', (select count(distinct lead_id) from sends),
    'unique_opened', (select count(distinct lead_id) from human where event_type in ('opened', 'clicked')),
    'unique_clicked', (select count(distinct lead_id) from human where event_type = 'clicked'),
    'unique_replied', (select count(distinct lead_id) from human where event_type = 'replied'),
    'unique_bounced', (select count(distinct lead_id) from human where event_type = 'bounced'),
    'unique_unsubscribed', (select count(distinct lead_id) from human where event_type = 'unsubscribed'),
    'bot_opens', (select count(*) from ev where event_type = 'opened' and is_bot),
    'bot_clicks', (select count(*) from ev where event_type = 'clicked' and is_bot),
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'step_id', s.id,
        'step_order', s.step_order,
        'subject', s.subject,
        'condition', s.condition,
        'sent', (select count(*) from sends x where x.step_id = s.id),
        'unique_opened', (select count(distinct lead_id) from human h where h.step_id = s.id::text and h.event_type in ('opened', 'clicked')),
        'unique_clicked', (select count(distinct lead_id) from human h where h.step_id = s.id::text and h.event_type = 'clicked'),
        'unique_replied', (select count(*) from step_replies r where r.step_id = s.id)
      ) order by s.step_order), '[]'::jsonb)
      from steps s
    )
  );
$$;

revoke all on function public.campaign_engagement(uuid) from public, anon;
grant execute on function public.campaign_engagement(uuid) to authenticated, service_role;
