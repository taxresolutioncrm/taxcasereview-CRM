-- Correct central traffic-coverage evidence to match currently deployed product sites.
-- Arcvena's marketing site pins Clarity project y6ou1vr1q0; the registry still
-- carried Oculivo's yguz2tkhnt value, which made Traffic Coverage inaccurate.
update public.product_traffic_channels
set tracking_id='y6ou1vr1q0',
    destination_url='https://arcvena.com',
    status='live',
    notes='Verified against current Arcvena marketing-site source: Microsoft Clarity project y6ou1vr1q0 is pinned in app/layout.tsx and enforced by the marketing validation script.',
    last_verified_at=now(),
    updated_at=now()
where product_id='arcvena' and channel_key='clarity';

