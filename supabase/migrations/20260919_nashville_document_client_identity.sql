-- Nashville document organization closeout.
-- Keep client_id authoritative while preserving lead/general documents that do not map to a CRM client.

create or replace function public.sync_document_client_identity()
returns trigger
language plpgsql
security invoker
set search_path to 'public','pg_temp'
as $$
declare
  v_name text;
  v_id text;
  v_matches integer;
begin
  if nullif(btrim(coalesce(new.client_id,'')),'') is not null then
    select c.name
      into v_name
    from public.clients c
    where c.id = new.client_id
      and (new.tenant_id is null or c.tenant_id = new.tenant_id)
    limit 1;

    if v_name is null then
      raise exception 'Document client_id does not resolve to a client';
    end if;

    new.client := v_name;
    new.clientname := v_name;
    return new;
  end if;

  if nullif(btrim(coalesce(new.client,new.clientname,'')),'') is null then
    return new;
  end if;

  select count(*), max(c.id), max(c.name)
    into v_matches, v_id, v_name
  from public.clients c
  where (new.tenant_id is null or c.tenant_id = new.tenant_id)
    and c.deleted_at is null
    and lower(btrim(c.name)) = lower(btrim(coalesce(new.client,new.clientname,'')));

  if v_matches = 1 then
    new.client_id := v_id;
    new.client := v_name;
    new.clientname := v_name;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_document_client_identity on public.documents;
create trigger sync_document_client_identity
before insert or update of client_id, client, clientname, tenant_id
on public.documents
for each row
execute function public.sync_document_client_identity();

revoke all on function public.sync_document_client_identity() from public, anon, authenticated;
