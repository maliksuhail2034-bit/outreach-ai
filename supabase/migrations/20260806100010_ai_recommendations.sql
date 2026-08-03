-- AI Recommendations v1 (BYOK) — persisted output of a user explicitly
-- clicking "Generate Recommendation" on an analytics page. There is no
-- scheduled worker writing this table: every row traces back to a single
-- Server Function call from lib/ai/recommendations.ts, by design (see
-- ROADMAP.md — no automatic AI generation in v1).
--
-- `entity_type`/`entity_id` mirror the existing analytics entity shape
-- (campaign/mailbox/domain/organization) already used across
-- lib/analytics/*. `entity_id` is null only when entity_type is
-- 'organization' (an org-wide rollup has no separate id from
-- organization_id).
--
-- `input_snapshot` stores the exact deterministic payload
-- (insights/forecast/benchmarks/health factors) that was sent to the LLM —
-- kept for audit/debugging so a stored recommendation's wording can always
-- be traced back to the numbers that produced it, without recomputing
-- anything. The LLM never sees or produces raw metrics beyond this snapshot.
create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null
    constraint ai_recommendations_entity_type_check check (entity_type in ('campaign', 'mailbox', 'domain', 'organization')),
  entity_id uuid,
  provider text not null
    constraint ai_recommendations_provider_check check (provider in ('anthropic', 'openai', 'google')),
  model text not null,
  input_snapshot jsonb not null,
  recommendation_text text,
  status text not null
    constraint ai_recommendations_status_check check (status in ('success', 'failed')),
  error_message text,
  generated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ai_recommendations_entity_id_required_check
    check ((entity_type = 'organization') = (entity_id is null))
);

comment on table public.ai_recommendations is 'Stored output of a user manually clicking "Generate Recommendation" on an analytics page. No scheduled generation in v1 — see lib/ai/recommendations.ts.';
comment on column public.ai_recommendations.input_snapshot is 'The exact deterministic insights/forecast/benchmark/health-factor payload sent to the LLM (see lib/ai/prompt.ts) — the LLM only phrases this, it never calculates it.';
comment on column public.ai_recommendations.generated_by is 'The user who clicked Generate. Set null (not cascaded) on user deletion — the recommendation still belongs to the organization.';

create index ai_recommendations_entity_idx on public.ai_recommendations (organization_id, entity_type, entity_id, created_at desc);

alter table public.ai_recommendations enable row level security;

create policy ai_recommendations_select_member on public.ai_recommendations
  for select using (public.is_organization_member(organization_id));

create policy ai_recommendations_insert_member on public.ai_recommendations
  for insert with check (public.is_organization_member(organization_id));

create policy ai_recommendations_delete_member on public.ai_recommendations
  for delete using (public.is_organization_member(organization_id));
