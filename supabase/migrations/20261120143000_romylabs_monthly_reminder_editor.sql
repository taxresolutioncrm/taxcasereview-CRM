-- Admin-managed text overrides for the first-day branded office SaaS reminders.
-- All sender identities, logos, rates, account state and payment disclosures remain system controlled.
create table if not exists public.romylabs_monthly_reminder_content (
  scope_key text primary key,
  product_key text not null references public.romylabs_products(product_id) on delete cascade,
  account_id uuid references public.romylabs_billing_accounts(id) on delete cascade,
  subject_override text not null default '' check(length(subject_override)<=180),
  opening_text text not null default '' check(length(opening_text)<=1200),
  additional_text text not null default '' check(length(additional_text)<=2400),
  closing_text text not null default '' check(length(closing_text)<=900),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint romylabs_reminder_scope_valid check (
    (account_id is null and scope_key = 'product:'||product_key)
    or (account_id is not null and scope_key = 'office:'||account_id::text)
  )
);
create index if not exists romylabs_reminder_product_idx on public.romylabs_monthly_reminder_content(product_key,account_id);
alter table public.romylabs_monthly_reminder_content enable row level security;
revoke all on public.romylabs_monthly_reminder_content from anon;
grant select,insert,update,delete on public.romylabs_monthly_reminder_content to authenticated;
grant all on public.romylabs_monthly_reminder_content to service_role;
drop policy if exists romylabs_monthly_reminder_admin_only on public.romylabs_monthly_reminder_content;
create policy romylabs_monthly_reminder_admin_only on public.romylabs_monthly_reminder_content
for all to authenticated
using ((select public._is_platform_admin()))
with check ((select public._is_platform_admin()));
create or replace function public.romylabs_validate_reminder_office()
returns trigger language plpgsql set search_path='public','pg_temp' as $$
begin
  if new.account_id is not null and not exists(
    select 1 from public.romylabs_billing_accounts a where a.id=new.account_id and a.product_key=new.product_key
  ) then raise exception 'Office is not part of selected CRM billing product'; end if;
  new.updated_at=now(); new.updated_by=auth.uid();
  return new;
end $$;
drop trigger if exists romylabs_reminder_office_consistency on public.romylabs_monthly_reminder_content;
create trigger romylabs_reminder_office_consistency
before insert or update on public.romylabs_monthly_reminder_content
for each row execute function public.romylabs_validate_reminder_office();
