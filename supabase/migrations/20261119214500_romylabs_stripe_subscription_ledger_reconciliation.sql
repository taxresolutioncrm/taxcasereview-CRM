-- Mirror verified Restore Relay Stripe invoices into the RomyLabs SaaS ledger.
-- Service role only, idempotent, and no duplicate in-app invoice creation.
CREATE OR REPLACE FUNCTION public.romylabs_record_stripe_subscription_invoice(p_office_ref text, p_invoice_id text, p_amount_cents bigint, p_paid_at timestamp with time zone, p_customer_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_office public.romylabs_office_registry%rowtype;
  v_account public.romylabs_billing_accounts%rowtype;
  v_invoice public.romylabs_invoices%rowtype;
  v_start date;
  v_end date;
  v_invoice_number text;
begin
  if auth.role() <> 'service_role' then raise exception 'not authorized'; end if;
  if p_office_ref is null or p_invoice_id !~ '^in_[A-Za-z0-9]+$' or
     p_amount_cents < 1 or p_amount_cents > 1000000 or
     p_paid_at is null or p_paid_at > now() + interval '1 hour' then
    raise exception 'invalid Stripe invoice reconciliation input';
  end if;
  select * into v_office from public.romylabs_office_registry
    where product_key = 'restore_relay' and external_office_id = p_office_ref and status = 'active';
  if not found then raise exception 'registered Restore Relay office not found'; end if;
  insert into public.romylabs_billing_accounts(
    product_key,external_tenant_id,account_name,billing_email,
    monthly_amount_cents,billing_day,status,auto_invoice,auto_suspend,seat_count,per_seat_amount_cents,last_paid_at
  ) values (
    'restore_relay',p_office_ref,v_office.firm_name,
    coalesce(nullif(trim(v_office.primary_contact_email),''),nullif(trim(p_customer_email),'')),
    39900,least(extract(day from p_paid_at)::int,28),'active',false,false,
    coalesce(v_office.seats,0),0,p_paid_at
  )
  on conflict (product_key,external_tenant_id) do update
    set last_paid_at = greatest(coalesce(romylabs_billing_accounts.last_paid_at,excluded.last_paid_at),excluded.last_paid_at),
        status = 'active', auto_invoice = false,
        updated_at = now()
  returning * into v_account;
  if v_account.monthly_amount_cents <> 39900 then
    raise exception 'Stripe subscription does not match existing billing account price';
  end if;
  v_start := (p_paid_at at time zone 'UTC')::date;
  v_end := ((v_start + interval '1 month')::date - 1);
  v_invoice_number := 'STRIPE-' || p_invoice_id;
  insert into public.romylabs_invoices(
    account_id,invoice_number,period_start,period_end,issued_at,due_at,
    amount_cents,amount_paid_cents,status,paid_at,provider,provider_invoice_id
  ) values (
    v_account.id,v_invoice_number,v_start,v_end,p_paid_at,p_paid_at,
    p_amount_cents,p_amount_cents,'paid',p_paid_at,'stripe',p_invoice_id
  )
  on conflict (invoice_number) do nothing;
  select * into v_invoice from public.romylabs_invoices where invoice_number = v_invoice_number;
  if not found or v_invoice.account_id <> v_account.id or v_invoice.amount_cents <> p_amount_cents then
    raise exception 'Stripe invoice identity mismatch';
  end if;
  insert into public.romylabs_subscription_payments(
    invoice_id,account_id,amount_cents,status,provider,provider_payment_id,paid_at
  ) values (
    v_invoice.id,v_account.id,p_amount_cents,'succeeded','stripe',p_invoice_id,p_paid_at
  )
  on conflict (provider,provider_payment_id) do nothing;
  if not exists (select 1 from public.romylabs_subscription_payments
      where provider = 'stripe' and provider_payment_id = p_invoice_id
        and account_id = v_account.id and invoice_id = v_invoice.id
        and status = 'succeeded') then
    raise exception 'Stripe payment ledger reconciliation mismatch';
  end if;
  return jsonb_build_object('ok',true,'account_id',v_account.id,'invoice_id',v_invoice.id);
end $function$
;
revoke all on function public.romylabs_record_stripe_subscription_invoice(text,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.romylabs_record_stripe_subscription_invoice(text,text,bigint,timestamptz,text) to service_role;
