-- TaxRes-family custom document folder management.
-- Destination-specific REVIEW REQUIRED: apply only to the intended sandbox project.
-- No Nashville tenant UUID, no data deletion, no storage changes.
create table if not exists public.client_document_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  client_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint client_document_folder_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 80 and name !~ '[[:cntrl:]]'
  )
);
create unique index if not exists client_document_folders_unique_folded
  on public.client_document_folders (tenant_id,client_id,lower(name));
create index if not exists client_document_folders_lookup
  on public.client_document_folders (tenant_id,client_id);
alter table public.client_document_folders enable row level security;
revoke all on public.client_document_folders from PUBLIC,anon,authenticated;
grant select on public.client_document_folders to authenticated;

-- Folder audit is append-only from authorized definer RPCs, not client-editable.
create table if not exists public.client_document_folder_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  actor_email text not null,
  tenant_id uuid not null,
  client_id text not null,
  folder_id uuid not null,
  operation text not null check (operation in ('create','rename','delete')),
  old_name text,
  new_name text,
  created_at timestamptz not null default now()
);
alter table public.client_document_folder_audit enable row level security;
revoke all on public.client_document_folder_audit from PUBLIC,anon,authenticated;

-- Mirrors the app's document permissions when explicit perm_documents is NULL.
create or replace function public._client_folder_can(p_tenant uuid, p_level integer)
returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select auth.uid() is not null and p_tenant=public.current_tenant_id()
    and exists (
      select 1 from public.employees e
      join public.tenants t on t.id=e.tenant_id
      where e.tenant_id=p_tenant
        and lower(e.email)=lower(coalesce(auth.jwt()->>'email',auth.email(),''))
        and lower(coalesce(e.status,''))='active'
        and lower(coalesce(t.status,'')) in ('active','trial')
        and coalesce(e.perm_documents,
          case
            when e.access in ('Super Admin','Admin','EA','CPA','Attorney','Sales Rep','Sales Manager','Manager','Tax Advisor') then 2
            when e.access='Tax Associate' then 1
            else 0
          end
        ) >= p_level
    );
$$;
revoke all on function public._client_folder_can(uuid,integer) from PUBLIC,anon;
grant execute on function public._client_folder_can(uuid,integer) to authenticated;

drop policy if exists client_document_folders_tenant_read on public.client_document_folders;
create policy client_document_folders_tenant_read on public.client_document_folders
for select to authenticated using (
  public._client_folder_can(tenant_id,1)
  and exists (select 1 from public.clients c where c.id=client_id and c.tenant_id=client_document_folders.tenant_id)
);

-- Shared validator for built-in names, casefolded duplicates and client identity.
create or replace function public._client_folder_validate_name(p_name text)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_name text:=btrim(coalesce(p_name,''));
begin
  if v_name='' or char_length(v_name)>80 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Enter a valid folder name (1–80 characters; no control characters)' using errcode='22023';
  end if;
  if lower(v_name)=any(array[
    'irs docs','tax returns','agreements','poa & forms','transcripts','correspondence',
    'financial statements','e-signatures','call recording','other','all'
  ]) then
    raise exception 'This is a built-in folder name' using errcode='23505';
  end if;
  return v_name;
end $$;
revoke all on function public._client_folder_validate_name(text) from PUBLIC,anon;
grant execute on function public._client_folder_validate_name(text) to authenticated;

-- All document writes for one canonical client serialize with folder maintenance.
-- Handles a concurrent upload/delete/rename without touching storage objects.
create or replace function public._client_folder_document_write_lock()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if NEW.tenant_id is not null and nullif(NEW.client_id,'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.client_id,180621));
  end if;
  return NEW;
end $$;
drop trigger if exists client_folder_document_write_lock on public.documents;
create trigger client_folder_document_write_lock
before insert or update of "docType",client_id,tenant_id on public.documents
for each row execute function public._client_folder_document_write_lock();
revoke all on function public._client_folder_document_write_lock() from PUBLIC,anon,authenticated;

create or replace function public.create_client_document_folder(p_client_id text,p_name text)
returns table(id uuid,name text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_tenant uuid; v_client text; v_name text;
begin
  v_tenant:=public.current_tenant_id();
  v_client:=nullif(btrim(coalesce(p_client_id,'')),'');
  if v_tenant is null or v_client is null
    or not public._client_folder_can(v_tenant,2)
    or not exists(select 1 from public.clients c where c.id=v_client and c.tenant_id=v_tenant)
  then raise exception 'Client record unavailable or not authorized to manage folders' using errcode='42501';
  end if;
  v_name:=public._client_folder_validate_name(p_name);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || v_client,180621));
  if exists(select 1 from public.client_document_folders f
      where f.tenant_id=v_tenant and f.client_id=v_client and lower(f.name)=lower(v_name)) then
    raise exception 'Folder already exists' using errcode='23505';
  end if;
  return query insert into public.client_document_folders(tenant_id,client_id,name)
    values(v_tenant,v_client,v_name) returning client_document_folders.id,client_document_folders.name;
  insert into public.client_document_folder_audit(actor_id,actor_email,tenant_id,client_id,folder_id,operation,new_name)
    values(auth.uid(),coalesce(auth.email(),''),v_tenant,v_client,id,'create',v_name);
end $$;

create or replace function public.rename_client_document_folder(p_folder_id uuid,p_new_name text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_folder public.client_document_folders%rowtype; v_tenant uuid; v_client text;
  v_name text; v_client_name text; v_legacy boolean;
begin
  -- Discover only the lock key; all permissions are checked before mutation.
  select tenant_id,client_id into v_tenant,v_client from public.client_document_folders where id=p_folder_id;
  if not found then raise exception 'Folder not found'; end if;
  if not public._client_folder_can(v_tenant,2) then
    raise exception 'Not authorized to manage this folder' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || v_client,180621));
  select * into v_folder from public.client_document_folders where id=p_folder_id for update;
  if not found or v_folder.tenant_id<>v_tenant or v_folder.client_id<>v_client then
    raise exception 'Folder changed while editing'; end if;
  select c.name into v_client_name from public.clients c
    where c.id=v_client and c.tenant_id=v_tenant;
  if not found then raise exception 'Client record unavailable' using errcode='42501'; end if;
  v_name:=public._client_folder_validate_name(p_new_name);
  if v_name=v_folder.name then return; end if;
  if exists(select 1 from public.client_document_folders f
      where f.tenant_id=v_tenant and f.client_id=v_client
      and f.id<>p_folder_id and lower(f.name)=lower(v_name)) then
    raise exception 'Folder already exists' using errcode='23505'; end if;
  -- Ambiguous, name-only legacy records are not reassigned to another client.
  select exists(select 1 from public.documents d
      where d.tenant_id=v_tenant and d."docType"=v_folder.name
      and nullif(d.client_id,'') is null and
          (d.client=v_client_name or d.clientname=v_client_name)) into v_legacy;
  if v_legacy then raise exception
    'Legacy documents have no verified client ID. Link them to this client before renaming.'; end if;
  update public.documents set "docType"=v_name
    where tenant_id=v_tenant and client_id=v_client and "docType"=v_folder.name;
  update public.client_document_folders set name=v_name where id=p_folder_id;
  insert into public.client_document_folder_audit(actor_id,actor_email,tenant_id,client_id,folder_id,operation,old_name,new_name)
    values(auth.uid(),coalesce(auth.email(),''),v_tenant,v_client,p_folder_id,'rename',v_folder.name,v_name);
end $$;

create or replace function public.delete_empty_client_document_folder(p_folder_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_folder public.client_document_folders%rowtype; v_tenant uuid; v_client text; v_client_name text;
begin
  select tenant_id,client_id into v_tenant,v_client from public.client_document_folders where id=p_folder_id;
  if not found then raise exception 'Folder not found'; end if;
  if not public._client_folder_can(v_tenant,2) then
    raise exception 'Not authorized to manage this folder' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || v_client,180621));
  select * into v_folder from public.client_document_folders where id=p_folder_id for update;
  if not found then raise exception 'Folder not found'; end if;
  select c.name into v_client_name from public.clients c where c.id=v_client and c.tenant_id=v_tenant;
  if not found then raise exception 'Client record unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.documents d where d.tenant_id=v_tenant
      and d."docType"=v_folder.name
      and (d.client_id=v_client or
        (nullif(d.client_id,'') is null and (d.client=v_client_name or d.clientname=v_client_name)))) then
    raise exception 'Folder contains documents. Move them to another folder before deleting.'; end if;
  delete from public.client_document_folders where id=p_folder_id;
  insert into public.client_document_folder_audit(actor_id,actor_email,tenant_id,client_id,folder_id,operation,old_name)
    values(auth.uid(),coalesce(auth.email(),''),v_tenant,v_client,p_folder_id,'delete',v_folder.name);
end $$;
revoke all on function public.create_client_document_folder(text,text) from PUBLIC,anon;
revoke all on function public.rename_client_document_folder(uuid,text) from PUBLIC,anon;
revoke all on function public.delete_empty_client_document_folder(uuid) from PUBLIC,anon;
grant execute on function public.create_client_document_folder(text,text) to authenticated;
grant execute on function public.rename_client_document_folder(uuid,text) to authenticated;
grant execute on function public.delete_empty_client_document_folder(uuid) to authenticated;
