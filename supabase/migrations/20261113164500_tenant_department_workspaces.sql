-- Additive department workspace preferences. This is a presentation preference,
-- not a replacement for employee permissions, plan entitlements or table RLS.
-- Execute only after the sandbox branch is certified.
create table if not exists public.tenant_department_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  departments text[] not null default array['resolution','preparation','bookkeeping','formation']::text[],
  updated_at timestamptz not null default now(),
  constraint tenant_department_config_known_keys check (
    departments <@ array['resolution','preparation','bookkeeping','formation']::text[]
  )
);

alter table public.tenant_department_config enable row level security;
revoke all on public.tenant_department_config from anon;
revoke all on public.tenant_department_config from authenticated;
grant select on public.tenant_department_config to authenticated;
-- Platform provisioning/administration uses service_role, not office employees.
drop policy if exists tenant_department_config_select_own on public.tenant_department_config;
create policy tenant_department_config_select_own
  on public.tenant_department_config for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- Preserve both shared offices' existing full-feature experience.
insert into public.tenant_department_config(tenant_id,departments)
values
 ('61a89aef-0e7e-4ea2-b222-44ab2024655a',array['resolution','preparation','bookkeeping','formation']::text[]),
 ('a0000000-0000-0000-0000-000000000001',array['resolution','preparation','bookkeeping','formation']::text[]),
 ('8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a',array['resolution']::text[])
on conflict (tenant_id) do nothing;
-- Nashville is deliberately excluded: it runs an independent Supabase project.
