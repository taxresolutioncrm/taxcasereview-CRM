-- Align the central RomyLabs registry with the live Restore Relay launch state.
-- The public website reads this registry at build time and again in-browser.
update public.romylabs_products
set lifecycle = 'available',
    public = true,
    active = true,
    marketing_url = 'https://restorerelay.com',
    app_url = 'https://restorerelay.com',
    cta_label = 'Visit RestoreRelay',
    updated_at = now()
where product_id = 'restore_relay';

-- Keep Command Center reporting intentionally partial until the dedicated
-- product platform-metrics feed is deployed and verified. Search Console,
-- Bing, Clarity and AI/AEO channels are tracked separately.
update public.product_traffic_channels
set destination_url = 'https://restorerelay.com',
    updated_at = now()
where product_id = 'restore_relay'
  and channel_key in ('organic_search','search_console','bing_webmaster','clarity','ga4','ai_aeo');
