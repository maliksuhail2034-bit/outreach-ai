-- After 20260731120000's recursion fix, creating an organization still
-- failed live with "new row violates row-level security policy for table
-- organizations": right after INSERT, the new org has no membership row
-- yet (that's the very next statement getOrCreateOrganizationForUser
-- runs), so is_organization_member() returns false and the just-inserted
-- row is invisible to its own RETURNING clause — and the same problem then
-- blocks the organization_members insert, whose own check subqueries
-- organizations looking for an owner match. The owner should always be
-- able to see their own org regardless of membership-row bookkeeping —
-- this is also just a more correct policy on its own, not only a
-- bootstrap workaround.
drop policy organizations_select_member on public.organizations;

create policy organizations_select_own_or_member on public.organizations
  for select using (owner_user_id = auth.uid() or public.is_organization_member(id));
