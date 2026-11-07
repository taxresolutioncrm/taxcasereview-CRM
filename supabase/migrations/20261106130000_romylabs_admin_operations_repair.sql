-- RomyLabs Admin Portal operations repair. Safe additive migration.
-- Briefing: tracked sends, DST-safe scheduler and real status, no false "active" badge.
-- Storage: count actual registered Supabase objects, not document-table rows.
-- Audit: paginate a sanitized platform-wide event stream; preserve legacy history.

create table if not exists public.romylabs_daily_briefing_runs (
  id bigint generated always as identity primary key,
  report_date date not null,
  mode text not null check (mode in ('scheduled', 'test')),
  status text not null check (status in ('attempting', 'submitted', 'failed')),
  recipient text not null,
  attempted_at timestamptz not null default now(),
  submitted_at timestamptz,
  provider text,
  error text
);
create unique index if not exists romylabs_daily_briefing_once_per_day
  on public.romylabs_daily_briefing_runs (report_date) where mode = 'scheduled';
create index if not exists romylabs_daily_briefing_runs_recent
  on public.romylabs_daily_briefing_runs (attempted_at desc);
alter table public.romylabs_daily_briefing_runs enable row level security;
revoke all on public.romylabs_daily_briefing_runs from public, anon, authenticated;
grant all on public.romylabs_daily_briefing_runs to service_role;
grant usage, select on sequence public.romylabs_daily_briefing_runs_id_seq to service_role;

create or replace function public.admin_daily_briefing_status()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_scheduled boolean;
  v_has_token boolean;
  v_last jsonb;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  select exists (select 1 from cron.job where jobname = 'romylabs-executive-email-7am-eastern') into v_scheduled;
  select exists (select 1 from vault.decrypted_secrets where name = 'tcr_internal_cron_token'
                 and coalesce(decrypted_secret, '') <> '') into v_has_token;
  select to_jsonb(x) into v_last from (
    select report_date, mode, status, attempted_at, submitted_at, provider, error
    from public.romylabs_daily_briefing_runs
    order by attempted_at desc limit 1
  ) x;
  return jsonb_build_object('scheduled', v_scheduled, 'scheduler_authenticated', v_has_token,
    'ready', v_scheduled and v_has_token, 'timezone', 'America/New_York', 'local_hour', 7,
    'last_run', v_last);
end
$$;
revoke all on function public.admin_daily_briefing_status() from public, anon;
grant execute on function public.admin_daily_briefing_status() to authenticated, service_role;

create or replace function public.admin_taxres_storage_metrics(p_tenant_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_bytes bigint := 0;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_tenant_id is not null and not exists (
    select 1 from public.tenants where id = p_tenant_id
      and tenant_code in ('TRC-001','TRC-004') and status <> 'deleted'
  ) then raise exception 'Selected office is not in the active TaxRes family storage scope'; end if;

  with objects_in_scope as (
    select distinct o.id, o.metadata
    from public.storage_object_tenants s
    join storage.objects o on o.bucket_id = s.bucket_id and o.name = s.object_name
    join public.tenants t on t.id = s.tenant_id
    where t.tenant_code in ('TRC-001','TRC-004')
      and t.status <> 'deleted'
      and (p_tenant_id is null or t.id = p_tenant_id)
  )
  select count(*)::int, coalesce(sum(
    case when (metadata->>'size') ~ '^[0-9]+$'
      then (metadata->>'size')::bigint else 0 end
  ),0)::bigint into v_count,v_bytes from objects_in_scope;

  return jsonb_build_object('files',v_count,'bytes',v_bytes,
    'source','registered_central_storage_objects',
    'coverage','Central TaxRes family storage only. Separate CRM projects are not included.');
end
$$;
revoke all on function public.admin_taxres_storage_metrics(uuid) from public, anon;
grant execute on function public.admin_taxres_storage_metrics(uuid) to authenticated, service_role;

create or replace function public.admin_get_audit_log_v2(
  p_limit integer default 50,
  p_offset integer default 0,
  p_filter text default 'operations'
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_filter not in ('operations','impersonation','all') then
    raise exception 'Invalid audit filter';
  end if;

  with events as (
    select 'admin:' || a.id::text id, a.created_at,
      a.action, coalesce(a.admin_email,'System') actor,
      coalesce(a.target_name,'—') target_name,
      case when a.action in ('impersonate','impersonate_session_started')
        then 'Impersonation' else 'Admin' end category,
      jsonb_strip_nulls(jsonb_build_object(
        'result',a.detail->>'result','reason',a.detail->>'reason',
        'source',a.detail->>'source','event',a.detail->>'event',
        'expires_in',a.detail->>'expires_in')) detail
    from public.admin_actions a
    union all
    select 'credential:' || c.id::text, c.created_at,
      'credential.' || c.action, coalesce(c.actor_email,'System'),
      'Credentials vault', 'Security',
      jsonb_build_object('operation',c.action)
    from public.credential_vault_audit c
    union all
    select 'esign:' || e.id::text, e.occurred_at,
      'esign.' || e.event_type, coalesce(e.actor_email,'System'),
      'RomyLabs e-sign', 'E-sign',
      jsonb_build_object('event',e.event_type)
    from public.romylabs_esign_events e
    union all
    select 'billing:' || b.id::text, b.created_at,
      'billing.' || b.event_type, coalesce(b.created_by,'System'),
      'Subscription billing', 'Billing',
      jsonb_build_object('event',b.event_type,'channel',b.channel)
    from public.romylabs_collection_events b
    union all
    select 'booking:' || b.id::text, b.created_at,
      'booking.' || b.activity_type, 'System', 'RomyLabs booking',
      'Booking', jsonb_build_object('event',b.activity_type)
    from public.romylabs_booking_activities b
  ), filtered as (
    select * from events
    where p_filter = 'all'
       or (p_filter = 'impersonation' and category = 'Impersonation')
       or (p_filter = 'operations' and category <> 'Impersonation')
  ), paged as (
    select * from filtered order by created_at desc, id desc
    limit least(greatest(coalesce(p_limit,50),1),100)
    offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'total',(select count(*) from filtered),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'created_at',p.created_at,'action',p.action,
      'admin_email',p.actor,'target_name',p.target_name,
      'category',p.category,'detail',p.detail
    ) order by p.created_at desc,p.id desc) from paged p),'[]'::jsonb),
    'filter',p_filter
  ) into v_result;
  return v_result;
end
$$;
revoke all on function public.admin_get_audit_log_v2(integer,integer,text) from public, anon;
grant execute on function public.admin_get_audit_log_v2(integer,integer,text) to authenticated, service_role;

-- Two UTC cron slots cover both EST and EDT, but the Edge Function sends only
-- when its America/New_York clock says 07:00. The partial unique index is the
-- second defense against duplicate daily dispatch.
select cron.unschedule('daily-briefing')
where exists (select 1 from cron.job where jobname = 'daily-briefing');
select cron.unschedule('romylabs-executive-email-7am-eastern')
where exists (select 1 from cron.job where jobname = 'romylabs-executive-email-7am-eastern');
select cron.schedule(
  'romylabs-executive-email-7am-eastern',
  '0 11,12 * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/daily-briefing',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-internal-cron-token',(
        select decrypted_secret from vault.decrypted_secrets
        where name='tcr_internal_cron_token' limit 1
      )),
    body := '{"scheduled":true}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);
