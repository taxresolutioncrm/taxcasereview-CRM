-- Preserve every legitimate universal e-sign link across resends/reminders.
-- Prior token hashes remain valid for the same envelope until a terminal state.

create table if not exists public.romylabs_esign_token_aliases (
  token_hash text primary key,
  envelope_id uuid not null references public.romylabs_office_signing_documents(id) on delete cascade,
  recipient_id uuid references public.romylabs_esign_recipients(id) on delete set null,
  source text not null default 'rotation',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists romylabs_esign_token_aliases_envelope_idx
  on public.romylabs_esign_token_aliases(envelope_id);

alter table public.romylabs_esign_token_aliases enable row level security;

-- Backfill prior links that were already emailed. Match each email to the most
-- recently-created compatible envelope that existed when that email was sent.
with sent_tokens as (
  select
    e.id as email_id,
    e.created_at,
    e.recipient,
    e.subject,
    e.product_id,
    substring(e.body_html from '/office-sign/([A-Fa-f0-9]{64})') as token
  from public.emails e
  where e.body_html ~ '/office-sign/[A-Fa-f0-9]{64}'
    and e.subject ilike 'Signature Requested:%'
),
resolved as (
  select
    s.*,
    d.id as envelope_id,
    d.token_hash as current_token_hash,
    r.id as recipient_id
  from sent_tokens s
  join lateral (
    select d.*
    from public.romylabs_office_signing_documents d
    where lower(d.signer_email)=lower(s.recipient)
      and s.subject = 'Signature Requested: ' || d.title
      and (s.product_id is null or d.product_key=s.product_id)
      and d.created_at <= s.created_at
    order by d.created_at desc
    limit 1
  ) d on true
  left join lateral (
    select r.id
    from public.romylabs_esign_recipients r
    where r.envelope_id=d.id and r.role='signer'
    order by r.recipient_order, r.created_at
    limit 1
  ) r on true
)
insert into public.romylabs_esign_token_aliases(token_hash,envelope_id,recipient_id,source,created_at)
select
  encode(digest(token,'sha256'),'hex'),
  envelope_id,
  recipient_id,
  'historical_email',
  created_at
from resolved
where token is not null
  and encode(digest(token,'sha256'),'hex') <> current_token_hash
on conflict (token_hash) do nothing;

create or replace function public.romylabs_revoke_esign_token_aliases()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status in ('signed','declined','void','expired')
     and old.status is distinct from new.status then
    update public.romylabs_esign_token_aliases
      set revoked_at=coalesce(revoked_at,now())
      where envelope_id=new.id and revoked_at is null;
  end if;
  return new;
end
$$;

drop trigger if exists trg_romylabs_revoke_esign_token_aliases
  on public.romylabs_office_signing_documents;
create trigger trg_romylabs_revoke_esign_token_aliases
after update of status on public.romylabs_office_signing_documents
for each row execute function public.romylabs_revoke_esign_token_aliases();

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
  where id=p_document_id;

  if not found then
    return jsonb_build_object('ok',false,'error','not found');
  end if;

  if v_row.status in ('signed','declined','void','expired') then
    return jsonb_build_object('ok',false,'error','document cannot be resent');
  end if;

  select id into v_recipient_id
  from public.romylabs_esign_recipients
  where envelope_id=p_document_id and role='signer'
  order by recipient_order,created_at
  limit 1;

  -- Preserve the currently-valid link before rotation.
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
      status='sent',
      sent_at=now(),
      expires_at=now()+make_interval(days=>greatest(coalesce(p_expires_days,14),1)),
      updated_at=now(),
      audit=audit||jsonb_build_array(
        jsonb_build_object(
          'event','resent',
          'at',now(),
          'actor',coalesce(auth.jwt()->>'email','platform-admin')
        )
      )
  where id=p_document_id;

  update public.romylabs_esign_recipients
  set token_hash=v_hash,
      status=case when status in ('pending','sent','viewed') then 'sent' else status end,
      sent_at=now(),
      updated_at=now()
  where id=v_recipient_id;

  return jsonb_build_object(
    'ok',true,
    'id',p_document_id,
    'token',v_token,
    'sign_url','/office-sign/'||v_token,
    'signer_email',v_row.signer_email,
    'signer_name',v_row.signer_name,
    'title',v_row.title,
    'firm_name',v_row.firm_name
  );
end
$$;

revoke all on function public.admin_romylabs_refresh_office_signing_link(uuid,integer)
  from public,anon;
grant execute on function public.admin_romylabs_refresh_office_signing_link(uuid,integer)
  to authenticated;
