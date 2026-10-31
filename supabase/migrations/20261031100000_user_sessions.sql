-- Lets a signed-in user see and revoke their own login sessions
-- (Settings → Sessions). auth.sessions isn't exposed through the API, so
-- these security definer functions are the only way in, and each one is
-- scoped to auth.uid() — a caller can never see or end another user's
-- session, whatever id it passes.
--
-- Revoking deletes the auth.sessions row; its refresh tokens cascade with it.
-- The revoked device's access token stays valid until it expires, but every
-- request to the app checks it with Supabase Auth (auth.getUser() in
-- proxy.ts and the (app) layout), which rejects a token whose session no
-- longer exists — so that device is signed out on its next request.

create or replace function public.list_my_sessions()
returns table (
  id uuid,
  created_at timestamptz,
  last_active_at timestamptz,
  user_agent text,
  is_current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.created_at,
    -- refreshed_at is stored without a time zone, in UTC.
    greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'UTC') as last_active_at,
    s.user_agent,
    s.id is not distinct from (auth.jwt() ->> 'session_id')::uuid as is_current
  from auth.sessions s
  where s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > now())
  order by is_current desc, last_active_at desc;
$$;

-- Returns whether a session was ended; false for an id that doesn't exist or
-- belongs to someone else (indistinguishable on purpose).
create or replace function public.revoke_my_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from auth.sessions s
  where s.id = p_session_id and s.user_id = auth.uid();
  get diagnostics v_deleted = row_count;

  return v_deleted > 0;
end;
$$;

revoke execute on function public.list_my_sessions() from public, anon;
revoke execute on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.list_my_sessions() to authenticated;
grant execute on function public.revoke_my_session(uuid) to authenticated;
