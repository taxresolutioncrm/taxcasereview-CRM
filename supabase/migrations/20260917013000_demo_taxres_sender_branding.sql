-- Sales Demo tenant must present as TaxRes CRM and use the proven taxrescrm.net
-- outbound identity. The login account remains demo@taxrescrm.net; transactional
-- mail uses romy@taxrescrm.net so booking/e-sign/payment/document triggers do not
-- leak Tax Case Review, CloudCPA or RomyLabs identities.

update public.settings
set
  name = 'TaxRes CRM',
  firmname = 'TaxRes CRM',
  email = 'romy@taxrescrm.net',
  firmemail = 'romy@taxrescrm.net',
  smtp_email = 'romy@taxrescrm.net',
  logourl = 'https://taxrescrm.app/taxrescrm-logo.png',
  email_signature_logo_url = 'https://taxrescrm.app/taxrescrm-logo.png',
  website = 'https://taxrescrm.net'
where tenant_id = 'a0000000-0000-0000-0000-000000000001';

-- Keep the dedicated Demo login independent from the transactional sender.
update public.employees
set
  email_signature_logo_url = 'https://taxrescrm.app/taxrescrm-logo.png'
where tenant_id = 'a0000000-0000-0000-0000-000000000001'
  and lower(email) = 'demo@taxrescrm.net';
