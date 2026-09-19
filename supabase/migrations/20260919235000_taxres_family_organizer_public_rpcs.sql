-- Keep Tax Organizer public-link workflow available on every TaxRes-family backend.
create or replace function public.organizer_get(p_id text)
returns public.tax_organizer_responses
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare rec public.tax_organizer_responses;
begin
  select * into rec
  from public.tax_organizer_responses
  where id::text=p_id
  limit 1;
  return rec;
end
$$;

create or replace function public.organizer_save_answers(p_id text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
begin
  if p_answers is null or jsonb_typeof(p_answers)<>'object' then
    raise exception 'Invalid organizer answers';
  end if;
  if pg_column_size(p_answers)>1048576 then
    raise exception 'Organizer answers are too large';
  end if;
  update public.tax_organizer_responses
  set answers=p_answers,updated_at=now()
  where id::text=p_id and status<>'Submitted';
  if not found then
    raise exception 'Organizer is unavailable or already submitted';
  end if;
end
$$;

create or replace function public.organizer_submit(p_id text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
begin
  if p_answers is null or jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>1048576 then
    raise exception 'Invalid organizer answers';
  end if;
  update public.tax_organizer_responses
  set answers=p_answers,status='Submitted',submitted_at=coalesce(submitted_at,now()),updated_at=now()
  where id::text=p_id and status<>'Submitted';
  if not found then
    raise exception 'Organizer is unavailable or already submitted';
  end if;
end
$$;

grant execute on function public.organizer_get(text) to anon, authenticated, service_role;
grant execute on function public.organizer_save_answers(text,jsonb) to anon, authenticated, service_role;
grant execute on function public.organizer_submit(text,jsonb) to anon, authenticated, service_role;
