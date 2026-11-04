-- Oculivo's native web leads are not scheduled bookings.
-- Preserve them as durable, admin-only follow-up tasks without inventing calevents.
create table if not exists public.romylabs_demo_requests (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  product_id text not null default 'oculivo' check (product_id='oculivo'),
  source text not null default 'oculivo.com',
  lead_name text not null check (length(trim(lead_name)) between 1 and 120),
  lead_email text not null check (length(trim(lead_email)) between 5 and 254),
  practice_name text not null check (length(trim(practice_name)) between 1 and 160),
  specialty text not null check (specialty in ('optometry','ophthalmology','optical','multi-specialty','other')),
  locations text not null check (locations in ('1','2-5','6+')),
  notes text not null default '',
  attribution jsonb not null default '{}'::jsonb,
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  followup_status text not null default 'new' check (followup_status in ('new','acknowledged','contacted','completed')),
  followup_due_at timestamptz not null default (now()+interval '1 day'),
  assigned_to text not null default 'RomyLabs Admin',
  contacted_at timestamptz,
  contact_outcome text,
  notification_submission_id text,
  notification_submitted_at timestamptz,
  notification_last_error text,
  constraint romylabs_demo_requests_completed_guard check (
    followup_status not in ('contacted','completed')
    or (contacted_at is not null and length(trim(coalesce(contact_outcome,'')))>0)
  )
);
create index if not exists romylabs_demo_requests_pending_idx
on public.romylabs_demo_requests(followup_status,followup_due_at,created_at desc);
alter table public.romylabs_demo_requests enable row level security;
revoke all on public.romylabs_demo_requests from anon, authenticated;
grant select, update on public.romylabs_demo_requests to authenticated;
drop policy if exists "Platform admins read Oculivo demo requests" on public.romylabs_demo_requests;
create policy "Platform admins read Oculivo demo requests"
on public.romylabs_demo_requests for select to authenticated
using (coalesce(public._is_platform_admin(),false));
drop policy if exists "Platform admins update Oculivo demo requests" on public.romylabs_demo_requests;
create policy "Platform admins update Oculivo demo requests"
on public.romylabs_demo_requests for update to authenticated
using (coalesce(public._is_platform_admin(),false))
with check (coalesce(public._is_platform_admin(),false));
-- No public INSERT privileges: only the authenticated server-to-server function uses service_role.
