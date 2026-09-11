-- Normalize only channel readiness that is already proven in source.
-- This migration deliberately does not mark external-provider channels Live without live evidence.
-- Oculivo is intentionally excluded from every update.

-- BocaSync: public SEO source/audit is present; Search Console routing exists; GA4 waits on a real property ID.
update public.product_traffic_channels
set status='configured',
    destination_url='https://bocasync.com',
    notes='Technical SEO source, canonical metadata, sitemap, robots, structured data and audit coverage are present. Production/live search verification remains required before promoting to Live.',
    updated_at=now()
where product_id='bocasync' and channel_key='organic_search' and status='planned';

update public.product_traffic_channels
set status='configured',
    destination_url='https://bocasync.com/llms.txt',
    notes='AI/AEO discovery manifest and source validation are prepared in the product marketing-site release. Public deployment verification remains required before promoting to Live.',
    updated_at=now()
where product_id='bocasync' and channel_key='ai_aeo' and status='planned';

update public.product_traffic_channels
set status='not_applicable',
    notes='National SaaS product; local search is not currently a product-acquisition channel. Re-enable only if location-specific acquisition becomes commercially relevant.',
    updated_at=now()
where product_id='bocasync' and channel_key='local_search' and status='planned';

-- GroundIVO: public SEO source/audit is present; Search Console routing exists; GA4 waits on a real property ID.
update public.product_traffic_channels
set status='configured',
    destination_url='https://groundivo.com',
    notes='Technical SEO source, canonical metadata, sitemap, robots, structured data and marketing-site validation are present. Production/live search verification remains required before promoting to Live.',
    updated_at=now()
where product_id='groundivo' and channel_key='organic_search' and status='planned';

update public.product_traffic_channels
set status='configured',
    destination_url='https://groundivo.com/llms.txt',
    notes='AI/AEO discovery manifest and source validation are prepared in the product marketing-site release. Public deployment verification remains required before promoting to Live.',
    updated_at=now()
where product_id='groundivo' and channel_key='ai_aeo' and status='planned';

update public.product_traffic_channels
set status='not_applicable',
    notes='National SaaS product; local search is not currently a product-acquisition channel. Re-enable only if location-specific acquisition becomes commercially relevant.',
    updated_at=now()
where product_id='groundivo' and channel_key='local_search' and status='planned';

-- Restore Relay: SEO/analytics hooks are source-configured while the product remains in building lifecycle.
update public.product_traffic_channels
set status='configured',
    destination_url='https://restorerelay.com',
    notes='SEO source generation covers canonical pages, structured data, sitemap and robots. Production/live verification remains required before promoting to Live.',
    updated_at=now()
where product_id='restore_relay' and channel_key='organic_search' and status='planned';

update public.product_traffic_channels
set status='configured',
    destination_url='https://restorerelay.com',
    notes='Google Search Console verification hook is implemented through VITE_GOOGLE_SITE_VERIFICATION. A verified property and successful live query are still required before promoting to Live.',
    updated_at=now()
where product_id='restore_relay' and channel_key='search_console' and status='planned';

update public.product_traffic_channels
set status='blocked',
    destination_url='https://restorerelay.com',
    notes='GA4 loader and product-specific environment hook are implemented. A real GA4 Measurement/Property ID and live traffic verification are required before promoting to Live.',
    updated_at=now()
where product_id='restore_relay' and channel_key='ga4' and status='planned';

update public.product_traffic_channels
set status='configured',
    destination_url='https://restorerelay.com/llms.txt',
    notes='AI/AEO discovery manifest generation and source verification are prepared in the product build. Public deployment verification remains required before promoting to Live.',
    updated_at=now()
where product_id='restore_relay' and channel_key='ai_aeo' and status='planned';

update public.product_traffic_channels
set status='not_applicable',
    notes='National SaaS product; local search is not currently a product-acquisition channel. Re-enable only if location-specific acquisition becomes commercially relevant.',
    updated_at=now()
where product_id='restore_relay' and channel_key='local_search' and status='planned';

-- Pool-service CRM placeholder: keep every channel Planned until the final product name/domain is approved.
update public.product_traffic_channels
set notes='Product naming/domain is still unresolved. Keep this channel Planned; configure product-specific acquisition infrastructure only after the canonical brand and domain are approved.',
    updated_at=now()
where product_id='aquagrid'
  and status='planned'
  and notes is null;

-- External channels stay Planned until a real provider/account/campaign/referral source exists.
-- Ensure every non-Oculivo planned external channel carries an explicit activation condition.
update public.product_traffic_channels
set notes=case channel_key
  when 'paid_search' then 'Activation required: create/authorize the product Google Ads account, link conversion tracking/GA4, launch at least one real campaign, then verify paid-search traffic before promoting to Live.'
  when 'linkedin' then 'Activation required: establish the product LinkedIn publishing workspace/authorization and verify a real product-scoped publish before promoting to Configured or Live.'
  when 'reddit' then 'Activation required: establish an official/approved Reddit community presence or campaign workflow, use tagged links, and verify Reddit referral traffic before promoting to Live.'
  when 'other_social' then 'Activation required: establish at least one additional official social channel for this product, use tagged links, and verify social traffic before promoting to Live.'
  when 'referral' then 'Activation required: establish at least one real partner/directory/backlink source with tagged or attributable referral traffic, then verify referral sessions before promoting to Live.'
  when 'email' then 'Activation required: establish the product lifecycle sender/campaign workflow, use tagged links, and verify attributable email traffic before promoting to Live.'
  else notes
end,
updated_at=now()
where product_id <> 'oculivo'
  and status='planned'
  and notes is null
  and channel_key in ('paid_search','linkedin','reddit','other_social','referral','email');

-- Production-facing direct/brand is evidence-driven and must not be inferred from source readiness.
-- No status change is made here.

do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
  from public.product_traffic_channels
  where product_id in ('bocasync','groundivo','restore_relay')
    and channel_key in ('organic_search','ai_aeo','local_search')
    and status='planned';

  if bad_count <> 0 then
    raise exception 'Traffic readiness normalization failed: % expected source-configured rows remain Planned', bad_count;
  end if;
end
$$;
