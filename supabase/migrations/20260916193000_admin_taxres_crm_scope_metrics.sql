create or replace function public.admin_taxres_crm_scope_metrics(p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := current_date;
  v_result jsonb;
begin
  if not public._is_platform_admin() then
    raise exception 'Not authorized.';
  end if;

  if p_tenant_id is not null and not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status <> 'deleted'
      and upper(coalesce(t.tenant_code,'')) not in ('ADMIN','DEMO')
  ) then
    raise exception 'Unknown TaxRes tenant';
  end if;

  with scope_tenants as (
    select t.id, t.firm_name, t.tenant_code, t.status, t.billing_seats
    from public.tenants t
    where t.status <> 'deleted'
      and upper(coalesce(t.tenant_code,'')) not in ('ADMIN','DEMO')
      and (p_tenant_id is null or t.id = p_tenant_id)
  ),
  tenant_rollup as (
    select
      st.id,
      coalesce(nullif(st.billing_seats,0), (
        select count(*)::int
        from public.employees e
        where e.tenant_id = st.id
          and lower(coalesce(e.status,'active'))='active'
      ))::int as seat_count,
      (
        select count(*)::int
        from public.employees e
        where e.tenant_id = st.id
          and lower(coalesce(e.status,'active'))='active'
      ) as active_staff,
      public._admin_tenant_storage_bytes(st.id) as storage_bytes,
      greatest(
        (select count(*)::int from public.documents d where d.tenant_id = st.id),
        (select count(*)::int from storage.objects o where position(st.id::text in o.name) > 0)
      ) as storage_files
    from scope_tenants st
  )
  select jsonb_build_object(
    'scope', case when p_tenant_id is null then 'all' else 'tenant' end,
    'tenant_id', p_tenant_id,
    'metrics', jsonb_build_object(
      'clients', (select count(*) from public.clients c where c.tenant_id in (select id from scope_tenants)),
      'leads', (select count(*) from public.leads l where l.tenant_id in (select id from scope_tenants)),
      'seats', coalesce((select sum(seat_count) from tenant_rollup),0),
      'active_staff', coalesce((select sum(active_staff) from tenant_rollup),0),
      'cases', (select count(*) from public.cases cs where cs.tenant_id in (select id from scope_tenants)),
      'pending_tasks', (
        select count(*) from public.tasks tk
        where tk.tenant_id in (select id from scope_tenants)
          and tk.done is not true
          and tk.deleted is not true
      ),
      'outstanding_invoices', (
        select count(*) from public.invoices i
        where i.tenant_id in (select id from scope_tenants)
          and lower(coalesce(i.status,'')) in ('unpaid','partial','overdue','past_due','open')
      ),
      'pending_esigns', (
        select count(*) from public.esigns e
        where e.tenant_id in (select id from scope_tenants)
          and lower(coalesce(e.status,'')) in ('pending','sent','awaiting')
      ),
      'demos_today', (
        select count(*) from public.calevents ce
        where lower(coalesce(ce."eventType",'')) like '%demo%'
          and ce.date::date = v_today
          and (
            (p_tenant_id is null and ce.product_id = 'taxres_crm')
            or (p_tenant_id is not null and ce.tenant_id = p_tenant_id)
          )
      ),
      'storage_bytes', coalesce((select sum(storage_bytes) from tenant_rollup),0),
      'storage_files', coalesce((select sum(storage_files) from tenant_rollup),0)
    ),
    'upcoming_demos', (
      select coalesce(jsonb_agg(x order by x->>'start'),'[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', ce.id,
          'title', coalesce(ce."clientName",ce.title,'Demo'),
          'start', ce.date::text || 'T' || coalesce(nullif(ce.time,''),'09:00'),
          'type', ce."eventType",
          'tenant_id', ce.tenant_id,
          'product_id', ce.product_id
        ) as x
        from public.calevents ce
        where lower(coalesce(ce."eventType",'')) like '%demo%'
          and (ce.date::date + coalesce(nullif(ce.time,''),'09:00')::time) >= now()
          and (
            (p_tenant_id is null and ce.product_id = 'taxres_crm')
            or (p_tenant_id is not null and ce.tenant_id = p_tenant_id)
          )
        order by ce.date::date, coalesce(nullif(ce.time,''),'09:00')::time
        limit 10
      ) q
    ),
    'upcoming_deadlines', (
      select coalesce(jsonb_agg(x order by x->>'dueDate'),'[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', d.id,
          'title', d.title,
          'dueDate', d."dueDate",
          'tenant_id', d.tenant_id
        ) as x
        from public.deadlines d
        where d.tenant_id in (select id from scope_tenants)
          and lower(coalesce(d.status,'')) <> 'completed'
          and d."dueDate"::date >= v_today
          and d."dueDate"::date <= v_today + 14
        order by d."dueDate"::date
        limit 10
      ) q
    )
  ) into v_result;

  return v_result;
end;
$$;