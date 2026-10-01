-- Atomically adjust an invoice's cumulative paid amount inside PostgreSQL.
-- The row lock prevents concurrent payments from overwriting each other.

create or replace function public.invoice_adjust_paid(
  p_inv_num text,
  p_delta numeric
)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_tenant uuid;
  v_id text;
  v_subtotal numeric;
  v_tax_rate numeric;
  v_paid numeric;
  v_total numeric;
  v_next_paid numeric;
  v_status text;
begin
  v_tenant := public.current_tenant_id();
  if v_tenant is null then
    raise exception 'No tenant context';
  end if;
  if nullif(btrim(coalesce(p_inv_num,'')),'') is null then
    raise exception 'Invoice number is required';
  end if;

  select i.id,
         coalesce(nullif(i.total,'')::numeric,0),
         coalesce(nullif(i."taxRate",'')::numeric,0),
         coalesce(nullif(i.paid,'')::numeric,0)
    into v_id,v_subtotal,v_tax_rate,v_paid
  from public.invoices i
  where i.tenant_id=v_tenant and i."invNum"=p_inv_num
  for update;

  if v_id is null then
    raise exception 'Invoice not found';
  end if;

  v_total := v_subtotal + (v_subtotal * v_tax_rate / 100);
  v_next_paid := greatest(0, v_paid + coalesce(p_delta,0));
  v_status := case
    when v_total > 0 and v_next_paid >= v_total - 0.005 then 'Paid'
    when v_next_paid > 0 then 'Partial'
    else 'Unpaid'
  end;

  update public.invoices
  set paid=v_next_paid::text,
      status=v_status,
      updated_at=now()
  where id=v_id and tenant_id=v_tenant;

  return jsonb_build_object('id',v_id,'paid',v_next_paid,'status',v_status,'total',v_total);
end;
$$;

revoke all on function public.invoice_adjust_paid(text,numeric) from public,anon;
grant execute on function public.invoice_adjust_paid(text,numeric) to authenticated;
