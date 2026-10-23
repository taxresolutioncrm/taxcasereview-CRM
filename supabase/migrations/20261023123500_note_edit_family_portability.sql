begin;

create or replace function public._note_edit_permission(p_column text)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v integer;
  v_email text := lower(coalesce(auth.jwt()->>'email', auth.email(), ''));
  v_tenant uuid := public.current_tenant_id();
begin
  if auth.role() = 'service_role' then return 3; end if;
  if auth.uid() is null or v_tenant is null or v_email='' then return 0; end if;
  if p_column not in ('perm_clients','perm_leads','perm_settings') then return 0; end if;
  execute format(
    'select coalesce(%I,0)::int from public.employees where tenant_id=$1 and lower(coalesce(email,''''))=$2 and lower(coalesce(status,''active''))=''active'' limit 1',
    p_column
  ) into v using v_tenant,v_email;
  return coalesce(v,0);
end;
$$;

revoke all on function public._note_edit_permission(text) from public, anon;
grant execute on function public._note_edit_permission(text) to authenticated, service_role;

drop policy if exists note_edit_audit_admin_select on public.note_edit_audit;
create policy note_edit_audit_admin_select
  on public.note_edit_audit
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      public._note_edit_permission('perm_settings') >= 2
      or exists (
        select 1
        from public.employees e
        where e.tenant_id = (select public.current_tenant_id())
          and lower(coalesce(e.email,'')) = lower(coalesce(auth.jwt()->>'email', auth.email(), ''))
          and lower(coalesce(e.status,'active')) = 'active'
          and lower(coalesce(e.access,e.role,'')) in ('admin','super admin','admin / owner')
      )
    )
  );

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
  if auth.uid() is null or v_tenant is null or v_email = '' then raise exception 'Authentication required'; end if;

  select * into v_employee
  from public.employees e
  where e.tenant_id=v_tenant
    and lower(coalesce(e.email,''))=v_email
    and lower(coalesce(e.status,'active'))='active'
  limit 1;
  if v_employee.id is null then raise exception 'Active employee record required'; end if;

  if p_note_kind='lead' then v_permission:=public._note_edit_permission('perm_leads');
  elsif p_note_kind in ('client','case') then v_permission:=public._note_edit_permission('perm_clients');
  else raise exception 'Unsupported note type'; end if;

  if coalesce(v_permission,0)<2 then raise exception 'You do not have permission to edit this note'; end if;
  if btrim(coalesce(p_new_content,''))='' then raise exception 'Note cannot be empty'; end if;

  if p_note_kind='client' then
    select n.text,n.author,n.edit_version,n.client_id,n.clientname
      into v_old_content,v_author,v_version,v_entity_id,v_entity_name
    from public.client_notes n where n.id=p_note_id and n.tenant_id=v_tenant for update;
  elsif p_note_kind='lead' then
    select n.text,n.author,n.edit_version,n.lead_id,n.lead_name
      into v_old_content,v_author,v_version,v_entity_id,v_entity_name
    from public.lead_notes n where n.id=p_note_id and n.tenant_id=v_tenant for update;
  else
    select n.note,n.author,n.edit_version,n.case_id,c."clientName"
      into v_old_content,v_author,v_version,v_entity_id,v_entity_name
    from public.case_notes n
    left join public.cases c on c.id=n.case_id and c.tenant_id=n.tenant_id
    where n.id=p_note_id and n.tenant_id=v_tenant for update of n;
  end if;

  if not found then raise exception 'Note not found'; end if;
  if coalesce(v_version,0)<>coalesce(p_expected_version,0) then
    raise exception 'This note was changed by another employee. Refresh before saving again.';
  end if;
  if not public._employee_note_content_is_editable(v_author,v_old_content) then
    raise exception 'System-generated activity cannot be edited';
  end if;
  if btrim(p_new_content)=btrim(v_old_content) then raise exception 'No changes to save'; end if;

  perform set_config('app.note_edit_rpc','1',true);

  if p_note_kind='client' then
    update public.client_notes n
    set text=btrim(p_new_content),last_edited_at=v_edited_at,last_edited_by_employee_id=v_employee.id,last_edited_by_name=v_employee.name,edit_version=coalesce(n.edit_version,0)+1
    where n.id=p_note_id and n.tenant_id=v_tenant;
  elsif p_note_kind='lead' then
    update public.lead_notes n
    set text=btrim(p_new_content),last_edited_at=v_edited_at,last_edited_by_employee_id=v_employee.id,last_edited_by_name=v_employee.name,edit_version=coalesce(n.edit_version,0)+1
    where n.id=p_note_id and n.tenant_id=v_tenant;
  else
    update public.case_notes n
    set note=btrim(p_new_content),last_edited_at=v_edited_at,last_edited_by_employee_id=v_employee.id,last_edited_by_name=v_employee.name,edit_version=coalesce(n.edit_version,0)+1
    where n.id=p_note_id and n.tenant_id=v_tenant;
  end if;

  perform set_config('app.note_edit_rpc','',true);

  insert into public.note_edit_audit(tenant_id,note_kind,note_id,entity_type,entity_id,entity_name,previous_content,updated_content,employee_id,employee_name,edit_version,edited_at)
  values(v_tenant,p_note_kind,p_note_id,p_note_kind,v_entity_id,v_entity_name,v_old_content,btrim(p_new_content),v_employee.id,v_employee.name,coalesce(v_version,0)+1,v_edited_at);

  return query select p_note_id,btrim(p_new_content),v_edited_at,v_employee.id,v_employee.name,coalesce(v_version,0)+1;
end;
$$;

revoke all on function public.edit_employee_note(text,uuid,text,integer) from public, anon;
grant execute on function public.edit_employee_note(text,uuid,text,integer) to authenticated;

commit;
