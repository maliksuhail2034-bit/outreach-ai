-- Default mailbox a campaign sends from. Individual campaign_leads rows may
-- still override this per lead (see campaign_leads.mailbox_id) — this column
-- is just the fallback assigned when a lead is enrolled without an explicit
-- override.

alter table public.campaigns
  add column default_mailbox_id uuid references public.mailboxes (id) on delete set null;

create index campaigns_default_mailbox_id_idx on public.campaigns (default_mailbox_id);

-- Defense in depth: a campaign's default mailbox must belong to the same
-- user, even though RLS on both tables already prevents referencing rows
-- the user can't see.
create or replace function public.check_campaign_default_mailbox_owner()
returns trigger
language plpgsql
as $$
begin
  if new.default_mailbox_id is not null and not exists (
    select 1 from public.mailboxes m where m.id = new.default_mailbox_id and m.user_id = new.user_id
  ) then
    raise exception 'campaigns.default_mailbox_id must reference a mailbox owned by the same user';
  end if;
  return new;
end;
$$;

create trigger campaigns_check_default_mailbox_owner
  before insert or update on public.campaigns
  for each row execute function public.check_campaign_default_mailbox_owner();
