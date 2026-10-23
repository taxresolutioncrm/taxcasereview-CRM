begin;

-- Existing case_notes.case_id was uuid while cases.id is text (e.g. cs..., c-demo-...).
-- Normalize the relationship before enabling note editing so new/existing case notes
-- use the same identifier shape as the cases table.
alter table public.case_notes
  alter column case_id type text using case_id::text;

alter table public.client_notes
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by_employee_id text,
  add column if not exists last_edited_by_name text,
  add column if not exists edit_version integer not null default 0;

alter table public.lead_notes
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by_employee_id text,
  add column if not exists last_edited_by_name text,
  add column if not exists edit_version integer not null default 0;

alter table public.case_notes
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by_employee_id text,
  add column if not exists last_edited_by_name text,
  add column if not exists edit_version integer not null default 0;

create table if not exists public.note_edit_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  note_kind text not null check (note_kind in ('client','lead','case')),
  note_id uuid not null,
  entity_type text not null check (entity_type in ('client','lead','case')),
  entity_id text,
  entity_name text,
  previous_content text not null,
  updated_content text not null,
  employee_id text not null,
  employee_name text not null,
  edit_version integer not null,
  edited_at timestamptz not null default now()
);

create index if not exists note_edit_audit_note_idx
  on public.note_edit_audit (tenant_id, note_kind, note_id, edit_version desc);
create index if not exists note_edit_audit_entity_idx
  on public.note_edit_audit (tenant_id, entity_type, entity_id, edited_at desc);

alter table public.note_edit_audit enable row level security;
revoke all on public.note_edit_audit from public, anon, authenticated;
grant select on public.note_edit_audit to authenticated;

drop policy if exists note_edit_audit_admin_select on public.note_edit_audit;
create policy note_edit_audit_admin_select
  on public.note_edit_audit
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      public.current_employee_permission('perm_settings') >= 2
      or exists (
        select 1
        from public.employees e
        where e.tenant_id = (select public.current_tenant_id())
          and lower(coalesce(e.email,'')) = lower(coalesce(auth.jwt()->>'email', auth.email(), ''))
          and lower(coalesce(e.status,'active')) = 'active'
          and lower(coalesce(e.access,e.role,'')) in ('admin','super admin')
      )
    )
  );

create or replace function public._employee_note_content_is_editable(
  p_author text,
  p_content text
) returns boolean
language sql
immutable
as $$
  select
    lower(btrim(coalesce(p_author,''))) not in ('system','ai','ai call summary')
    and lower(coalesce(p_author,'')) not like 'system %'
    and lower(coalesce(p_author,'')) not like 'ai %'
    and coalesce(p_content,'') !~ '^(📧 Email (Sent|Received)|💬 (SMS|Text) (Sent|Received)|📠 Fax sent|📁 Case status changed|💳 Payment|🔄 Task status changed|📅 Appointment scheduled|✉️ Booking link|📞 Call Summary)';
$$;

revoke all on function public._employee_note_content_is_editable(text,text) from public, anon, authenticated;

create or replace function public._guard_note_edit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rpc boolean := coalesce(current_setting('app.note_edit_rpc', true),'') = '1';
  v_content_changed boolean;
begin
  if tg_table_name in ('client_notes','lead_notes') then
    v_content_changed := new.text is distinct from old.text;
  else
    v_content_changed := new.note is distinct from old.note;
  end if;

  if auth.uid() is not null and not v_rpc then
    if v_content_changed then
      raise exception 'Note content must be edited through edit_employee_note()';
    end if;
    if new.last_edited_at is distinct from old.last_edited_at
       or new.last_edited_by_employee_id is distinct from old.last_edited_by_employee_id
       or new.last_edited_by_name is distinct from old.last_edited_by_name
       or new.edit_version is distinct from old.edit_version then
      raise exception 'Note edit audit metadata is managed by the server';
    end if;
    if tg_table_name='client_notes' and (
      new.author is distinct from old.author
      or new.created_at is distinct from old.created_at
      or new.clientname is distinct from old.clientname
      or new.client_id is distinct from old.client_id
      or new.tenant_id is distinct from old.tenant_id
    ) then
      raise exception 'Original client-note identity fields are immutable';
    elsif tg_table_name='lead_notes' and (
      new.author is distinct from old.author
      or new.created_at is distinct from old.created_at
      or new.lead_id is distinct from old.lead_id
      or new.lead_name is distinct from old.lead_name
      or new.tenant_id is distinct from old.tenant_id
    ) then
      raise exception 'Original lead-note identity fields are immutable';
    elsif tg_table_name='case_notes' and (
      new.author is distinct from old.author
      or new.created_at is distinct from old.created_at
      or new.case_id is distinct from old.case_id
      or new.tenant_id is distinct from old.tenant_id
    ) then
      raise exception 'Original case-note identity fields are immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_client_note_edit_fields on public.client_notes;
create trigger guard_client_note_edit_fields
before update on public.client_notes
for each row execute function public._guard_note_edit_fields();

drop trigger if exists guard_lead_note_edit_fields on public.lead_notes;
create trigger guard_lead_note_edit_fields
before update on public.lead_notes
for each row execute function public._guard_note_edit_fields();

drop trigger if exists guard_case_note_edit_fields on public.case_notes;
create trigger guard_case_note_edit_fields
before update on public.case_notes
for each row execute function public._guard_note_edit_fields();

create or replace function public.edit_employee_note(
  p_note_kind text,
  p_note_id uuid,
  p_new_content text,
  p_expected_version integer default 0
)
returns table (
  note_id uuid,
  content text,
  last_edited_at timestamptz,
  last_edited_by_employee_id text,
  last_edited_by_name text,
  edit_version integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_email text := lower(coalesce(auth.jwt()->>'email', auth.email(), ''));
  v_employee public.employees%rowtype;
  v_old_content text;
  v_author text;
  v_version integer;
  v_entity_id text;
  v_entity_name text;
  v_edited_at timestamptz := clock_timestamp();
  v_permission integer;
begin
  if auth.uid() is null or v_tenant is null or v_email = '' then
    raise exception 'Authentication required';
  end if;

  select * into v_employee
  from public.employees e
  where e.tenant_id = v_tenant
    and lower(coalesce(e.email,'')) = v_email
    and lower(coalesce(e.status,'active')) = 'active'
  limit 1;

  if v_employee.id is null then
    raise exception 'Active employee record required';
  end if;

  if p_note_kind = 'lead' then
    v_permission := public.current_employee_permission('perm_leads');
  elsif p_note_kind in ('client','case') then
    v_permission := public.current_employee_permission('perm_clients');
  else
    raise exception 'Unsupported note type';
  end if;

  if coalesce(v_permission,0) < 2 then
    raise exception 'You do not have permission to edit this note';
  end if;

  if btrim(coalesce(p_new_content,'')) = '' then
    raise exception 'Note cannot be empty';
  end if;

  if p_note_kind = 'client' then
    select n.text,n.author,n.edit_version,n.client_id,n.clientname
      into v_old_content,v_author,v_version,v_entity_id,v_entity_name
    from public.client_notes n
    where n.id=p_note_id and n.tenant_id=v_tenant
    for update;
  elsif p_note_kind = 'lead' then
    select n.text,n.author,n.edit_version,n.lead_id,n.lead_name
      into v_old_content,v_author,v_version,v_entity_id,v_entity_name
    from public.lead_notes n
    where n.id=p_note_id and n.tenant_id=v_tenant
    for update;
  else
    select n.note,n.author,n.edit_version,n.case_id::text,c."clientName"
      into v_old_content,v_author,v_version,v_entity_id,v_entity_name
    from public.case_notes n
    left join public.cases c on c.id=n.case_id and c.tenant_id=n.tenant_id
    where n.id=p_note_id and n.tenant_id=v_tenant
    for update of n;
  end if;

  if not found then
    raise exception 'Note not found';
  end if;

  if coalesce(v_version,0) <> coalesce(p_expected_version,0) then
    raise exception 'This note was changed by another employee. Refresh before saving again.';
  end if;

  if not public._employee_note_content_is_editable(v_author,v_old_content) then
    raise exception 'System-generated activity cannot be edited';
  end if;

  if btrim(p_new_content) = btrim(v_old_content) then
    raise exception 'No changes to save';
  end if;

  perform set_config('app.note_edit_rpc','1',true);

  if p_note_kind = 'client' then
    update public.client_notes
    set text=btrim(p_new_content),
        last_edited_at=v_edited_at,
        last_edited_by_employee_id=v_employee.id,
        last_edited_by_name=v_employee.name,
        edit_version=coalesce(edit_version,0)+1
    where id=p_note_id and tenant_id=v_tenant;
  elsif p_note_kind = 'lead' then
    update public.lead_notes
    set text=btrim(p_new_content),
        last_edited_at=v_edited_at,
        last_edited_by_employee_id=v_employee.id,
        last_edited_by_name=v_employee.name,
        edit_version=coalesce(edit_version,0)+1
    where id=p_note_id and tenant_id=v_tenant;
  else
    update public.case_notes
    set note=btrim(p_new_content),
        last_edited_at=v_edited_at,
        last_edited_by_employee_id=v_employee.id,
        last_edited_by_name=v_employee.name,
        edit_version=coalesce(edit_version,0)+1
    where id=p_note_id and tenant_id=v_tenant;
  end if;

  insert into public.note_edit_audit (
    tenant_id,note_kind,note_id,entity_type,entity_id,entity_name,
    previous_content,updated_content,employee_id,employee_name,edit_version,edited_at
  ) values (
    v_tenant,p_note_kind,p_note_id,p_note_kind,v_entity_id,v_entity_name,
    v_old_content,btrim(p_new_content),v_employee.id,v_employee.name,coalesce(v_version,0)+1,v_edited_at
  );

  return query
  select p_note_id,btrim(p_new_content),v_edited_at,v_employee.id,v_employee.name,coalesce(v_version,0)+1;
end;
$$;

revoke all on function public.edit_employee_note(text,uuid,text,integer) from public, anon;
grant execute on function public.edit_employee_note(text,uuid,text,integer) to authenticated;

create or replace function public.get_note_edit_history(
  p_note_kind text,
  p_note_id uuid
)
returns table (
  edit_version integer,
  previous_content text,
  updated_content text,
  employee_id text,
  employee_name text,
  edited_at timestamptz
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select a.edit_version,a.previous_content,a.updated_content,a.employee_id,a.employee_name,a.edited_at
  from public.note_edit_audit a
  where a.tenant_id = public.current_tenant_id()
    and a.note_kind = p_note_kind
    and a.note_id = p_note_id
  order by a.edit_version desc;
$$;

revoke all on function public.get_note_edit_history(text,uuid) from public, anon;
grant execute on function public.get_note_edit_history(text,uuid) to authenticated;

commit;
