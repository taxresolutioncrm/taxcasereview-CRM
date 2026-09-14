-- Repair Admin Portal office detail RPC after a later migration regressed
-- recent_actions back to the removed public.admin_audit_log relation.
create or replace function public.get_office_full(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare v_tenant jsonb;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized'; end if;

  select to_jsonb(t) into v_tenant
  from public.tenants t
  where t.id = p_tenant_id;

  if v_tenant is null then raise exception 'Office not found'; end if;

  return jsonb_build_object(
    'tenant', v_tenant,
    'employees', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.name), '[]'::jsonb)
      from public.employees e
      where e.tenant_id = p_tenant_id
    ),
    'client_count', (select count(*) from public.clients c where c.tenant_id = p_tenant_id),
    'lead_count', (select count(*) from public.leads l where l.tenant_id = p_tenant_id),
    'cases_count', (select count(*) from public.cases c where c.tenant_id = p_tenant_id),
    'tasks_count', (select count(*) from public.tasks k where k.tenant_id = p_tenant_id),
    'transaction_count', (
      select count(*)
      from public.romylabs_subscription_payments sp
      join public.romylabs_billing_accounts ba on ba.id = sp.account_id
      where ba.product_key = 'taxres_crm'
        and ba.external_tenant_id = p_tenant_id::text
        and lower(coalesce(sp.status,'')) in ('succeeded','paid','completed','posted','cleared')
    ),
    'total_collected', coalesce((
      select sum(sp.amount_cents)::numeric / 100
      from public.romylabs_subscription_payments sp
      join public.romylabs_billing_accounts ba on ba.id = sp.account_id
      where ba.product_key = 'taxres_crm'
        and ba.external_tenant_id = p_tenant_id::text
        and lower(coalesce(sp.status,'')) in ('succeeded','paid','completed','posted','cleared')
    ), 0),
    'storage_bytes', public._admin_tenant_storage_bytes(p_tenant_id),
    'last_activity', (
      select max(a.created_at)
      from public.activity_log a
      where a.tenant_id = p_tenant_id
    ),
    'recent_actions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', aa.id,
            'action', aa.action,
            'admin_email', aa.admin_email,
            'target_tenant_id', aa.target_tenant_id,
            'target_name', aa.target_name,
            'detail', aa.detail,
            'created_at', aa.created_at
          )
          order by aa.created_at desc
        ),
        '[]'::jsonb
      )
      from (
        select *
        from public.admin_actions
        where target_tenant_id = p_tenant_id
        order by created_at desc
        limit 20
      ) aa
    ),
    'support_tickets', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (
        select *
        from public.support_tickets
        where tenant_id = p_tenant_id
        order by created_at desc
        limit 20
      ) x
    )
  );
end;
$function$;

revoke all on function public.get_office_full(uuid) from public, anon;
grant execute on function public.get_office_full(uuid) to authenticated, service_role;
