-- Repair any lead already marked Converted to Client without a client row,
-- then enforce the invariant at the database layer so no UI, webhook, RPC,
-- or future code path can create an orphaned conversion again.

-- 1) Repair existing orphaned conversions for every tenant.
insert into public.clients (
  name, "clientType", business_name, first, mi, last, phone, phone2, email,
  "smsConsent", "smsConsentDate", ssn, ein, dob,
  "spouseName", "spouseSsn", "spouseDob", "filingStatus",
  stripe_customer_id, default_payment_method_id, payment_method_type,
  payment_method_brand, payment_method_last4,
  street, city, state, zip, county,
  "pipelineStage", biz_street, biz_city, biz_state, biz_zip,
  source, "assignedTo", "taxAssociate",
  "irsBalance", "stateBalance", "issueType", "irsOrState",
  "irsStatus", "irsStatusOther", "irsDeadline",
  "stateStatus", "stateStatusOther", "stateDeadline",
  "filingRequirements", "taxYears",
  "salesRep", "contractFee",
  "trade1Amount", "trade1Date", "trade2Amount", "trade2Date",
  "trade3Amount", "trade3Date",
  notes, status, "clientSince", created_at, tenant_id
)
select
  l.name, coalesce(l."clientType",'Individual'), l.business_name,
  l.first, l.mi, l.last, l.phone, l.phone2, l.email,
  coalesce(l."smsConsent",false), l."smsConsentDate", l.ssn, l.ein, l.dob,
  l."spouseName", l."spouseSsn", l."spouseDob", l."filingStatus",
  l.stripe_customer_id, l.default_payment_method_id, l.payment_method_type,
  l.payment_method_brand, l.payment_method_last4,
  l.street, l.city, l.state, l.zip, l.county,
  'analysis', l.biz_street, l.biz_city, l.biz_state, l.biz_zip,
  l.source, l."assignedTo", l."taxAssociate",
  l."irsBalance", l."stateBalance", l."issueType", l."irsOrState",
  l."irsStatus", l."irsStatusOther", l."irsDeadline",
  l."stateStatus", l."stateStatusOther", l."stateDeadline",
  l."filingRequirements", coalesce(nullif(l."taxYearsCustom",''), l."taxYears"),
  l."salesRep", l."contractFee",
  l."trade1Amount", l."trade1Date", l."trade2Amount", l."trade2Date",
  l."trade3Amount", l."trade3Date",
  l.notes, 'Active', current_date::text, now(), l.tenant_id
from public.leads l
where l.status='Converted to Client'
  and l.tenant_id is not null
  and not exists (
    select 1
    from public.clients c
    where c.tenant_id=l.tenant_id
      and btrim(lower(c.name))=btrim(lower(l.name))
  );

-- 2) Every converted lead needs a case. Add one only when absent.
insert into public.cases (
  id, "clientName", clientid, "caseType", "irsBalance",
  "assignedTo", "taxAssociate", status, "taxYears",
  notes, created_at, tenant_id
)
select
  'case-'||c.id, c.name, c.id, coalesce(l."issueType",'Tax Resolution'),
  l."irsBalance", l."assignedTo", l."taxAssociate", 'Active',
  coalesce(nullif(l."taxYearsCustom",''), l."taxYears"),
  'Case opened on conversion from lead.', now(), l.tenant_id
from public.leads l
join public.clients c
  on c.tenant_id=l.tenant_id
 and btrim(lower(c.name))=btrim(lower(l.name))
where l.status='Converted to Client'
  and not exists (
    select 1 from public.cases x
    where x.tenant_id=l.tenant_id and x.clientid=c.id
  );

-- 3) Restore the standard onboarding task set if conversion was orphaned.
insert into public.tasks (
  title, "clientName", priority, "dueDate", done,
  "assignedTo", notes, created_at, tenant_id
)
select v.title, c.name, v.priority, (current_date + v.days_due), false,
       l."assignedTo", v.notes, now(), l.tenant_id
from public.leads l
join public.clients c
  on c.tenant_id=l.tenant_id
 and btrim(lower(c.name))=btrim(lower(l.name))
cross join lateral (
  values
    ('Email IRS POA — '||c.name, 'High', 0,
     'Send/confirm the IRS Power of Attorney for the newly converted client.'),
    ('Call IRS — '||c.name, 'High', 1,
     'Begin IRS contact and gather the account information needed for the resolution case.'),
    ('Schedule CRM call — '||c.name, 'Normal', 3,
     'Schedule the client onboarding / case strategy follow-up.')
) as v(title,priority,days_due,notes)
where l.status='Converted to Client'
  and not exists (
    select 1 from public.tasks t
    where t.tenant_id=l.tenant_id
      and t."clientName"=c.name
      and t.title=v.title
  );

-- 4) Carry lead history into the client timeline without duplicating entries.
insert into public.client_notes (
  clientname, text, author, type, created_at, visible_to_client, tenant_id
)
select c.name, n.text, coalesce(n.author,'Staff'), coalesce(n.type,'System'),
       n.created_at, false, l.tenant_id
from public.leads l
join public.clients c
  on c.tenant_id=l.tenant_id
 and btrim(lower(c.name))=btrim(lower(l.name))
join public.lead_notes n on n.lead_id=l.id and n.tenant_id=l.tenant_id
where l.status='Converted to Client'
  and not exists (
    select 1 from public.client_notes cn
    where cn.tenant_id=l.tenant_id
      and cn.clientname=c.name
      and cn.text=n.text
      and cn.created_at=n.created_at
  );

-- 5) Hard database guard: "Converted to Client" may only exist when the
-- tenant already has the corresponding client row.
create or replace function public.enforce_lead_conversion_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status='Converted to Client'
     and old.status is distinct from new.status
     and not exists (
       select 1
       from public.clients c
       where c.tenant_id=new.tenant_id
         and btrim(lower(c.name))=btrim(lower(new.name))
     )
  then
    raise exception 'Cannot mark lead Converted to Client before creating the client record';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lead_conversion_integrity on public.leads;
create trigger trg_lead_conversion_integrity
before update of status on public.leads
for each row
execute function public.enforce_lead_conversion_integrity();
