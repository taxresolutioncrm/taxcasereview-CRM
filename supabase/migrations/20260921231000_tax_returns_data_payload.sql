-- Preserve extended tax-return form fields that do not have dedicated scalar columns.
alter table public.tax_returns
  add column if not exists data jsonb not null default '{}'::jsonb;
