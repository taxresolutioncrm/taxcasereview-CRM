-- Keep manual resend delivery state truthful.
-- Rotate the token and preserve the prior link, but do not mark the envelope
-- sent until Stalwart submission is confirmed by admin_romylabs_mark_office_signing_sent.

create or replace function public.admin_romylabs_refresh_office_signing_link(
  p_document_id uuid,
  p_expires_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_token text;
  v_hash text;
  v_row public.romylabs_office_signing_documents;
  v_recipient_id uuid;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;

  select * into v_row
  from public.romylabs_office_signing_documents
  where id=p_document_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','not found');
  end if;

  if v_row.status in ('signed','declined','void','expired') then
    return jsonb_build_object('ok',false,'error','document cannot be resent','status',v_row.status);
  end if;

  select id into v_recipient_id
  from public.romylabs_esign_recipients
  where envelope_id=p_document_id and role='signer'
  order by recipient_order,created_at
  limit 1;

  insert into public.romylabs_esign_token_aliases(
    token_hash,envelope_id,recipient_id,source,created_at
  )
  values(
    v_row.token_hash,p_document_id,v_recipient_id,'manual_resend',now()
  )
  on conflict (token_hash) do update
    set revoked_at=null;

  v_token:=encode(gen_random_bytes(32),'hex');
  v_hash:=encode(digest(v_token,'sha256'),'hex');

  update public.romylabs_office_signing_documents
  set token_hash=v_hash,
      status='pending',
      sent_at=null,
      expires_at=now()+make_interval(days=>greatest(coalesce(p_expires_days,14),1)),
      updated_at=now(),
      audit=audit||jsonb_build_array(
        jsonb_build_object(
          'event','resend_prepared',
          'at',now(),
          'actor',coalesce(auth.jwt()->>'email','platform-admin')
        )
      )
  where id=p_document_id;

  update public.romylabs_esign_recipients
  set token_hash=v_hash,
      status='pending',
      sent_at=null,
      opened_at=null,
      updated_at=now()
  where id=v_recipient_id
    and status in ('pending','sent','viewed');

  insert into public.romylabs_esign_events(
    envelope_id,recipient_id,event_type,actor_email,actor_name,metadata,occurred_at
  ) values(
    p_document_id,v_recipient_id,'resend_prepared',
    auth.jwt()->>'email',auth.jwt()->>'email',
    jsonb_build_object('source','admin_portal'),now()
  );

  return jsonb_build_object(
    'ok',true,
    'id',p_document_id,
    'token',v_token,
    'sign_url','/office-sign/'||v_token,
    'signer_email',v_row.signer_email,
    'signer_name',v_row.signer_name,
    'title',v_row.title,
    'firm_name',v_row.firm_name,
    'status','pending'
  );
end
$$;

revoke all on function public.admin_romylabs_refresh_office_signing_link(uuid,integer)
  from public,anon;
grant execute on function public.admin_romylabs_refresh_office_signing_link(uuid,integer)
  to authenticated;
