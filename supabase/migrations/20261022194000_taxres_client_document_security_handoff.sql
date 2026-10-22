-- TaxRes client document/contact/security handoff.
-- Additive and tenant-safe. Does not move clients between tenants/databases.

alter table public.documents
  add column if not exists file_hash text,
  add column if not exists original_file_name text,
  add column if not exists upload_batch_id text;

create unique index if not exists documents_client_folder_hash_uidx
  on public.documents (tenant_id, client_id, "docType", file_hash)
  where file_hash is not null and client_id is not null;

alter table public.clients
  add column if not exists office_label text;

alter table public.settings
  add column if not exists client_offices jsonb not null default '[]'::jsonb;

-- Seed each tenant with its own configured firm identity as the first office
-- only when no explicit client-office list exists. No Nashville names are
-- hardcoded and tenant_id never changes when office_label changes.
update public.settings
set client_offices = jsonb_build_array(coalesce(nullif(name,''), nullif(firmname,''), 'Main Office'))
where coalesce(jsonb_array_length(client_offices),0)=0;

create table if not exists public.client_sensitive_fields (
  tenant_id uuid not null,
  client_id text not null,
  ssn text,
  spouse_ssn text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, client_id)
);

alter table public.client_sensitive_fields enable row level security;
revoke all on public.client_sensitive_fields from anon, authenticated;

-- Existing client writes may still include ssn/spouseSsn. Capture them into the
-- private table and erase them from the normal clients row before it is stored,
-- so ordinary PostgREST client reads can never expose full SSNs.
create or replace function public.capture_client_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ssn text;
  v_spouse text;
begin
  v_ssn := nullif(btrim(coalesce(new.ssn,'')), '');
  v_spouse := nullif(btrim(coalesce(new."spouseSsn",'')), '');

  if tg_op = 'UPDATE' then
    if v_ssn is null then
      select ssn into v_ssn
      from public.client_sensitive_fields
      where tenant_id = new.tenant_id and client_id = new.id::text;
    end if;
    if v_spouse is null then
      select spouse_ssn into v_spouse
      from public.client_sensitive_fields
      where tenant_id = new.tenant_id and client_id = new.id::text;
    end if;
  end if;

  if v_ssn is not null or v_spouse is not null then
    insert into public.client_sensitive_fields(tenant_id,client_id,ssn,spouse_ssn,updated_at)
    values(new.tenant_id,new.id::text,v_ssn,v_spouse,now())
    on conflict (tenant_id,client_id) do update
      set ssn = coalesce(excluded.ssn, public.client_sensitive_fields.ssn),
          spouse_ssn = coalesce(excluded.spouse_ssn, public.client_sensitive_fields.spouse_ssn),
          updated_at = now();
  end if;

  new.ssn := null;
  new."spouseSsn" := null;
  return new;
end;
$$;

drop trigger if exists capture_client_sensitive_fields_trg on public.clients;
create trigger capture_client_sensitive_fields_trg
before insert or update on public.clients
for each row execute function public.capture_client_sensitive_fields();

-- Backfill legacy values, then erase them from the ordinary client row.
insert into public.client_sensitive_fields(tenant_id,client_id,ssn,spouse_ssn,updated_at)
select tenant_id,id::text,nullif(btrim(coalesce(ssn,'')),''),nullif(btrim(coalesce("spouseSsn",'')),''),now()
from public.clients
where nullif(btrim(coalesce(ssn,'')),'') is not null
   or nullif(btrim(coalesce("spouseSsn",'')),'') is not null
on conflict (tenant_id,client_id) do update
  set ssn=coalesce(excluded.ssn,public.client_sensitive_fields.ssn),
      spouse_ssn=coalesce(excluded.spouse_ssn,public.client_sensitive_fields.spouse_ssn),
      updated_at=now();

update public.clients
set ssn=null, "spouseSsn"=null
where ssn is not null or "spouseSsn" is not null;

-- Keep the private row lifecycle aligned with archived/deleted client records.
create or replace function public.delete_client_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.client_sensitive_fields
  where tenant_id=old.tenant_id and client_id=old.id::text;
  return old;
end;
$$;

drop trigger if exists delete_client_sensitive_fields_trg on public.clients;
create trigger delete_client_sensitive_fields_trg
after delete on public.clients
for each row execute function public.delete_client_sensitive_fields();


-- Documents table permissions: tenant + employee document permission.
alter table public.documents enable row level security;
drop policy if exists tenant_isolation on public.documents;
drop policy if exists tenant_scoped_staff_only on public.documents;
drop policy if exists documents_select_perm on public.documents;
drop policy if exists documents_insert_perm on public.documents;
drop policy if exists documents_update_perm on public.documents;
drop policy if exists documents_delete_perm on public.documents;

create policy documents_select_perm on public.documents
for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.current_employee_permission('perm_documents') >= 1
);

create policy documents_insert_perm on public.documents
for insert to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and public.current_employee_permission('perm_documents') >= 2
);

create policy documents_update_perm on public.documents
for update to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.current_employee_permission('perm_documents') >= 2
)
with check (
  tenant_id = public.current_tenant_id()
  and public.current_employee_permission('perm_documents') >= 2
);

create policy documents_delete_perm on public.documents
for delete to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.current_employee_permission('perm_documents') >= 3
);

-- Legacy Storage objects can predate tenant-prefixed paths. Keep a service-only
-- ownership map so existing documents remain readable without weakening new uploads.
create table if not exists public.storage_object_tenants (
  bucket_id text not null,
  object_name text not null,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  source text not null default 'legacy_owner',
  created_at timestamptz not null default now(),
  primary key (bucket_id, object_name)
);

alter table public.storage_object_tenants enable row level security;
revoke all on public.storage_object_tenants from public, anon, authenticated;
grant all on public.storage_object_tenants to service_role;

insert into public.storage_object_tenants(bucket_id, object_name, tenant_id, source)
select so.bucket_id, so.name, e.tenant_id, 'legacy_owner'
from storage.objects so
join auth.users u on u.id::text = so.owner_id
join public.employees e on lower(e.email) = lower(u.email)
where so.bucket_id = 'documents'
  and e.tenant_id is not null
on conflict (bucket_id, object_name)
do update set tenant_id = excluded.tenant_id, source = excluded.source;


-- Prefer durable document metadata when it can identify legacy ownership.
insert into public.storage_object_tenants(bucket_id, object_name, tenant_id, source)
select 'documents', so.name, d.tenant_id, 'document_record'
from storage.objects so
join public.documents d
  on so.bucket_id = 'documents'
 and d.tenant_id is not null
 and (
   nullif(d.storage_path,'') = so.name
   or replace(coalesce(d.file_url,''),'storage://documents/','') = so.name
 )
where so.bucket_id = 'documents'
on conflict (bucket_id, object_name)
do update set tenant_id = excluded.tenant_id, source = excluded.source;

-- Historical direct-TDS service-role uploads used tds-direct/<tenant_uuid>/...
-- and may have no storage owner. That path itself contains the exact tenant.
insert into public.storage_object_tenants(bucket_id, object_name, tenant_id, source)
select 'documents', so.name, t.id, 'legacy_tds_path'
from storage.objects so
join public.tenants t on t.id::text = split_part(so.name,'/',2)
where so.bucket_id = 'documents'
  and split_part(so.name,'/',1) = 'tds-direct'
on conflict (bucket_id, object_name)
do update set tenant_id = excluded.tenant_id, source = excluded.source;

create or replace function public.storage_object_belongs_to_current_tenant(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.storage_object_tenants m
    where m.bucket_id = p_bucket
      and m.object_name = p_name
      and m.tenant_id = public.current_tenant_id()
  );
$$;

revoke all on function public.storage_object_belongs_to_current_tenant(text,text) from public, anon;
grant execute on function public.storage_object_belongs_to_current_tenant(text,text) to authenticated, service_role;

-- Remove historical broad document-bucket policies and any prior versions of
-- the strict policies before recreating the final permission-aware rules.
drop policy if exists "documents bucket - allow all" on storage.objects;
drop policy if exists "documents bucket - allow all writes" on storage.objects;
drop policy if exists documents_authenticated_select on storage.objects;
drop policy if exists documents_authenticated_insert on storage.objects;
drop policy if exists documents_authenticated_update on storage.objects;
drop policy if exists documents_authenticated_delete on storage.objects;
drop policy if exists documents_tenant_select on storage.objects;
drop policy if exists documents_tenant_insert on storage.objects;
drop policy if exists documents_tenant_update on storage.objects;
drop policy if exists documents_tenant_delete on storage.objects;

create policy documents_tenant_select on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and public.current_employee_permission('perm_documents') >= 1
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

create policy documents_tenant_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'documents'
  and public.current_employee_permission('perm_documents') >= 2
  and split_part(name,'/',1) = public.current_tenant_id()::text
);

create policy documents_tenant_update on storage.objects
for update to authenticated
using (
  bucket_id = 'documents'
  and public.current_employee_permission('perm_documents') >= 2
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
)
with check (
  bucket_id = 'documents'
  and public.current_employee_permission('perm_documents') >= 2
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

create policy documents_tenant_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'documents'
  and public.current_employee_permission('perm_documents') >= 3
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);
