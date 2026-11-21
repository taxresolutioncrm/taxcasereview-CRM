-- Real registered offices can have reminder drafts without activating billing.
-- Preserve existing billing account and CRM scopes, and allow registry office scope.
alter table public.romylabs_monthly_reminder_content
 add column if not exists registry_office_id uuid
 references public.romylabs_office_registry(id) on delete cascade;
alter table public.romylabs_monthly_reminder_content
 drop constraint if exists romylabs_reminder_scope_valid;
alter table public.romylabs_monthly_reminder_content
 add constraint romylabs_reminder_scope_valid check (
   (account_id is null and registry_office_id is null and scope_key='product:'||product_key)
   or (account_id is not null and registry_office_id is null and scope_key='office:'||account_id::text)
   or (account_id is null and registry_office_id is not null and scope_key='registry:'||registry_office_id::text)
 );
create index if not exists romylabs_reminder_registry_idx
 on public.romylabs_monthly_reminder_content(registry_office_id);
create or replace function public.romylabs_validate_reminder_office()
returns trigger language plpgsql set search_path='public','pg_temp' as $$
begin
 if new.account_id is not null and not exists(
   select 1 from public.romylabs_billing_accounts a
    where a.id=new.account_id and a.product_key=new.product_key
 ) then raise exception 'Office is not part of selected CRM billing product'; end if;
 if new.registry_office_id is not null and not exists(
   select 1 from public.romylabs_office_registry r
   where r.id=new.registry_office_id and r.product_key=new.product_key
   and coalesce(r.metadata->>'demo','false')<>'true'
   and coalesce(r.metadata->>'required_demo_office','false')<>'true'
   and r.firm_name !~* '(^|[[:space:]])demo([[:space:]]|$)'
   and lower(trim(r.firm_name)) not in ('main office','tax case review','internal','romylabs internal')
 ) then raise exception 'Registered customer office is not eligible for a reminder draft'; end if;
 new.updated_at=now();new.updated_by=auth.uid();
 return new;
end $$;
-- Existing RLS and platform-admin policy continue to protect every scope.
