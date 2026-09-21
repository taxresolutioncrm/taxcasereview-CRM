-- TaxResolution CRM Disk I/O guardrails.
-- Keeps pg_net / pg_cron history bounded and covers advisor-reported FK gaps.
-- This is intentionally conservative: it does not change application data.

create index if not exists idx_formacorp_lifecycle_case_id
  on public.formacorp_lifecycle(case_id);
create index if not exists idx_product_traffic_channels_channel_key
  on public.product_traffic_channels(channel_key);
create index if not exists idx_prospects_tenant_id_fk
  on public.prospects(tenant_id);
create index if not exists idx_romylabs_esign_events_recipient_id
  on public.romylabs_esign_events(recipient_id);
create index if not exists idx_romylabs_esign_token_aliases_recipient_id
  on public.romylabs_esign_token_aliases(recipient_id);
create index if not exists idx_romylabs_sales_agreement_events_agreement_id
  on public.romylabs_sales_agreement_events(agreement_id);
create index if not exists idx_romylabs_sales_agreements_office_agreement_id
  on public.romylabs_sales_agreements(office_agreement_id);
create index if not exists idx_romylabs_sales_agreements_prospect_id
  on public.romylabs_sales_agreements(prospect_id);
create index if not exists idx_romylabs_sales_agreements_template_id
  on public.romylabs_sales_agreements(template_id);
create index if not exists idx_romylabs_sales_agreements_tenant_id_fk
  on public.romylabs_sales_agreements(tenant_id);

-- Two hot tenant tables still had direct function evaluation instead of init-plan form.
drop policy if exists tenant_isolation on public.employees;
create policy tenant_isolation on public.employees
  for all to public
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists tenant_isolation on public.settings;
create policy tenant_isolation on public.settings
  for all to public
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists hide_qa_certification_employees_from_staff on public.employees;
create policy hide_qa_certification_employees_from_staff on public.employees
  as restrictive
  for select to authenticated
  using (
    (
      coalesce(notes,'') not ilike 'TEMP QA%'
      and coalesce(id,'') not like 'qa_%'
      and coalesce(email,'') not like 'qa_%@%'
    )
    or lower(coalesce(email,'')) = lower(coalesce((select auth.jwt()->>'email'),''))
  );

create or replace function public.prune_taxres_operational_history()
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public, net, cron
as $$
declare
  v_http integer := 0;
  v_cron integer := 0;
begin
  delete from net._http_response
  where created < now() - interval '12 hours';
  get diagnostics v_http = row_count;

  delete from cron.job_run_details
  where start_time < now() - interval '7 days';
  get diagnostics v_cron = row_count;

  return jsonb_build_object(
    'http_responses_deleted', v_http,
    'cron_runs_deleted', v_cron,
    'ran_at', now()
  );
end
$$;

revoke all on function public.prune_taxres_operational_history() from public, anon, authenticated;
grant execute on function public.prune_taxres_operational_history() to service_role;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname='taxres-io-history-prune'
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'taxres-io-history-prune',
  '17 */6 * * *',
  'select public.prune_taxres_operational_history();'
);

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname in ('taxres-io-vacuum-net','taxres-io-vacuum-cron')
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'taxres-io-vacuum-net',
  '41 4 * * *',
  'vacuum (analyze) net._http_response;'
);

select cron.schedule(
  'taxres-io-vacuum-cron',
  '47 4 * * *',
  'vacuum (analyze) cron.job_run_details;'
);

-- Reclaim the two bloated operational-history relations once at rollout.
-- pg_net responses are only discarded if no LinkedIn publish is waiting on a response.
truncate table cron.job_run_details;

do $$
begin
  if not exists (
    select 1 from public.linkedin_posts where status='publishing'
  ) then
    truncate table net._http_response;
  end if;
end $$;

select public.prune_taxres_operational_history();
