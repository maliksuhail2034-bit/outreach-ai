-- Scalability Track, Phase A (Item 11, migration portion only): add plain
-- created_at indexes to rate_limit_events and job_runs.
--
-- Verified this session: neither table has an index that leads with
-- created_at alone. rate_limit_events only has
-- (scope, identity, created_at desc) (20260813100000_rate_limit_events.sql)
-- and job_runs only has (job, created_at desc)
-- (20260811100000_job_runs.sql) -- Postgres cannot use either composite
-- index to satisfy a plain "where created_at < X" predicate with no other
-- filter, which is exactly the query a future retention/pruning worker
-- (Scalability Track Phase B) will run. Without this, that worker's delete
-- would force a full table scan on the two fastest-growing tables in the
-- schema. No worker exists yet that deletes anything -- this migration adds
-- only the index, nothing reads or writes differently today.

create index rate_limit_events_created_at_idx on public.rate_limit_events (created_at);
create index job_runs_created_at_idx on public.job_runs (created_at);
