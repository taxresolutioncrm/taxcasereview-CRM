-- Keep e-sign envelope/recipient delivery state synchronized and route Stalwart by exact product mailbox.

alter table public.romylabs_office_signing_documents
  drop constraint if exists romylabs_office_signing_documents_status_check;

alter table public.romylabs_office_signing_documents
  add constraint romylabs_office_signing_documents_status_check
  check (status in ('draft','pending','sent','viewed','signed','declined','void','expired'));

create or replace function public.admin_romylabs_refresh_office_signing_link(
  p_document_id uuid,
  p_expires_days integer default 14
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_token text;
  v_hash text;
  v_row public.romylabs_office_signing_documents;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  select * into v_row from public.romylabs_office_signing_documents where id=p_document_id;
  if not found then return jsonb_build_object('ok',false,'error','not found'); end if;
  if v_row.status in ('signed','void') then return jsonb_build_object('ok',false,'error','document cannot be resent'); end if;

  v_token:=encode(gen_random_bytes(32),'hex');
  v_hash:=encode(digest(v_token,'sha256'),'hex');

  update public.romylabs_office_signing_documents
  set token_hash=v_hash,status='pending',sent_at=null,
      expires_at=now()+make_interval(days=>greatest(coalesce(p_expires_days,14),1)),
      updated_at=now()
  where id=p_document_id;

  insert into public.romylabs_esign_recipients(
    envelope_id,recipient_order,role,name,email,status,token_hash,auth_method,fields,
    sent_at,opened_at,completed_at,declined_at,decline_reason
  )
  values(
    p_document_id,1,'signer',v_row.signer_name,v_row.signer_email,'pending',v_hash,'email',
    coalesce(v_row.fields,'[]'::jsonb),null,null,null,null,null
  )
  on conflict (envelope_id,email,role) do update
  set token_hash=excluded.token_hash,status='pending',sent_at=null,opened_at=null,
      completed_at=null,declined_at=null,decline_reason=null,updated_at=now();

  return jsonb_build_object(
    'ok',true,'id',p_document_id,'token',v_token,'sign_url','/office-sign/'||v_token,
    'signer_email',v_row.signer_email,'signer_name',v_row.signer_name,
    'title',v_row.title,'firm_name',v_row.firm_name
  );
end $$;

create or replace function public.admin_romylabs_mark_office_signing_sent(
  p_document_id uuid,
  p_event text default 'sent'
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_event text;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  v_event:=case when lower(coalesce(p_event,''))='resent' then 'resent' else 'sent' end;

  update public.romylabs_office_signing_documents
  set status='sent',sent_at=now(),updated_at=now(),
      audit=audit||jsonb_build_array(
        jsonb_build_object('event',v_event,'at',now(),'actor',coalesce(auth.jwt()->>'email','platform-admin'))
      )
  where id=p_document_id and status not in ('signed','void');

  if not found then
    return jsonb_build_object('ok',false,'error','document not found or not sendable');
  end if;

  update public.romylabs_esign_recipients
  set status='sent',sent_at=now(),updated_at=now()
  where envelope_id=p_document_id and role='signer' and status not in ('completed','declined','skipped');

  return jsonb_build_object('ok',true,'id',p_document_id,'event',v_event);
end $$;

create or replace function public.admin_romylabs_create_office_signing_document(
  p_product_key text,p_external_office_id text,p_firm_name text,p_title text,
  p_source_filename text,p_source_path text,p_signer_name text,p_signer_email text,
  p_fields jsonb,p_expires_days integer default 14
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_id uuid; v_token text; v_hash text; v_product text; v_office text; v_email text;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  v_product:=lower(trim(coalesce(p_product_key,'')));
  v_office:=trim(coalesce(p_external_office_id,''));
  v_email:=lower(trim(coalesce(p_signer_email,'')));

  if v_product='' or v_office='' then raise exception 'office is required'; end if;
  if not exists(select 1 from public.romylabs_office_registry r where r.product_key=v_product and r.external_office_id=v_office) then raise exception 'office is not registered'; end if;
  if coalesce(trim(p_title),'')='' then raise exception 'document title required'; end if;
  if coalesce(trim(p_source_filename),'')='' or lower(trim(p_source_filename)) not like '%.pdf' then raise exception 'PDF filename required'; end if;
  if coalesce(trim(p_source_path),'')='' or p_source_path not like v_product||'/'||v_office||'/%' then raise exception 'invalid document storage path'; end if;
  if v_email='' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'valid signer email required'; end if;
  if jsonb_typeof(coalesce(p_fields,'[]'::jsonb)) <> 'array' then raise exception 'fields must be an array'; end if;
  if jsonb_array_length(coalesce(p_fields,'[]'::jsonb))=0 then raise exception 'at least one signing field is required'; end if;
  if not exists(select 1 from jsonb_array_elements(p_fields) f where f->>'type'='signature') then raise exception 'at least one signature field is required'; end if;
  if exists(select 1 from jsonb_array_elements(p_fields) f where coalesce(f->>'type','') not in ('signature','initials','date','name','title','text')) then raise exception 'unsupported signing field type'; end if;

  v_token:=encode(gen_random_bytes(32),'hex');
  v_hash:=encode(digest(v_token,'sha256'),'hex');

  insert into public.romylabs_office_signing_documents(
    product_key,external_office_id,firm_name,title,source_filename,source_path,
    signer_name,signer_email,fields,token_hash,status,sent_at,expires_at,created_by,audit
  ) values(
    v_product,v_office,trim(p_firm_name),trim(p_title),trim(p_source_filename),trim(p_source_path),
    nullif(trim(p_signer_name),''),v_email,p_fields,v_hash,'pending',null,
    now()+make_interval(days=>greatest(least(coalesce(p_expires_days,14),90),1)),
    auth.jwt()->>'email',
    jsonb_build_array(jsonb_build_object('event','created','at',now(),'actor',coalesce(auth.jwt()->>'email','platform-admin')))
  ) returning id into v_id;

  insert into public.romylabs_esign_recipients(
    envelope_id,recipient_order,role,name,email,status,token_hash,auth_method,fields
  ) values(
    v_id,1,'signer',nullif(trim(p_signer_name),''),v_email,'pending',v_hash,'email',p_fields
  );

  insert into public.romylabs_esign_events(
    envelope_id,event_type,actor_email,actor_name,metadata,occurred_at
  ) values(
    v_id,'created',auth.jwt()->>'email',auth.jwt()->>'email',
    jsonb_build_object('source','admin_portal','recipient',v_email),now()
  );

  return jsonb_build_object('ok',true,'id',v_id,'token',v_token,'sign_url','/office-sign/'||v_token);
end $$;

create or replace function public.romylabs_stalwart_transport_for_product(p_product_key text)
returns jsonb
language plpgsql security definer set search_path=public,vault,pg_temp
as $$
declare
  v_entry public.credential_vault_entries;
  v_password text;
  v_route_email text;
begin
  if auth.role() <> 'service_role' then raise exception 'not authorized'; end if;

  select lower(trim(m.outbound_from)) into v_route_email
  from public.romylabs_mailboxes m
  where m.product_id=lower(trim(coalesce(p_product_key,'')))
    and m.active=true
    and lower(coalesce(m.outbound_from,'')) like 'romy@%'
  order by m.updated_at desc nulls last
  limit 1;

  select * into v_entry
  from public.credential_vault_entries
  where product_id=lower(trim(coalesce(p_product_key,'')))
  order by
    case when lower(trim(coalesce(username,'')))=coalesce(v_route_email,'') then 0 else 1 end,
    case when lower(service)='stalwart' then 0 when lower(service) like 'stalwart%' then 1 else 2 end,
    updated_at desc
  limit 1;

  if not found then return jsonb_build_object('ok',false,'error','credential_not_registered'); end if;
  if coalesce(v_route_email,'')<>'' and lower(trim(coalesce(v_entry.username,'')))<>v_route_email then
    return jsonb_build_object('ok',false,'error','routed_mailbox_credential_missing');
  end if;

  select decrypted_secret into v_password from vault.decrypted_secrets where id=v_entry.secret_id;
  if coalesce(v_password,'')='' then return jsonb_build_object('ok',false,'error','credential_unavailable'); end if;

  return jsonb_build_object(
    'ok',true,'host','mail.taxrescrm.net','port',465,
    'username',v_entry.username,'password',v_password
  );
end $$;
