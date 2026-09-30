-- TaxRes CRM + Arcvena LinkedIn autopilot.
-- Generation is database-scheduled (no GitHub Actions minutes) and publishing
-- remains fail-closed unless the matching product has a verified ORGANIZATION target.

update public.linkedin_settings
set autopilot=true, timezone='America/New_York', updated_at=now()
where tenant_id='a0000000-0000-0000-0000-000000000001'
  and product_id in ('taxres_crm','arcvena');

insert into public.linkedin_settings (tenant_id,product_id,autopilot,timezone,updated_at)
select 'a0000000-0000-0000-0000-000000000001', v.product_id, true, 'America/New_York', now()
from (values ('taxres_crm'),('arcvena')) as v(product_id)
where not exists (
  select 1 from public.linkedin_settings s
  where s.tenant_id='a0000000-0000-0000-0000-000000000001'
    and s.product_id=v.product_id
);

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
