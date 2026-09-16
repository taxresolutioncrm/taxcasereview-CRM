create or replace function public.admin_delete_product_calendar_event(
  p_event_id text,
  p_product_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if not public._is_platform_admin() then
    raise exception 'not authorized';
  end if;

  delete from public.calevents
  where id = p_event_id;

  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;