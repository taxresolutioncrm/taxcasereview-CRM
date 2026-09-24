-- The Settings UI exposes Otter integration credentials; persist them
-- instead of silently dropping the field.
alter table public.settings
  add column if not exists otter_api_key text;
