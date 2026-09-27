-- A shared RomyLabs Reddit identity proves the corporate channel exists, but it
-- does not prove that every product has live product-scoped Reddit activity.
-- Keep RomyLabs Live; product rows remain Configured until product-specific
-- activity or attributable Reddit traffic is verified.
update public.product_traffic_channels
set status='configured',
    last_verified_at=null,
    notes='Shared RomyLabs Reddit identity is active. This product is tracking-ready with product-specific UTM attribution, but Live requires verified product-specific Reddit activity or attributable Reddit referral traffic.',
    updated_at=now()
where channel_key='reddit'
  and product_id <> 'romylabs'
  and status='live'
  and notes ilike '%shared official account u/RomyLabs%';

update public.product_traffic_channels
set status='live',
    notes='Verified live corporate Reddit presence through the official u/RomyLabs account. Product-specific Reddit channels remain separately evidence-gated.',
    updated_at=now()
where channel_key='reddit' and product_id='romylabs';
