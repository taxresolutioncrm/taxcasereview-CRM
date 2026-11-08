-- Idempotent retirement for fresh/sandbox databases that still contain the closed legacy office.
-- Exact tenant-code/name guard; no other office is touched.
do $retire$
declare
  tid uuid;
  tbl text;
  n integer;
  found_rows bigint;
  r record;
  ordered text[]:=array[
    'workflow_steps','lead_notes','client_notes','case_notes','activity_log','admin_impersonation_tokens',
    'book_whip_rows','client_compliance_records','document_ai_runs','financial_intake_responses',
    'client_sensitive_fields','tasks','calllog','outbound_calls','emails','chat_messages','chat_channels',
    'workflow_statuses','workflow_status_categories','workflow_templates',
    'cases','leads','clients','employees','settings'
  ];
begin
  select id into tid from public.tenants where tenant_code='TRC-003' and firm_name='CloudCPA Inc';
  if tid is null then return; end if;
  if (select count(*) from public.tenants where tenant_code='TRC-003')<>1 then
    raise exception 'Retired office identity is ambiguous; no deletion';
  end if;
  if exists(select 1 from public.romylabs_billing_accounts where external_tenant_id=tid::text) then
    raise exception 'Retired office has financial history requiring separate review';
  end if;
  if exists(select 1 from public.storage_object_tenants where tenant_id=tid) then
    raise exception 'Retired office has storage objects requiring API deletion';
  end if;
  delete from public.admin_actions where target_tenant_id=tid;
  foreach tbl in array ordered loop
    if exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tbl and c.column_name='tenant_id') then
      execute format('delete from public.%I where tenant_id=$1',tbl) using tid;
    end if;
  end loop;
  for r in select x.table_name from information_schema.columns x where x.table_schema='public' and x.column_name='tenant_id' and x.udt_name='uuid' and x.table_name <> all(ordered) loop
    execute format('select count(*) from public.%I where tenant_id=$1',r.table_name) into found_rows using tid;
    if found_rows>0 then raise exception 'Retired office unreviewed data in %. Rollback.',r.table_name; end if;
  end loop;
  delete from public.romylabs_office_registry where external_office_id=tid::text;
  delete from public.tenants where id=tid and tenant_code='TRC-003';
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Retired office deletion count mismatch'; end if;
end
$retire$;

-- Keep the production-verified KPI function restricted to Tax Case Review.
CREATE OR REPLACE FUNCTION public.admin_taxres_live_kpis(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_tcr constant uuid := '61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid;
  v_token text;
  v_http extensions.http_response;
  v_batch jsonb;
  v_feed jsonb;
  v_metrics jsonb;
  v_seats integer := 0;
begin
  if not public._is_platform_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_tenant_id is not null and p_tenant_id <> c_tcr then
    raise exception 'Unknown central TaxRes tenant';
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name='tcr_internal_cron_token' limit 1;
  if coalesce(v_token,'')='' then
    raise exception 'Live TaxRes metrics token is not configured';
  end if;
  perform set_config('http.curlopt_timeout_msec','15000',true);
  perform set_config('http.curlopt_connecttimeout_msec','5000',true);
  select * into v_http from extensions.http((
    'POST'::extensions.http_method,
    'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy',
    array[
      extensions.http_header('Content-Type','application/json'),
      extensions.http_header('x-internal-cron-token',v_token)
    ],
    'application/json',
    '{"action":"metrics_batch","products":["tax_case_review"]}'
  )::extensions.http_request);
  if coalesce(v_http.status,0)<>200 then
    raise exception 'Live central TaxRes metrics unavailable (hub status %)',coalesce(v_http.status,0);
  end if;
  begin
    v_batch:=v_http.content::jsonb;
  exception when others then
    raise exception 'Live central TaxRes metrics returned invalid JSON';
  end;
  v_feed:=v_batch#>'{results,tax_case_review,data}';
  if coalesce((v_batch->>'ok')::boolean,false) is not true
     or v_feed is null
     or coalesce((v_feed->>'ok')::boolean,false) is not true then
    raise exception 'Live Tax Case Review metrics feed is unavailable';
  end if;
  select coalesce(sum(coalesce(nullif(t.billing_seats,0),
    (select count(*)::int from public.employees e where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active'))),0)::int
  into v_seats from public.tenants t where t.id=c_tcr;
  v_metrics:=jsonb_build_object(
    'clients',coalesce((v_feed#>>'{metrics,total_clients}')::int,0),
    'leads',coalesce((v_feed#>>'{metrics,total_leads}')::int,0),
    'seats',v_seats,
    'active_staff',coalesce((v_feed#>>'{metrics,active_staff}')::int,0),
    'cases',coalesce((v_feed#>>'{metrics,open_jobs}')::int,(v_feed#>>'{metrics,active_cases}')::int,0),
    'pending_tasks',coalesce((v_feed#>>'{metrics,pending_tasks}')::int,0),
    'outstanding_invoices',coalesce((v_feed#>>'{metrics,outstanding_invoices}')::int,0),
    'pending_esigns',coalesce((v_feed#>>'{metrics,pending_esigns}')::int,0),
    'demos_today',coalesce((v_feed#>>'{metrics,demos_today}')::int,0),
    'storage_bytes',coalesce((v_feed#>>'{metrics,storage_bytes}')::bigint,0),
    'storage_files',coalesce((v_feed#>>'{metrics,storage_files}')::int,(v_feed#>>'{metrics,storage_objects}')::int,0)
  );
  return jsonb_build_object(
    'source','live_taxres_family',
    'scope',case when p_tenant_id is null then 'all' else 'tenant' end,
    'tenant_id',p_tenant_id,
    'metrics',v_metrics
  );
end;
$function$

revoke all on function public.admin_taxres_live_kpis(uuid) from public;
grant execute on function public.admin_taxres_live_kpis(uuid) to authenticated;
