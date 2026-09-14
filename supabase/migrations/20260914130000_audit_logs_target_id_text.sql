-- Fixes a bug discovered while verifying the Razorpay Phase 1 webhook: both
-- the Razorpay and Stripe webhook handlers write the payment provider's own
-- subscription id (e.g. "sub_xxxxxxxxxxxxx") into audit_logs.target_id for
-- the billing_subscription_changed action, but that column was declared
-- uuid — Razorpay/Stripe subscription ids are not UUIDs, so every one of
-- those inserts has been silently failing with Postgres error 22P02
-- (invalid_text_representation). recordAuditEvent() (lib/db/audit-log.ts)
-- deliberately swallows insert errors rather than throwing (so a broken
-- audit write never blocks the webhook/action it's recording), which is why
-- this has gone unnoticed: subscriptions_v2/billing_customers_v2/
-- payment_webhook_events all wrote correctly, only the audit trail entry
-- was silently lost every time.
--
-- target_id was never a real foreign key (see this column's original
-- comment in 20260812100000_audit_logs.sql: "a loosely-typed reference,
-- not a real foreign key, same pattern as analytics_events.subject_type/
-- subject_id") — every other current caller (mailbox/integration/AI-key/
-- verification-key actions) already passes one of this app's own row
-- UUIDs, which converts losslessly to text, so relaxing the column to text
-- changes nothing for them and fixes the two webhook call sites that pass
-- an opaque, non-UUID provider id.
--
-- No FK, no CHECK constraint, and no index exists on target_id itself (see
-- audit_logs_organization_id_created_at_idx / audit_logs_action_idx, both
-- keyed on other columns) and neither RLS policy references it — so this
-- column-type change has no knock-on effect on indexes, constraints, or
-- row-level security. USING target_id::text is a lossless cast: every
-- existing row's target_id is a real UUID (the column's prior type
-- enforced that), so no data can be lost or rejected by this migration.
alter table public.audit_logs
  alter column target_id type text using target_id::text;

comment on column public.audit_logs.target_id is 'Loosely-typed reference to the row this event is about (not a real foreign key) — either one of this app''s own row UUIDs (mailbox/integration/key id, as text) or an opaque payment-provider id (e.g. a Razorpay/Stripe subscription id) for billing_subscription_changed. See lib/db/audit-log.ts.';
