-- LinkedIn autopilot closeout: company-page-only publishing for TaxRes CRM and Arcvena.
-- Replaces the legacy TaxRes-only queue replenisher with the product-aware scheduler.
-- This migration is intentionally idempotent.

do $$
begin
  if exists (select 1 from cron.job where jobname='linkedin-queue-replenishment-supabase') then
    perform cron.unschedule('linkedin-queue-replenishment-supabase');
  end if;
  if exists (select 1 from cron.job where jobname='linkedin-product-autopilot') then
    perform cron.unschedule('linkedin-product-autopilot');
  end if;
end $$;

select cron.schedule(
  'linkedin-product-autopilot',
  '15 12 * * *',
  $$
  select net.http_post(
    url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/linkedin-scheduler',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"action":"run"}'::jsonb
  );
  $$
);

create or replace function public.publish_due_linkedin_posts()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_post record;
  v_conn record;
  v_req_id bigint;
  v_fired int := 0;
  v_skipped int := 0;
  v_author text;
begin
  for v_post in
    select id, body, title, category, retry_count, coalesce(product_id,'taxres_crm') as product_id
    from public.linkedin_posts
    where tenant_id='a0000000-0000-0000-0000-000000000001'
      and status='approved'
      and scheduled_at <= now()
      and retry_count < 3
    order by scheduled_at asc
    limit 6
  loop
    select access_token, expires_at, linkedin_person_id, publish_target_type, linkedin_organization_id
      into v_conn
    from public.linkedin_connections
    where tenant_id='a0000000-0000-0000-0000-000000000001'
      and coalesce(product_id,'taxres_crm')=v_post.product_id
    limit 1;

    if v_conn is null or v_conn.expires_at <= now() then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- TaxRes CRM and Arcvena are product brands. Never publish their queue to a
    -- personal member profile, even if an older OAuth row still exists.
    if v_post.product_id in ('taxres_crm','arcvena')
       and (
         upper(coalesce(v_conn.publish_target_type,'')) <> 'ORGANIZATION'
         or nullif(v_conn.linkedin_organization_id,'') is null
       ) then
      update public.linkedin_posts
         set error_msg='company_page_authorization_required', updated_at=now()
       where id=v_post.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if upper(coalesce(v_conn.publish_target_type,'PERSON'))='ORGANIZATION' then
      if nullif(v_conn.linkedin_organization_id,'') is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_author := 'urn:li:organization:' || v_conn.linkedin_organization_id;
    else
      v_author := 'urn:li:person:' || v_conn.linkedin_person_id;
    end if;

    update public.linkedin_posts
       set status='publishing', updated_at=now()
     where id=v_post.id and status='approved';
    if not found then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select net.http_post(
      url := 'https://api.linkedin.com/v2/ugcPosts',
      headers := jsonb_build_object(
        'Authorization','Bearer ' || v_conn.access_token,
        'Content-Type','application/json',
        'X-Restli-Protocol-Version','2.0.0'
      ),
      body := jsonb_build_object(
        'author',v_author,
        'lifecycleState','PUBLISHED',
        'specificContent',jsonb_build_object(
          'com.linkedin.ugc.ShareContent',jsonb_build_object(
            'shareCommentary',jsonb_build_object('text',coalesce(v_post.body,'')),
            'shareMediaCategory','NONE'
          )
        ),
        'visibility',jsonb_build_object('com.linkedin.ugc.MemberNetworkVisibility','PUBLIC')
      )
    ) into v_req_id;

    update public.linkedin_posts
       set error_msg='pg_net_req:' || v_req_id::text, updated_at=now()
     where id=v_post.id;
    v_fired := v_fired + 1;
  end loop;

  return jsonb_build_object('ok',true,'fired',v_fired,'skipped',v_skipped);
end;
$function$;
