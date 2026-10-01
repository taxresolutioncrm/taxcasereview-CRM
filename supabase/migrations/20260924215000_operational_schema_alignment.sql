-- Align operational tables with fields the current CRM UI actually persists.

alter table public.payments
  add column if not exists "checkNum" text,
  add column if not exists reference text,
  add column if not exists updated_at timestamptz;

alter table public.invoices
  add column if not exists updated_at timestamptz;

alter table public.estimates
  add column if not exists "depositAmount" text,
  add column if not exists "assignedTo" text,
  add column if not exists updated_at timestamptz;

-- Tenant-scoped, race-safe estimate numbering.
create or replace function public.assign_estimate_number()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_next integer;
begin
  if nullif(btrim(new."estNum"),'') is not null then
    return new;
  end if;
  if new.tenant_id is null then
    raise exception 'estimate tenant_id is required before numbering';
  end if;
  perform pg_advisory_xact_lock(hashtext('estimate-number:'||new.tenant_id::text));
  select coalesce(max(nullif(regexp_replace(coalesce(e."estNum",''),'\D','','g'),'')::integer),0)+1
    into v_next
  from public.estimates e
  where e.tenant_id=new.tenant_id;
  new."estNum" := 'EST-'||lpad(v_next::text,6,'0');
  return new;
end;
$$;

drop trigger if exists trg_assign_estimate_number on public.estimates;
create trigger trg_assign_estimate_number
before insert on public.estimates
for each row execute function public.assign_estimate_number();

create unique index if not exists estimates_tenant_est_num_uidx
on public.estimates(tenant_id,"estNum")
where "estNum" is not null and btrim("estNum")<>'';
