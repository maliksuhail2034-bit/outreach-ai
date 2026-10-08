-- Durable "at most one open checkout per organization" for Razorpay.
--
-- The billing:checkout_start rate limit (lib/rate-limit/config.ts) only
-- covers a 2-minute window: a checkout left open longer than that could be
-- joined by a second one, leaving two payable Razorpay subscriptions for one
-- organization. This table records each checkout before its Razorpay
-- subscription is created, and a partial unique index makes a second open
-- checkout for the same organization impossible at the database level.
--
-- Flow (app/(app)/billing/razorpay-actions.ts):
--   claim_billing_checkout       -> reserve (or reuse) the org's open checkout;
--                                   a NEW claim also returns a private claim token
--   Razorpay subscriptions.create -> only for a newly claimed checkout
--   attach_billing_checkout_subscription -> record the Razorpay id on it (token)
--   release_billing_checkout     -> only when the Razorpay call itself failed (token)
-- The webhook (service role) marks a checkout completed once the
-- subscription it created has been synced into subscriptions_v2.
--
-- Claim token: attach/release change the one checkout that guards against a
-- second Razorpay subscription, so organization membership alone is not
-- enough to call them — any member could otherwise release a checkout while
-- the server action is between creating its Razorpay subscription and
-- attaching it, and open the door to a second one. Only the request that
-- created a claim gets its token (256 random bits from pgcrypto, returned
-- once); only its SHA-256 hash is stored, and it is cleared as soon as the
-- claim can no longer be attached or released.
--
-- Expiry is lazy: an open checkout past expires_at is abandoned by the next
-- claim for that organization. No cron job. "abandoned" is only an app-side
-- coordination state — the Razorpay subscription itself is never cancelled
-- from here.

create table public.billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null
    constraint billing_checkouts_provider_check
    check (provider in ('stripe', 'razorpay', 'paypal')),
  -- Null between the claim and the Razorpay call returning (see the
  -- in-progress handling in claim_billing_checkout).
  provider_subscription_id text,
  internal_plan_id text not null
    constraint billing_checkouts_internal_plan_id_check
    check (internal_plan_id in ('starter', 'growth', 'pro', 'scale')),
  billing_interval text not null
    constraint billing_checkouts_billing_interval_check
    check (billing_interval in ('1_month', '3_month', '6_month', '12_month')),
  currency text not null
    constraint billing_checkouts_currency_check
    check (currency in ('USD', 'INR')),
  status text not null default 'open'
    constraint billing_checkouts_status_check
    check (status in ('open', 'completed', 'abandoned')),
  expires_at timestamptz not null,
  -- SHA-256 of the claim token; never the token itself. Only kept while the
  -- claim can still be attached or released (open, no provider id yet).
  claim_token_hash bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Nulls are distinct, so any number of not-yet-attached rows can coexist
  -- historically; a real provider id can only ever belong to one checkout.
  constraint billing_checkouts_provider_subscription_id_key unique (provider, provider_subscription_id),
  constraint billing_checkouts_claim_token_hash_check
    check (claim_token_hash is null or (status = 'open' and provider_subscription_id is null))
);

comment on table public.billing_checkouts is 'Checkouts started from the billing page, before the provider confirms payment. At most one open checkout per organization. Written only through the claim/attach/release functions and the webhook, never directly by the client.';

-- The invariant itself. Also serves as the organization_id lookup index for
-- open checkouts.
create unique index billing_checkouts_one_open_per_organization_idx
  on public.billing_checkouts (organization_id)
  where status = 'open';

create index billing_checkouts_organization_id_idx on public.billing_checkouts (organization_id);

alter table public.billing_checkouts enable row level security;

-- Same shape as subscriptions_v2/billing_customers_v2: members may read their
-- own org's rows; no insert/update/delete policy. Privileges are granted
-- explicitly (as lead_segments/email_send_usage do): users get select only,
-- so a missing policy is not the only thing standing in the way of a direct
-- write; the service role (the webhook) can complete checkouts.
create policy billing_checkouts_select_member on public.billing_checkouts
  for select using (public.is_organization_member(organization_id));

revoke all on table public.billing_checkouts from anon, authenticated;
grant select on table public.billing_checkouts to authenticated;
grant select, insert, update, delete on table public.billing_checkouts to service_role;

create trigger billing_checkouts_set_updated_at
  before update on public.billing_checkouts
  for each row execute function public.set_updated_at();

-- ============================================================================
-- claim_billing_checkout
-- ============================================================================
-- Reserves the caller's organization's single open checkout for this
-- plan/interval/currency, or reports the one already open.
--
-- claim_outcome:
--   'claimed'  -> a new open checkout was created; claim_token is its private
--                 token, returned only here, only once. The caller may now
--                 create the Razorpay subscription and attach it.
--   'existing' -> an unexpired open checkout for the same plan/interval/
--                 currency already exists. checkout_subscription_id is its
--                 Razorpay id, or null while another request is still
--                 creating it. No token: the caller must NOT create another
--                 subscription or change this checkout.
--   'conflict' -> an unexpired open checkout for a different plan/interval/
--                 currency exists. Nothing is changed.
--
-- Membership is checked against auth.uid(), so a caller-supplied
-- organization id is never trusted. A per-organization advisory lock
-- serializes concurrent claims; the partial unique index above backstops it.
create or replace function public.claim_billing_checkout(
  p_organization_id uuid,
  p_internal_plan_id text,
  p_billing_interval text,
  p_currency text
)
returns table (checkout_id uuid, claim_outcome text, checkout_subscription_id text, claim_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.billing_checkouts%rowtype;
  v_token text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = auth.uid()
  ) then
    raise exception 'not authorized for this organization' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing_checkout:' || p_organization_id::text, 0));

  -- Lazy expiry: an open checkout past its window no longer blocks.
  update public.billing_checkouts bc
  set status = 'abandoned', claim_token_hash = null
  where bc.organization_id = p_organization_id
    and bc.status = 'open'
    and bc.expires_at <= now();

  select * into v_open
  from public.billing_checkouts bc
  where bc.organization_id = p_organization_id
    and bc.status = 'open'
  for update;

  if found then
    if v_open.internal_plan_id = p_internal_plan_id
      and v_open.billing_interval = p_billing_interval
      and v_open.currency = p_currency then
      return query select v_open.id, 'existing'::text, v_open.provider_subscription_id, null::text;
    else
      return query select v_open.id, 'conflict'::text, null::text, null::text;
    end if;
    return;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.billing_checkouts (organization_id, provider, internal_plan_id, billing_interval, currency, expires_at, claim_token_hash)
  values (p_organization_id, 'razorpay', p_internal_plan_id, p_billing_interval, p_currency, now() + interval '30 minutes',
    extensions.digest(v_token, 'sha256'))
  returning * into v_open;

  return query select v_open.id, 'claimed'::text, null::text, v_token;
end;
$$;

comment on function public.claim_billing_checkout(uuid, text, text, text) is 'Claims the caller organization single open checkout (30 minute TTL), reusing a matching unexpired one and rejecting a different one. Must succeed before any Razorpay subscription is created.';

-- ============================================================================
-- attach_billing_checkout_subscription
-- ============================================================================
-- Records the Razorpay subscription id on a claimed checkout. Requires the
-- claim token the claim returned (organization membership is checked too),
-- and only fills an empty slot on a still-open, unexpired checkout, so it can
-- never overwrite an id already attached. Clears the token hash: once the id
-- is attached the claim can be neither attached nor released again. Returns
-- whether it attached; a wrong token is indistinguishable from a missing
-- checkout.
--
-- The token is compared by its SHA-256 hash, so any timing difference in the
-- comparison reveals nothing usable about the token itself.
create or replace function public.attach_billing_checkout_subscription(
  p_checkout_id uuid,
  p_claim_token text,
  p_provider_subscription_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_claim_token is null or p_provider_subscription_id is null then
    return false;
  end if;

  update public.billing_checkouts bc
  set provider_subscription_id = p_provider_subscription_id,
      claim_token_hash = null
  where bc.id = p_checkout_id
    and bc.claim_token_hash = extensions.digest(p_claim_token, 'sha256')
    and bc.status = 'open'
    and bc.provider_subscription_id is null
    and bc.expires_at > now()
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = bc.organization_id and m.user_id = auth.uid()
    )
  returning bc.id into v_id;

  return v_id is not null;
end;
$$;

comment on function public.attach_billing_checkout_subscription(uuid, text, text) is 'Attaches the provider subscription id to an open, unexpired, not-yet-attached checkout of the caller organization, given that claim private token.';

-- ============================================================================
-- release_billing_checkout
-- ============================================================================
-- Abandons a claimed checkout whose Razorpay call explicitly failed, so the
-- organization is not blocked for the rest of the TTL. Requires the claim
-- token, like attach. Refuses once a provider id is attached (attaching also
-- clears the token hash, so no token matches any more): a checkout with a
-- real Razorpay subscription behind it is only ever left to complete or
-- expire, never released early.
create or replace function public.release_billing_checkout(p_checkout_id uuid, p_claim_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_claim_token is null then
    return false;
  end if;

  update public.billing_checkouts bc
  set status = 'abandoned',
      claim_token_hash = null
  where bc.id = p_checkout_id
    and bc.claim_token_hash = extensions.digest(p_claim_token, 'sha256')
    and bc.status = 'open'
    and bc.provider_subscription_id is null
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = bc.organization_id and m.user_id = auth.uid()
    )
  returning bc.id into v_id;

  return v_id is not null;
end;
$$;

comment on function public.release_billing_checkout(uuid, text) is 'Abandons an open checkout of the caller organization that has no provider subscription attached (the provider call failed), given that claim private token.';

revoke execute on function public.claim_billing_checkout(uuid, text, text, text) from public, anon;
revoke execute on function public.attach_billing_checkout_subscription(uuid, text, text) from public, anon;
revoke execute on function public.release_billing_checkout(uuid, text) from public, anon;
grant execute on function public.claim_billing_checkout(uuid, text, text, text) to authenticated;
grant execute on function public.attach_billing_checkout_subscription(uuid, text, text) to authenticated;
grant execute on function public.release_billing_checkout(uuid, text) to authenticated;
