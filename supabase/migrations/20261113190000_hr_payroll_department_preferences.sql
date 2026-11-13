-- Additive fifth workspace: HR & Payroll, with independent display preferences.
-- No employee hours, time-clock records, payroll runs or client records are modified.
alter table public.tenant_department_config
  add column if not exists hr_features text[] not null default array['time_tracking','payroll']::text[];

alter table public.tenant_department_config
  drop constraint if exists tenant_department_config_known_keys;

alter table public.tenant_department_config
  add constraint tenant_department_config_known_keys check (
    departments <@ array['resolution','preparation','bookkeeping','formation','hr']::text[]
    and cardinality(departments) between 1 and 5
  );

alter table public.tenant_department_config
  add constraint tenant_department_config_hr_features_known check (
    hr_features <@ array['time_tracking','payroll']::text[]
    and cardinality(hr_features) between 0 and 2
  );

-- Keep both existing full-feature offices on all five departments.
-- Centurion remains resolution-only until the platform owner explicitly enables HR.
update public.tenant_department_config
set departments=array['resolution','preparation','bookkeeping','formation','hr']::text[],
    updated_at=now()
where tenant_id in (
  '61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid
) and departments=array['resolution','preparation','bookkeeping','formation']::text[];

-- Nashville runs a completely separate CRM/project: no modification.
