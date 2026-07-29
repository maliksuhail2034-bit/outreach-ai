-- Individual steps (touches) within a sequence. Ownership is derived from
-- the parent sequence -> campaign chain.

create table public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences (id) on delete cascade,
  day_delay integer not null default 0
    constraint sequence_steps_day_delay_check check (day_delay >= 0),
  subject text,
  body text,
  step_order integer not null
    constraint sequence_steps_step_order_check check (step_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sequence_steps_sequence_order_key unique (sequence_id, step_order)
);

comment on table public.sequence_steps is 'Individual steps within a sequence, ordered by step_order.';
comment on column public.sequence_steps.day_delay is 'Days to wait after the previous step (or enrollment) before sending.';

create index sequence_steps_sequence_id_idx on public.sequence_steps (sequence_id);

alter table public.sequence_steps enable row level security;

create policy sequence_steps_select_own on public.sequence_steps
  for select using (
    exists (
      select 1 from public.sequences s
      join public.campaigns c on c.id = s.campaign_id
      where s.id = sequence_steps.sequence_id and c.user_id = auth.uid()
    )
  );

create policy sequence_steps_insert_own on public.sequence_steps
  for insert with check (
    exists (
      select 1 from public.sequences s
      join public.campaigns c on c.id = s.campaign_id
      where s.id = sequence_steps.sequence_id and c.user_id = auth.uid()
    )
  );

create policy sequence_steps_update_own on public.sequence_steps
  for update using (
    exists (
      select 1 from public.sequences s
      join public.campaigns c on c.id = s.campaign_id
      where s.id = sequence_steps.sequence_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.sequences s
      join public.campaigns c on c.id = s.campaign_id
      where s.id = sequence_steps.sequence_id and c.user_id = auth.uid()
    )
  );

create policy sequence_steps_delete_own on public.sequence_steps
  for delete using (
    exists (
      select 1 from public.sequences s
      join public.campaigns c on c.id = s.campaign_id
      where s.id = sequence_steps.sequence_id and c.user_id = auth.uid()
    )
  );

create trigger sequence_steps_set_updated_at
  before update on public.sequence_steps
  for each row execute function public.set_updated_at();
