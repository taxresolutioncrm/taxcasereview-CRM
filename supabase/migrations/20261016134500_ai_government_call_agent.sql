-- AI Government Call Agent foundation
create table if not exists ai_government_call_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  case_id uuid references cases(id) on delete set null,
  client_name text,
  requested_by_email text not null,
  requested_by_name text,
  assigned_to_email text not null,
  purpose_key text not null,
  agency text not null,
  destination_number text not null,
  objective text not null,
  route_hints jsonb not null default '[]'::jsonb,
  route_step integer not null default 0,
  status text not null default 'created',
  conference_name text,
  outbound_call_id uuid,
  provider_call_sid text,
  callback_token text not null,
  last_prompt text,
  last_action text,
  confidence numeric(5,2),
  human_detected_at timestamptz,
  human_joined_at timestamptz,
  ended_at timestamptz,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_government_call_status_chk check (status in (
    'created','dialing','navigating','holding','human_detected','takeover_requested',
    'human_joined','completed','failed','cancelled'
  ))
);
create index if not exists ai_gov_calls_tenant_status_idx on ai_government_call_sessions(tenant_id,status,created_at desc);
create index if not exists ai_gov_calls_assigned_idx on ai_government_call_sessions(tenant_id,assigned_to_email,status,created_at desc);
alter table ai_government_call_sessions enable row level security;
drop policy if exists "tenant_ai_government_calls" on ai_government_call_sessions;
create policy "tenant_ai_government_calls" on ai_government_call_sessions
  for all using (tenant_id=current_tenant_id()) with check (tenant_id=current_tenant_id());

create table if not exists ai_government_call_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  session_id uuid not null references ai_government_call_sessions(id) on delete cascade,
  event_type text not null,
  prompt_text text,
  action text,
  digit text,
  confidence numeric(5,2),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_gov_call_events_session_idx on ai_government_call_events(session_id,created_at);
alter table ai_government_call_events enable row level security;
drop policy if exists "tenant_ai_government_call_events" on ai_government_call_events;
create policy "tenant_ai_government_call_events" on ai_government_call_events
  for all using (tenant_id=current_tenant_id()) with check (tenant_id=current_tenant_id());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='ai_government_call_sessions'
  ) then
    alter publication supabase_realtime add table ai_government_call_sessions;
  end if;
end $$;
