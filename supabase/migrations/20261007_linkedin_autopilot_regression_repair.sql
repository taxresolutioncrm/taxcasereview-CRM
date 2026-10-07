-- Repair the Sep 29 LinkedIn regression: TaxRes keeps member publishing; Arcvena stays company-page only.
create or replace function public.publish_due_linkedin_posts()
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_post record;
  v_conn record;
  v_settings record;
  v_req_id bigint;
  v_fired int := 0;
  v_skipped int := 0;
  v_body text;
  v_author text;
begin
  for v_post in
    select id, product_id, body, title, category, retry_count
    from public.linkedin_posts
    where tenant_id='a0000000-0000-0000-0000-000000000001'
      and product_id in ('taxres_crm','arcvena')
      and status='approved'
      and scheduled_at<=now()
      and retry_count<3
    order by scheduled_at asc
    limit 3
  loop
    select autopilot into v_settings
    from public.linkedin_settings
    where tenant_id='a0000000-0000-0000-0000-000000000001'
      and product_id=v_post.product_id
    limit 1;
    if v_settings is null or v_settings.autopilot is distinct from true then
      v_skipped:=v_skipped+1; continue;
    end if;

    select access_token,expires_at,publish_target_type,linkedin_organization_id,linkedin_person_id
      into v_conn
    from public.linkedin_connections
    where tenant_id='a0000000-0000-0000-0000-000000000001'
      and product_id=v_post.product_id
    order by updated_at desc limit 1;
    if v_conn is null or v_conn.expires_at<=now() then
      v_skipped:=v_skipped+1; continue;
    end if;

    if v_post.product_id='arcvena' then
      if upper(coalesce(v_conn.publish_target_type,''))<>'ORGANIZATION'
         or nullif(v_conn.linkedin_organization_id,'') is null then
        v_skipped:=v_skipped+1; continue;
      end if;
      v_author:='urn:li:organization:'||v_conn.linkedin_organization_id;
    elsif upper(coalesce(v_conn.publish_target_type,''))='ORGANIZATION'
          and nullif(v_conn.linkedin_organization_id,'') is not null then
      v_author:='urn:li:organization:'||v_conn.linkedin_organization_id;
    elsif nullif(v_conn.linkedin_person_id,'') is not null then
      v_author:='urn:li:person:'||v_conn.linkedin_person_id;
    else
      v_skipped:=v_skipped+1; continue;
    end if;

    update public.linkedin_posts set status='publishing',updated_at=now()
    where id=v_post.id and status='approved';
    if not found then v_skipped:=v_skipped+1; continue; end if;

    v_body:=coalesce(v_post.body,'');
    select net.http_post(
      url:='https://api.linkedin.com/v2/ugcPosts',
      headers:=jsonb_build_object(
        'Authorization','Bearer '||v_conn.access_token,
        'Content-Type','application/json',
        'X-Restli-Protocol-Version','2.0.0'
      ),
      body:=jsonb_build_object(
        'author',v_author,
        'lifecycleState','PUBLISHED',
        'specificContent',jsonb_build_object(
          'com.linkedin.ugc.ShareContent',jsonb_build_object(
            'shareCommentary',jsonb_build_object('text',v_body),
            'shareMediaCategory','NONE'
          )
        ),
        'visibility',jsonb_build_object('com.linkedin.ugc.MemberNetworkVisibility','PUBLIC')
      )
    ) into v_req_id;

    update public.linkedin_posts set error_msg='pg_net_req:'||v_req_id::text,updated_at=now()
    where id=v_post.id;
    v_fired:=v_fired+1;
  end loop;
  return jsonb_build_object('ok',true,'fired',v_fired,'skipped',v_skipped);
end;
$function$;

update public.linkedin_posts
set status='approved',
    approved_at=coalesce(approved_at,now()),
    updated_at=now()
where tenant_id='a0000000-0000-0000-0000-000000000001'
  and product_id='taxres_crm'
  and status='draft'
  and scheduled_at is not null
  and linkedin_post_id is null;
