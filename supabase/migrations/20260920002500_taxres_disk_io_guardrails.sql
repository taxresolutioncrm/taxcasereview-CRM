-- TaxResolution CRM Disk I/O guardrails.
-- Keeps pg_net / pg_cron history bounded and covers advisor-reported FK gaps.
-- This is intentionally conservative: it does not change application data.

create index if not exists idx_cron_job_run_details_start_time
  on cron.job_run_details(start_time);

alter table net._http_response set (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 50
);

alter table cron.job_run_details set (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.10,
  autovacuum_analyze_threshold = 500
);

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

-- Trim accumulated history immediately on migration so the project starts from a bounded baseline.
select public.prune_taxres_operational_history();
