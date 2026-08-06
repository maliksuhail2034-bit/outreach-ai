-- Scalability Track, Phase A (Item 3): widen analytics_daily_rollups'
-- event_type constraint to also accept email_events' vocabulary.
--
-- analytics_daily_rollups (20260803100000_analytics.sql) was built for the
-- analytics_events stream and currently only allows 'email_sent' (not
-- 'sent') and has no 'failed' value at all, while email_events
-- (20260728100110_email_events.sql) uses ('sent', 'delivered', 'opened',
-- 'clicked', 'replied', 'bounced', 'unsubscribed', 'failed'). A future
-- aggregation worker reading email_events and upserting into this table
-- (Scalability Track Phase B) needs both vocabularies accepted here.
--
-- Schema-only, purely additive: widens an allow-list, adds no column, and
-- the table has zero rows today (per its own migration's comment), so
-- there is nothing existing to validate against or migrate. No worker
-- reads or writes analytics_daily_rollups yet — this alone has zero
-- production behavior change.

alter table public.analytics_daily_rollups
  drop constraint analytics_daily_rollups_event_type_check;

alter table public.analytics_daily_rollups
  add constraint analytics_daily_rollups_event_type_check
  check (event_type in (
    'email_sent', 'sent', 'delivered', 'bounced', 'opened', 'clicked', 'replied',
    'positive_reply', 'meeting_booked', 'unsubscribed', 'spam_report', 'campaign_completed', 'failed'
  ));
