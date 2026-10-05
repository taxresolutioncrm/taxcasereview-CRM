-- Prevent accidental duplicate manual subscription payments for an already-paid billing period.
create or replace function public.admin_record_manual_subscription_payment(
  p_product_key text,
  p_external_tenant_id text,
  p_account_name text,
  p_billing_email text,
  p_seat_count integer,
  p_per_seat_amount_cents bigint,
  p_amount_cents bigint,
  p_paid_at timestamptz default now(),
  p_provider text default 'zelle',
  p_reference text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.romylabs_billing_accounts%rowtype;
  v_invoice public.romylabs_invoices%rowtype;
  v_payment public.romylabs_subscription_payments%rowtype;
  v_expected bigint;
  v_period_start date;
  v_period_end date;
  v_reference text;
  v_provider text;
  v_now timestamptz := coalesce(p_paid_at, now());
  v_invoice_number text;
begin
  if not public._is_platform_admin() then raise exception 'Not authorized.'; end if;
  if coalesce(trim(p_product_key),'') = '' or coalesce(trim(p_external_tenant_id),'') = '' or coalesce(trim(p_account_name),'') = '' then raise exception 'Product, tenant, and account name are required.'; end if;
  if coalesce(p_seat_count,0) <= 0 then raise exception 'Seat count must be greater than zero.'; end if;
  if coalesce(p_per_seat_amount_cents,0) <= 0 then raise exception 'Per-seat rate must be greater than zero.'; end if;
  if coalesce(p_amount_cents,0) <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;

  v_expected := p_seat_count::bigint * p_per_seat_amount_cents;
  v_period_start := date_trunc('month', v_now)::date;
  v_period_end := (date_trunc('month', v_now) + interval '1 month - 1 day')::date;
  v_provider := lower(coalesce(nullif(trim(p_provider),''),'manual'));
  v_reference := nullif(trim(p_reference),'');
  if v_reference is null then v_reference := 'manual-' || gen_random_uuid()::text; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_provider || ':' || v_reference, 0));

  select * into v_payment
  from public.romylabs_subscription_payments
  where provider=v_provider and provider_payment_id=v_reference
  limit 1;

  if found then
    select * into v_account from public.romylabs_billing_accounts where id=v_payment.account_id;
    select * into v_invoice from public.romylabs_invoices where id=v_payment.invoice_id;
    if v_account.product_key <> p_product_key
       or v_account.external_tenant_id <> p_external_tenant_id
       or v_payment.amount_cents <> p_amount_cents then
      raise exception 'Payment reference is already in use for a different payment.';
    end if;
    return jsonb_build_object(
      'ok',true,'idempotent',true,'account_id',v_account.id,'invoice_id',v_invoice.id,
      'invoice_number',v_invoice.invoice_number,'payment_id',v_payment.id,
      'amount_cents',v_payment.amount_cents,'expected_monthly_cents',v_account.monthly_amount_cents,
      'seat_count',v_account.seat_count,'invoice_status',v_invoice.status
    );
  end if;

  insert into public.romylabs_billing_accounts(product_key,external_tenant_id,account_name,billing_email,monthly_amount_cents,status,seat_count,per_seat_amount_cents,last_paid_at,updated_at)
  values (p_product_key,p_external_tenant_id,p_account_name,nullif(trim(p_billing_email),''),v_expected,'active',p_seat_count,p_per_seat_amount_cents,v_now,now())
  on conflict (product_key,external_tenant_id) do update set
    account_name=excluded.account_name,
    billing_email=coalesce(excluded.billing_email,public.romylabs_billing_accounts.billing_email),
    monthly_amount_cents=excluded.monthly_amount_cents,
    seat_count=excluded.seat_count,
    per_seat_amount_cents=excluded.per_seat_amount_cents,
    status='active',updated_at=now()
  returning * into v_account;

  select * into v_invoice from public.romylabs_invoices
    where account_id=v_account.id and period_start=v_period_start and period_end=v_period_end for update;

  if found and v_invoice.status='paid' then
    raise exception 'This billing period is already paid. Choose a different payment date.';
  end if;

  if not found then
    v_invoice_number := 'RL-' || to_char(v_period_start,'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    insert into public.romylabs_invoices(account_id,invoice_number,period_start,period_end,issued_at,due_at,amount_cents,amount_paid_cents,status,provider,created_at,updated_at)
    values(v_account.id,v_invoice_number,v_period_start,v_period_end,v_now,v_now,v_expected,0,'open','manual',now(),now()) returning * into v_invoice;
  else
    update public.romylabs_invoices set amount_cents=v_expected,updated_at=now() where id=v_invoice.id returning * into v_invoice;
  end if;

  insert into public.romylabs_subscription_payments(invoice_id,account_id,amount_cents,status,provider,provider_payment_id,paid_at,created_at)
  values(v_invoice.id,v_account.id,p_amount_cents,'succeeded',v_provider,v_reference,v_now,now()) returning * into v_payment;

  update public.romylabs_invoices
    set amount_paid_cents=amount_paid_cents+p_amount_cents,
        status=case when amount_paid_cents+p_amount_cents>=amount_cents then 'paid' else 'open' end,
        paid_at=case when amount_paid_cents+p_amount_cents>=amount_cents then v_now else paid_at end,
        updated_at=now()
    where id=v_invoice.id returning * into v_invoice;

  insert into public.romylabs_collection_events(account_id,invoice_id,event_type,channel,detail,created_by,created_at)
  values(v_account.id,v_invoice.id,'manual_payment_recorded',v_provider,
    jsonb_build_object('payment_id',v_payment.id,'amount_cents',p_amount_cents,'seat_count',p_seat_count,'per_seat_amount_cents',p_per_seat_amount_cents,'reference',v_reference,'notes',p_notes),
    coalesce(auth.email(),'platform-admin'),now());

  update public.romylabs_billing_accounts
  set last_paid_at=v_now,updated_at=now()
  where id=v_account.id;

  if p_product_key='taxres_crm' then
    update public.tenants set
      billing_seats=p_seat_count,
      per_seat_rate=(p_per_seat_amount_cents::numeric/100),
      first_billed_at=coalesce(first_billed_at,v_now),
      last_billed_at=v_now,
      billing_notes=case when nullif(trim(p_notes),'') is null then billing_notes else concat_ws(E'\n',nullif(billing_notes,''),p_notes) end
    where id::text=p_external_tenant_id;
  end if;

  return jsonb_build_object(
    'ok',true,'idempotent',false,'account_id',v_account.id,'invoice_id',v_invoice.id,
    'invoice_number',v_invoice.invoice_number,'payment_id',v_payment.id,'amount_cents',p_amount_cents,
    'expected_monthly_cents',v_expected,'seat_count',p_seat_count,'invoice_status',v_invoice.status
  );
end;
$$;

revoke all on function public.admin_record_manual_subscription_payment(text,text,text,text,integer,bigint,bigint,timestamptz,text,text,text) from public;
revoke all on function public.admin_record_manual_subscription_payment(text,text,text,text,integer,bigint,bigint,timestamptz,text,text,text) from anon;
grant execute on function public.admin_record_manual_subscription_payment(text,text,text,text,integer,bigint,bigint,timestamptz,text,text,text) to authenticated;
grant execute on function public.admin_record_manual_subscription_payment(text,text,text,text,integer,bigint,bigint,timestamptz,text,text,text) to service_role;
