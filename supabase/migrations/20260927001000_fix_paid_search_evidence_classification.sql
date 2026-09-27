-- GA4 Cross-network is not equivalent to a verified paid-search campaign.
-- Traffic Coverage must not promote Paid Search to Live from Cross-network alone.
create or replace function public.reconcile_traffic_channel_from_ga4()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  mapped_key text;
begin
  if new.product_id in ('oculivo','phl_land_care') or coalesce(new.sessions,0) <= 0 then
    return new;
  end if;

  mapped_key := case
    when new.channel = 'Direct' then 'direct'
    when new.channel = 'Referral' then 'referral'
    when new.channel = 'Organic Social' then 'other_social'
    when new.channel = 'Email' then 'email'
    when new.channel = 'Paid Search' then 'paid_search'
    when new.channel = 'Organic Search' then 'organic_search'
    else null
  end;

  if mapped_key is not null then
    update public.product_traffic_channels
    set status='live',
        last_verified_at=coalesce(new.synced_at,now()),
        updated_at=now(),
        notes=format(
          'Auto-verified from GA4: %s recorded %s session(s), %s user(s), and %s page view(s) on %s.',
          new.channel,
          coalesce(new.sessions,0)::text,
          coalesce(new.users,0)::text,
          coalesce(new.page_views,0)::text,
          new.date::text
        )
    where product_id=new.product_id
      and channel_key=mapped_key
      and status <> 'not_applicable';
  end if;

  return new;
end;
$$;

-- Undo prior false promotions that were based only on Cross-network traffic.
update public.product_traffic_channels
set status='configured',
    last_verified_at=null,
    notes='Tracking-ready. Previous Live status was based only on GA4 Cross-network traffic, which is not sufficient evidence of an authorized paid-search campaign. Promote to Live only after Paid Search traffic or campaign/provider evidence is verified.',
    updated_at=now()
where channel_key='paid_search'
  and notes like 'Auto-verified from GA4: Cross-network%';
