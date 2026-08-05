-- Performance audit (Phase 1, P4): listEmailEvents (lib/db/email-events.ts)
-- filters by campaign_id or mailbox_id and orders by created_at desc with a
-- limit. The single-column indexes from 20260728100110_email_events.sql let
-- Postgres find matching rows but then require a separate sort of the full
-- matched set instead of walking an index straight to the limit.
-- analytics_events (20260803100000_analytics.sql) already got this composite
-- shape right; this brings the older email_events table in line with it.

create index email_events_campaign_id_created_at_idx
  on public.email_events (campaign_id, created_at desc);

create index email_events_mailbox_id_created_at_idx
  on public.email_events (mailbox_id, created_at desc);
