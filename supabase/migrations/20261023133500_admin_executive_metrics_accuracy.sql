-- Canonical RomyLabs executive reporting contract.
-- One source for portfolio KPIs, deduped office counts, billing truth, and data-quality flags.

create or replace function public.admin_executive_metrics()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with authorized as (
  select public._is_platform_admin() as ok
),
product_registry as (
  select product_id,name,lifecycle,active,sort_order
  from public.romylabs_products
  where (select ok from authorized)
),
active_products as (
  select *
  from product_registry
  where active=true and lower(coalesce(lifecycle,''))<>'internal'
),
billing_accounts as (
  select *
  from public.romylabs_billing_accounts
  where (select ok from authorized)
),
paid_payments as (
  select p.*,b.account_name,b.product_key,b.external_tenant_id
  from public.romylabs_subscription_payments p
  join billing_accounts b on b.id=p.account_id
  where lower(coalesce(p.status,'')) in ('succeeded','paid','completed','posted','cleared')
),
billing_truth as (
  select
    coalesce(sum(case when lower(coalesce(status,''))='active'
      then case
        when coalesce(monthly_amount_cents,0)>0 then monthly_amount_cents
        else coalesce(seat_count,0)*coalesce(per_seat_amount_cents,0)
      end else 0 end),0)::numeric/100.0 as mrr,
    coalesce(sum(case when lower(coalesce(status,''))='active' then coalesce(seat_count,0) else 0 end),0)::int as purchased_seats
  from billing_accounts
),
revenue_truth as (
  select coalesce(sum(amount_cents),0)::numeric/100.0 as total_revenue
  from paid_payments
),
monthly_revenue as (
  select date_trunc('month',coalesce(paid_at,created_at))::date month_start,
         sum(amount_cents)::numeric/100.0 revenue
  from paid_payments
  group by 1
),
revenue_period as (
  select
    coalesce((select revenue from monthly_revenue where month_start=date_trunc('month',current_date)::date),0) current_month,
    coalesce((select revenue from monthly_revenue where month_start=(date_trunc('month',current_date)-interval '1 month')::date),0) previous_month
),
cache as (
  select product_key,payload,fetched_at
  from public.romylabs_metrics_cache
  where (select ok from authorized)
    and coalesce((payload->>'ok')::boolean,false)
),
feed_raw as (
  select c.product_key,c.payload,c.fetched_at,o,
         nullif(o->>'id','') office_id,
         coalesce(o->>'name','') office_name,
         coalesce((o->>'is_active')::boolean,true) is_active,
         coalesce(
           nullif(o->>'employee_count','')::int,
           nullif(o->>'active_staff','')::int,
           jsonb_array_length(coalesce(o->'employees','[]'::jsonb)),
           0
         ) row_staff
  from cache c
  cross join lateral jsonb_array_elements(coalesce(c.payload->'offices','[]'::jsonb)) o
),
ranked as (
  select f.*,
         row_number() over(
           partition by office_id
           order by case when product_key='taxres_crm' then 2 else 1 end,fetched_at desc
         ) rn,
         count(*) over(partition by office_id) duplicate_count
  from feed_raw f
  where office_id is not null
),
dedup as (
  select * from ranked where rn=1
),
real_count_by_product as (
  select product_key,
         count(*) filter(
           where is_active
             and lower(office_name) not like '%demo%'
             and lower(office_name) not like '%internal%'
         ) real_count
  from dedup
  group by product_key
),
resolved as (
  select d.*,
         case
           when d.row_staff>0 then d.row_staff
           when pc.real_count=1 then coalesce(
             nullif(d.payload->'metrics'->>'active_staff','')::int,
             nullif(d.payload->'metrics'->>'active_users','')::int,
             0
           )
           else d.row_staff
         end active_staff,
         (
           coalesce((r.metadata->>'demo')::boolean,false)
           or coalesce((r.metadata->>'is_demo')::boolean,false)
           or lower(d.office_name) like '%demo%'
         ) is_demo,
         (
           coalesce((r.metadata->>'internal')::boolean,false)
           or lower(d.office_name) like '%internal%'
         ) is_internal,
         r.external_office_id is not null registry_known,
         r.status registry_status,
         nullif(r.seats,0) registry_seats,
         r.metadata registry_metadata
  from dedup d
  join real_count_by_product pc using(product_key)
  left join public.romylabs_office_registry r on r.external_office_id=d.office_id
),
verified_companies as (
  select *
  from resolved
  where is_active
    and not is_demo
    and not is_internal
    and (
      registry_known
      or active_staff>0
      or lower(office_name)=lower(product_key)
    )
),
company_capacity as (
  select v.office_id,v.office_name,v.active_staff,
         coalesce(
           (select nullif(b.seat_count,0)
            from billing_accounts b
            where lower(coalesce(b.status,''))='active'
              and b.external_tenant_id=v.office_id
            order by b.updated_at desc limit 1),
           v.registry_seats
         ) contracted_seats
  from verified_companies v
),
occupancy as (
  select
    coalesce(sum(active_staff) filter(where contracted_seats is not null),0)::int covered_active_staff,
    coalesce(sum(contracted_seats) filter(where contracted_seats is not null),0)::int covered_capacity,
    count(*) filter(where contracted_seats is not null)::int covered_companies,
    count(*)::int total_companies
  from company_capacity
),
canonical_demos as (
  select distinct
    case when r.product_key='health_insurance_crm' then 'health_insurance' else r.product_key end product_key
  from public.romylabs_office_registry r
  where (select ok from authorized)
    and lower(coalesce(r.status,'trial')) not in ('cancelled','deleted','inactive')
    and (
      coalesce((r.metadata->>'demo')::boolean,false)
      or coalesce((r.metadata->>'is_demo')::boolean,false)
      or lower(coalesce(r.firm_name,'')) like '%demo%'
    )
),
demo_count as (
  select count(*)::int value
  from canonical_demos d
  join active_products p on p.product_id=d.product_key
),
duplicate_offices as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'office_id',office_id,'office_name',office_name,'copies',duplicate_count
  ) order by office_name),'[]'::jsonb) value
  from ranked
  where rn=1 and duplicate_count>1
),
unclassified_offices as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'product',product_key,'office_id',office_id,'office_name',office_name,'active_staff',active_staff
  ) order by office_name),'[]'::jsonb) value
  from resolved
  where is_active and not is_demo and not is_internal
    and not registry_known and active_staff=0 and lower(office_name)<>lower(product_key)
),
missing_product_feeds as (
  select coalesce(jsonb_agg(jsonb_build_object('product_id',p.product_id,'name',p.name) order by p.sort_order,p.name),'[]'::jsonb) value
  from active_products p
  left join cache c on c.product_key=p.product_id
  where lower(coalesce(p.lifecycle,''))='live'
    and c.product_key is null
),
stale_feeds as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'product',product_key,'fetched_at',fetched_at,
    'age_minutes',floor(extract(epoch from (now()-fetched_at))/60)
  ) order by fetched_at),'[]'::jsonb) value
  from cache
  where fetched_at < now()-interval '2 hours'
),
company_status as (
  select coalesce(jsonb_object_agg(status_name,cnt),'{}'::jsonb) value
  from (
    select status_name,count(*)::int cnt
    from (
      select v.office_id,
             case
               when lower(coalesce(b.status,'')) in ('active','trial','past_due','suspended','cancelled') then lower(b.status)
               when lower(coalesce(v.registry_status,'')) in ('active','trial','past_due','suspended','cancelled') then lower(v.registry_status)
               when v.is_active then 'active'
               else 'inactive'
             end status_name
      from verified_companies v
      left join lateral (
        select status
        from billing_accounts ba
        where ba.external_tenant_id=v.office_id
        order by ba.updated_at desc
        limit 1
      ) b on true
    ) x
    group by status_name
  ) y
),
verified_company_rows as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'office_id',v.office_id,
    'office_name',v.office_name,
    'product',v.product_key,
    'active_staff',v.active_staff,
    'status',case
      when lower(coalesce(b.status,'')) in ('active','trial','past_due','suspended','cancelled') then lower(b.status)
      when lower(coalesce(v.registry_status,'')) in ('active','trial','past_due','suspended','cancelled') then lower(v.registry_status)
      when v.is_active then 'active'
      else 'inactive'
    end,
    'fetched_at',v.fetched_at
  ) order by v.office_name),'[]'::jsonb) value
  from verified_companies v
  left join lateral (
    select status
    from billing_accounts ba
    where ba.external_tenant_id=v.office_id
    order by ba.updated_at desc
    limit 1
  ) b on true
),
office_revenue as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id',account_id,
    'account_name',account_name,
    'product_key',product_key,
    'revenue',revenue
  ) order by revenue desc,account_name),'[]'::jsonb) value
  from (
    select p.account_id,max(p.account_name) account_name,max(p.product_key) product_key,
           sum(p.amount_cents)::numeric/100.0 revenue
    from paid_payments p
    group by p.account_id
  ) x
),
revenue_series as (
  select coalesce(jsonb_agg(jsonb_build_object('month',month_start,'revenue',revenue) order by month_start),'[]'::jsonb) value
  from monthly_revenue
  where month_start >= (date_trunc('month',current_date)-interval '11 months')::date
)
select case when not (select ok from authorized) then
  jsonb_build_object('ok',false,'error','Platform admin required')
else jsonb_build_object(
  'ok',true,
  'generated_at',now(),
  'definitions',jsonb_build_object(
    'total_revenue','Succeeded RomyLabs subscription payments only',
    'mrr','Active RomyLabs subscription billing only',
    'active_seats','Active staff in deduplicated verified real companies',
    'occupancy','Active staff divided by contracted seats only for companies with known capacity',
    'products','Active non-internal RomyLabs products',
    'companies','Deduplicated verified real offices; demos/internal/unclassified excluded',
    'demo_tenants','One canonical demo per active non-internal product'
  ),
  'kpis',jsonb_build_object(
    'total_revenue',(select total_revenue from revenue_truth),
    'mrr',(select mrr from billing_truth),
    'active_seats',(select coalesce(sum(active_staff),0) from verified_companies),
    'products',(select count(*) from active_products),
    'companies',(select count(*) from verified_companies),
    'demo_tenants',(select value from demo_count),
    'occupancy_active',(select covered_active_staff from occupancy),
    'occupancy_capacity',(select covered_capacity from occupancy),
    'occupancy_pct',case when (select covered_capacity from occupancy)>0
      then round((select covered_active_staff from occupancy)::numeric*100/(select covered_capacity from occupancy),1)
      else null end,
    'occupancy_covered_companies',(select covered_companies from occupancy),
    'occupancy_total_companies',(select total_companies from occupancy),
    'occupancy_complete',(select covered_companies=total_companies and total_companies>0 from occupancy)
  ),
  'growth',jsonb_build_object(
    'revenue_mom_pct',case
      when (select previous_month from revenue_period)>0 then round(
        ((select current_month from revenue_period)-(select previous_month from revenue_period))*100
        /(select previous_month from revenue_period),1)
      else null end,
    'mrr_pct',null,
    'active_seats_pct',null,
    'mrr_reason','No historical MRR snapshot source exists yet',
    'active_seats_reason','No historical active-seat snapshot source exists yet'
  ),
  'charts',jsonb_build_object(
    'monthly_revenue',(select value from revenue_series),
    'historical_mrr','[]'::jsonb,
    'office_revenue',(select value from office_revenue),
    'office_status',(select value from company_status)
  ),
  'companies',(select value from verified_company_rows),
  'quality',jsonb_build_object(
    'duplicate_offices',(select value from duplicate_offices),
    'unclassified_offices',(select value from unclassified_offices),
    'missing_product_feeds',(select value from missing_product_feeds),
    'stale_feeds',(select value from stale_feeds),
    'occupancy_incomplete',not (select covered_companies=total_companies and total_companies>0 from occupancy)
  )
) end;
$$;

revoke all on function public.admin_executive_metrics() from public,anon;
grant execute on function public.admin_executive_metrics() to authenticated;
