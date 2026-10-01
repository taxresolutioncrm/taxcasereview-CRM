-- Prevent replayed client edit audit notes from creating duplicate timeline entries.
-- Limited strictly to auto-generated "✏️ Updated:" system notes so legitimate
-- repeated manual notes remain unaffected.

create or replace function public.prevent_duplicate_client_update_audit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.note_type,'') = 'System'
     and new.text like '✏️ Updated:%'
     and new.tenant_id is not null
  then
    if exists (
      select 1
      from public.client_notes cn
      where cn.tenant_id = new.tenant_id
        and (
          (new.client_id is not null and cn.client_id = new.client_id)
          or
          (new.client_id is null and lower(trim(cn.clientname)) = lower(trim(new.clientname)))
        )
        and cn.text = new.text
        and coalesce(cn.note_type,'') = 'System'
        and cn.created_at >= coalesce(new.created_at, now()) - interval '10 minutes'
    ) then
      return null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_client_update_audit on public.client_notes;
create trigger trg_prevent_duplicate_client_update_audit
before insert on public.client_notes
for each row
execute function public.prevent_duplicate_client_update_audit();
