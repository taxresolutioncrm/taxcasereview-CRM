-- Brand tenant-specific public bookings with the office name instead of
-- "[TaxRes CRM]". Product demo bookings without a tenant keep product branding.

create or replace function public.booking_create_product(
  p_name text,
  p_email text,
  p_phone text,
  p_event_type text,
  p_date date,
  p_time text,
  p_notes text,
  p_product text,
  p_tenant text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_product text;
  v_label text;
  v_booking_id text;
  v_tenant uuid;
  v_firm_name text;
begin
  v_product := lower(trim(coalesce(p_product, '')));
  if v_product not in ('taxres_crm','romylabs','camvella','arcvena','bocasync','groundivo','oculivo','restore_relay') then
    v_product := 'taxres_crm';
  end if;

  begin
    v_tenant := nullif(trim(coalesce(p_tenant,'')),'')::uuid;
  exception when others then
    v_tenant := null;
  end;

  if v_tenant is not null then
    select coalesce(nullif(trim(s.name),''),nullif(trim(s.firmname),''),nullif(trim(t.firm_name),''))
      into v_firm_name
      from public.tenants t
      left join public.settings s on s.tenant_id=t.id
      where t.id=v_tenant
      limit 1;
  end if;

  v_label := case
    when coalesce(trim(v_firm_name),'') <> '' then '[' || trim(v_firm_name) || ']'
    else case v_product
      when 'romylabs' then '[RomyLabs]'
      when 'camvella' then '[Camvella]'
      when 'arcvena' then '[Arcvena]'
      when 'bocasync' then '[BocaSync]'
      when 'groundivo' then '[GroundIVO]'
      when 'oculivo' then '[Oculivo]'
      when 'restore_relay' then '[Restore Relay]'
      else '[TaxRes CRM]'
    end
  end;

  v_result := public.booking_create(
    p_name,p_email,p_phone,p_event_type,p_date,p_time,p_notes,p_tenant
  );

  if coalesce((v_result->>'ok')::boolean, false) then
    update public.calevents
       set product_id = v_product,
           title = v_label || ' ' || p_event_type || ' — ' || trim(p_name)
     where booking_token = v_result->>'booking_token'
       and product_id is null
     returning id into v_booking_id;

    v_result := v_result || jsonb_build_object(
      'product_id',v_product,
      'booking_id',v_booking_id,
      'booking_label',v_label
    );
  end if;

  return v_result;
end;
$function$;
