-- Pre-onboarding Restore Relay sales: a six-month $399 agreement that can
-- be signed BEFORE a new CRM office is provisioned. No existing agreements,
-- customer office rows, or other product templates are modified.
alter table public.romylabs_sales_agreements
  add column if not exists restore_relay_stripe_payment_url text;

create or replace function public.admin_romylabs_set_sales_agreement_stripe_link(
  p_agreement_id uuid, p_payment_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v public.romylabs_sales_agreements%rowtype;
  v_link text := btrim(coalesce(p_payment_url,''));
begin
  if auth.uid() is null or not public._is_platform_admin() then
    raise exception 'RomyLabs administrator required';
  end if;
  select * into v from public.romylabs_sales_agreements where id=p_agreement_id for update;
  if not found or v.product_key<>'restore_relay' then raise exception 'Restore Relay agreement not found'; end if;
  if v.status<>'draft' or v.sent_at is not null then raise exception 'Cannot modify a sent agreement'; end if;
  if v.monthly_amount<>399 or v.seats<>10 then raise exception 'Contract price or plan does not match $399 Professional'; end if;
  if length(v_link)>300 or
     v_link !~ '^https://buy[.]stripe[.]com/[A-Za-z0-9_-]+$' or
     v_link ~ '^https://buy[.]stripe[.]com/test_' then
    raise exception 'Live Stripe Payment Link is required';
  end if;
  update public.romylabs_sales_agreements
    set restore_relay_stripe_payment_url=v_link,updated_at=now()
    where id=p_agreement_id;
  insert into public.romylabs_sales_agreement_events(agreement_id,event_type,actor,metadata)
    values(p_agreement_id,'payment_link_attached',lower(coalesce(auth.jwt()->>'email','platform-admin')),
           jsonb_build_object('provider','stripe','first_installment_cents',39900));
  return true;
end;
$$;
revoke all on function public.admin_romylabs_set_sales_agreement_stripe_link(uuid,text) from public,anon;
grant execute on function public.admin_romylabs_set_sales_agreement_stripe_link(uuid,text) to authenticated;

insert into public.romylabs_agreement_templates
  (product_key,name,version,title,body_html,active,created_by)
select
  'restore_relay',
  'Restore Relay Professional Plan — Six-Month Fixed Term',
  '1.0',
  'Restore Relay Professional Plan — Six-Month Subscription Agreement',
  $template$
    <h2>Restore Relay Professional Plan — Six-Month Subscription Agreement</h2>
    <p>This Agreement is between <strong>Romy Labs, LLC</strong> (Provider) and <strong>{{firm_name}}</strong> (Customer).
    The authorized customer representative is {{signer_name}} ({{signer_email}}).</p>
    <h3>1. Access and seats</h3>
    <p>Provider grants Customer a limited, nontransferable right to use Restore Relay cloud CRM for its internal roofing, restoration and contractor business, including up to ten authorized users. Additional user seats, integrations, telecommunications or other usage-based charges require a separately approved order.</p>
    <h3>2. Fixed six-month term and fees</h3>
    <p>Customer agrees to a fixed term of <strong>six monthly billing periods</strong> beginning when the customer signs or on a separately agreed service-activation date. The subscription is <strong>$399.00 per month, six installments, $2,394.00 total</strong> before any legally applicable taxes and separately authorized charges. <strong>No automatic renewal.</strong> Renewal requires a new written agreement.</p>
    <h3>3. Billing and payment</h3>
    <p>The first $399.00 installment is due using the secure Stripe payment link provided in the same email as this Agreement. The payment link collects only the first installment unless its checkout expressly discloses otherwise. The remaining five $399.00 installments are due monthly and will be invoiced unless Customer separately elects automatic recurring billing with a valid payment authorization. No more than six installments may be charged for this contract, and automatic billing must not continue after the fixed term. Customer supplies payment details only to Stripe-hosted payment pages, never by reply email. The provider may request payment for amounts already due, subject to applicable law.</p>
    <h3>4. Responsibilities and support</h3>
    <p>Customer will use the platform lawfully, maintain accurate billing contacts, keep account credentials secure, and ensure it has the necessary authority and consents to upload, store and communicate customer and job information. Provider will use commercially reasonable efforts to operate and support the software, subject to scheduled maintenance, service outages and factors outside its reasonable control.</p>
    <h3>5. Data and confidentiality</h3>
    <p>Customer retains ownership of its business data. Provider may process that data as needed to provide, maintain and secure the subscription under applicable privacy commitments. Each party agrees to safeguard confidential information using reasonable measures. Any requested export or post-termination retention follows the applicable written policy.</p>
    <h3>6. Nonpayment and termination</h3>
    <p>Service may be suspended for material nonpayment after reasonable notice and an opportunity to cure, or immediately for serious security or unlawful-use issues. Any early-termination arrangement or refund must be agreed in writing. Nothing here removes rights that cannot lawfully be waived. Service and recurring charges must cease at the end of the initial term unless a new agreement is executed.</p>
    <h3>7. Acceptance</h3>
    <p>This agreement and any signed written order form comprise the subscription terms. Florida law governs except to the extent other mandatory law applies. The customer may sign electronically using the secure link provided; Provider accepts by activating service after signature and initial payment.</p>
  $template$,true,'RomyLabs Admin'
where not exists (
  select 1 from public.romylabs_agreement_templates
  where product_key='restore_relay' and name='Restore Relay Professional Plan — Six-Month Fixed Term'
);
