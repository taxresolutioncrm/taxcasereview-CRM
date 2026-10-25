-- TaxRes family persistent unassigned IRS transcript inbox.
-- Compatible with shared TaxRes (TCR/CloudCPA) and Centurion dedicated Supabase.
-- Nashville already has its own independently deployed equivalent.

create table if not exists public.unassigned_transcripts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  file_path text not null,
  file_name text not null,
  file_sha256 text not null,
  file_size bigint,
  taxpayer_name text,
  tax_year text,
  transcript_type text,
  raw_analysis jsonb not null default '{}'::jsonb,
  intake_source text not null default 'unknown',
  conflict_reason text,
  received_at timestamptz not null default now(),
  received_by text,
  status text not null default 'pending' check (status in ('pending','assigned','discarded')),
  assigned_to_client_id uuid,
  assigned_to_client_name text,
  assigned_by text,
  assigned_at timestamptz,
  transcript_analysis_id uuid,
  audit_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists unassigned_transcripts_tenant_sha
  on public.unassigned_transcripts (tenant_id, file_sha256);

create index if not exists unassigned_transcripts_tenant_status
  on public.unassigned_transcripts (tenant_id, status, received_at desc);

alter table public.unassigned_transcripts enable row level security;

drop policy if exists unassigned_transcripts_select on public.unassigned_transcripts;
create policy unassigned_transcripts_select
on public.unassigned_transcripts
for select
to authenticated
using (
  tenant_id = current_tenant_id()
  and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.email())
      and e.status = 'Active'
      and e.tenant_id = unassigned_transcripts.tenant_id
      and coalesce(e.perm_irs, 0) >= 1
  )
);

drop policy if exists unassigned_transcripts_insert on public.unassigned_transcripts;
create policy unassigned_transcripts_insert
on public.unassigned_transcripts
for insert
to authenticated
with check (
  tenant_id = current_tenant_id()
  and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.email())
      and e.status = 'Active'
      and e.tenant_id = unassigned_transcripts.tenant_id
      and coalesce(e.perm_irs, 0) >= 2
  )
);

drop policy if exists unassigned_transcripts_update on public.unassigned_transcripts;
create policy unassigned_transcripts_update
on public.unassigned_transcripts
for update
to authenticated
using (
  tenant_id = current_tenant_id()
  and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.email())
      and e.status = 'Active'
      and e.tenant_id = unassigned_transcripts.tenant_id
      and coalesce(e.perm_irs, 0) >= 2
  )
)
with check (
  tenant_id = current_tenant_id()
  and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.email())
      and e.status = 'Active'
      and e.tenant_id = unassigned_transcripts.tenant_id
      and coalesce(e.perm_irs, 0) >= 2
  )
);

-- Unassigned IRS PDFs deliberately live outside the normal <tenant>/... documents path,
-- so normal document policies do not grant access. These policies use IRS permissions.
drop policy if exists taxres_unassigned_irs_select on storage.objects;
create policy taxres_unassigned_irs_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and split_part(name, '/', 1) = 'unassigned'
  and split_part(name, '/', 2) = current_tenant_id()::text
  and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.email())
      and e.status = 'Active'
      and e.tenant_id = current_tenant_id()
      and coalesce(e.perm_irs, 0) >= 1
  )
);

drop policy if exists taxres_unassigned_irs_insert on storage.objects;
create policy taxres_unassigned_irs_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and split_part(name, '/', 1) = 'unassigned'
  and split_part(name, '/', 2) = current_tenant_id()::text
  and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.email())
      and e.status = 'Active'
      and e.tenant_id = current_tenant_id()
      and coalesce(e.perm_irs, 0) >= 2
  )
);

drop policy if exists taxres_unassigned_irs_delete on storage.objects;
create policy taxres_unassigned_irs_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and split_part(name, '/', 1) = 'unassigned'
  and split_part(name, '/', 2) = current_tenant_id()::text
  and exists (
    select 1 from public.employees e
    where lower(e.email) = lower(auth.email())
      and e.status = 'Active'
      and e.tenant_id = current_tenant_id()
      and coalesce(e.perm_irs, 0) >= 2
  )
);

grant select, insert, update on public.unassigned_transcripts to authenticated;
