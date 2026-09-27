-- Rule-based lead segments.
--
-- A segment is a named, saved set of AND-ed rules over lead fields
-- (status, verification_status, list, company/title/city/country, email
-- domain, created_at). Membership is never stored: the matching leads are
-- worked out when a segment is viewed or used, so a segment always reflects
-- current lead data. Enrolling a segment into a campaign snapshots the
-- matches at that moment (enrollLeadSegmentAction); later matches are not
-- auto-enrolled.
--
-- The rule shape is validated by lib/validations/lead-segments.ts before
-- every write and again before every use; the constraints below only bound
-- the stored document. Static lead lists (lead_lists) are unchanged.

create table public.lead_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_segments_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint lead_segments_description_length check (description is null or char_length(description) <= 500),
  constraint lead_segments_rules_shape check (
    jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) between 1 and 20
  )
);

comment on table public.lead_segments is 'Saved rule-based lead segments owned by a user. Rules are AND-ed; membership is evaluated at read time, never stored.';
comment on column public.lead_segments.rules is 'JSON array of rules, validated by lib/validations/lead-segments.ts (leadSegmentRulesSchema) before storage and before use.';

create index lead_segments_user_id_idx on public.lead_segments (user_id);

-- Explicit grants instead of relying on the environment's default
-- privileges (hosted projects grant ALL on new public tables to the API
-- roles; newer local images grant none). anon gets nothing, and
-- authenticated gets only the four row operations RLS governs — not
-- TRUNCATE, which RLS does not apply to.
revoke all on table public.lead_segments from anon, authenticated;
grant select, insert, update, delete on table public.lead_segments to authenticated;
grant all on table public.lead_segments to service_role;

alter table public.lead_segments enable row level security;

create policy lead_segments_select_own on public.lead_segments
  for select using (auth.uid() = user_id);

create policy lead_segments_insert_own on public.lead_segments
  for insert with check (auth.uid() = user_id);

create policy lead_segments_update_own on public.lead_segments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy lead_segments_delete_own on public.lead_segments
  for delete using (auth.uid() = user_id);

-- Defense in depth, same as leads_check_list_owner: a list_id rule may only
-- name lists owned by the segment's own user. Runs as the caller, so under
-- RLS another user's list isn't even visible to the lookup.
create or replace function public.check_lead_segment_list_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_list_id text;
begin
  -- A non-array is rejected by lead_segments_rules_shape right after this
  -- trigger; skip it here so that constraint, not a jsonb error, reports it.
  if jsonb_typeof(new.rules) is distinct from 'array' then
    return new;
  end if;

  for v_list_id in
    select jsonb_array_elements_text(r -> 'values')
    from jsonb_array_elements(new.rules) r
    where r ->> 'field' = 'list_id'
      and jsonb_typeof(r -> 'values') = 'array'
  loop
    if not exists (
      select 1 from public.lead_lists l
      where l.id::text = v_list_id and l.user_id = new.user_id
    ) then
      raise exception 'lead_segments.rules may only reference lead lists owned by the same user'
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

create trigger lead_segments_check_list_owner
  before insert or update of rules, user_id on public.lead_segments
  for each row execute function public.check_lead_segment_list_owner();

create trigger lead_segments_set_updated_at
  before update on public.lead_segments
  for each row execute function public.set_updated_at();
