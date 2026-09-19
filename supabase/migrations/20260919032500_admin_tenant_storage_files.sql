create or replace function public._admin_tenant_storage_files(p_tenant_id uuid)
returns bigint
language sql
security definer
set search_path to 'public','pg_temp'
as $$
  select greatest(
    coalesce((
      select count(*)::bigint
      from public.documents d
      where d.tenant_id = p_tenant_id
    ),0),
    coalesce((
      select count(*)::bigint
      from storage.objects o
      where position(p_tenant_id::text in o.name) > 0
    ),0)
  );
$$;

revoke all on function public._admin_tenant_storage_files(uuid) from public, anon, authenticated;
grant execute on function public._admin_tenant_storage_files(uuid) to service_role;
