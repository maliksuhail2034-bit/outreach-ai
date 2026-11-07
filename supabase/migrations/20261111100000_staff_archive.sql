-- Leavers are archived, not deleted (owner decision, 2026-11-07): an
-- archived staff account can never sign in again, but its work sessions,
-- hours and audit trail stay for payroll and disputes. Archiving is
-- permanent from the console; rehiring someone means a new account.

alter table public.staff_members drop constraint staff_members_status_check;
alter table public.staff_members
  add constraint staff_members_status_check check (status in ('invited', 'active', 'disabled', 'archived'));

alter table public.staff_members
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id) on delete set null,
  add constraint staff_members_archived_consistent check ((status = 'archived') = (archived_at is not null));

comment on column public.staff_members.archived_at is 'When the account was archived (leaver). Archived accounts never sign in again; their history is kept.';
