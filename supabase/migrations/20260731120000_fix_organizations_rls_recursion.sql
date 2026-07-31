-- 20260731110000_organizations.sql's organizations_select_member policy
-- queries organization_members, whose own select policy queries
-- organizations back — Postgres RLS evaluates the referenced table's
-- policies too, so this is a genuine infinite-recursion cycle between the
-- two tables' policies (confirmed live: "infinite recursion detected in
-- policy for relation organizations" on a plain select). A security
-- definer function breaks the cycle: it runs as the function's owner
-- (bypassing RLS on the table it queries internally) instead of as the
-- calling user, so calling it from organizations' policy no longer
-- re-triggers organization_members' policy evaluation.
create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = auth.uid()
  );
$$;

drop policy organizations_select_member on public.organizations;

create policy organizations_select_member on public.organizations
  for select using (public.is_organization_member(id));
