-- Generate tenant-scoped case and invoice numbers inside PostgreSQL under
-- transaction advisory locks. This removes the browser race where two users
-- could calculate the same next number at the same time.

create or replace function public.assign_case_number()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_next integer;
begin
  if nullif(btrim(new."caseNum"),'') is not null then
    return new;
  end if;
  if new.tenant_id is null then
    raise exception 'case tenant_id is required before numbering';
  end if;
  perform pg_advisory_xact_lock(hashtext('case-number:'||new.tenant_id::text));
  select coalesce(max(nullif(regexp_replace(coalesce(c."caseNum",''),'\D','','g'),'')::integer),0)+1
    into v_next
  from public.cases c
  where c.tenant_id=new.tenant_id;
  new."caseNum" := 'C-'||lpad(v_next::text,6,'0');
  return new;
end;
$$;

drop trigger if exists trg_assign_case_number on public.cases;
create trigger trg_assign_case_number
before insert on public.cases
for each row execute function public.assign_case_number();

create unique index if not exists cases_tenant_case_num_uidx
on public.cases(tenant_id,"caseNum")
where "caseNum" is not null and btrim("caseNum")<>'';

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_next integer;
begin
  if nullif(btrim(new."invNum"),'') is not null then
    return new;
  end if;
  if new.tenant_id is null then
    raise exception 'invoice tenant_id is required before numbering';
  end if;
  perform pg_advisory_xact_lock(hashtext('invoice-number:'||new.tenant_id::text));
  select coalesce(max(nullif(regexp_replace(coalesce(i."invNum",''),'\D','','g'),'')::integer),0)+1
    into v_next
  from public.invoices i
  where i.tenant_id=new.tenant_id;
  new."invNum" := 'INV-'||lpad(v_next::text,6,'0');
  return new;
end;
$$;

drop trigger if exists trg_assign_invoice_number on public.invoices;
create trigger trg_assign_invoice_number
before insert on public.invoices
for each row execute function public.assign_invoice_number();

create unique index if not exists invoices_tenant_inv_num_uidx
on public.invoices(tenant_id,"invNum")
where "invNum" is not null and btrim("invNum")<>'';
