create or replace function public.get_sidebar_badge_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','app_private','pg_temp'
as $$
declare
  v_tenant uuid := app_private.current_tenant_id();
  v_today text := current_date::text;
  v_week text := (current_date + 7)::text;
  r jsonb;
begin
  if v_tenant is null then return '{}'::jsonb; end if;

  select jsonb_build_object(
    'deadlines',(select count(*) from public.deadlines d where d.tenant_id=v_tenant and lower(coalesce(d.status,'')) not in ('completed','closed','done') and coalesce(nullif(d.due_date,''),nullif(d."dueDate",''),nullif(d.duedate,'')) between v_today and v_week),
    'timeoff',(select count(*) from public.time_off_requests t where t.tenant_id=v_tenant and lower(coalesce(t.status,''))='pending'),
    'pending_payments',(select count(*) from public.payments p where p.tenant_id=v_tenant and p.status in ('Pending','TBD','No Status','New Agmt','Failed')),
    'overdue_invoices',(select count(*) from public.invoices i where i.tenant_id=v_tenant and lower(coalesce(i.status,'')) <> 'paid' and (lower(coalesce(i.status,''))='overdue' or (nullif(i."dueDate",'') is not null and i."dueDate"<v_today) or (nullif(i.duedate,'') is not null and i.duedate<v_today))),
    'overdue_ar',(select count(*) from public.payments p where p.tenant_id=v_tenant and p.trade_type in ('1st Trade','2nd Trade') and lower(coalesce(p.payment_status,''))<>'paid' and nullif(p.scheduled_date,'') is not null and p.scheduled_date<v_today),
    'unread_voicemails',(select count(*) from public.voicemails v where v.tenant_id=v_tenant and coalesce(v.is_read,false)=false),
    'pending_esign',(select count(*) from public.esigns e where e.tenant_id=v_tenant and e.status='Awaiting'),
    'unread_fax',(select count(*) from public.fax_logs f where f.tenant_id=v_tenant and f.direction='inbound' and coalesce(f.is_read,false)=false),
    'calendar',(select count(*) from public.calevents c where c.tenant_id=v_tenant and nullif(c.date,'') is not null and c.date between v_today and (current_date+1)::text),
    'tasks',(select count(*) from public.tasks t where t.tenant_id=v_tenant and coalesce(t.done,false)=false and coalesce(t.deleted,false)=false)
  ) into r;
  return r;
end;
$$;

grant execute on function public.get_sidebar_badge_counts() to authenticated;
revoke execute on function public.get_sidebar_badge_counts() from anon;
