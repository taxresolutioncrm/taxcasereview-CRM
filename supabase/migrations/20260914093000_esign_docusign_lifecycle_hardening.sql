-- DocuSign-style universal e-sign lifecycle hardening.
-- Enforce terminal-state protections, synchronized recipient states,
-- immutable lifecycle events, and safe recipient correction/token rotation.

create or replace function public.admin_romylabs_mark_office_signing_sent(
  p_document_id uuid,
  p_event text default 'sent'
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_event text;
  v_status text;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  v_event:=case when lower(coalesce(p_event,''))='resent' then 'resent' else 'sent' end;

  select status into v_status
  from public.romylabs_office_signing_documents
  where id=p_document_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','document not found');
  end if;

  if v_status not in ('pending','sent','viewed') then
    return jsonb_build_object('ok',false,'error','document is in terminal state','status',v_status);
  end if;

  update public.romylabs_office_signing_documents
  set status='sent',
      sent_at=now(),
      updated_at=now(),
      audit=audit||jsonb_build_array(
        jsonb_build_object('event',v_event,'at',now(),'actor',coalesce(auth.jwt()->>'email','platform-admin'))
      )
  where id=p_document_id;

  update public.romylabs_esign_recipients
  set status='sent',
      sent_at=now(),
      updated_at=now()
  where envelope_id=p_document_id
    and role='signer'
    and status in ('pending','sent','viewed');

  insert into public.romylabs_esign_events(
    envelope_id,event_type,actor_email,actor_name,metadata,occurred_at
  ) values(
    p_document_id,v_event,auth.jwt()->>'email',auth.jwt()->>'email',
    jsonb_build_object('source','admin_portal'),now()
  );

  return jsonb_build_object('ok',true,'id',p_document_id,'event',v_event);
end
$$;

revoke all on function public.admin_romylabs_mark_office_signing_sent(uuid,text) from public,anon;
grant execute on function public.admin_romylabs_mark_office_signing_sent(uuid,text) to authenticated;


create or replace function public.admin_romylabs_void_office_signing_document(
  p_document_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_doc public.romylabs_office_signing_documents;
  v_now timestamptz:=now();
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;

  select * into v_doc
  from public.romylabs_office_signing_documents
  where id=p_document_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','not found'); end if;

  if v_doc.status not in ('pending','sent','viewed') then
    return jsonb_build_object('ok',false,'error','document cannot be voided','status',v_doc.status);
  end if;

  update public.romylabs_office_signing_documents
  set status='void',
      voided_at=v_now,
      updated_at=v_now,
      audit=audit||jsonb_build_array(
        jsonb_build_object(
          'event','voided','at',v_now,
          'actor',coalesce(auth.jwt()->>'email','platform-admin'),
          'reason',nullif(trim(coalesce(p_reason,'')),'')
        )
      )
  where id=p_document_id;

  update public.romylabs_esign_recipients
  set status='skipped',updated_at=v_now
  where envelope_id=p_document_id
    and status in ('pending','sent','viewed');

  insert into public.romylabs_esign_events(
    envelope_id,event_type,actor_email,actor_name,metadata,occurred_at
  ) values(
    p_document_id,'voided',auth.jwt()->>'email',auth.jwt()->>'email',
    jsonb_build_object('reason',nullif(trim(coalesce(p_reason,'')),''),'source','admin_portal'),
    v_now
  );

  return jsonb_build_object('ok',true,'id',p_document_id,'status','void','voided_at',v_now);
end
$$;

revoke all on function public.admin_romylabs_void_office_signing_document(uuid,text) from public,anon;
grant execute on function public.admin_romylabs_void_office_signing_document(uuid,text) to authenticated;


create or replace function public.admin_romylabs_esign_correct_recipient(
  p_document_id uuid,
  p_recipient_id uuid,
  p_name text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_doc public.romylabs_office_signing_documents;
  v_old public.romylabs_esign_recipients;
  v_email text;
  v_name text;
  v_token text;
  v_hash text;
  v_now timestamptz:=now();
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;

  v_email:=lower(trim(coalesce(p_email,'')));
  v_name:=nullif(trim(coalesce(p_name,'')),'');

  if v_email='' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok',false,'error','valid email required');
  end if;

  select * into v_doc
  from public.romylabs_office_signing_documents
  where id=p_document_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','document not found'); end if;
  if v_doc.status not in ('pending','sent','viewed') then
    return jsonb_build_object('ok',false,'error','document can no longer be corrected','status',v_doc.status);
  end if;

  select * into v_old
  from public.romylabs_esign_recipients
  where id=p_recipient_id and envelope_id=p_document_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','recipient not found'); end if;
  if v_old.role <> 'signer' then
    return jsonb_build_object('ok',false,'error','only signer recipient can be corrected');
  end if;

  -- Corrections deliberately invalidate every previously issued token. Old emails
  -- must not remain usable after recipient identity changes.
  update public.romylabs_esign_token_aliases
  set revoked_at=coalesce(revoked_at,v_now)
  where envelope_id=p_document_id and revoked_at is null;

  insert into public.romylabs_esign_token_aliases(
    token_hash,envelope_id,recipient_id,source,created_at,revoked_at
  ) values(
    v_doc.token_hash,p_document_id,p_recipient_id,'recipient_correction',v_now,v_now
  )
  on conflict (token_hash) do update set revoked_at=coalesce(public.romylabs_esign_token_aliases.revoked_at,v_now);

  v_token:=encode(gen_random_bytes(32),'hex');
  v_hash:=encode(digest(v_token,'sha256'),'hex');

  update public.romylabs_esign_recipients
  set name=v_name,
      email=v_email,
      status='pending',
      token_hash=v_hash,
      sent_at=null,
      opened_at=null,
      completed_at=null,
      declined_at=null,
      decline_reason=null,
      updated_at=v_now
  where id=p_recipient_id;

  update public.romylabs_office_signing_documents
  set signer_name=v_name,
      signer_email=v_email,
      token_hash=v_hash,
      status='pending',
      sent_at=null,
      opened_at=null,
      corrected_at=v_now,
      corrected_by=coalesce(auth.jwt()->>'email','platform-admin'),
      updated_at=v_now,
      audit=audit||jsonb_build_array(
        jsonb_build_object(
          'event','recipient_corrected','at',v_now,
          'actor',coalesce(auth.jwt()->>'email','platform-admin'),
          'old_email',v_old.email,'new_email',v_email,
          'old_name',v_old.name,'new_name',v_name
        )
      )
  where id=p_document_id;

  insert into public.romylabs_esign_events(
    envelope_id,recipient_id,event_type,actor_email,actor_name,metadata,occurred_at
  ) values(
    p_document_id,p_recipient_id,'recipient_corrected',
    auth.jwt()->>'email',auth.jwt()->>'email',
    jsonb_build_object('old_email',v_old.email,'new_email',v_email,'old_name',v_old.name,'new_name',v_name),
    v_now
  );

  return jsonb_build_object(
    'ok',true,
    'recipient_id',p_recipient_id,
    'token',v_token,
    'sign_url','/office-sign/'||v_token,
    'signer_name',v_name,
    'signer_email',v_email,
    'status','pending'
  );
end
$$;

revoke all on function public.admin_romylabs_esign_correct_recipient(uuid,uuid,text,text) from public,anon;
grant execute on function public.admin_romylabs_esign_correct_recipient(uuid,uuid,text,text) to authenticated;
