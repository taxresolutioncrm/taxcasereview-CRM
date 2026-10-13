-- Centurion Firm is a separate central TaxRes office from CloudCPA.
-- This migration intentionally creates ONLY the tenant/settings shell.
-- It does not create/move employees, auth users, clients, documents,
-- phone/fax numbers, mailboxes, payment providers, or integrations.

do $$
declare
  v_tenant constant uuid := '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a';
  v_existing uuid;
begin
  select id into v_existing
  from public.tenants
  where lower(tenant_code)=lower('TRC-004')
  limit 1;

  if v_existing is not null and v_existing <> v_tenant then
    raise exception 'TRC-004 is already assigned to another tenant';
  end if;

  insert into public.tenants (
    id, tenant_code, firm_name, firm_address, firm_phone,
    plan_tier, status, logo_url, brand_color,
    primary_contact_name, primary_contact_email, notes
  )
  values (
    v_tenant,
    'TRC-004',
    'Centurion Firm',
    null,
    null,
    'starter',
    'trial',
    null,
    null,
    null,
    null,
    'Separate Centurion Firm prospect workspace. Do not merge with or inherit CloudCPA/TCR tenant data.'
  )
  on conflict (id) do update set
    firm_name = excluded.firm_name,
    -- Contact/provider fields are intentionally not overwritten here.
    notes = excluded.notes;

  insert into public.settings (
    id, tenant_id,
    name, firmname, website, tagline,
    firmaddress, address,
    firmphone, phone,
    firm_fax_number, fax_number,
    firmemail, email,
    logourl, primary_color
  )
  values (
    'tenant_' || replace(v_tenant::text,'-',''),
    v_tenant,
    'Centurion Firm',
    'Centurion Firm',
    'https://centurionfirm.com/',
    'Strategic Tax Solutions for the Innovators and Operators of Tomorrow',
    null, null,
    null, null,
    null, null,
    null, null,
    null, null
  )
  on conflict (tenant_id) do update set
    name = excluded.name,
    firmname = excluded.firmname,
    website = excluded.website,
    tagline = excluded.tagline;
end $$;

-- Guardrail evidence: the new tenant is separate from CloudCPA and TCR.
do $$
begin
  if exists (
    select 1
    from public.tenants
    where id='8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a'
      and id in (
        '61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid,
        'ecd3d3ce-016a-4bb4-800e-f090f51e4cae'::uuid
      )
  ) then
    raise exception 'Centurion tenant isolation failed';
  end if;
end $$;
