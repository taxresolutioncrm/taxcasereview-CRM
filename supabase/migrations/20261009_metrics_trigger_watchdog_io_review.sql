-- REVIEWED SANDBOX MIGRATION: remove repeated DDL discovery from minute-critical path.
-- This does NOT disable the 155 existing row-change event triggers, cron mail,
-- calendar, financial activity, or actual admin metrics delivery.
-- This migration is deliberately scoped to the schema-discovery watchdog.
--
-- Safety: fail closed if the job has been renamed or the command changed.
DO $$
DECLARE
  v_job record;
BEGIN
  SELECT jobid, jobname, schedule, command, active
  INTO v_job FROM cron.job WHERE jobid = 69 FOR UPDATE;
  IF NOT FOUND OR v_job.jobname <> 'romylabs-admin-metrics-trigger-watchdog'
    OR v_job.command !~ 'romylabs_install_metrics_change_triggers'
    OR NOT v_job.active THEN
    RAISE EXCEPTION 'Unexpected job 69 configuration; review manually before changing cron';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgname='romylabs_admin_metrics_changed' AND NOT tgisinternal) < 100 THEN
    RAISE EXCEPTION 'Metrics change triggers absent; refusing schedule change';
  END IF;
  PERFORM cron.alter_job(job_id := 69, schedule := '7 * * * *');
END $$;
-- Acceptance requires:
-- 1. Confirm job 69 is hourly and still active.
-- 2. Confirm metrics triggers remain attached to all expected tables.
-- 3. Create/update a test record in sandbox, verify admin metrics receive it.
-- 4. Compare pg_stat_statements, job startup failures, and authentication latency.
-- 5. Revert job 69 to '* * * * *' if schema onboarding is impaired.
