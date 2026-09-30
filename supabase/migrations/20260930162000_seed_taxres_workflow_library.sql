-- Seed the standard TaxRes workflow library into tenant offices that were
-- provisioned without it, and make future TRC-* offices receive the library.
-- Source library remains Tax Case Review; every copied row is tenant-local.

create or replace function public.seed_taxres_workflow_library(p_target_tenant uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_source constant uuid := '61a89aef-0e7e-4ea2-b222-44ab2024655a';
begin
  if p_target_tenant is null or p_target_tenant = v_source then
    return;
  end if;

  -- Do not overwrite an office that already has its own workflow library.
  if exists (select 1 from public.workflow_templates where tenant_id = p_target_tenant) then
    return;
  end if;

  insert into public.workflow_status_categories (name, sort_order, tenant_id, created_at)
  select c.name, c.sort_order, p_target_tenant, now()
  from public.workflow_status_categories c
  where c.tenant_id = v_source;

  insert into public.workflow_statuses (category_id, label, sort_order, tenant_id, created_at)
  select tc.id, s.label, s.sort_order, p_target_tenant, now()
  from public.workflow_statuses s
  join public.workflow_status_categories sc on sc.id = s.category_id
  join public.workflow_status_categories tc
    on tc.tenant_id = p_target_tenant
   and tc.name = sc.name
  where s.tenant_id = v_source;

  with copied_templates as (
    insert into public.workflow_templates (
      name, trigger_event, entity_type, active, created_by, created_at,
      tenant_id, description, trigger_value
    )
    select
      t.name, t.trigger_event, t.entity_type, t.active, t.created_by, now(),
      p_target_tenant, t.description, t.trigger_value
    from public.workflow_templates t
    where t.tenant_id = v_source
    returning id, name
  )
  insert into public.workflow_steps (
    template_id, title, assigned_role, due_in_days, notes,
    step_order, tenant_id, section_title
  )
  select
    ct.id, s.title, s.assigned_role, s.due_in_days, s.notes,
    s.step_order, p_target_tenant, s.section_title
  from public.workflow_steps s
  join public.workflow_templates st on st.id = s.template_id
  join copied_templates ct on ct.name = st.name
  where st.tenant_id = v_source;
end
$function$;

-- Repair every existing TaxRes-family office that was provisioned without a
-- workflow library. Offices that already have workflows are left untouched.
do $block$
declare
  r record;
begin
  for r in
    select id
    from public.tenants
    where tenant_code like 'TRC-%'
      and id <> '61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid
  loop
    perform public.seed_taxres_workflow_library(r.id);
  end loop;
end
$block$;

-- Keep future TaxRes-family offices from being created without the standard library.
create or replace function public.seed_taxres_workflows_after_tenant_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.tenant_code like 'TRC-%'
     and new.id <> '61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid then
    perform public.seed_taxres_workflow_library(new.id);
  end if;
  return new;
end
$function$;

drop trigger if exists trg_seed_taxres_workflows_after_tenant_insert on public.tenants;
create trigger trg_seed_taxres_workflows_after_tenant_insert
after insert on public.tenants
for each row
execute function public.seed_taxres_workflows_after_tenant_insert();
