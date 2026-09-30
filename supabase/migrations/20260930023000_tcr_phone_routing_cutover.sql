-- TCR phone routing cutover staged for production deployment.
-- Voice:
--   +1 (888) 334-5052 = public outbound caller ID / main auto-attendant
--   +1 (561) 420-6665 = direct IRS/state return-call bypass only
-- Fax:
--   +1 (561) 420-6626 = dedicated fax DID

update public.settings
set firm_fax_number = '15614206626',
    fax_number = '15614206626',
    updated_at = now()
where tenant_id = '61a89aef-0e7e-4ea2-b222-44ab2024655a';
