-- RomyLabs live Admin Portal metrics bus.
-- Operational CRM writes signal the central hub asynchronously; the portal
-- reads aggregate metrics only. No client/patient/customer row payloads are copied.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.romylabs_metrics_cache (
  product_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.romylabs_metrics_cache enable row level security;
revoke all on table public.romylabs_metrics_cache from public, anon;
grant select on table public.romylabs_metrics_cache to authenticated;

drop policy if exists romylabs_metrics_cache_platform_admin_read
  on public.romylabs_metrics_cache;
create policy romylabs_metrics_cache_platform_admin_read
on public.romylabs_metrics_cache
for select
to authenticated
using (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') = 'platform_admin'
  or lower(coalesce(auth.jwt() ->> 'email','')) in (
    'info@romylabs.com',
    'romy@romylabs.com',
    'romy@taxrescrm.net',
    'romy@taxcasereview.org'
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='romylabs_metrics_cache'
  ) then
    alter publication supabase_realtime add table public.romylabs_metrics_cache;
  end if;
end $$;

create table if not exists public.romylabs_metrics_refresh_gate (
  product_key text primary key,
  last_claimed_at timestamptz not null default '-infinity'::timestamptz
);

alter table public.romylabs_metrics_refresh_gate enable row level security;
revoke all on table public.romylabs_metrics_refresh_gate from public, anon, authenticated;

create or replace function public.claim_romylabs_metrics_refresh(
  p_product_key text,
  p_min_interval_ms integer default 2000
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed text;
begin
  insert into public.romylabs_metrics_refresh_gate(product_key,last_claimed_at)
  values (p_product_key, now())
  on conflict (product_key) do update
    set last_claimed_at = excluded.last_claimed_at
    where public.romylabs_metrics_refresh_gate.last_claimed_at
      <= now() - make_interval(secs => greatest(p_min_interval_ms,0)::double precision / 1000.0)
  returning product_key into claimed;

  return claimed is not null;
end;
$$;

revoke all on function public.claim_romylabs_metrics_refresh(text,integer)
  from public, anon, authenticated;
grant execute on function public.claim_romylabs_metrics_refresh(text,integer)
  to service_role;

-- Local TaxRes-family changes use the same event path as external products.
create table if not exists public.romylabs_metrics_signal_gate (
  product_key text primary key,
  last_sent_at timestamptz not null default '-infinity'::timestamptz
);

alter table public.romylabs_metrics_signal_gate enable row level security;
revoke all on table public.romylabs_metrics_signal_gate from public, anon, authenticated;

create or replace function public.romylabs_admin_metrics_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  claimed text;
begin
  insert into public.romylabs_metrics_signal_gate(product_key,last_sent_at)
  values ('taxres_crm', now())
  on conflict (product_key) do update
    set last_sent_at=excluded.last_sent_at
    where public.romylabs_metrics_signal_gate.last_sent_at <= now() - interval '1 second'
  returning product_key into claimed;

  if claimed is null then
    return null;
  end if;

  perform net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object(
      'action','product_changed',
      'product','taxres_crm',
      'source_schema',TG_TABLE_SCHEMA,
      'source_table',TG_TABLE_NAME
    ),
    timeout_milliseconds := 1000
  );

  return null;
end;
$$;

revoke all on function public.romylabs_admin_metrics_changed()
  from public, anon, authenticated;

create or replace function public.romylabs_install_metrics_change_triggers()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relkind in ('r','p')
      and c.relname not like 'romylabs_metrics_%'
  loop
    if not exists (
      select 1
      from pg_trigger t
      join pg_class tc on tc.oid=t.tgrelid
      join pg_namespace tn on tn.oid=tc.relnamespace
      where not t.tgisinternal
        and t.tgname='romylabs_admin_metrics_changed'
        and tn.nspname=r.schema_name
        and tc.relname=r.table_name
    ) then
      execute format(
        'create trigger romylabs_admin_metrics_changed after insert or update or delete on %I.%I for each statement execute function public.romylabs_admin_metrics_changed()',
        r.schema_name, r.table_name
      );
    end if;
  end loop;

  if to_regclass('storage.objects') is not null
     and not exists (
       select 1
       from pg_trigger t
       join pg_class tc on tc.oid=t.tgrelid
       join pg_namespace tn on tn.oid=tc.relnamespace
       where not t.tgisinternal
         and t.tgname='romylabs_admin_metrics_changed'
         and tn.nspname='storage'
         and tc.relname='objects'
     ) then
    execute 'create trigger romylabs_admin_metrics_changed after insert or update or delete on storage.objects for each statement execute function public.romylabs_admin_metrics_changed()';
  end if;
end;
$$;

revoke all on function public.romylabs_install_metrics_change_triggers()
  from public, anon, authenticated;
grant execute on function public.romylabs_install_metrics_change_triggers()
  to service_role;

select public.romylabs_install_metrics_change_triggers();

do $$
declare r record;
begin
  for r in
    select jobid from cron.job
    where jobname in (
      'nashville-metrics-cache-refresh',
      'romylabs-metrics-watchdog',
      'romylabs-admin-metrics-trigger-watchdog'
    )
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

-- Recovery only: ensures new public tables inherit the live signal trigger.
select cron.schedule(
  'romylabs-admin-metrics-trigger-watchdog',
  '* * * * *',
  $job$select public.romylabs_install_metrics_change_triggers();$job$
);

-- Recovery only: if a webhook is missed, the hub refreshes stale aggregate rows.
select cron.schedule(
  'romylabs-metrics-watchdog',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-cron-token',
      (select decrypted_secret
       from vault.decrypted_secrets
       where name='tcr_internal_cron_token'
       limit 1)
    ),
    body := '{"action":"refresh_stale_metrics"}'::jsonb,
    timeout_milliseconds := 1000
  );
  $job$
);
