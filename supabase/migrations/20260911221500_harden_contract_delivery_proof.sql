-- E-sign delivery state must reflect real transport acceptance, not button clicks.

create or replace function public.admin_romylabs_create_office_signing_document(
  p_product_key text,p_external_office_id text,p_firm_name text,p_title text,
  p_source_filename text,p_source_path text,p_signer_name text,p_signer_email text,
  p_fields jsonb,p_expires_days integer default 14
) returns jsonb
language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid; v_token text; v_hash text; v_product text; v_office text; v_email text;
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
    product_key,external_office_id,firm_name,title,source_filename,source_path,signer_name,signer_email,fields,token_hash,status,sent_at,expires_at,created_by,audit
  ) values(
    v_product,v_office,trim(p_firm_name),trim(p_title),trim(p_source_filename),trim(p_source_path),nullif(trim(p_signer_name),''),v_email,p_fields,v_hash,'pending',null,now()+make_interval(days=>greatest(least(coalesce(p_expires_days,14),90),1)),auth.jwt()->>'email',
    jsonb_build_array(jsonb_build_object('event','created','at',now(),'actor',coalesce(auth.jwt()->>'email','platform-admin')))
  ) returning id into v_id;

  return jsonb_build_object('ok',true,'id',v_id,'token',v_token,'sign_url','/office-sign/'||v_token);
end $$;

create or replace function public.admin_romylabs_refresh_office_signing_link(p_document_id uuid,p_expires_days integer default 14)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_token text; v_hash text; v_row public.romylabs_office_signing_documents;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  select * into v_row from public.romylabs_office_signing_documents where id=p_document_id;
  if not found then return jsonb_build_object('ok',false,'error','not found'); end if;
  if v_row.status in ('signed','void') then return jsonb_build_object('ok',false,'error','document cannot be resent'); end if;

  v_token:=encode(gen_random_bytes(32),'hex');
  v_hash:=encode(digest(v_token,'sha256'),'hex');

  update public.romylabs_office_signing_documents
  set token_hash=v_hash,status='pending',expires_at=now()+make_interval(days=>greatest(coalesce(p_expires_days,14),1)),updated_at=now()
  where id=p_document_id;

  return jsonb_build_object('ok',true,'id',p_document_id,'token',v_token,'sign_url','/office-sign/'||v_token,'signer_email',v_row.signer_email,'signer_name',v_row.signer_name,'title',v_row.title,'firm_name',v_row.firm_name);
end $$;

create or replace function public.admin_romylabs_mark_office_signing_sent(p_document_id uuid,p_event text default 'sent')
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_event text;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  v_event:=case when lower(coalesce(p_event,''))='resent' then 'resent' else 'sent' end;

  update public.romylabs_office_signing_documents
  set status='sent',
      sent_at=now(),
      updated_at=now(),
      audit=audit||jsonb_build_array(jsonb_build_object('event',v_event,'at',now(),'actor',coalesce(auth.jwt()->>'email','platform-admin')))
  where id=p_document_id and status not in ('signed','void');

  if not found then return jsonb_build_object('ok',false,'error','document not found or not sendable'); end if;
  return jsonb_build_object('ok',true,'id',p_document_id,'event',v_event);
end $$;

revoke all on function public.admin_romylabs_create_office_signing_document(text,text,text,text,text,text,text,text,jsonb,integer) from public,anon;
grant execute on function public.admin_romylabs_create_office_signing_document(text,text,text,text,text,text,text,text,jsonb,integer) to authenticated,service_role;
revoke all on function public.admin_romylabs_refresh_office_signing_link(uuid,integer) from public,anon;
grant execute on function public.admin_romylabs_refresh_office_signing_link(uuid,integer) to authenticated,service_role;
revoke all on function public.admin_romylabs_mark_office_signing_sent(uuid,text) from public,anon;
grant execute on function public.admin_romylabs_mark_office_signing_sent(uuid,text) to authenticated,service_role;
