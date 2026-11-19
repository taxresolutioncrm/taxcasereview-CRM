-- Store an approved first-installment Stripe Payment Link on the existing
-- Restore Relay office e-sign envelope, so a fresh signing-link resend retains
-- the same payment CTA. No other office/product is modified.
create or replace function public.admin_romylabs_set_restore_relay_signing_payment_link(
  p_document_id uuid,
  p_payment_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.romylabs_office_signing_documents%rowtype;
  v_payment text := btrim(coalesce(p_payment_url,''));
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into v_row from public.romylabs_office_signing_documents
    where id=p_document_id for update;
  if not found then raise exception 'Signing request not found'; end if;
  if v_row.product_key <> 'restore_relay' or
     not public.can_manage_romylabs_office_esign(v_row.product_key,v_row.external_office_id) then
    raise exception 'Not authorized';
  end if;
  if v_row.status not in ('pending','draft') or v_row.sent_at is not null then
    raise exception 'Cannot alter a sent signing request';
  end if;
  if length(v_payment)>300 or
     v_payment !~ '^https://buy[.]stripe[.]com/[A-Za-z0-9_-]+$' or
     v_payment ~ '^https://buy[.]stripe[.]com/test_' then
    raise exception 'A live Stripe Payment Link is required';
  end if;
  update public.romylabs_office_signing_documents
    set envelope_settings = jsonb_set(
      coalesce(envelope_settings,'{}'::jsonb),
      '{restore_relay_first_installment_stripe_link}', to_jsonb(v_payment), true
    ),
    updated_at=now(),
    audit=coalesce(audit,'[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'event','restore_relay_payment_link_attached',
      'at',now(),'actor',auth.jwt()->>'email'
    ))
  where id=p_document_id;
  return true;
end;
$$;
revoke all on function public.admin_romylabs_set_restore_relay_signing_payment_link(uuid,text) from public, anon;
grant execute on function public.admin_romylabs_set_restore_relay_signing_payment_link(uuid,text) to authenticated;
