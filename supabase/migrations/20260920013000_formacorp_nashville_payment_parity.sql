-- Nashville FormaCorp payment parity.
-- The publishable key is public configuration; the Stripe secret remains in the
-- Nashville project's encrypted Edge Function environment.
update public.settings
set stripe_publishable_key = 'pk_live_51TOjeV2faAzH978R82VjQYwH6hxLmTQCpIaeD8LMfoYVLHwNKVk8BhymWWRTIQWLWueWt6j5HcyGdwvK0CzL207r00T4MznHEE'
where tenant_id = '489ace07-1a6b-4864-833a-4f8420568b40'
  and coalesce(nullif(trim(stripe_publishable_key),''),'') = '';
