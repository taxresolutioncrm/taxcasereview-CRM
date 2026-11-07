-- Per-business Microsoft Clarity reporting, isolated from the existing PoolVerge flow.
create table if not exists public.romylabs_clarity_business_cache (
  product_id text primary key,
  project_id text not null,
  metrics jsonb,
  fetched_at timestamptz,
  attempted_at timestamptz not null default '2000-01-01T00:00:00Z',
  last_error text
);
alter table public.romylabs_clarity_business_cache enable row level security;
revoke all on public.romylabs_clarity_business_cache from public, anon, authenticated;
grant select,insert,update on public.romylabs_clarity_business_cache to service_role;

create or replace function public.romylabs_clarity_business_token(
  p_product_id text, p_new_token text default null
) returns text language plpgsql security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
declare v_id uuid; v_token text; v_name text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_product_id is null or p_product_id = 'pool_crm' or
     not exists (select 1 from public.product_traffic_channels
       where product_id=p_product_id and channel_key='clarity'
         and tracking_id is not null and length(trim(tracking_id))>0)
  then raise exception 'Registered non-PoolVerge Clarity project required'; end if;
  v_name := 'romylabs_clarity_' || encode(convert_to(p_product_id, 'UTF8'), 'hex');
  if p_new_token is not null then
    if length(trim(p_new_token)) < 32 or length(trim(p_new_token)) > 10000
      or p_new_token ~ '[[:space:]]' then raise exception 'Invalid Clarity token'; end if;
    select id into v_id from vault.secrets where name=v_name limit 1;
    if v_id is null then
      perform vault.create_secret(trim(p_new_token),v_name,'Clarity token for '||p_product_id);
    else
      perform vault.update_secret(v_id,trim(p_new_token));
    end if;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name=v_name limit 1;
  return v_token;
end $$;
revoke all on function public.romylabs_clarity_business_token(text,text) from public,anon,authenticated;
grant execute on function public.romylabs_clarity_business_token(text,text) to service_role;
