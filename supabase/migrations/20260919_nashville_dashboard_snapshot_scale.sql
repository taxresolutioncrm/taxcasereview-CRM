CREATE OR REPLACE FUNCTION public.get_dashboard_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_temp'
AS $function$
declare
  v_tenant uuid := app_private.current_tenant_id();
  v_email text := lower(coalesce((select auth.jwt())->>'email',''));
  v_employee_name text;
  v_leads integer := app_private.permission_level('leads');
  v_clients integer := app_private.permission_level('clients');
  v_billing integer := app_private.permission_level('billing');
  v_result jsonb;
  v_metrics jsonb;
  v_recent_cases jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_deadlines jsonb := '[]'::jsonb;
  v_recent_clients jsonb := '[]'::jsonb;
  v_recent_leads jsonb := '[]'::jsonb;
  v_month text := to_char(current_date,'YYYY-MM');
begin
  if v_email='' or v_tenant is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select e.name into v_employee_name
  from public.employees e
  where e.tenant_id=v_tenant
    and lower(e.email)=v_email
    and e.status='Active'
  limit 1;

  v_metrics := jsonb_build_object(
    'activeCases', case when v_clients>=1 then (
      select count(*) from public.cases c
      where c.tenant_id=v_tenant
        and c.status in ('Open','Active','Collection Hold','Pending IRS','Docs Needed','POA Sent','Compliance (Filing/Payment)','Financials','Active Plan','Under Review','Penalty Abatement','Monitoring/Review')
    ) else 0 end,
    'openLeads', case when v_leads>=1 then (
      select count(*) from public.leads l
      where l.tenant_id=v_tenant and coalesce(l.status,'') not in ('Converted to Client','Dead','Do Not Contact')
        and coalesce(l.archived,false)=false and l.deleted_at is null
    ) else 0 end,
    'totalClients', case when v_clients>=1 then (
      select count(*) from public.clients c where c.tenant_id=v_tenant and c.deleted_at is null
    ) else 0 end,
    'mtd1stTrades', case when v_leads>=1 then (
      select coalesce(sum(case when l."taxFee" ~ '^[-+]?[0-9]*\.?[0-9]+$' then l."taxFee"::numeric else 0 end),0)
      from public.leads l
      where l.tenant_id=v_tenant and to_char(l.created_at,'YYYY-MM')=v_month
    ) else 0 end,
    'total1stTrades', case when v_leads>=1 then (
      select coalesce(sum(case when l."taxFee" ~ '^[-+]?[0-9]*\.?[0-9]+$' then l."taxFee"::numeric else 0 end),0)
      from public.leads l where l.tenant_id=v_tenant
    ) else 0 end,
    'mtd2ndTrades', case when v_billing>=1 then (
      select coalesce(sum(case when p.amount ~ '^[-+]?[0-9]*\.?[0-9]+$' then p.amount::numeric else 0 end),0)
      from public.payments p
      where p.tenant_id=v_tenant and p.source='resolution_fee' and to_char(p.created_at,'YYYY-MM')=v_month
    ) else 0 end,
    'total2ndTrades', case when v_billing>=1 then (
      select coalesce(sum(case when p.amount ~ '^[-+]?[0-9]*\.?[0-9]+$' then p.amount::numeric else 0 end),0)
      from public.payments p where p.tenant_id=v_tenant and p.source='resolution_fee'
    ) else 0 end,
    'closedLeads', case when v_leads>=1 then (
      select count(*) from public.leads l where l.tenant_id=v_tenant and l.status in ('Converted to Client','Dead','Do Not Contact')
    ) else 0 end,
    'myOpenLeads', case when v_leads>=1 then (
      select count(*) from public.leads l
      where l.tenant_id=v_tenant and l."assignedTo"=v_employee_name
        and coalesce(l.status,'') not in ('Converted to Client','Dead','Do Not Contact')
    ) else 0 end,
    'myClosedLeads', case when v_leads>=1 then (
      select count(*) from public.leads l
      where l.tenant_id=v_tenant and l."assignedTo"=v_employee_name
        and l.status in ('Converted to Client','Dead','Do Not Contact')
    ) else 0 end,
    'my1stTradeMtd', case when v_leads>=1 then (
      select coalesce(sum(case when l."taxFee" ~ '^[-+]?[0-9]*\.?[0-9]+$' then l."taxFee"::numeric else 0 end),0)
      from public.leads l
      where l.tenant_id=v_tenant and l."assignedTo"=v_employee_name and to_char(l.created_at,'YYYY-MM')=v_month
    ) else 0 end,
    'my2ndTradeMtd', case when v_billing>=1 then (
      select coalesce(sum(case when p.amount ~ '^[-+]?[0-9]*\.?[0-9]+$' then p.amount::numeric else 0 end),0)
      from public.payments p
      where p.tenant_id=v_tenant and p.source='resolution_fee'
        and p.enrolled_by=v_employee_name and to_char(p.created_at,'YYYY-MM')=v_month
    ) else 0 end,
    'arOutstanding', case when v_billing>=1 then (
      select coalesce(sum(case when p.amount ~ '^[-+]?[0-9]*\.?[0-9]+$' then p.amount::numeric else 0 end),0)
      from public.payments p where p.tenant_id=v_tenant and p.payment_status='Scheduled'
    ) else 0 end,
    'unpaidInvoices', case when v_billing>=1 then (
      select count(*) from public.invoices i where i.tenant_id=v_tenant and i.status in ('Unpaid','Overdue')
    ) else 0 end,
    'unpaidAmt', case when v_billing>=1 then (
      select coalesce(sum(case when i.total ~ '^[-+]?[0-9]*\.?[0-9]+$' then i.total::numeric else 0 end),0)
      from public.invoices i where i.tenant_id=v_tenant and i.status in ('Unpaid','Overdue')
    ) else 0 end,
    'openTasks', case when v_clients>=1 then (
      select count(*) from public.tasks t where t.tenant_id=v_tenant and coalesce(t.done,false)=false and coalesce(t.deleted,false)=false
    ) else 0 end,
    'overdueTasks', case when v_clients>=1 then (
      select count(*) from public.tasks t
      where t.tenant_id=v_tenant and coalesce(t.done,false)=false and coalesce(t.deleted,false)=false
        and t."dueDate" is not null and t."dueDate" < current_date::text
    ) else 0 end,
    'upcomingDl', case when v_clients>=1 then (
      select count(*) from public.deadlines d
      where d.tenant_id=v_tenant and coalesce(d.status,'Tracking')<>'Completed'
        and d."dueDate" is not null and d."dueDate">=current_date::text
    ) else 0 end,
    'overdueDl', case when v_clients>=1 then (
      select count(*) from public.deadlines d
      where d.tenant_id=v_tenant and coalesce(d.status,'Tracking')<>'Completed'
        and d."dueDate" is not null and d."dueDate"<current_date::text
    ) else 0 end
  );

  if v_clients>=1 then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_recent_cases from (
      select id,status,"assignedTo","taxAssociate","clientName","caseType","irsBalance",created_at
      from public.cases where tenant_id=v_tenant order by created_at desc nulls last limit 6
    ) x;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_tasks from (
      select id,title,done,"dueDate","assignedTo",client_id,"clientName",priority,created_at
      from public.tasks where tenant_id=v_tenant and coalesce(done,false)=false and coalesce(deleted,false)=false
      order by created_at desc nulls last limit 8
    ) x;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_deadlines from (
      select id,name,client,type,"dueDate",status,notes,"clientName",client_id,created_at
      from public.deadlines where tenant_id=v_tenant and coalesce(status,'Tracking')<>'Completed'
      order by "dueDate" asc nulls last limit 8
    ) x;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_recent_clients from (
      select id,name,status,"assignedTo","clientType","issueType","irsBalance",created_at
      from public.clients where tenant_id=v_tenant and deleted_at is null
      order by created_at desc nulls last limit 5
    ) x;
  end if;

  if v_leads>=1 then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_recent_leads from (
      select id,name,status,"assignedTo","taxFee","issueType",source,"irsBalance",created_at,archived
      from public.leads
      where tenant_id=v_tenant and coalesce(status,'') not in ('Converted to Client','Dead')
        and coalesce(archived,false)=false and deleted_at is null
      order by created_at desc nulls last limit 5
    ) x;
  end if;

  return jsonb_build_object(
    'metrics',v_metrics,
    'recentCases',v_recent_cases,
    'tasks',v_tasks,
    'deadlines',v_deadlines,
    'recentClients',v_recent_clients,
    'recentLeads',v_recent_leads
  );
end
$function$

