-- Make Admin Portal tenant usage reflect the actual tenant footprint.
-- Separates purchased billing seats from active staff, preserves total CRM record
-- counts, and reports tenant storage from either document metadata or matching
-- Storage objects without mixing client collections into RomyLabs subscription revenue.

create or replace function public._admin_tenant_storage_bytes(p_tenant_id uuid)
returns bigint
language sql
security definer
set search_path=public,pg_temp
as $$
  select greatest(
    coalesce((
      select sum(coalesce(d.file_size,0))::bigint
      from public.documents d
      where d.tenant_id=p_tenant_id
    ),0),
    coalesce((
      select sum(coalesce((o.metadata->>'size')::bigint,0))::bigint
      from storage.objects o
      where position(p_tenant_id::text in o.name) > 0
    ),0)
  );
$$;

revoke all on function public._admin_tenant_storage_bytes(uuid) from public,anon,authenticated;
grant execute on function public._admin_tenant_storage_bytes(uuid) to service_role;

create or replace function public.admin_tenant_overview()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not public._is_platform_admin() then raise exception 'Not authorized.'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,
      'firm_name',t.firm_name,
      'tenant_code',t.tenant_code,
      'plan_tier',t.plan_tier,
      'status',t.status,
      'brand_color',t.brand_color,
      'created_at',t.created_at,
      'primary_contact_name',t.primary_contact_name,
      'primary_contact_email',t.primary_contact_email,
      'per_seat_rate',t.per_seat_rate,
      'monthly_rate',t.monthly_rate,
      'billing_seats',t.billing_seats,
      'employee_count',(
        select count(*)
        from public.employees e
        where e.tenant_id=t.id
          and lower(coalesce(e.status,'active'))='active'
      ),
      'client_count',(select count(*) from public.clients c where c.tenant_id=t.id),
      'active_client_count',(select count(*) from public.clients c where c.tenant_id=t.id and c.deleted_at is null),
      'lead_count',(select count(*) from public.leads l where l.tenant_id=t.id),
      'active_lead_count',(select count(*) from public.leads l where l.tenant_id=t.id and l.deleted_at is null),
      'cases_count',(select count(*) from public.cases cs where cs.tenant_id=t.id),
      'tasks_count',(select count(*) from public.tasks tk where tk.tenant_id=t.id and tk.done is not true and tk.deleted is not true),
      'transactions_count',(select count(*) from public.payment_transactions pt where pt.tenant_id=t.id),
      'calevents_count',(select count(*) from public.calevents ce where ce.tenant_id=t.id),
      'storage_bytes',public._admin_tenant_storage_bytes(t.id),
      'last_activity',(select max(a.created_at) from public.activity_log a where a.tenant_id=t.id),
      'total_collected',coalesce((
        select sum(sp.amount_cents)::numeric / 100
        from public.romylabs_subscription_payments sp
        join public.romylabs_billing_accounts ba on ba.id=sp.account_id
        where ba.product_key='taxres_crm'
          and ba.external_tenant_id=t.id::text
          and lower(coalesce(sp.status,'')) in ('succeeded','paid','completed','posted','cleared')
      ),0),
      'transaction_count',(
        select count(*)
        from public.romylabs_subscription_payments sp
        join public.romylabs_billing_accounts ba on ba.id=sp.account_id
        where ba.product_key='taxres_crm'
          and ba.external_tenant_id=t.id::text
          and lower(coalesce(sp.status,'')) in ('succeeded','paid','completed','posted','cleared')
      ),
      'effective_monthly',case
        when t.monthly_rate is not null and t.monthly_rate>0 then t.monthly_rate
        when t.per_seat_rate is not null then t.per_seat_rate * coalesce(
          nullif(t.billing_seats,0),
          (select count(*) from public.employees e where e.tenant_id=t.id and lower(coalesce(e.status,'active'))='active')
        )
        else 0
      end
    ) order by t.created_at),'[]'::jsonb)
    from public.tenants t
    where t.status<>'deleted' and t.tenant_code<>'ADMIN'
  );
end;
$$;

revoke all on function public.admin_tenant_overview() from public,anon;
grant execute on function public.admin_tenant_overview() to authenticated,service_role;

create or replace function public.get_office_full(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_tenant jsonb;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;
  select to_jsonb(t) into v_tenant from public.tenants t where t.id=p_tenant_id;
  if v_tenant is null then raise exception 'Office not found'; end if;

  return jsonb_build_object(
    'tenant',v_tenant,
    'employees',(select coalesce(jsonb_agg(to_jsonb(e) order by e.name),'[]'::jsonb) from public.employees e where e.tenant_id=p_tenant_id),
    'client_count',(select count(*) from public.clients c where c.tenant_id=p_tenant_id),
    'lead_count',(select count(*) from public.leads l where l.tenant_id=p_tenant_id),
    'cases_count',(select count(*) from public.cases c where c.tenant_id=p_tenant_id),
    'tasks_count',(select count(*) from public.tasks k where k.tenant_id=p_tenant_id and k.done is not true and k.deleted is not true),
    'transactions_count',(select count(*) from public.payment_transactions pt where pt.tenant_id=p_tenant_id),
    'transaction_count',(
      select count(*)
      from public.romylabs_subscription_payments sp
      join public.romylabs_billing_accounts ba on ba.id=sp.account_id
      where ba.product_key='taxres_crm'
        and ba.external_tenant_id=p_tenant_id::text
        and lower(coalesce(sp.status,'')) in ('succeeded','paid','completed','posted','cleared')
    ),
    'total_collected',coalesce((
      select sum(sp.amount_cents)::numeric / 100
      from public.romylabs_subscription_payments sp
      join public.romylabs_billing_accounts ba on ba.id=sp.account_id
      where ba.product_key='taxres_crm'
        and ba.external_tenant_id=p_tenant_id::text
        and lower(coalesce(sp.status,'')) in ('succeeded','paid','completed','posted','cleared')
    ),0),
    'storage_bytes',public._admin_tenant_storage_bytes(p_tenant_id),
    'last_activity',(select max(a.created_at) from public.activity_log a where a.tenant_id=p_tenant_id),
    'recent_actions',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (select a.* from public.admin_audit_log a where a.target_tenant_id=p_tenant_id order by a.created_at desc limit 20) x),
    'support_tickets',(select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (select s.* from public.support_tickets s where s.tenant_id=p_tenant_id order by s.created_at desc limit 20) x)
  );
end;
$$;

revoke all on function public.get_office_full(uuid) from public,anon;
grant execute on function public.get_office_full(uuid) to authenticated,service_role;
