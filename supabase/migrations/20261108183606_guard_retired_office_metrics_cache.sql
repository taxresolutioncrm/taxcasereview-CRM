-- Prevent retired legacy product snapshots from being recreated by older scheduled metrics workers.
-- Other product keys remain completely unaffected.
create or replace function public.skip_retired_office_metrics_cache()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $function$
begin
  if lower(coalesce(new.product_key,''))='cloudcpa' then
    return null;
  end if;
  return new;
end;
$function$;
drop trigger if exists romylabs_metrics_cache_retired_office_guard on public.romylabs_metrics_cache;
create trigger romylabs_metrics_cache_retired_office_guard
before insert or update on public.romylabs_metrics_cache
for each row execute function public.skip_retired_office_metrics_cache();
delete from public.romylabs_metrics_cache where lower(product_key)='cloudcpa';
