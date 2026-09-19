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