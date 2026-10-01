-- RomyLabs Document Intelligence foundation
-- Sandbox-first: schema only. Do not apply to production until acceptance testing passes.

create table if not exists public.document_ai_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id text,
  document_id text,
  status text not null default 'queued' check (status in ('queued','processing','complete','failed','needs_review')),
  vertical text not null default 'tax',
  document_type text,
  tax_year integer,
  summary text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  model text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_ai_runs_tenant_client_idx
  on public.document_ai_runs (tenant_id, client_id, created_at desc);
create index if not exists document_ai_runs_document_idx
  on public.document_ai_runs (document_id, created_at desc);
create index if not exists document_ai_runs_latest_complete_idx
  on public.document_ai_runs (tenant_id, document_id, created_at desc) where status='complete';

create table if not exists public.document_ai_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null references public.document_ai_runs(id) on delete cascade,
  client_id text,
  document_id text,
  category text not null default 'general',
  field_key text not null,
  field_label text,
  value_json jsonb,
  normalized_text text,
  source_page integer,
  source_locator text,
  source_excerpt text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed','verified','rejected','superseded')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists document_ai_facts_client_idx
  on public.document_ai_facts (tenant_id, client_id, category, field_key);
create index if not exists document_ai_facts_run_idx
  on public.document_ai_facts (run_id);

create table if not exists public.document_ai_entities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null references public.document_ai_runs(id) on delete cascade,
  client_id text,
  document_id text,
  entity_type text not null,
  display_name text not null,
  relationship text,
  identifiers jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  source_page integer,
  source_locator text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed','verified','rejected','superseded')),
  created_at timestamptz not null default now()
);

create index if not exists document_ai_entities_client_idx
  on public.document_ai_entities (tenant_id, client_id, entity_type);

create table if not exists public.document_ai_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id text,
  run_id uuid references public.document_ai_runs(id) on delete set null,
  document_id text,
  question text not null,
  reason text,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','answered','dismissed')),
  answer text,
  answered_by uuid,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists document_ai_questions_client_idx
  on public.document_ai_questions (tenant_id, client_id, status, priority);

alter table public.document_ai_runs enable row level security;
alter table public.document_ai_facts enable row level security;
alter table public.document_ai_entities enable row level security;
alter table public.document_ai_questions enable row level security;

drop policy if exists "document_ai_runs_tenant" on public.document_ai_runs;
create policy "document_ai_runs_tenant" on public.document_ai_runs
  for all using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

drop policy if exists "document_ai_facts_tenant" on public.document_ai_facts;
create policy "document_ai_facts_tenant" on public.document_ai_facts
  for all using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

drop policy if exists "document_ai_entities_tenant" on public.document_ai_entities;
create policy "document_ai_entities_tenant" on public.document_ai_entities
  for all using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

drop policy if exists "document_ai_questions_tenant" on public.document_ai_questions;
create policy "document_ai_questions_tenant" on public.document_ai_questions
  for all using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());


revoke all on table public.document_ai_runs from anon;
revoke all on table public.document_ai_facts from anon;
revoke all on table public.document_ai_entities from anon;
revoke all on table public.document_ai_questions from anon;

grant select, insert, update, delete on public.document_ai_runs to authenticated;
grant select, insert, update, delete on public.document_ai_facts to authenticated;
grant select, insert, update, delete on public.document_ai_entities to authenticated;
grant select, insert, update, delete on public.document_ai_questions to authenticated;

create or replace function public.document_ai_client_overview(p_client_id text)
returns jsonb
language sql
security invoker
stable
set search_path = public, pg_catalog
as $$
  with latest_runs as (
    select distinct on (document_id)
      id, document_id, status, created_at
    from public.document_ai_runs
    where tenant_id=current_tenant_id() and client_id=p_client_id
    order by document_id, created_at desc
  ),
  current_complete as (
    select id from latest_runs where status='complete'
  ),
  runs as (
    select count(*)::int total_runs,
           count(*) filter (where status='complete')::int completed_runs,
           max(created_at) last_run_at
    from latest_runs
  ),
  facts as (
    select count(*)::int total_facts,
           count(*) filter (where f.review_status='verified')::int verified_facts
    from public.document_ai_facts f
    where f.tenant_id=current_tenant_id()
      and f.client_id=p_client_id
      and f.run_id in (select id from current_complete)
      and f.review_status <> 'rejected'
  ),
  entities as (
    select count(*)::int total_entities
    from public.document_ai_entities e
    where e.tenant_id=current_tenant_id()
      and e.client_id=p_client_id
      and e.run_id in (select id from current_complete)
      and e.review_status <> 'rejected'
  ),
  questions as (
    select count(*)::int open_questions
    from public.document_ai_questions q
    where q.tenant_id=current_tenant_id()
      and q.client_id=p_client_id
      and q.status='open'
      and (q.run_id is null or q.run_id in (select id from current_complete))
  )
  select jsonb_build_object(
    'runs', runs.total_runs,
    'completed_runs', runs.completed_runs,
    'last_run_at', runs.last_run_at,
    'facts', facts.total_facts,
    'verified_facts', facts.verified_facts,
    'entities', entities.total_entities,
    'open_questions', questions.open_questions
  )
  from runs, facts, entities, questions;
$$;

revoke all on function public.document_ai_client_overview(text) from anon;
grant execute on function public.document_ai_client_overview(text) to authenticated;
