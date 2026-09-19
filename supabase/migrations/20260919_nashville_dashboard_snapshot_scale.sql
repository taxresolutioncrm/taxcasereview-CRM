CREATE OR REPLACE FUNCTION public.nashville_dashboard_snapshot(p_employee_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tenant constant uuid := '489ace07-1a6b-4864-833a-4f8420568b40'::uuid;
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_emp text := coalesce(nullif(btrim(p_employee_name),''),'');
  v_month_start timestamptz := date_trunc('month', now());
  v_today date := current_date;
  v_result jsonb;
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.employees e
    where e.tenant_id=v_tenant
      and lower(coalesce(e.email,''))=v_email
      and coalesce(e.status,'Active')='Active'
  ) then
    raise exception 'Active Nashville employee required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'activeCases', (
        select count(*) from public.cases c
        where c.tenant_id=v_tenant
          and c.status in ('Open','Active','Collection Hold','Pending IRS','Docs Needed','POA Sent','Compliance (Filing/Payment)','Financials','Active Plan','Under Review','Penalty Abatement','Monitoring/Review')
      ),
      'openLeads', (
        select count(*) from public.leads l
        where l.tenant_id=v_tenant
          and coalesce(l.status,'') not in ('Converted to Client','Dead','Do Not Contact')
      ),
      'totalClients', (
        select count(*) from public.clients c
        where c.tenant_id=v_tenant and c.deleted_at is null
      ),
      'mtd1stTrades', (
        select coalesce(sum(
          case
            when nullif(regexp_replace(coalesce(l."taxFee",''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then regexp_replace(l."taxFee",'[^0-9.-]','','g')::numeric else 0 end
        ),0)
        from public.leads l where l.tenant_id=v_tenant and l.created_at>=v_month_start
      ),
      'total1stTrades', (
        select coalesce(sum(
          case
            when nullif(regexp_replace(coalesce(l."taxFee",''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then regexp_replace(l."taxFee",'[^0-9.-]','','g')::numeric else 0 end
        ),0)
        from public.leads l where l.tenant_id=v_tenant
      ),
      'mtd2ndTrades', (
        select coalesce(sum(
          case
            when nullif(regexp_replace(coalesce(p.amount,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then regexp_replace(p.amount,'[^0-9.-]','','g')::numeric else 0 end
        ),0)
        from public.payments p
        where p.tenant_id=v_tenant and p.source='resolution_fee' and p.created_at>=v_month_start
      ),
      'total2ndTrades', (
        select coalesce(sum(
          case
            when nullif(regexp_replace(coalesce(p.amount,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then regexp_replace(p.amount,'[^0-9.-]','','g')::numeric else 0 end
        ),0)
        from public.payments p
        where p.tenant_id=v_tenant and p.source='resolution_fee'
      ),
      'closedLeads', (
        select count(*) from public.leads l
        where l.tenant_id=v_tenant and l.status in ('Converted to Client','Dead','Do Not Contact')
      ),
      'myOpenLeads', (
        select count(*) from public.leads l
        where l.tenant_id=v_tenant and l."assignedTo"=v_emp
          and coalesce(l.status,'') not in ('Converted to Client','Dead','Do Not Contact')
      ),
      'myClosedLeads', (
        select count(*) from public.leads l
        where l.tenant_id=v_tenant and l."assignedTo"=v_emp
          and l.status in ('Converted to Client','Dead','Do Not Contact')
      ),
      'my1stTradeMtd', (
        select coalesce(sum(
          case
            when nullif(regexp_replace(coalesce(l."taxFee",''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then regexp_replace(l."taxFee",'[^0-9.-]','','g')::numeric else 0 end
        ),0)
        from public.leads l
        where l.tenant_id=v_tenant and l."assignedTo"=v_emp and l.created_at>=v_month_start
      ),
      'my2ndTradeMtd', (
        select coalesce(sum(
          case
            when nullif(regexp_replace(coalesce(p.amount,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then regexp_replace(p.amount,'[^0-9.-]','','g')::numeric else 0 end
        ),0)
        from public.payments p
        where p.tenant_id=v_tenant and p.source='resolution_fee'
          and p.enrolled_by=v_emp and p.created_at>=v_month_start
      ),
      'arOutstanding', (
        select coalesce(sum(
          case
            when nullif(regexp_replace(coalesce(p.amount,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then regexp_replace(p.amount,'[^0-9.-]','','g')::numeric else 0 end
        ),0)
        from public.payments p
        where p.tenant_id=v_tenant and p.payment_status='Scheduled'
      ),
      'unpaidInvoices', (
        select count(*) from public.invoices i
        where i.tenant_id=v_tenant and i.status in ('Unpaid','Overdue')
      ),
      'unpaidAmt', (
        select coalesce(sum(
          case
            when nullif(regexp_replace(coalesce(i.total,''),'[^0-9.-]','','g'),'') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then regexp_replace(i.total,'[^0-9.-]','','g')::numeric else 0 end
        ),0)
        from public.invoices i
        where i.tenant_id=v_tenant and i.status in ('Unpaid','Overdue')
      ),
      'openTasks', (
        select count(*) from public.tasks t
        where t.tenant_id=v_tenant and coalesce(t.deleted,false)=false and coalesce(t.done,false)=false
      ),
      'overdueTasks', (
        select count(*) from public.tasks t
        where t.tenant_id=v_tenant and coalesce(t.deleted,false)=false and coalesce(t.done,false)=false
          and btrim(coalesce(t."dueDate",'')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and to_date(btrim(t."dueDate"),'YYYY-MM-DD') < v_today
      ),
      'upcomingDl', (
        select count(*) from public.deadlines d
        where d.tenant_id=v_tenant and coalesce(d.status,'')<>'Completed'
          and btrim(coalesce(d."dueDate",'')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and to_date(btrim(d."dueDate"),'YYYY-MM-DD') >= v_today
      ),
      'overdueDl', (
        select count(*) from public.deadlines d
        where d.tenant_id=v_tenant and coalesce(d.status,'')<>'Completed'
          and btrim(coalesce(d."dueDate",'')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and to_date(btrim(d."dueDate"),'YYYY-MM-DD') < v_today
      )
    ),
    'recentCases', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select * from public.cases c
        where c.tenant_id=v_tenant
        order by c.created_at desc nulls last limit 6
      ) x
    ),'[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select * from public.tasks t
        where t.tenant_id=v_tenant and coalesce(t.deleted,false)=false and coalesce(t.done,false)=false
        order by t.created_at desc nulls last limit 8
      ) x
    ),'[]'::jsonb),
    'deadlines', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select * from public.deadlines d
        where d.tenant_id=v_tenant and coalesce(d.status,'')<>'Completed'
        order by
          case when btrim(coalesce(d."dueDate",'')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
               then to_date(btrim(d."dueDate"),'YYYY-MM-DD') else date '9999-12-31' end asc
        limit 8
      ) x
    ),'[]'::jsonb),
    'recentClients', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select * from public.clients c
        where c.tenant_id=v_tenant and c.deleted_at is null
        order by c.created_at desc nulls last limit 5
      ) x
    ),'[]'::jsonb),
    'recentLeads', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select * from public.leads l
        where l.tenant_id=v_tenant and coalesce(l.status,'') not in ('Converted to Client','Dead')
        order by l.created_at desc nulls last limit 5
      ) x
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$


revoke all on function public.nashville_dashboard_snapshot(text) from public, anon;
grant execute on function public.nashville_dashboard_snapshot(text) to authenticated;
