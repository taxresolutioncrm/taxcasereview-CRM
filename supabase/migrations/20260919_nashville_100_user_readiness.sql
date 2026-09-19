-- Nashville 100-user readiness: hot-path indexes + server-side billing aggregates.

create index if not exists idx_employee_portal_sessions_tenant_employee_expires
on public.employee_portal_sessions(tenant_id,employee_id,expires_at desc);

create index if not exists idx_chat_channels_tenant_archived_position
on public.chat_channels(tenant_id,archived,position);

create index if not exists idx_time_entries_tenant_worker_started
on public.time_entries(tenant_id,worker_name,started_at desc);

create index if not exists idx_billing_time_tenant_employee_date
on public.billing_time_entries(tenant_id,employee_name,date desc);

create or replace function public.billing_time_activity_summary(
  p_client_id text default null,
  p_client_name text default null
)
returns table(
  activity_type text,
  entry_count bigint,
  hours numeric,
  amount numeric,
  billed_amount numeric,
  wip_amount numeric
)
language sql
security invoker
stable
set search_path to 'public','pg_temp'
as $$
  select
    coalesce(b.activity_type,'Uncategorized') as activity_type,
    count(*)::bigint as entry_count,
    coalesce(sum(b.hours),0) as hours,
    coalesce(sum(b.amount),0) as amount,
    coalesce(sum(b.amount) filter(where b.billed),0) as billed_amount,
    coalesce(sum(b.amount) filter(where not b.billed),0) as wip_amount
  from public.billing_time_entries b
  where (p_client_id is null or b.client_id=p_client_id)
    and (p_client_id is not null or p_client_name is null or b.client_name=p_client_name)
  group by coalesce(b.activity_type,'Uncategorized')
  order by amount desc;
$$;

grant execute on function public.billing_time_activity_summary(text,text) to authenticated;
-- Employee Portal assignment and communications hot paths.
create index if not exists idx_clients_tenant_assigned_lower
on public.clients(tenant_id,lower(coalesce("assignedTo",'')))
where deleted_at is null;

create index if not exists idx_clients_tenant_taxassociate_lower
on public.clients(tenant_id,lower(coalesce("taxAssociate",'')))
where deleted_at is null;

create index if not exists idx_cases_tenant_assigned_lower
on public.cases(tenant_id,lower(coalesce("assignedTo",'')));

create index if not exists idx_cases_tenant_taxassociate_lower
on public.cases(tenant_id,lower(coalesce("taxAssociate",'')));

create index if not exists idx_tasks_tenant_assigned_open_lower
on public.tasks(tenant_id,lower(coalesce("assignedTo",assignedto,'')),"dueDate",created_at desc)
where coalesce(deleted,false)=false and coalesce(done,false)=false;

create index if not exists idx_calevents_tenant_assigned_date_lower
on public.calevents(tenant_id,lower(coalesce("assignedTo",'')),date);

create index if not exists idx_timeentries_tenant_employee_lower_date
on public.timeentries(tenant_id,lower(coalesce(employee,staffname,'')),date,created_at desc);

create index if not exists idx_timeoff_tenant_employee_created
on public.time_off_requests(tenant_id,employee_id,created_at desc);

create index if not exists idx_clients_tenant_phone10
on public.clients(tenant_id,(right(regexp_replace(coalesce(phone,''),'\D','','g'),10)))
where deleted_at is null and phone is not null;

create index if not exists idx_sms_tenant_phone10_created
on public.sms_messages(tenant_id,(right(regexp_replace(coalesce(phone,''),'\D','','g'),10)),created_at desc);

-- Client workspace hot paths used heavily by many simultaneous staff.
create index if not exists idx_cases_tenant_clientname_created
on public.cases(tenant_id,"clientName",created_at desc);

create index if not exists idx_tasks_tenant_clientname_due
on public.tasks(tenant_id,"clientName","dueDate",created_at)
where coalesce(deleted,false)=false;

create index if not exists idx_invoices_tenant_clientname_created
on public.invoices(tenant_id,"clientName",created_at desc);

create index if not exists idx_client_notes_tenant_clientname_created
on public.client_notes(tenant_id,clientname,created_at desc);

create index if not exists idx_payments_tenant_clientname_created
on public.payments(tenant_id,"clientName",created_at desc);

create index if not exists idx_sms_tenant_clientname_created
on public.sms_messages(tenant_id,"clientName",created_at desc);

create index if not exists idx_deadlines_tenant_clientname_due
on public.deadlines(tenant_id,"clientName","dueDate");

create index if not exists idx_documents_tenant_client_created
on public.documents(tenant_id,client,created_at desc);
