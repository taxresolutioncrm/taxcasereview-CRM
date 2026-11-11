-- Reviewed against the live 2026-11-11 schema: calevents.id/product_id are TEXT.
-- Do NOT use the stale report's UUID/calendar_product_id example.
create or replace function public.admin_delete_product_calendar_event(
  p_event_id text,
  p_product_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_deleted integer := 0;
begin
  if not public._is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if nullif(btrim(p_event_id), '') is null or nullif(btrim(p_product_id), '') is null or p_product_id = 'all' then
    raise exception 'Event ID and a specific product are required';
  end if;

  delete from public.calevents c
   where c.id = p_event_id
     and (
       c.product_id = p_product_id
       or (
         p_product_id = 'romylabs'
         and c.product_id is null
         and c.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
         and c."assignedTo" = 'Romy Cruz'
       )
     );

  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;
revoke all on function public.admin_delete_product_calendar_event(text,text) from public, anon;
grant execute on function public.admin_delete_product_calendar_event(text,text) to authenticated, service_role;

-- External-product support tickets intentionally have NULL tenant_id.
-- This platform-admin-only update does not grant general users cross-tenant access.
create or replace function public.admin_update_support_ticket_status(
  p_ticket_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_updated integer := 0;
begin
  if not public._is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if p_status not in ('Open', 'In Progress', 'Resolved') then
    raise exception 'Invalid support ticket status';
  end if;

  update public.support_tickets t
     set status = p_status, updated_at = now()
   where t.id = p_ticket_id
     and (t.tenant_id is null or t.tenant_id <> '489ace07-1a6b-4864-833a-4f8420568b40'::uuid);

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;
revoke all on function public.admin_update_support_ticket_status(uuid,text) from public, anon;
grant execute on function public.admin_update_support_ticket_status(uuid,text) to authenticated, service_role;

-- Defense-in-depth: the legacy logs already have tenant-scoped RLS in
-- production, but anonymous roles retain unnecessary table-level ALL grants.
-- Authenticated CRM fax/call UI and service_role webhooks are unchanged.
revoke all privileges on table public.call_logs, public.fax_logs from anon;

-- No public.sms_logs table exists in this database. Do not invent it.
-- The admin-only scope metrics RPC already verifies _is_platform_admin();
-- removing anonymous EXECUTE tightens the exposed RPC surface.
revoke execute on function public.admin_taxres_crm_scope_metrics(uuid) from public, anon;

-- Goals previously mislabelled today's appointment count as "Monthly Demos".
-- This protected read-only aggregate uses the actual calendar month.
create or replace function public.admin_monthly_calendar_event_count(p_month date default current_date)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if not public._is_platform_admin() then
    raise exception 'not authorized';
  end if;
  select count(*)::integer into v_count
    from public.calevents c
   where c.date::date >= date_trunc('month',p_month)::date
     and c.date::date < (date_trunc('month',p_month) + interval '1 month')::date
     and c."eventType" = 'Product Demo';
  return coalesce(v_count,0);
end;
$$;
revoke all on function public.admin_monthly_calendar_event_count(date) from public, anon;
grant execute on function public.admin_monthly_calendar_event_count(date) to authenticated, service_role;
