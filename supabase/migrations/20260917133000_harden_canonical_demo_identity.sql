-- Canonical Demo tenant identity guard.
-- Keeps the Demo login/mailbox owner separate from the physical outbound sender
-- and prevents later resets/settings writes from restoring legacy branding.

create or replace function public.enforce_canonical_demo_settings()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid then
    new.name := 'TaxRes CRM';
    new.firmname := 'TaxRes CRM';
    new.logourl := '/taxrescrm-logo.png';
    new.email := 'demo@taxrescrm.net';
    new.firmemail := 'demo@taxrescrm.net';
    new.website := 'https://taxrescrm.app';
    new.smtp_host := 'mail.taxrescrm.net';
    new.smtp_port := '465';
    new.smtp_email := 'romy@taxrescrm.net';
    new.smtp_name := 'TaxRes CRM';
    new.smtp_encryption := 'ssl';
    -- The Demo path must not silently fall back to a tenant Gmail OAuth token.
    new.gmail_access_token := null;
    new.gmail_refresh_token := null;
    new.gmail_token_expiry := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_canonical_demo_settings on public.settings;
create trigger trg_enforce_canonical_demo_settings
before insert or update on public.settings
for each row
execute function public.enforce_canonical_demo_settings();

-- Normalize the existing canonical row immediately when this migration is applied.
update public.settings
set
  name = 'TaxRes CRM',
  firmname = 'TaxRes CRM',
  logourl = '/taxrescrm-logo.png',
  email = 'demo@taxrescrm.net',
  firmemail = 'demo@taxrescrm.net',
  website = 'https://taxrescrm.app',
  smtp_host = 'mail.taxrescrm.net',
  smtp_port = '465',
  smtp_email = 'romy@taxrescrm.net',
  smtp_name = 'TaxRes CRM',
  smtp_encryption = 'ssl',
  gmail_access_token = null,
  gmail_refresh_token = null,
  gmail_token_expiry = null
where tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid;
