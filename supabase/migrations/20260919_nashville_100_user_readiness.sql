-- Nashville 100-user readiness: hot-path indexes + server-side billing aggregates.

create index if not exists idx_employee_portal_sessions_tenant_employee_expires
on public.employee_portal_sessions(tenant_id,employee_id,expires_at desc);

create index if not exists idx_chat_channels_tenant_archived_position
on public.chat_channels(tenant_id,archived,position);

create index if not exists idx_time_entries_tenant_worker_started
on public.time_entries(tenant_id,worker_name,started_at desc);

create index if not exists idx_billing_time_tenant_employee_date
on public.billing_time_entries(tenant_id,employee_name,date desc);

create or replace function public.billing_time_summary(
  p_client_id text default null,
  p_client_name text default null
)
returns jsonb
language sql
security invoker
stable
set search_path to 'public','pg_temp'
as $$
  with scoped as (
    select activity_type,hours,amount,billed
    from public.billing_time_entries
    where (p_client_id is null or client_id=p_client_id)
      and (p_client_id is not null or p_client_name is null or client_name=p_client_name)
  ),
  activity as (
    select
      coalesce(activity_type,'Uncategorized') activity_type,
      count(*) entry_count,
      coalesce(sum(hours),0) hours,
      coalesce(sum(amount),0) amount,
      coalesce(sum(amount) filter(where billed),0) billed_amount,
      coalesce(sum(amount) filter(where not billed),0) wip_amount
    from scoped
    group by coalesce(activity_type,'Uncategorized')
  )
  select jsonb_build_object(
    'entry_count',(select count(*) from scoped),
    'total_hours',coalesce((select sum(hours) from scoped),0),
    'total_amount',coalesce((select sum(amount) from scoped),0),
    'wip_hours',coalesce((select sum(hours) from scoped where not billed),0),
    'wip_amount',coalesce((select sum(amount) from scoped where not billed),0),
    'billed_amount',coalesce((select sum(amount) from scoped where billed),0),
    'by_activity',coalesce((
      select jsonb_agg(jsonb_build_object(
        'activity_type',activity_type,
        'count',entry_count,
        'hours',hours,
        'amount',amount,
        'billed',billed_amount,
        'wip',wip_amount
      ) order by amount desc)
      from activity
    ),'[]'::jsonb)
  );
$$;

grant execute on function public.billing_time_summary(text,text) to authenticated;
