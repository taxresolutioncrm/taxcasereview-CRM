-- Add Florida formation fields needed to prepare a complete Sunbiz LLC filing packet.
alter table public.formacorp
  add column if not exists principal_address text,
  add column if not exists mailing_address text,
  add column if not exists registered_agent_address text,
  add column if not exists authorized_representative text,
  add column if not exists authorized_representative_title text,
  add column if not exists correspondence_email text,
  add column if not exists effective_date text,
  add column if not exists registered_agent_accepted boolean not null default false;

comment on column public.formacorp.registered_agent_accepted is 'True only after the filer confirms the registered agent has accepted the appointment; not an electronic signature itself.';
