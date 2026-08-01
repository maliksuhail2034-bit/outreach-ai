-- Stripe billing foundation. Attached to organizations (Task 3's seam),
-- not directly to auth.users — this is the first feature to actually use
-- that ownership shape, per "future features should use organization
-- ownership where appropriate". No existing table's ownership/RLS changes.
--
-- Plan tiers/limits themselves are NOT a database table — they're a small
-- config module (lib/billing/plans.ts) keyed by Stripe price id. Nothing
-- here needs a `plans` or `usage` table: usage is computed on demand from
-- existing tables (mailboxes/campaigns/leads already have count*()
-- helpers), so adding a table for it would just be a redundant, driftable
-- cache of numbers the DB can already answer directly.

-- Maps an organization to its Stripe Customer. Written only by the webhook
-- handler (source of truth is Stripe, not anything a user submits) — see
-- lib/billing/sync-subscription.ts.
create table public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_customers_organization_id_key unique (organization_id),
  constraint billing_customers_stripe_customer_id_key unique (stripe_customer_id)
);

comment on table public.billing_customers is 'One row per organization: which Stripe Customer they are. Written only by the Stripe webhook handler.';

alter table public.billing_customers enable row level security;

create policy billing_customers_select_member on public.billing_customers
  for select using (public.is_organization_member(organization_id));

-- No insert/update/delete policy: this table's only writer is the webhook
-- handler (lib/supabase/admin.ts, service role) — same carve-out as
-- send_attempts' missing insert/delete policies
-- (20260730100030_send_attempts.sql). Billing state must never be
-- settable by the client it's gating.

create trigger billing_customers_set_updated_at
  before update on public.billing_customers
  for each row execute function public.set_updated_at();

-- Current subscription state per organization, mirrored from Stripe.
-- "Current" only — not a history log (not required, and Stripe's own
-- dashboard is the source of truth for history). Upserted on
-- organization_id, so a cancel-then-resubscribe (a new Stripe subscription
-- object, different id) cleanly overwrites the old row instead of needing
-- reconciliation logic.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  stripe_subscription_id text not null,
  stripe_price_id text not null,
  status text not null
    constraint subscriptions_status_check
    check (status in ('active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_organization_id_key unique (organization_id),
  constraint subscriptions_stripe_subscription_id_key unique (stripe_subscription_id)
);

comment on table public.subscriptions is 'Current Stripe subscription state per organization — no row means the organization is on the free plan.';

create index subscriptions_status_idx on public.subscriptions (status);

alter table public.subscriptions enable row level security;

create policy subscriptions_select_member on public.subscriptions
  for select using (public.is_organization_member(organization_id));

-- No insert/update/delete policy — webhook-only writer, same reasoning as
-- billing_customers above. "Never trust client-side plan information" is
-- structural here, not just a convention: there is no policy a client
-- request could use to write this table even if it tried.

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Idempotency ledger for the webhook handler. Stripe explicitly recommends
-- recording event ids and skipping duplicates (retries, and the same event
-- occasionally being delivered more than once) rather than assuming
-- exactly-once delivery. No RLS policies at all (not just "no write
-- policies" — no select either): nothing but the webhook handler, running
-- as the service role, ever needs to touch this table.
create table public.stripe_webhook_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

comment on table public.stripe_webhook_events is 'Processed Stripe event ids, so a retried/duplicate webhook delivery is a no-op instead of double-processing.';

alter table public.stripe_webhook_events enable row level security;
