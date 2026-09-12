-- DocuSign-style envelope core for RomyLabs universal e-sign.
-- Backward compatible with existing romylabs_office_signing_documents rows.

alter table public.romylabs_office_signing_documents
  add column if not exists email_subject text,
  add column if not exists email_message text,
  add column if not exists reminder_enabled boolean not null default true,
  add column if not exists reminder_delay_days integer not null default 2,
  add column if not exists reminder_frequency_days integer not null default 2,
  add column if not exists last_reminder_at timestamptz,
  add column if not exists expiration_warning_days integer not null default 3,
  add column if not exists completed_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists decline_reason text,
  add column if not exists corrected_at timestamptz,
  add column if not exists corrected_by text,
  add column if not exists source_sha256 text,
  add column if not exists signed_sha256 text,
  add column if not exists certificate_path text,
  add column if not exists certificate_sha256 text,
  add column if not exists envelope_settings jsonb not null default '{}'::jsonb;

create table if not exists public.romylabs_esign_recipients (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.romylabs_office_signing_documents(id) on delete cascade,
  recipient_order integer not null default 1,
  role text not null default 'signer' check (role in ('signer','cc','approver','viewer')),
  name text,
  email text not null,
  status text not null default 'pending' check (status in ('pending','sent','viewed','completed','declined','skipped')),
  token_hash text,
  auth_method text not null default 'email' check (auth_method in ('email','access_code','sms','phone','idv','kba')),
  auth_config jsonb not null default '{}'::jsonb,
  fields jsonb not null default '[]'::jsonb,
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(envelope_id,email,role)
);

create index if not exists romylabs_esign_recipients_envelope_idx
  on public.romylabs_esign_recipients(envelope_id,recipient_order,id);
create unique index if not exists romylabs_esign_recipients_token_hash_uq
  on public.romylabs_esign_recipients(token_hash) where token_hash is not null;

create table if not exists public.romylabs_esign_events (
  id bigserial primary key,
  envelope_id uuid not null references public.romylabs_office_signing_documents(id) on delete cascade,
  recipient_id uuid references public.romylabs_esign_recipients(id) on delete set null,
  event_type text not null,
  actor_email text,
  actor_name text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists romylabs_esign_events_envelope_idx
  on public.romylabs_esign_events(envelope_id,occurred_at,id);

create or replace function public.prevent_romylabs_esign_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'e-sign audit events are immutable';
end $$;

drop trigger if exists romylabs_esign_events_immutable_update on public.romylabs_esign_events;
create trigger romylabs_esign_events_immutable_update
before update or delete on public.romylabs_esign_events
for each row execute function public.prevent_romylabs_esign_event_mutation();

alter table public.romylabs_esign_recipients enable row level security;
alter table public.romylabs_esign_events enable row level security;

drop policy if exists "platform admins read esign recipients" on public.romylabs_esign_recipients;
create policy "platform admins read esign recipients"
on public.romylabs_esign_recipients for select to authenticated
using (public._is_platform_admin());

drop policy if exists "platform admins manage esign recipients" on public.romylabs_esign_recipients;
create policy "platform admins manage esign recipients"
on public.romylabs_esign_recipients for all to authenticated
using (public._is_platform_admin())
with check (public._is_platform_admin());

drop policy if exists "platform admins read esign events" on public.romylabs_esign_events;
create policy "platform admins read esign events"
on public.romylabs_esign_events for select to authenticated
using (public._is_platform_admin());

-- Service role writes the immutable event stream through edge functions.
revoke insert,update,delete on public.romylabs_esign_events from anon,authenticated;
grant select on public.romylabs_esign_events to authenticated;
grant all on public.romylabs_esign_events to service_role;
grant usage,select on sequence public.romylabs_esign_events_id_seq to service_role;

-- Backfill existing single-recipient agreements into recipient rows.
insert into public.romylabs_esign_recipients(
  envelope_id,recipient_order,role,name,email,status,token_hash,fields,
  sent_at,opened_at,completed_at,declined_at,decline_reason,created_at,updated_at
)
select
  d.id,1,'signer',d.signer_name,d.signer_email,
  case
    when d.status='signed' then 'completed'
    when d.status='viewed' then 'viewed'
    when d.status in ('declined','void') then 'declined'
    when d.status='sent' then 'sent'
    else 'pending'
  end,
  d.token_hash,d.fields,d.sent_at,d.opened_at,d.signed_at,d.declined_at,d.decline_reason,d.created_at,d.updated_at
from public.romylabs_office_signing_documents d
where not exists (
  select 1 from public.romylabs_esign_recipients r where r.envelope_id=d.id
);

-- Seed the immutable event stream from legacy audit JSON.
insert into public.romylabs_esign_events(envelope_id,event_type,actor_email,actor_name,metadata,occurred_at)
select d.id,
       coalesce(a->>'event','legacy_event'),
       nullif(a->>'actor',''),
       nullif(a->>'signer',''),
       a,
       coalesce((a->>'at')::timestamptz,d.created_at)
from public.romylabs_office_signing_documents d
cross join lateral jsonb_array_elements(coalesce(d.audit,'[]'::jsonb)) a
where not exists (
  select 1 from public.romylabs_esign_events e where e.envelope_id=d.id
);

create or replace function public.admin_romylabs_esign_envelope_detail(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_doc jsonb;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  select to_jsonb(d) into v_doc from public.romylabs_office_signing_documents d where d.id=p_document_id;
  if v_doc is null then return jsonb_build_object('ok',false,'error','not found'); end if;

  return jsonb_build_object(
    'ok',true,
    'envelope',v_doc,
    'recipients',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.recipient_order,r.created_at)
      from public.romylabs_esign_recipients r where r.envelope_id=p_document_id
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(to_jsonb(e) order by e.occurred_at,e.id)
      from public.romylabs_esign_events e where e.envelope_id=p_document_id
    ),'[]'::jsonb)
  );
end $$;

revoke all on function public.admin_romylabs_esign_envelope_detail(uuid) from public,anon;
grant execute on function public.admin_romylabs_esign_envelope_detail(uuid) to authenticated,service_role;

create or replace function public.admin_romylabs_esign_correct_recipient(
  p_document_id uuid,
  p_recipient_id uuid,
  p_name text,
  p_email text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_old public.romylabs_esign_recipients; v_email text;
begin
  if not public._is_platform_admin() then raise exception 'not authorized'; end if;
  v_email:=lower(trim(coalesce(p_email,'')));
  if v_email='' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok',false,'error','valid email required');
  end if;

  select * into v_old from public.romylabs_esign_recipients
  where id=p_recipient_id and envelope_id=p_document_id;
  if not found then return jsonb_build_object('ok',false,'error','recipient not found'); end if;
  if v_old.status in ('completed','declined') then
    return jsonb_build_object('ok',false,'error','recipient can no longer be corrected');
  end if;

  update public.romylabs_esign_recipients
  set name=nullif(trim(coalesce(p_name,'')),''),
      email=v_email,
      status='pending',
      token_hash=null,
      sent_at=null,
      opened_at=null,
      updated_at=now()
  where id=p_recipient_id;

  update public.romylabs_office_signing_documents
  set corrected_at=now(),corrected_by=coalesce(auth.jwt()->>'email','platform-admin'),updated_at=now()
  where id=p_document_id;

  return jsonb_build_object('ok',true,'recipient_id',p_recipient_id);
end $$;

revoke all on function public.admin_romylabs_esign_correct_recipient(uuid,uuid,text,text) from public,anon;
grant execute on function public.admin_romylabs_esign_correct_recipient(uuid,uuid,text,text) to authenticated,service_role;
