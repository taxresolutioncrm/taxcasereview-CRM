-- RomyLabs-only configurable IVR and voicemail controls.
-- RLS and explicit service-only grants keep the config outside public Data API access.
create table if not exists public.romylabs_ivr_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  menu_greeting text not null default 'Thanks for calling RomyLabs. How can I help? For sales, press 1. For support, press 2. For billing, press 3. To speak with a representative, press 4. Or, to leave a voicemail, press 5.',
  after_hours_greeting text not null default 'Thanks for calling RomyLabs. We are closed right now. Our regular hours are Monday through Friday, nine A M to six P M Eastern. Leave your name, number, and a short message after the tone, and we will get back to you the next business day.',
  voicemail_greeting text not null default 'We cannot get to the phone right now. Please leave your name, number, and a short message after the tone. Press pound when you are finished.',
  opening_hour integer not null default 9 check (opening_hour between 0 and 23),
  closing_hour integer not null default 18 check (closing_hour between 1 and 24),
  weekdays integer[] not null default array[1,2,3,4,5]::integer[],
  no_answer_seconds integer not null default 28 check (no_answer_seconds between 15 and 60),
  voicemail_max_seconds integer not null default 180 check (voicemail_max_seconds between 30 and 300),
  updated_at timestamptz not null default now(),
  constraint romylabs_ivr_settings_hours check (opening_hour < closing_hour),
  constraint romylabs_ivr_settings_days check (array_length(weekdays,1) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]::integer[])
);
alter table public.romylabs_ivr_settings enable row level security;
revoke all on public.romylabs_ivr_settings from public,anon,authenticated;
grant select,insert,update,delete on public.romylabs_ivr_settings to service_role;
insert into public.romylabs_ivr_settings(tenant_id) values ('a0000000-0000-0000-0000-000000000001')
on conflict (tenant_id) do nothing;
