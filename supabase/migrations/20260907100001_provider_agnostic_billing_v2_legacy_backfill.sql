-- Phase B (Legacy Backfill) of the Stripe -> provider-agnostic billing
-- migration. Depends on Phase A
-- (20260907100000_provider_agnostic_billing_v2_expand.sql) having created
-- billing_customers_v2 and payment_webhook_events. Backfills only the two
-- legacy tables that need no plan/interval mapping to copy safely — straight
-- field copies with provider fixed to 'stripe'. Does NOT touch, rename, or
-- drop billing_customers or stripe_webhook_events; both keep serving the
-- live Stripe webhook handler and billing UI unmodified.
--
-- The subscriptions -> subscriptions_v2 backfill is intentionally NOT here:
-- internal_plan_id/billing_interval depend on STRIPE_PRICE_<PLAN>_<INTERVAL>
-- environment variables (see lib/billing/plans.ts's priceIdsFor/
-- getPlanByPriceId), which are not available to this migration and have not
-- been verified. That backfill, and the guard that gates it, are a separate,
-- later phase, applied only once the real mapping is in hand — see the
-- project's Expand -> Backfill -> Cutover -> Retire plan.

-- ============================================================================
-- Backfill: billing_customers -> billing_customers_v2
-- ============================================================================
-- Straight copy, provider fixed to 'stripe' — every existing row is a Stripe
-- customer by construction (this table has never had a second provider).
-- ON CONFLICT DO NOTHING makes this safe to reason about even if this
-- migration file were ever re-applied to a database that already has v2 rows.
insert into public.billing_customers_v2 (organization_id, provider, provider_customer_id, created_at, updated_at)
select organization_id, 'stripe', stripe_customer_id, created_at, updated_at
from public.billing_customers
on conflict (organization_id, provider) do nothing;

-- ============================================================================
-- Backfill: stripe_webhook_events -> payment_webhook_events
-- ============================================================================
-- Straight copy, provider fixed to 'stripe'. No derivation involved.
insert into public.payment_webhook_events (provider, event_id, event_type, processed_at)
select 'stripe', id, type, created_at
from public.stripe_webhook_events
on conflict (provider, event_id) do nothing;
