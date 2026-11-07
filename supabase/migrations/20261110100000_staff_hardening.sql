-- Staff hardening.
--
-- is_staff_email(): lets the public "forgot password" form skip staff
-- accounts. Staff passwords are reset only by an owner or the security team
-- in the console (setup link or "set password"), never by self-service
-- email, so access to a staff member's mailbox alone can't start a reset.
-- Service role only; returns a boolean and nothing about the account.

create function public.is_staff_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.staff_members s on s.user_id = u.id
    where lower(u.email) = lower(trim(p_email))
  );
$$;

revoke all on function public.is_staff_email(text) from public, anon, authenticated;
grant execute on function public.is_staff_email(text) to service_role;
