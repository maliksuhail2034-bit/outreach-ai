-- Scalability Track, Phase D, Step 3 (items 8/9): composite indexes
-- supporting the newly-cut-over paginated queries (listLeadsPage() /
-- listCampaignsPage(), lib/db/leads.ts / lib/db/campaigns.ts), wired into
-- app/(app)/leads/page.tsx and app/(app)/campaigns/page.tsx in this same
-- step. Deliberately deferred from Phase B (where the query functions were
-- built but unreachable) to this phase, where they actually go live --
-- mirrors the shape already established for email_events
-- (20260810100000_email_events_composite_indexes.sql): leads_user_id_idx /
-- campaigns_user_id_idx alone let Postgres find matching rows but then
-- require a separate sort of the full matched set instead of walking an
-- index straight to the `order by created_at desc` + `range()` these
-- queries use.

create index leads_user_id_created_at_idx
  on public.leads (user_id, created_at desc);

create index campaigns_user_id_created_at_idx
  on public.campaigns (user_id, created_at desc);
