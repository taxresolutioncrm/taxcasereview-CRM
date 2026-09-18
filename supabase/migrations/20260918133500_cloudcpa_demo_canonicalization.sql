-- CloudCPA demo-readiness canonicalization.
-- Scope is TRC-003 only. Keep the prospect in trial status; do not fabricate
-- phone, fax, mail, payment, address, pricing, or provider credentials.

do $$
declare
  v_tenant uuid;
begin
  select id into v_tenant
  from public.tenants
  where tenant_code='TRC-003'
    and lower(firm_name)=lower('CloudCPA Inc')
  limit 1;

  if v_tenant is null then
    raise exception 'CloudCPA tenant TRC-003 was not found; refusing to mutate another office.';
  end if;

  update public.tenants
     set firm_name='CloudCPA Inc',
         plan_tier='enterprise',
         brand_color='#ea580c',
         logo_url='/cloudcpa-logo.png',
         primary_contact_name=coalesce(primary_contact_name,'Anthony Tropeano'),
         primary_contact_email=coalesce(primary_contact_email,'tony@thecloudcpa.net')
   where id=v_tenant;

  update public.settings
     set name='CloudCPA Inc',
         firmname='CloudCPA Inc',
         email='tony@thecloudcpa.net',
         firmemail='tony@thecloudcpa.net',
         logourl='/cloudcpa-logo.png',
         primary_color='#ea580c',
         -- Truthful demo defaults: CRM/manual workflows stay usable while
         -- external provider credentials are still pending.
         calling_provider=case
           when (coalesce(sw_space_url,'')<>'' and coalesce(sw_project_id,'')<>'' and coalesce(sw_api_token,'')<>'')
             or coalesce(verizon_api_key,'')<>''
             or coalesce(telnyx_api_key,'')<>''
           then calling_provider
           else 'none'
         end,
         payment_provider=case
           when exists (select 1 from public.tenants t where t.id=v_tenant and coalesce(t.stripe_connect_account_id,'')<>'')
             then coalesce(payment_provider,'stripe')
           when coalesce(qb_client_id,'')<>'' then coalesce(payment_provider,'intuit')
           else 'manual'
         end,
         booking_config=coalesce(booking_config,jsonb_build_object(
           'enabled',true,
           'slotMinutes',30,
           'bufferMinutes',0,
           'leadHours',4,
           'maxDaysOut',30,
           'types',jsonb_build_array('Free Consultation','Tax Investigation Review','Follow-Up Call'),
           'blockedDates','[]'::jsonb,
           'payment',jsonb_build_object('required',false,'amount','','label',''),
           'hours',jsonb_build_object(
             'mon',jsonb_build_array('09:00','17:00'),
             'tue',jsonb_build_array('09:00','17:00'),
             'wed',jsonb_build_array('09:00','17:00'),
             'thu',jsonb_build_array('09:00','17:00'),
             'fri',jsonb_build_array('09:00','17:00'),
             'sat',null,'sun',null
           )
         ))
   where tenant_id=v_tenant;

  update public.employees
     set name=case when lower(email)='tony@thecloudcpa.net' then 'Anthony Tropeano' else name end,
         role=case when lower(email)='tony@thecloudcpa.net' then 'Super Admin' else role end,
         access=case when lower(email)='tony@thecloudcpa.net' then 'Super Admin' else access end,
         status=case when lower(email)='tony@thecloudcpa.net' then 'Active' else status end,
         perm_clients=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_clients end,
         perm_leads=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_leads end,
         perm_billing=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_billing end,
         perm_schedule=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_schedule end,
         perm_documents=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_documents end,
         perm_reports=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_reports end,
         perm_hr=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_hr end,
         perm_settings=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_settings end,
         perm_irs=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_irs end,
         perm_comms=case when lower(email)='tony@thecloudcpa.net' then 3 else perm_comms end
   where tenant_id=v_tenant;
end $$;
