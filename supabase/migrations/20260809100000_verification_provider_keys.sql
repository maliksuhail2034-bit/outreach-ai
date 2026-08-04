-- Email Verification v1 — Bring Your Own Key (BYOK), same shape as
-- ai_provider_keys: an organization connects its own MillionVerifier API
-- key rather than the app purchasing/managing verification credits. See
-- lib/verification/ for the provider abstraction and
-- lib/crypto/verification-provider-key-secret.ts for how the key is
-- encrypted at rest.
--
-- Organization-scoped (organization_id, not user_id) for the same reason as
-- ai_provider_keys: the key belongs to the organization, not the individual
-- member who pasted it in, even though leads (the table this key verifies)
-- is still user_id-scoped — see the leads_verification migration's comment.
--
-- `provider` is a text enum ('millionverifier') — a second verification
-- vendor is added by extending this check constraint and
-- lib/verification/get-provider.ts's factory, never by changing this
-- table's shape. A future managed-credit option (outreach-ai buying
-- verification credit on the organization's behalf) is added the same way
-- lib/ai/get-provider.ts documents for AI: a new branch in
-- lib/verification/verify.ts's key-lookup, no change here. Unique on
-- (organization_id, provider): one connected key per provider per
-- organization, matching ai_provider_keys/integrations' one-row-per-provider
-- shape.
--
-- The API key itself is never stored in plaintext — only
-- encrypted_api_key (AES-256-GCM via lib/crypto/verification-provider-key-secret.ts).
-- `key_preview` holds a display-only fragment (e.g. last 4 characters) so
-- the settings UI can show which key is connected without ever decrypting
-- it for display.
create table public.verification_provider_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null
    constraint verification_provider_keys_provider_check check (provider in ('millionverifier')),
  encrypted_api_key text not null,
  key_preview text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verification_provider_keys_organization_provider_key unique (organization_id, provider)
);

comment on table public.verification_provider_keys is 'Per-organization, bring-your-own email verification provider API keys (MillionVerifier). One row per organization per provider. No managed/app-provided key in v1 — outreach-ai never purchases verification credits on behalf of users.';
comment on column public.verification_provider_keys.encrypted_api_key is 'AES-256-GCM ciphertext, see lib/crypto/verification-provider-key-secret.ts. Never exposed to the client.';
comment on column public.verification_provider_keys.key_preview is 'Display-only fragment (e.g. last 4 characters) of the plaintext key, captured at connect time, so the UI never needs to decrypt the stored key just to render it.';

create index verification_provider_keys_organization_id_idx on public.verification_provider_keys (organization_id);

alter table public.verification_provider_keys enable row level security;

create policy verification_provider_keys_select_member on public.verification_provider_keys
  for select using (public.is_organization_member(organization_id));

create policy verification_provider_keys_insert_member on public.verification_provider_keys
  for insert with check (public.is_organization_member(organization_id));

create policy verification_provider_keys_update_member on public.verification_provider_keys
  for update using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create policy verification_provider_keys_delete_member on public.verification_provider_keys
  for delete using (public.is_organization_member(organization_id));

create trigger verification_provider_keys_set_updated_at
  before update on public.verification_provider_keys
  for each row execute function public.set_updated_at();
