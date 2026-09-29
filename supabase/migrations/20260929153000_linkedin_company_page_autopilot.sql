-- LinkedIn company-page autopilot hardening.
-- Root cause fixed:
--   1) the old pg_net publisher selected the first admin LinkedIn connection,
--      ignored linkedin_posts.product_id, and always authored as a PERSON.
--   2) TaxRes/Arcvena therefore published to the owner's personal profile.
--   3) queue generation depended on the legacy TaxRes-only replenisher instead
--      of the product-scoped linkedin-scheduler.
--
-- This migration makes publishing product-scoped, organization-aware, and
-- fail-closed for TaxRes CRM and Arcvena company pages.

create or replace function public.publish_due_linkedin_posts()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_post record;
  v_conn record;
  v_req_id bigint;
  v_fired int := 0;
  v_skipped int := 0;
  v_author text;
begin
  for v_post in
    select id, product_id, body, title, category, retry_count
    from public.linkedin_posts
    where tenant_id = 'a0000000-0000-0000-0000-000000000001'
      and status = 'approved'
      and scheduled_at <= now()
      and retry_count < 3
    order by scheduled_at asc
    limit 10
  loop
    select access_token, expires_at, linkedin_person_id, publish_target_type, linkedin_organization_id
      into v_conn
    from public.linkedin_connections
    where tenant_id = 'a0000000-0000-0000-0000-000000000001'
      and product_id = v_post.product_id
    limit 1;

    if v_conn is null or v_conn.expires_at <= now() then
      update public.linkedin_posts
      set error_msg = 'linkedin_connection_missing_or_expired',
          updated_at = now()
      where id = v_post.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_post.product_id in ('taxres_crm','arcvena') then
      if upper(coalesce(v_conn.publish_target_type,'')) <> 'ORGANIZATION'
         or nullif(v_conn.linkedin_organization_id,'') is null then
        update public.linkedin_posts
        set error_msg = 'company_page_connection_required',
            updated_at = now()
        where id = v_post.id;
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    v_author := case
      when upper(coalesce(v_conn.publish_target_type,'PERSON')) = 'ORGANIZATION'
        and nullif(v_conn.linkedin_organization_id,'') is not null
        then 'urn:li:organization:' || v_conn.linkedin_organization_id
      when nullif(v_conn.linkedin_person_id,'') is not null
        then 'urn:li:person:' || v_conn.linkedin_person_id
      else null
    end;

    if v_author is null then
      update public.linkedin_posts
      set error_msg = 'linkedin_publish_target_missing',
          updated_at = now()
      where id = v_post.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update public.linkedin_posts
    set status = 'publishing', updated_at = now(), error_msg = null
    where id = v_post.id and status = 'approved';

    if not found then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select net.http_post(
      url := 'https://api.linkedin.com/v2/ugcPosts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_conn.access_token,
        'Content-Type', 'application/json',
        'X-Restli-Protocol-Version', '2.0.0'
      ),
      body := jsonb_build_object(
        'author', v_author,
        'lifecycleState', 'PUBLISHED',
        'specificContent', jsonb_build_object(
          'com.linkedin.ugc.ShareContent', jsonb_build_object(
            'shareCommentary', jsonb_build_object('text', coalesce(v_post.body,'')),
            'shareMediaCategory', 'NONE'
          )
        ),
        'visibility', jsonb_build_object(
          'com.linkedin.ugc.MemberNetworkVisibility','PUBLIC'
        )
      )
    ) into v_req_id;

    update public.linkedin_posts
    set error_msg = 'pg_net_req:' || v_req_id::text,
        updated_at = now()
    where id = v_post.id;

    v_fired := v_fired + 1;
  end loop;

  return jsonb_build_object('ok',true,'fired',v_fired,'skipped',v_skipped);
end;
$$;

revoke execute on function public.publish_due_linkedin_posts() from public, anon, authenticated;
grant execute on function public.publish_due_linkedin_posts() to service_role;

-- Canonical autopilot generation runs from Supabase, not GitHub Actions.
do $$
begin
  perform cron.unschedule('linkedin-queue-replenishment-supabase');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('linkedin-scheduler-autopilot');
exception when others then null;
end $$;

select cron.schedule(
  'linkedin-scheduler-autopilot',
  '5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/linkedin-scheduler',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"action":"run"}'::jsonb
    );
  $cron$
);
