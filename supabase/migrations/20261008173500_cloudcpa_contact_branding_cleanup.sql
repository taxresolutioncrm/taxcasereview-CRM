-- CloudCPA firm identity cleanup.
-- Scope is intentionally one tenant only. Do not change TCR or any other office.
update public.settings
set
  name = 'CloudCPA Inc',
  firmname = 'CloudCPA Inc',
  phone = '+15612039464',
  firmphone = '+15612039464',
  firm_fax_number = '+15613280029',
  fax_number = '+15613280029',
  logourl = '/cloudcpa-logo.png',
  updated_at = now()
where tenant_id = 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae'::uuid;
