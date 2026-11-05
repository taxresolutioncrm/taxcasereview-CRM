-- FormaCorp native Florida LLC intake fields.
-- Additive only: existing formation records and RLS remain unchanged.
-- Apply in the intended TaxRes-family project after sandbox verification.
alter table public.formacorp
  add column if not exists fl_correspondence_name text,
  add column if not exists fl_optional_provisions text,
  add column if not exists fl_llc_managers jsonb not null default '[]'::jsonb;

comment on column public.formacorp.fl_correspondence_name is
  'Correspondence contact shown on Florida LLC Articles intake; email remains correspondence_email.';
comment on column public.formacorp.fl_optional_provisions is
  'Optional provisions drafted for the filing packet; not an accepted state filing.';
comment on column public.formacorp.fl_llc_managers is
  'Optional Florida LLC managers/authorized persons as structured title, name, and street_address values.';
