-- TaxRes CRM + Arcvena LinkedIn autopilot.
-- Generation is database-scheduled (no GitHub Actions minutes) and publishing
-- remains fail-closed unless the matching product has a verified ORGANIZATION target.

insert into public.linkedin_settings (tenant_id,product_id,autopilot,timezone,updated_at)
values
  ('a0000000-0000-0000-0000-000000000001','taxres_crm',true,'America/New_York',now()),
  ('a0000000-0000-0000-0000-000000000001','arcvena',true,'America/New_York',now())
on conflict (tenant_id,product_id) do update
set autopilot=excluded.autopilot,
    timezone=excluded.timezone,
    updated_at=excluded.updated_at;

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='linkedin-autopilot-run'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

select cron.schedule(
  'linkedin-autopilot-run',
  '7 * * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/linkedin-scheduler',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name='tcr_internal_cron_token' limit 1)
    ),
    body := '{"action":"run"}'::jsonb
  );
  $job$
);
