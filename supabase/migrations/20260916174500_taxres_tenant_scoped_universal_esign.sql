-- Tenant-safe universal e-sign access for shared TaxRes / Cloud / future offices.
-- Platform admins retain global access. Office managers are restricted to taxres_crm/<their tenant id>/...

create or replace function public.can_manage_romylabs_office_esign(p_product_key text,p_external_office_id text)
returns boolean
language plpgsql stable security definer set search_path='public','pg_temp'
as $$
declare v_tenant uuid; v_email text;
begin
  if public._is_platform_admin() then return true; end if;
  if lower(trim(coalesce(p_product_key,''))) <> 'taxres_crm' then return false; end if;
  begin v_tenant := trim(coalesce(p_external_office_id,''))::uuid; exception when others then return false; end;
  if public.current_tenant_id() is distinct from v_tenant then return false; end if;
  v_email:=lower(coalesce(auth.jwt()->>'email',''));
  if v_email='' then return false; end if;
  return exists(
    select 1 from public.employees e
    where lower(e.email)=v_email and e.tenant_id=v_tenant and coalesce(e.status,'Active')='Active'
      and (coalesce(e.access,'') in ('Super Admin','Admin','Manager')
        or coalesce(e.role,'') in ('Super Admin','Admin','Manager')
        or coalesce(e.perm_documents,0)>=2)
  );
end $$;
revoke all on function public.can_manage_romylabs_office_esign(text,text) from public,anon;
grant execute on function public.can_manage_romylabs_office_esign(text,text) to authenticated,service_role;

-- The live migration also updates the existing admin_romylabs_* e-sign/list/resend/void RPCs
-- to call can_manage_romylabs_office_esign(), and adds these tenant-scoped RLS policies.
drop policy if exists "taxres offices manage own romylabs esign files" on storage.objects;
create policy "taxres offices manage own romylabs esign files" on storage.objects
for all to authenticated
using (
  bucket_id='romylabs-esign'
  and (storage.foldername(name))[1]='taxres_crm'
  and public.can_manage_romylabs_office_esign('taxres_crm',(storage.foldername(name))[2])
)
with check (
  bucket_id='romylabs-esign'
  and (storage.foldername(name))[1]='taxres_crm'
  and public.can_manage_romylabs_office_esign('taxres_crm',(storage.foldername(name))[2])
);

drop policy if exists "taxres offices manage own universal office documents" on public.romylabs_office_documents;
create policy "taxres offices manage own universal office documents" on public.romylabs_office_documents
for all to authenticated
using (product_key='taxres_crm' and public.can_manage_romylabs_office_esign(product_key,external_office_id))
with check (product_key='taxres_crm' and public.can_manage_romylabs_office_esign(product_key,external_office_id));
