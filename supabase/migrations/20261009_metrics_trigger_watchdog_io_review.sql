-- Sandbox proposal ONLY. Do not apply without approval and a baseline.
-- Purpose: remove redundant every-minute schema trigger installation.
-- Existing per-table data-change triggers remain installed and active,
-- preserving real-time data change signals. This only reschedules the
-- DDL-discovery watchdog that checks for newly created tables.
--
-- IMPORTANT: verify schedule policy for new tables before applying.
select cron.alter_job(
  job_id := 69,
  schedule := '7 * * * *'
);
-- Verification:
-- select jobid, jobname, schedule, active from cron.job where jobid = 69;
-- select * from pg_stat_activity where wait_event_type = 'IO';
