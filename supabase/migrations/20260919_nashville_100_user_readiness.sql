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

-- Consolidate Sidebar badge work into one authenticated RPC so 100 staff
-- create one Realtime channel each instead of eight separate channel joins.
create or replace function public.get_sidebar_badges_v2(
  p_sms_last_seen timestamptz default '1970-01-01T00:00:00Z'::timestamptz,
  p_chat_last_seen timestamptz default null,
  p_employee_name text default null,
  p_signed_last_seen timestamptz default '1970-01-01T00:00:00Z'::timestamptz,
  p_leads_last_seen timestamptz default '1970-01-01T00:00:00Z'::timestamptz,
  p_clients_last_seen timestamptz default '1970-01-01T00:00:00Z'::timestamptz,
  p_cases_last_seen timestamptz default '1970-01-01T00:00:00Z'::timestamptz
)
returns jsonb
language plpgsql stable security definer
set search_path to 'public','app_private','pg_temp'
as $$
declare
  v_tenant uuid := app_private.current_tenant_id();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_clients integer := app_private.permission_level('clients');
  v_leads integer := app_private.permission_level('leads');
  v_schedule integer := app_private.permission_level('schedule');
  v_docs integer := app_private.permission_level('documents');
  v_comms integer := app_private.permission_level('comms');
  v_billing integer := app_private.permission_level('billing');
  v_hr integer := app_private.permission_level('hr');
  result jsonb;
begin
  if v_email='' or v_tenant is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select jsonb_build_object(
    'pendingTimeOff',case when v_hr>=1 then (select count(*) from public.time_off_requests x where x.tenant_id=v_tenant and x.status='pending') else 0 end,
    'newLeads',case when v_leads>=1 then (select count(*) from public.leads x where x.tenant_id=v_tenant and x.created_at>coalesce(p_leads_last_seen,'1970-01-01T00:00:00Z') and coalesce(x.archived,false)=false and x.deleted_at is null) else 0 end,
    'newClients',case when v_clients>=1 then (select count(*) from public.clients x where x.tenant_id=v_tenant and x.created_at>coalesce(p_clients_last_seen,'1970-01-01T00:00:00Z') and x.deleted_at is null) else 0 end,
    'newCases',case when v_clients>=1 then (select count(*) from public.cases x where x.tenant_id=v_tenant and x.created_at>coalesce(p_cases_last_seen,'1970-01-01T00:00:00Z')) else 0 end,
    'dueSoonDeadlines',case when v_clients>=1 then (select count(*) from public.deadlines x where x.tenant_id=v_tenant and coalesce(x.status,'Tracking')<>'Completed' and x."dueDate" is not null and x."dueDate">=(current_date-1)::text and x."dueDate"<=(current_date+7)::text) else 0 end,
    'upcomingEvents',case when v_schedule>=1 then (select count(*) from public.calevents x where x.tenant_id=v_tenant and x.status='scheduled' and x.date>=current_date::text and x.date<=(current_date+1)::text) else 0 end,
    'unreadVoicemails',case when v_comms>=1 then (select count(*) from public.voicemails x where x.tenant_id=v_tenant and coalesce(x.is_read,false)=false) else 0 end,
    'pendingEsign',case when v_docs>=1 then (select count(*) from public.esigns x where x.tenant_id=v_tenant and x.status='Awaiting') else 0 end,
    'signedEsign',case when v_docs>=1 then (select count(*) from public.esigns x where x.tenant_id=v_tenant and x.status='Signed' and x.signed_at is not null and x.signed_at>coalesce(p_signed_last_seen,'1970-01-01T00:00:00Z')) else 0 end,
    'unreadFax',case when v_comms>=1 then (select count(*) from public.fax_logs x where x.tenant_id=v_tenant and x.direction='inbound' and coalesce(x.is_read,false)=false) else 0 end,
    'unreadSms',case when v_comms>=1 then (select count(*) from public.sms_messages x where x.tenant_id=v_tenant and x.direction='inbound' and x.created_at>coalesce(p_sms_last_seen,'1970-01-01T00:00:00Z')) else 0 end,
    'unreadInbox',case when v_comms>=1 then (select count(*) from public.emails x where x.tenant_id=v_tenant and lower(coalesce(x.mailbox_owner,''))=v_email and coalesce(x.is_read,false)=false and coalesce(x.triage,'Inbox') in ('Inbox','Action Needed','Waiting')) else 0 end,
    'emailActionNeeded',case when v_comms>=1 then (select count(*) from public.emails x where x.tenant_id=v_tenant and lower(coalesce(x.mailbox_owner,''))=v_email and coalesce(x.is_read,false)=false and x.triage='Action Needed') else 0 end,
    'emailWaiting',case when v_comms>=1 then (select count(*) from public.emails x where x.tenant_id=v_tenant and lower(coalesce(x.mailbox_owner,''))=v_email and coalesce(x.is_read,false)=false and x.triage='Waiting') else 0 end,
    'openTasks',case when v_clients>=1 then (select count(*) from public.tasks x where x.tenant_id=v_tenant and coalesce(x.done,false)=false and coalesce(x.deleted,false)=false) else 0 end,
    'pendingPayments',case when v_billing>=1 then (select count(*) from public.payments x where x.tenant_id=v_tenant and x.status in ('Pending','TBD','No Status','New Agmt','Failed')) else 0 end,
    'overdueInvoices',case when v_billing>=1 then (select count(*) from public.invoices x where x.tenant_id=v_tenant and coalesce(x.status,'')<>'Paid' and (x.status='Overdue' or (coalesce(x."dueDate",'')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and x."dueDate"<current_date::text))) else 0 end,
    'overdueReceivables',case when v_billing>=1 then (select count(*) from public.payments x where x.tenant_id=v_tenant and x.trade_type in ('1st Trade','2nd Trade') and coalesce(x.payment_status,'')<>'Paid' and x.scheduled_date is not null and x.scheduled_date<current_date) else 0 end,
    'unreadChat',case when v_comms>=1 and p_chat_last_seen is not null then (
      select count(*) from public.chat_messages x where x.tenant_id=v_tenant and x.created_at>p_chat_last_seen
        and coalesce(x.sender,'')<>coalesce(p_employee_name,v_email)
        and (left(x.channel,3)<>'dm_' or (
          app_private.chat_current_employee_id() is not null and (
            (position('__' in substring(x.channel from 4))>0 and app_private.chat_current_employee_id()=any(string_to_array(substring(x.channel from 4),'__')))
            or (position('__' in substring(x.channel from 4))=0 and (
              x.channel='dm_'||app_private.chat_current_employee_id()
              or lower(x.sender)=lower(public.chat_current_actor())
              or lower(x.sender)=v_email
              or lower(x.sender)=lower(split_part(v_email,'@',1))
            ))
          )
        ))
    ) else 0 end
  ) into result;
  return result;
end
$$;
revoke all on function public.get_sidebar_badges_v2(timestamptz,timestamptz,text,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_sidebar_badges_v2(timestamptz,timestamptz,text,timestamptz,timestamptz,timestamptz,timestamptz) to authenticated;
