-- Tenant-safe Team Chat preferences.
-- Historical tables were later given tenant_id, but their original UNIQUE
-- constraints still ignored tenant_id. That lets a platform admin using the
-- same display name in two offices collide on the same preference key.
--
-- This migration changes only the preference uniqueness boundary; rows and
-- preference values are preserved.

alter table public.chat_rep_prefs
  drop constraint if exists chat_rep_prefs_viewer_name_rep_name_key;

alter table public.chat_conv_prefs
  drop constraint if exists chat_conv_prefs_viewer_name_conv_id_key;

alter table public.chat_rep_prefs
  add constraint chat_rep_prefs_tenant_viewer_rep_key
  unique (tenant_id, viewer_name, rep_name);

alter table public.chat_conv_prefs
  add constraint chat_conv_prefs_tenant_viewer_conv_key
  unique (tenant_id, viewer_name, conv_id);

create index if not exists idx_chat_rep_prefs_tenant_viewer
  on public.chat_rep_prefs (tenant_id, viewer_name);

create index if not exists idx_chat_conv_prefs_tenant_viewer
  on public.chat_conv_prefs (tenant_id, viewer_name);
