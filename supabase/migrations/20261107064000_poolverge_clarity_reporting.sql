-- PoolVerge uses the existing Microsoft Clarity project already embedded in
-- the production website build. Register its verified project ID without
-- manufacturing a live-session verification or touching other products.
update public.product_traffic_channels
set tracking_id = 'z31rnrvbns',
    destination_url = 'https://poolverge.com',
    status = 'configured',
    notes = 'PoolVerge Clarity project z31rnrvbns verified in website postbuild source; live visitor sessions not independently verified in Admin Portal. Do not mark live until sessions are confirmed.',
    updated_at = now()
where product_id = 'pool_crm'
  and channel_key = 'clarity'
  and (tracking_id is null or tracking_id = 'z31rnrvbns');
