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
