-- The RomyLabs Admin calendar must display legacy events created before
-- product_id tagging. Limit the fallback to its own admin-owned events so
-- null product_id is never treated as an unrestricted cross-tenant match.
create or replace function public.admin_product_calendar_events(
  p_product_id text default 'romylabs'
)
returns table (
  id text, title text, event_date date, event_time text, end_time text,
  event_type text, client_name text, contact_email text, notes text,
  source text, status text, product_id text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if lower(coalesce(auth.jwt()->>'email','')) not in (
    'info@romylabs.com',
    'romy@romylabs.com',
    'romy@taxrescrm.net',
    'romy@taxcasereview.org'
  ) then
    raise exception 'not authorized';
  end if;

  return query
  select
    c.id::text, c.title::text, c.date::date, c.time::text,
    c."endTime"::text,
    coalesce(c."eventType"::text, c.type::text),
    coalesce(c."clientName"::text, c.client::text),
    c.contact_email::text, c.notes::text, c.source::text,
    c.status::text,
    case when c.product_id is null then 'romylabs' else c.product_id end::text,
    c.created_at
  from public.calevents c
  where c.date is not null
    and c.date::date >= date '2020-01-01'
    and (
      c.product_id is not null
      or (
        c.product_id is null
        and c.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
        and c."assignedTo" = 'Romy Cruz'
      )
    )
    and (
      p_product_id is null or p_product_id = 'all'
      or c.product_id = p_product_id
      or (
        p_product_id = 'romylabs'
        and c.product_id is null
        and c.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
        and c."assignedTo" = 'Romy Cruz'
      )
    )
  order by c.date::date asc, nullif(c.time,'')::time asc nulls last, c.created_at asc;
end;
$function$;
