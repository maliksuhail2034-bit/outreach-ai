-- Phase 3B Part 2 Enterprise Readiness (security audit, item 7): a queryable
-- record of who changed what for an organization's credential/access/
-- billing-sensitive configuration — mailbox connections, BYOK provider keys,
-- webhook integrations, and subscription changes. Modeled on warmup_events
-- (20260802100000_warmup.sql): organization-scoped, an event_type-style enum,
-- append-only (select+insert for members, no update/delete — "it's a log").
--
-- actor_user_id is nullable with `on delete set null`, not the usual cascade
-- to auth.users — an audit log's entire purpose is to survive the thing it's
-- logging. If the acting user's account is later deleted, the event still
-- happened and should stay queryable, just with the actor anonymized rather
-- than the row disappearing. It's also null for the one event with no
-- interactive user at all: billing_subscription_changed, written from the
-- Stripe webhook handler.
--
-- target_type/target_id are a loosely-typed reference (not a real foreign
-- key), same pattern as analytics_events.subject_type/subject_id
-- (20260803100000_analytics.sql) — the target lives in a different table
-- depending on the action, so a single real FK column isn't possible.
--
-- metadata must never contain a secret — only identifiers already safe to
-- display elsewhere (an email address, a provider name, an already-masked
-- key_preview-style string, which fields changed). See lib/db/audit-log.ts
-- for the one function that writes this table.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null
    constraint audit_logs_action_check
    check (action in (
      'mailbox_connected', 'mailbox_credentials_updated', 'mailbox_disconnected', 'mailbox_deleted',
      'ai_key_connected', 'ai_key_disconnected',
      'verification_key_connected', 'verification_key_disconnected',
      'integration_connected', 'integration_disconnected',
      'billing_subscription_changed'
    )),
  target_type text
    constraint audit_logs_target_type_check
    check (target_type in ('mailbox', 'ai_provider_key', 'verification_provider_key', 'integration', 'subscription')),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is 'Append-only record of sensitive, credential/access/billing-relevant actions per organization — see lib/db/audit-log.ts for the single writer.';
comment on column public.audit_logs.actor_user_id is 'Who performed the action. Null for system-initiated events (e.g. the Stripe webhook) or if the acting user''s account has since been deleted.';
comment on column public.audit_logs.metadata is 'Action-specific, non-secret detail only (provider name, masked key preview, email address) — never a password, API key, or token. See lib/db/audit-log.ts.';

create index audit_logs_organization_id_created_at_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action);

alter table public.audit_logs enable row level security;

create policy audit_logs_select_member on public.audit_logs
  for select using (public.is_organization_member(organization_id));

create policy audit_logs_insert_member on public.audit_logs
  for insert with check (public.is_organization_member(organization_id));

-- No update/delete policy: it's a log.
