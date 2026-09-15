-- Admin Portal office internal notes timeline.
-- Separate from tenants.notes so outreach/meeting history is append-only and timestamped.

create table if not exists public.romylabs_office_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  note_type text not null default 'General'
    check (note_type in ('General','Outreach','Meeting','Follow-up')),
  note_text text not null check (length(trim(note_text)) > 0),
  activity_at timestamptz not null default now(),
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists romylabs_office_notes_tenant_activity_idx
  on public.romylabs_office_notes(tenant_id, activity_at desc, created_at desc);

alter table public.romylabs_office_notes enable row level security;

drop policy if exists romylabs_office_notes_admin_select on public.romylabs_office_notes;
create policy romylabs_office_notes_admin_select
  on public.romylabs_office_notes
  for select
  to authenticated
  using (public._is_platform_admin());

drop policy if exists romylabs_office_notes_admin_insert on public.romylabs_office_notes;
create policy romylabs_office_notes_admin_insert
  on public.romylabs_office_notes
  for insert
  to authenticated
  with check (public._is_platform_admin());

revoke all on public.romylabs_office_notes from anon;
grant select, insert on public.romylabs_office_notes to authenticated;
