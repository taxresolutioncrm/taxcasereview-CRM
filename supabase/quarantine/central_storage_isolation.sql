-- CENTRAL TAXRES STORAGE ISOLATION
-- Run only after central_legacy_nashville.sql.
-- Keeps the private documents bucket usable for legacy TCR files while preventing
-- authenticated users in one office from browsing/modifying another office's files.

begin;

create or replace function public.central_document_storage_access(
  p_name text,
  p_owner_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path='public','auth','pg_temp'
as $$
declare
  v_tenant uuid;
begin
  if public._is_platform_admin() then return true; end if;

  v_tenant:=public.current_tenant_id();
  if v_tenant is null then return false; end if;
  if not exists (
    select 1 from public.tenants t
    where t.id=v_tenant
      and lower(coalesce(t.status,'')) in ('active','trial')
  ) then return false; end if;

  -- New service/browser paths carry tenant identity explicitly.
  if p_name like 'tenant/'||v_tenant::text||'/%'
     or p_name like 'portal/'||v_tenant::text||'/%'
     or p_name like 'organizer/'||v_tenant::text||'/%'
     or p_name like 'tds-direct/'||v_tenant::text||'/%'
  then return true; end if;

  -- Existing browser uploads predate tenant folders. Bind them to the tenant of
  -- the authenticated uploader so coworkers in that same office can still use them.
  if coalesce(p_owner_id,'')<>'' and exists (
    select 1
    from auth.users u
    join public.employees e on lower(e.email)=lower(u.email)
    where u.id::text=p_owner_id
      and e.tenant_id=v_tenant
  ) then return true; end if;

  -- Server-side records can establish tenant ownership even when Storage owner_id
  -- is null or belongs to a platform admin who uploaded while impersonating.
  if exists (
    select 1 from public.documents d
    where d.tenant_id=v_tenant and (
      d.storage_path=p_name
      or d.file_url like '%/documents/'||p_name||'%'
      or d.url like '%/documents/'||p_name||'%'
    )
  ) then return true; end if;

  if exists (
    select 1 from public.fax_logs f
    where f.tenant_id=v_tenant and (
      f.storage_path=p_name
      or f.file_url like '%/documents/'||p_name||'%'
    )
  ) then return true; end if;

  if exists (
    select 1 from public.transcript_analyses x
    where x.tenant_id=v_tenant and (
      x.file_path=p_name
      or x.file_url like '%/documents/'||p_name||'%'
    )
  ) then return true; end if;

  if exists (
    select 1 from public.formacorp_documents f
    where f.tenant_id=v_tenant and f.storage_path=p_name
  ) then return true; end if;

  if exists (
    select 1 from public.poa_records p
    where p.tenant_id=v_tenant and p.file_url like '%/documents/'||p_name||'%'
  ) then return true; end if;

  -- Old server-generated signed package files have null Storage owners and no
  -- tenant folder. They were created before CloudCPA/Nashville separation and
  -- are retained as a narrow TCR-only compatibility exception.
  if v_tenant='61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid
     and p_owner_id is null
     and p_name like 'docs/%/signed/%'
  then return true; end if;

  return false;
end;
$$;

revoke all on function public.central_document_storage_access(text,text) from public, anon;
grant execute on function public.central_document_storage_access(text,text) to authenticated, service_role;

create or replace function public.central_firm_asset_write_access(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path='public','pg_temp'
as $$
declare v_tenant uuid;
begin
  if public._is_platform_admin() then return true; end if;
  v_tenant:=public.current_tenant_id();
  if v_tenant is null then return false; end if;
  if not exists (
    select 1 from public.tenants t
    where t.id=v_tenant
      and lower(coalesce(t.status,'')) in ('active','trial')
  ) then return false; end if;

  return p_name like 'logo-'||v_tenant::text||'.%'
      or p_name like 'signature-logo-'||v_tenant::text||'.%'
      or p_name like 'signatures/'||v_tenant::text||'/%';
end;
$$;

revoke all on function public.central_firm_asset_write_access(text) from public, anon;
grant execute on function public.central_firm_asset_write_access(text) to authenticated, service_role;

create or replace function public.central_training_storage_access(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path='public','pg_temp'
as $$
declare v_tenant uuid;
begin
  if public._is_platform_admin() then return true; end if;
  v_tenant:=public.current_tenant_id();
  if v_tenant is null then return false; end if;
  if not exists (
    select 1 from public.tenants t
    where t.id=v_tenant
      and lower(coalesce(t.status,'')) in ('active','trial')
  ) then return false; end if;
  return p_name like v_tenant::text||'/%';
end;
$$;

revoke all on function public.central_training_storage_access(text) from public, anon;
grant execute on function public.central_training_storage_access(text) to authenticated, service_role;

drop policy if exists central_documents_tenant_guard on storage.objects;
create policy central_documents_tenant_guard
on storage.objects
as restrictive
for all
to authenticated
using (
  bucket_id<>'documents'
  or public.central_document_storage_access(name,owner_id::text)
)
with check (
  bucket_id<>'documents'
  or public.central_document_storage_access(name,owner_id::text)
);

drop policy if exists central_firm_assets_write_guard on storage.objects;
create policy central_firm_assets_write_guard
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id<>'firm-assets'
  or public.central_firm_asset_write_access(name)
);

drop policy if exists central_firm_assets_update_guard on storage.objects;
create policy central_firm_assets_update_guard
on storage.objects
as restrictive
for update
to authenticated
using (
  bucket_id<>'firm-assets'
  or public.central_firm_asset_write_access(name)
)
with check (
  bucket_id<>'firm-assets'
  or public.central_firm_asset_write_access(name)
);

drop policy if exists central_firm_assets_delete_guard on storage.objects;
create policy central_firm_assets_delete_guard
on storage.objects
as restrictive
for delete
to authenticated
using (
  bucket_id<>'firm-assets'
  or public.central_firm_asset_write_access(name)
);

drop policy if exists central_training_recordings_guard on storage.objects;
create policy central_training_recordings_guard
on storage.objects
as restrictive
for all
to authenticated
using (
  bucket_id<>'training-recordings'
  or public.central_training_storage_access(name)
)
with check (
  bucket_id<>'training-recordings'
  or public.central_training_storage_access(name)
);

commit;
