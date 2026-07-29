-- Lead qualification status, tracked independently of any campaign
-- enrollment (see campaign_leads.status, which tracks per-campaign send
-- state once campaigns exist).

alter table public.leads
  add column status text not null default 'new'
    constraint leads_status_check
    check (status in ('new', 'contacted', 'replied', 'qualified', 'unqualified'));

create index leads_status_idx on public.leads (status);
