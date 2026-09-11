alter table public.fax_logs
  add column if not exists storage_path text;

comment on column public.fax_logs.storage_path is 'Private documents bucket path for durable fax file access.';
