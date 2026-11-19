-- RomyLabs-only sales prospect composer. Allows an agreement to be signed
-- before the receiving Restore Relay office is provisioned.
create or replace function public.admin_romylabs_create_restore_relay_presale_prospect(
  p_firm_name text, p_contact_name text, p_contact_email text
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_name text:=btrim(coalesce(p_firm_name,''));
  v_contact text:=btrim(coalesce(p_contact_name,''));
  v_email text:=lower(btrim(coalesce(p_contact_email,'')));
  v_id uuid;
begin
  if auth.uid() is null or not public._is_platform_admin() then raise exception 'RomyLabs administrator required'; end if;
  if length(v_name)<2 or length(v_name)>160 then raise exception 'A valid customer legal business name is required'; end if;
  if length(v_contact)<2 or length(v_contact)>160 then raise exception 'An authorized contact name is required'; end if;
  if length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'A valid customer email is required'; end if;
  select id into v_id from public.prospects
    where product='restore_relay' and tenant_id is null
      and lower(firm_name)=lower(v_name) and lower(coalesce(contact_email,''))=v_email
    order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.prospects(
    firm_name,contact_name,contact_email,product,stage,seats,mrr_potential,
    deal_value,source,pricing_model,next_action
  ) values(
    v_name,v_contact,v_email,'restore_relay','New Lead',10,399.00,
    2394.00,'RomyLabs Admin Portal','subscription','Prepare six-month subscription agreement'
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_romylabs_create_restore_relay_presale_prospect(text,text,text) from public,anon;
grant execute on function public.admin_romylabs_create_restore_relay_presale_prospect(text,text,text) to authenticated;

create or replace function public.admin_romylabs_restore_relay_presale_prospects()
returns setof public.prospects
language sql
stable security definer
set search_path=pg_catalog,public,pg_temp
as $$
  select p.* from public.prospects p
  where auth.uid() is not null and public._is_platform_admin()
    and p.product='restore_relay' and p.tenant_id is null
  order by p.created_at desc limit 30;
$$;
revoke all on function public.admin_romylabs_restore_relay_presale_prospects() from public,anon;
grant execute on function public.admin_romylabs_restore_relay_presale_prospects() to authenticated;
