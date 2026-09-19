-- Scale-safe Time Clock history for offices with 100+ active employees.
create or replace function public.timeclock_history_page(
  p_employee text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 250
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_actor record;
  v_employee text := nullif(btrim(coalesce(p_employee,'')),'');
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_limit integer := least(greatest(coalesce(p_limit,250),1),500);
  v_total bigint := 0;
  v_hours numeric := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Authentication required';
  end if;

  select e.name,e.role,e.access
    into v_actor
  from public.employees e
  where e.tenant_id=v_tenant
    and lower(e.email)=lower(auth.email())
    and e.status='Active'
  limit 1;

  if v_actor.name is null then
    raise exception 'Active employee required';
  end if;

  if lower(coalesce(v_actor.access,v_actor.role,'')) not in ('super admin','admin','manager') then
    v_employee := v_actor.name;
  end if;

  select count(*),coalesce(sum(coalesce(t.hours,0)),0)
    into v_total,v_hours
  from public.timeentries t
  where t.tenant_id=v_tenant
    and (v_employee is null or t.employee=v_employee)
    and (p_start_date is null or t.date>=p_start_date)
    and (p_end_date is null or t.date<=p_end_date)
    and (v_search is null or t.employee ilike '%'||v_search||'%' or coalesce(t.notes,'') ilike '%'||v_search||'%');

  select coalesce(jsonb_agg(to_jsonb(x) order by x.date desc,x.created_at desc),'[]'::jsonb)
    into v_rows
  from (
    select t.*
    from public.timeentries t
    where t.tenant_id=v_tenant
      and (v_employee is null or t.employee=v_employee)
      and (p_start_date is null or t.date>=p_start_date)
      and (p_end_date is null or t.date<=p_end_date)
      and (v_search is null or t.employee ilike '%'||v_search||'%' or coalesce(t.notes,'') ilike '%'||v_search||'%')
    order by t.date desc,t.created_at desc
    offset v_offset
    limit v_limit
  ) x;

  return jsonb_build_object(
    'rows',v_rows,
    'total_count',v_total,
    'total_hours',v_hours,
    'offset',v_offset,
    'limit',v_limit
  );
end;
$$;

revoke all on function public.timeclock_history_page(text,date,date,text,integer,integer) from public,anon;
grant execute on function public.timeclock_history_page(text,date,date,text,integer,integer) to authenticated;

create index if not exists idx_timeentries_tenant_date_created
on public.timeentries(tenant_id,date desc,created_at desc);

create index if not exists idx_timeentries_tenant_employee_date_created
on public.timeentries(tenant_id,employee,date desc,created_at desc);
