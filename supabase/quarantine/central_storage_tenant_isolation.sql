begin;

-- Compatibility map for legacy Storage objects that predate tenant-prefixed paths.
-- New uploads use <tenant_uuid>/... and do not require a mapping row.
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

-- Backfill only objects with trustworthy ownership:
-- storage owner -> auth user -> employee email -> employee tenant.
insert into public.storage_object_tenants(bucket_id, object_name, tenant_id, source)
select so.bucket_id, so.name, e.tenant_id, 'legacy_owner'
from storage.objects so
join auth.users u on u.id::text = so.owner_id
join public.employees e on lower(e.email) = lower(u.email)
where so.bucket_id in ('documents','training-recordings','firm-assets')
  and e.tenant_id is not null
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

-- Remove broad legacy policies.
drop policy if exists documents_authenticated_select on storage.objects;
drop policy if exists documents_authenticated_insert on storage.objects;
drop policy if exists documents_authenticated_update on storage.objects;
drop policy if exists documents_authenticated_delete on storage.objects;

drop policy if exists training_recordings_select on storage.objects;
drop policy if exists training_recordings_insert on storage.objects;
drop policy if exists training_recordings_delete on storage.objects;

drop policy if exists "Allow authenticated uploads" on storage.objects;
drop policy if exists "Allow authenticated updates" on storage.objects;
drop policy if exists "firm-assets-insert" on storage.objects;
drop policy if exists "firm-assets-update" on storage.objects;

-- Documents: tenant-prefixed new objects OR mapped legacy objects.
create policy documents_tenant_select on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

create policy documents_tenant_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'documents'
  and split_part(name,'/',1) = public.current_tenant_id()::text
);

create policy documents_tenant_update on storage.objects
for update to authenticated
using (
  bucket_id = 'documents'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
)
with check (
  bucket_id = 'documents'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

create policy documents_tenant_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'documents'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

-- Training recordings: tenant-prefixed only for new files; mapping retained for any legacy object.
create policy training_recordings_tenant_select on storage.objects
for select to authenticated
using (
  bucket_id = 'training-recordings'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

create policy training_recordings_tenant_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'training-recordings'
  and split_part(name,'/',1) = public.current_tenant_id()::text
);

create policy training_recordings_tenant_update on storage.objects
for update to authenticated
using (
  bucket_id = 'training-recordings'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
)
with check (
  bucket_id = 'training-recordings'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

create policy training_recordings_tenant_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'training-recordings'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

-- firm-assets remains publicly readable for logos, but writes are tenant-bound.
-- Compatibility allows the historical logo-<tenant>.ext naming and mapped legacy assets.
create policy firm_assets_tenant_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'firm-assets'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or name like ('logo-' || public.current_tenant_id()::text || '.%')
    or name like ('signature-logo-' || public.current_tenant_id()::text || '.%')
  )
);

create policy firm_assets_tenant_update on storage.objects
for update to authenticated
using (
  bucket_id = 'firm-assets'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or name like ('logo-' || public.current_tenant_id()::text || '.%')
    or name like ('signature-logo-' || public.current_tenant_id()::text || '.%')
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
)
with check (
  bucket_id = 'firm-assets'
  and (
    split_part(name,'/',1) = public.current_tenant_id()::text
    or name like ('logo-' || public.current_tenant_id()::text || '.%')
    or name like ('signature-logo-' || public.current_tenant_id()::text || '.%')
    or public.storage_object_belongs_to_current_tenant(bucket_id,name)
  )
);

commit;
