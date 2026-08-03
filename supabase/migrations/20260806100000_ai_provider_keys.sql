-- AI Recommendations v1 — Bring Your Own Key (BYOK). An organization
-- connects its own Claude/OpenAI/Gemini API key rather than the app
-- providing managed AI; see lib/ai/ for the provider abstraction and
-- lib/crypto/ai-provider-key-secret.ts for how the key is encrypted at rest.
--
-- Organization-scoped (organization_id, not user_id), same convention as
-- warmup_profiles/integrations: the key belongs to the organization, not the
-- individual member who pasted it in.
--
-- `provider` is a text enum ('anthropic' | 'openai' | 'google') — a future
-- managed-AI option is added by extending this check constraint (e.g. a
-- 'managed' pseudo-provider) and lib/ai/get-provider.ts's factory, never by
-- changing this table's shape. Unique on (organization_id, provider): one
-- connected key per provider per organization, matching integrations'
-- one-row-per-provider shape.
--
-- The API key itself is never stored in plaintext — only
-- encrypted_api_key (AES-256-GCM via lib/crypto/ai-provider-key-secret.ts).
-- `key_preview` holds a display-only fragment (e.g. last 4 characters) so
-- the settings UI can show which key is connected without ever decrypting
-- it for display.
create table public.ai_provider_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null
    constraint ai_provider_keys_provider_check check (provider in ('anthropic', 'openai', 'google')),
  encrypted_api_key text not null,
  key_preview text not null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_provider_keys_organization_provider_key unique (organization_id, provider)
);

comment on table public.ai_provider_keys is 'Per-organization, bring-your-own AI provider API keys (Claude/OpenAI/Gemini) used to generate AI Recommendations. One row per organization per provider. No managed/app-provided key in v1.';
comment on column public.ai_provider_keys.encrypted_api_key is 'AES-256-GCM ciphertext, see lib/crypto/ai-provider-key-secret.ts. Never exposed to the client.';
comment on column public.ai_provider_keys.key_preview is 'Display-only fragment (e.g. last 4 characters) of the plaintext key, captured at connect time, so the UI never needs to decrypt the stored key just to render it.';
comment on column public.ai_provider_keys.model is 'Optional model override (e.g. "claude-sonnet-4-5"); null means the provider's default model (see lib/ai/providers/*.ts).';

create index ai_provider_keys_organization_id_idx on public.ai_provider_keys (organization_id);

alter table public.ai_provider_keys enable row level security;

create policy ai_provider_keys_select_member on public.ai_provider_keys
  for select using (public.is_organization_member(organization_id));

create policy ai_provider_keys_insert_member on public.ai_provider_keys
  for insert with check (public.is_organization_member(organization_id));

create policy ai_provider_keys_update_member on public.ai_provider_keys
  for update using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));

create policy ai_provider_keys_delete_member on public.ai_provider_keys
  for delete using (public.is_organization_member(organization_id));

create trigger ai_provider_keys_set_updated_at
  before update on public.ai_provider_keys
  for each row execute function public.set_updated_at();
