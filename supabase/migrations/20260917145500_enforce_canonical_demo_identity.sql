-- Canonical TaxRes CRM Demo identity guard.
--
-- The showcase tenant is permanent and must never inherit Tax Case Review,
-- CloudCPA, RomyLabs, the retired taxrescrm.com address, or a prospect office's
-- identity after a reset. These triggers make the invariant database-level so
-- future reseeds cannot silently regress it.

create or replace function public.enforce_taxres_demo_settings_identity()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
begin
  if new.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid then
    new.name := 'TaxRes CRM';
    new.firmname := 'TaxRes CRM';
    new.email := 'romy@taxrescrm.net';
    new.firmemail := 'romy@taxrescrm.net';
    new.smtp_email := 'romy@taxrescrm.net';
    new.logourl := 'https://taxrescrm.app/taxrescrm-logo.png';
    new.email_signature_logo_url := 'https://taxrescrm.app/taxrescrm-logo.png';
    new.website := 'https://taxrescrm.net';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_taxres_demo_settings_identity() from public,anon,authenticated;

drop trigger if exists trg_enforce_taxres_demo_settings_identity on public.settings;
create trigger trg_enforce_taxres_demo_settings_identity
before insert or update on public.settings
for each row execute function public.enforce_taxres_demo_settings_identity();

create or replace function public.enforce_taxres_demo_outbound_email_identity()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
begin
  if new.tenant_id = 'a0000000-0000-0000-0000-000000000001'::uuid
     and lower(coalesce(new.direction,'')) = 'outbound' then
    new.sender := 'romy@taxrescrm.net';
    new.from_address := 'romy@taxrescrm.net';
    new.reply_from := 'romy@taxrescrm.net';
    new.received_mailbox := 'romy@taxrescrm.net';
    new.mailbox_owner := 'demo@taxrescrm.net';
    if new.product_id is null or new.product_id = '' then
      new.product_id := 'taxres_crm';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_taxres_demo_outbound_email_identity() from public,anon,authenticated;

drop trigger if exists trg_enforce_taxres_demo_outbound_email_identity on public.emails;
create trigger trg_enforce_taxres_demo_outbound_email_identity
before insert or update on public.emails
for each row execute function public.enforce_taxres_demo_outbound_email_identity();

-- Normalize the current showcase tenant and any seeded outbound sample mail.
update public.settings
set name='TaxRes CRM',firmname='TaxRes CRM',email='romy@taxrescrm.net',firmemail='romy@taxrescrm.net',smtp_email='romy@taxrescrm.net',
    logourl='https://taxrescrm.app/taxrescrm-logo.png',email_signature_logo_url='https://taxrescrm.app/taxrescrm-logo.png',website='https://taxrescrm.net'
where tenant_id='a0000000-0000-0000-0000-000000000001'::uuid;

update public.employees
set email_signature_logo_url='https://taxrescrm.app/taxrescrm-logo.png'
where tenant_id='a0000000-0000-0000-0000-000000000001'::uuid
  and lower(email)='demo@taxrescrm.net';

update public.emails
set sender='romy@taxrescrm.net',from_address='romy@taxrescrm.net',reply_from='romy@taxrescrm.net',
    received_mailbox='romy@taxrescrm.net',mailbox_owner='demo@taxrescrm.net',product_id='taxres_crm'
where tenant_id='a0000000-0000-0000-0000-000000000001'::uuid
  and lower(coalesce(direction,''))='outbound';
