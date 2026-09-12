-- Restore Relay Admin Portal registry alignment
-- Keeps lifecycle=building until the CRM closeout itself is complete.
-- Populates the already-live app/backend connection metadata that drives Admin Portal status.

update public.romylabs_products
set
  app_url = 'https://restorerelay.com',
  supabase_project_ref = 'yuwxzuybzuqnnldvdenx',
  supabase_url = 'https://yuwxzuybzuqnnldvdenx.supabase.co',
  cta_label = coalesce(cta_label, 'Open CRM'),
  updated_at = now()
where product_id = 'restore_relay';
