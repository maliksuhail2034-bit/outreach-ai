-- Per-lead timezone (launch audit: per-lead / per-region timezone).
--
-- An explicit IANA timezone name for the lead, e.g. America/New_York. When
-- it is set and valid, the send pipeline applies the campaign's sending
-- window (days and hours) in this timezone instead of the campaign's own;
-- when it is null, or not a valid IANA name, the campaign timezone is used
-- exactly as before. Nothing is derived automatically from country or city.
--
-- Validity is checked in the app (lib/timezones.ts isValidIanaTimezone, the
-- same check the campaign sending window uses) at every write path, and
-- again when the value is read for scheduling. The length bound here only
-- keeps the column sane; IANA names are well under 64 characters.
--
-- Nullable with no default: every existing lead keeps behaving exactly as
-- it does today. The existing leads RLS policies already cover every column
-- of the table, so no policy changes are needed.

alter table public.leads
  add column timezone text
  constraint leads_timezone_length check (timezone is null or char_length(timezone) between 1 and 64);

comment on column public.leads.timezone is 'Explicit IANA timezone for this lead, e.g. America/New_York. Null means use the campaign sending-window timezone.';
