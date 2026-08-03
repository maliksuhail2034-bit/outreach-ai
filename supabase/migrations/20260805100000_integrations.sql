-- Integrations Foundation: lets an organization configure an outbound
-- destination (starting with a generic webhook) that periodically receives
-- an organization digest — reusing the existing analytics/forecasting/
-- benchmark/AI Insights engines rather than a new data pipeline. See
-- lib/integrations/ for the provider abstraction and
-- lib/integrations/digest.ts for what gets sent.
--
-- Organization-scoped (organization_id, not user_id) — same convention as
-- warmup_profiles (20260802100000_warmup.sql): a digest describes an
-- organization's whole rollup, not one user's data, and is_organization_member()
-- already exists from that migration so this needs no new RLS helper.
--
-- `provider` is a text enum with exactly one value today ('webhook') — new
-- providers (Slack, Zapier, a CRM) are added by extending the check
-- constraint and lib/integrations/get-provider.ts's factory, never by
-- changing this table's shape. `config` is jsonb because each provider's
-- connection details differ (a webhook needs a URL; a future OAuth-based
-- provider would need different fields) — the same "flexible bag for
-- provider-specific data" role leads.custom_fields already plays.
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null
    constraint integrations_provider_check check (provider in ('webhook')),
  status text not null default 'disabled'
    constraint integrations_status_check check (status in ('enabled', 'disabled')),
  config jsonb not null default '{}'::jsonb,
  last_sent_at timestamptz,
  last_status text
    constraint integrations_last_status_check check (last_status in ('success', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_organization_provider_key unique (organization_id, provider)
);

comment on table public.integrations is 'Outbound integration connections per organization (e.g. a webhook URL) that receive a periodic organization digest. One row per organization per provider.';
comment on column public.integrations.config is 'Provider-specific connection details (e.g. { "url": "..." } for a webhook). Validated at the application layer per provider — see lib/validations/integrations.ts.';
comment on column public.integrations.last_status is 'Outcome of the most recent delivery attempt by the digest worker. Null means never attempted.';

create index integrations_organization_id_idx on public.integrations (organization_id);
create index integrations_status_idx on public.integrations (status);

alter table public.integrations enable row level security;

create policy integrations_select_member on public.integrations
  for select using (public.is_organization_member(organization_id));

create policy integrations_insert_member on public.integrations
  for insert with check (public.is_organization_member(organization_id));

create policy integrations_update_member on public.integrations
  for update using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create policy integrations_delete_member on public.integrations
  for delete using (public.is_organization_member(organization_id));

create trigger integrations_set_updated_at
  before update on public.integrations
  for each row execute function public.set_updated_at();
