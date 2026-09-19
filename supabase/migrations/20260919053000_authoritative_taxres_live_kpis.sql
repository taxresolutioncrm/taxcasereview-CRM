-- Live TaxRes-family KPI source for the Admin Portal.
-- Nashville lives in a separate Supabase project, so the central database mirror
-- must never be used to total TaxRes CRM cards.

create or replace function public.admin_taxres_live_kpis(
  p_tenant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  c_tcr constant uuid := '61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid;
  c_nash constant uuid := '489ace07-1a6b-4864-833a-4f8420568b40'::uuid;
  c_cloud constant uuid := 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae'::uuid;
  v_token text;
  v_http extensions.http_response;
  v_batch jsonb;
  v_tcr jsonb;
  v_nash jsonb;
  v_cloud jsonb;
  v_feed jsonb;
  v_metrics jsonb;
  v_seats integer := 0;
begin
  if not public._is_platform_admin() then
    raise exception 'Not authorized.';
  end if;

  if p_tenant_id is not null
     and p_tenant_id not in (c_tcr,c_nash,c_cloud) then
    raise exception 'Unknown TaxRes tenant';
  end if;

  select decrypted_secret
    into v_token
  from vault.decrypted_secrets
  where name='tcr_internal_cron_token'
  limit 1;

  if coalesce(v_token,'')='' then
    raise exception 'Live TaxRes metrics token is not configured';
  end if;

  perform set_config('http.curlopt_timeout_msec','15000',true);
  perform set_config('http.curlopt_connecttimeout_msec','5000',true);

  select *
    into v_http
  from extensions.http(
    (
      'POST'::extensions.http_method,
      'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy',
      array[
        extensions.http_header('Content-Type','application/json'),
        extensions.http_header('x-internal-cron-token',v_token)
      ],
      'application/json',
      '{"action":"metrics_batch","products":["tax_case_review","nashville","cloudcpa"]}'
    )::extensions.http_request
  );

  if coalesce(v_http.status,0)<>200 then
    raise exception 'Live TaxRes metrics unavailable (hub status %)',coalesce(v_http.status,0);
  end if;

  begin
    v_batch:=v_http.content::jsonb;
  exception when others then
    raise exception 'Live TaxRes metrics returned invalid JSON';
  end;

  v_tcr:=v_batch#>'{results,tax_case_review,data}';
  v_nash:=v_batch#>'{results,nashville,data}';
  v_cloud:=v_batch#>'{results,cloudcpa,data}';

  if coalesce((v_batch->>'ok')::boolean,false) is not true
     or v_tcr is null or v_nash is null or v_cloud is null
     or coalesce((v_tcr->>'ok')::boolean,false) is not true
     or coalesce((v_nash->>'ok')::boolean,false) is not true
     or coalesce((v_cloud->>'ok')::boolean,false) is not true then
    raise exception 'One or more live TaxRes office feeds are unavailable';
  end if;

  select coalesce(sum(
    coalesce(
      nullif(t.billing_seats,0),
      (
        select count(*)::int
        from public.employees e
        where e.tenant_id=t.id
          and lower(coalesce(e.status,'active'))='active'
      )
    )
  ),0)::int
  into v_seats
  from public.tenants t
  where t.id in (c_tcr,c_nash,c_cloud)
    and (p_tenant_id is null or t.id=p_tenant_id);

  if p_tenant_id is null then
    v_metrics:=jsonb_build_object(
      'clients',
        coalesce((v_tcr#>>'{metrics,total_clients}')::int,0)
        +coalesce((v_nash#>>'{metrics,total_clients}')::int,0)
        +coalesce((v_cloud#>>'{metrics,total_clients}')::int,0),
      'leads',
        coalesce((v_tcr#>>'{metrics,total_leads}')::int,0)
        +coalesce((v_nash#>>'{metrics,total_leads}')::int,0)
        +coalesce((v_cloud#>>'{metrics,total_leads}')::int,0),
      'seats',v_seats,
      'active_staff',
        coalesce((v_tcr#>>'{metrics,active_staff}')::int,0)
        +coalesce((v_nash#>>'{metrics,active_staff}')::int,0)
        +coalesce((v_cloud#>>'{metrics,active_staff}')::int,0),
      'cases',
        coalesce((v_tcr#>>'{metrics,open_jobs}')::int,0)
        +coalesce((v_nash#>>'{metrics,active_cases}')::int,0)
        +coalesce((v_cloud#>>'{metrics,open_jobs}')::int,0),
      'pending_tasks',
        coalesce((v_tcr#>>'{metrics,pending_tasks}')::int,0)
        +coalesce((v_nash#>>'{metrics,pending_tasks}')::int,0)
        +coalesce((v_cloud#>>'{metrics,pending_tasks}')::int,0),
      'outstanding_invoices',
        coalesce((v_tcr#>>'{metrics,outstanding_invoices}')::int,0)
        +coalesce((v_nash#>>'{metrics,outstanding_invoices}')::int,0)
        +coalesce((v_cloud#>>'{metrics,outstanding_invoices}')::int,0),
      'pending_esigns',
        coalesce((v_tcr#>>'{metrics,pending_esigns}')::int,0)
        +coalesce((v_nash#>>'{metrics,pending_esigns}')::int,0)
        +coalesce((v_cloud#>>'{metrics,pending_esigns}')::int,0),
      'demos_today',
        coalesce((v_tcr#>>'{metrics,demos_today}')::int,0)
        +coalesce((v_nash#>>'{metrics,demos_today}')::int,0)
        +coalesce((v_cloud#>>'{metrics,demos_today}')::int,0),
      'storage_bytes',
        coalesce((v_tcr#>>'{metrics,storage_bytes}')::bigint,0)
        +coalesce((v_nash#>>'{metrics,storage_bytes}')::bigint,0)
        +coalesce((v_cloud#>>'{metrics,storage_bytes}')::bigint,0),
      'storage_files',
        coalesce((v_tcr#>>'{metrics,storage_files}')::int,(v_tcr#>>'{metrics,storage_objects}')::int,0)
        +coalesce((v_nash#>>'{metrics,storage_files}')::int,(v_nash#>>'{metrics,storage_objects}')::int,0)
        +coalesce((v_cloud#>>'{metrics,storage_files}')::int,(v_cloud#>>'{metrics,storage_objects}')::int,0)
    );
  else
    v_feed:=case p_tenant_id
      when c_tcr then v_tcr
      when c_nash then v_nash
      when c_cloud then v_cloud
    end;

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
  end if;

  return jsonb_build_object(
    'source','live_taxres_family',
    'scope',case when p_tenant_id is null then 'all' else 'tenant' end,
    'tenant_id',p_tenant_id,
    'metrics',v_metrics
  );
end;
$$;

revoke all on function public.admin_taxres_live_kpis(uuid) from public;
grant execute on function public.admin_taxres_live_kpis(uuid) to authenticated;
