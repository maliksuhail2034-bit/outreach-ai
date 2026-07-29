-- Extensions and shared helper functions used by every table migration
-- that follows. Keep this migration first in the chain.

-- gen_random_uuid() ships in Postgres core as of v13, but pgcrypto is
-- enabled defensively so this schema also works on older/managed
-- environments where the function still lives in the extension.
create extension if not exists pgcrypto with schema extensions;

-- Keeps `updated_at` current on every UPDATE without relying on
-- application code to set it. Attached per-table as `<table>_set_updated_at`.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
