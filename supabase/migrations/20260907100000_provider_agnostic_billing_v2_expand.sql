-- Phase A (Expand) of the Stripe -> provider-agnostic billing migration.
-- Additive-only, schema-only: creates the new v2/generic tables the app will
-- eventually read/write instead of billing_customers/subscriptions/
-- stripe_webhook_events. Contains no data-migration statements — see
-- 20260907100001_provider_agnostic_billing_v2_legacy_backfill.sql for the
-- safe legacy backfills, and the still-pending subscription migration
-- (blocked on a verified Stripe price id -> plan mapping) for the rest.
-- Does NOT touch, rename, or drop any existing table (billing_customers,
-- subscriptions, stripe_webhook_events all keep working exactly as they do
-- now — the live Stripe webhook handler and billing UI are unaffected by
-- this migration and need no code changes to keep functioning). Cutover
-- (application code reading/writing these new tables) and Retire (dropping
-- the old tables) are separate, later phases per the agreed
-- Expand -> Backfill -> Cutover -> Retire strategy.

-- ============================================================================
-- billing_customers_v2
-- ============================================================================
-- Provider-agnostic replacement for billing_customers. Unlike the original
-- (unique on organization_id alone, since it only ever needed to hold one
-- Stripe customer id), an organization can now accumulate a customer record
-- per provider over time (e.g. a Stripe customer from an earlier signup and
-- a later Razorpay customer once that provider goes live), so uniqueness is
-- scoped to (organization_id, provider) instead.
create table public.billing_customers_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null
    constraint billing_customers_v2_provider_check
    check (provider in ('stripe', 'razorpay', 'paypal')),
  provider_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_customers_v2_organization_provider_key unique (organization_id, provider),
  constraint billing_customers_v2_provider_customer_id_key unique (provider, provider_customer_id)
);

comment on table public.billing_customers_v2 is 'Provider-agnostic replacement for billing_customers — one row per (organization, provider). Written only by webhook/server code, never the client.';

alter table public.billing_customers_v2 enable row level security;

-- Mirrors billing_customers' RLS exactly: members may read their own org's
-- rows; no insert/update/delete policy at all, since this table's only
-- writer is server-side webhook code running as the service role (same
-- carve-out as billing_customers and send_attempts before it).
create policy billing_customers_v2_select_member on public.billing_customers_v2
  for select using (public.is_organization_member(organization_id));

create trigger billing_customers_v2_set_updated_at
  before update on public.billing_customers_v2
  for each row execute function public.set_updated_at();

-- ============================================================================
-- subscriptions_v2
-- ============================================================================
-- Provider-agnostic replacement for subscriptions. provider_plan_id is kept
-- as an opaque foreign identifier only (Stripe Price id / Razorpay Plan id /
-- PayPal Plan id) — it is never read to determine product plan. Every place
-- that needs to know the org's tier/duration reads internal_plan_id/
-- billing_interval directly, resolved once by webhook code at write time
-- instead of re-derived from provider_plan_id on every read (today's
-- getPlanByPriceId does the latter, keyed off live STRIPE_PRICE_* env vars —
-- see the subscription-migration phase for why that matters there).
create table public.subscriptions_v2 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  provider text not null
    constraint subscriptions_v2_provider_check
    check (provider in ('stripe', 'razorpay', 'paypal')),
  provider_subscription_id text not null,
  -- Opaque foreign id (Stripe Price / Razorpay Plan / PayPal Plan). Never a
  -- source of truth for product plan — see internal_plan_id.
  provider_plan_id text not null,

  -- Polimatiq's own identifiers, independent of any provider's id space.
  -- "free" is deliberately NOT an allowed value here: it is an internal,
  -- no-subscription fallback (see lib/billing/resolve-plan.ts) and is never
  -- represented as a row in this table — no row for an organization means
  -- "on the free/no-subscription fallback", exactly as today.
  internal_plan_id text not null
    constraint subscriptions_v2_internal_plan_id_check
    check (internal_plan_id in ('starter', 'growth', 'pro', 'scale')),
  billing_interval text not null
    constraint subscriptions_v2_billing_interval_check
    check (billing_interval in ('1_month', '3_month', '6_month', '12_month')),
  currency text not null default 'USD'
    constraint subscriptions_v2_currency_check
    check (currency in ('USD', 'INR')),

  -- Raw, verbatim provider status (e.g. "past_due", "halted", "SUSPENDED"),
  -- kept for support/debugging without re-fetching from the provider.
  provider_status text not null,
  -- What access-control code actually branches on — a small, provider-
  -- independent vocabulary every provider's provider_status is mapped into.
  normalized_status text not null
    constraint subscriptions_v2_normalized_status_check
    check (normalized_status in ('pending', 'active', 'past_due', 'suspended', 'cancelled', 'expired', 'completed')),

  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One active subscription per organization regardless of provider — same
  -- product model subscriptions.organization_id_key already enforces today.
  constraint subscriptions_v2_organization_id_key unique (organization_id),
  constraint subscriptions_v2_provider_subscription_id_key unique (provider, provider_subscription_id)
);

comment on table public.subscriptions_v2 is 'Provider-agnostic replacement for subscriptions — current subscription state per organization, any provider. No row means the organization is on the internal no-subscription fallback.';

create index subscriptions_v2_normalized_status_idx on public.subscriptions_v2 (normalized_status);

alter table public.subscriptions_v2 enable row level security;

-- Mirrors subscriptions' RLS exactly: members may read their own org's row;
-- no insert/update/delete policy — webhook-only writer, same as today.
create policy subscriptions_v2_select_member on public.subscriptions_v2
  for select using (public.is_organization_member(organization_id));

create trigger subscriptions_v2_set_updated_at
  before update on public.subscriptions_v2
  for each row execute function public.set_updated_at();

-- ============================================================================
-- payment_webhook_events
-- ============================================================================
-- Generic idempotency ledger, replacing the Stripe-only stripe_webhook_events
-- — one table shared across every provider's webhook handler rather than a
-- separate table per provider, keyed on (provider, event_id) instead of a
-- bare event id (Stripe/Razorpay/PayPal each mint ids from their own,
-- independent id space, so the pair is what's actually unique).
create table public.payment_webhook_events (
  provider text not null
    constraint payment_webhook_events_provider_check
    check (provider in ('stripe', 'razorpay', 'paypal')),
  event_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  constraint payment_webhook_events_pkey primary key (provider, event_id)
);

comment on table public.payment_webhook_events is 'Processed payment-provider event ids (any provider), so a retried/duplicate webhook delivery is a no-op instead of double-processing. Replacement for stripe_webhook_events.';

-- No RLS policies at all (not just "no write policies" — no select either),
-- same as stripe_webhook_events: nothing but server-side webhook code,
-- running as the service role, ever needs to touch this table.
alter table public.payment_webhook_events enable row level security;
