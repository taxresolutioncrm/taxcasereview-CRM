-- Multi-tenant Book Whip for TaxRes CRM / every tax office.
create table if not exists public.book_whip_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  snapshot_month date not null,
  client_id text,
  client_name text not null,
  client_since text,
  client_owner text,
  source_created_on timestamptz,
  tags text,
  spouse_name text,
  client_display text,
  assigned_associate text,
  financials text,
  last_payment text,
  transcripts text,
  state_res_hold text,
  hold_date text,
  notes text,
  quote text,
  return_quote text,
  resolution_step text,
  chris_flag text,
  johnny_flag text,
  last_contact_date text,
  source text not null default 'crm_live_client',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists book_whip_rows_tenant_month_client_uidx
  on public.book_whip_rows(tenant_id,snapshot_month,client_id)
  where client_id is not null;
create index if not exists book_whip_rows_tenant_month_idx
  on public.book_whip_rows(tenant_id,snapshot_month,client_name);

alter table public.book_whip_rows enable row level security;
grant select,insert,update,delete on public.book_whip_rows to authenticated;

drop policy if exists book_whip_select on public.book_whip_rows;
create policy book_whip_select on public.book_whip_rows
for select to authenticated
using (tenant_id=current_tenant_id() and current_employee_permission('perm_reports')>=1);

drop policy if exists book_whip_insert on public.book_whip_rows;
create policy book_whip_insert on public.book_whip_rows
for insert to authenticated
with check (tenant_id=current_tenant_id() and current_employee_permission('perm_reports')>=2);

drop policy if exists book_whip_update on public.book_whip_rows;
create policy book_whip_update on public.book_whip_rows
for update to authenticated
using (tenant_id=current_tenant_id() and current_employee_permission('perm_reports')>=2)
with check (tenant_id=current_tenant_id() and current_employee_permission('perm_reports')>=2);

drop policy if exists book_whip_delete on public.book_whip_rows;
create policy book_whip_delete on public.book_whip_rows
for delete to authenticated
using (tenant_id=current_tenant_id() and current_employee_permission('perm_reports')>=3);

create or replace function public.refresh_book_whip_tenant(p_tenant uuid,p_month date)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer;
begin
  insert into public.book_whip_rows(
    tenant_id,snapshot_month,client_id,client_name,client_since,client_owner,
    source_created_on,tags,spouse_name,client_display,assigned_associate,
    financials,last_payment,transcripts,state_res_hold,quote,resolution_step,source,updated_at
  )
  select
    c.tenant_id,date_trunc('month',p_month)::date,c.id,
    regexp_replace(coalesce(c.name,''),'\s+[0-9]{5}$','','g'),
    coalesce(c."clientSince",c.clientsince),
    coalesce(c."salesRep",c.assignedto,c."assignedTo"),
    c.created_at,c.tags,coalesce(c."spouseName",c.spousename),
    regexp_replace(coalesce(c.name,''),'\s+[0-9]{5}$','','g'),
    coalesce(c."taxAssociate",c.assignedto,c."assignedTo"),
    null,
    lp.last_payment,
    tr.transcript_status,
    coalesce(c."stateStatus",c."irsOrState"),
    case when c."contractFee" is not null then c."contractFee"::text else null end,
    coalesce(c."pipelineStage",c.pipelinestage),
    'crm_live_client',
    now()
  from public.clients c
  left join lateral (
    select concat(coalesce(p.amount,''),case when coalesce(p.date,p.scheduled_date::text,'')<>'' then ' · '||coalesce(p.date,p.scheduled_date::text) else '' end) last_payment
    from public.payments p
    where p.tenant_id=c.tenant_id
      and (p.client_id=c.id or lower(coalesce(p."clientName",p.clientname,''))=lower(coalesce(c.name,'')))
    order by coalesce(p.created_at,now()) desc
    limit 1
  ) lp on true
  left join lateral (
    select concat_ws(' · ',coalesce(t.status,''),coalesce(t."transcriptType",t.type,''),coalesce(t."taxYears",t.taxyears,'')) transcript_status
    from public.transcripts t
    where t.tenant_id=c.tenant_id
      and (t.client_id=c.id or lower(coalesce(t."clientName",t.clientname,''))=lower(coalesce(c.name,'')))
    order by coalesce(t.updated_at,t.created_at) desc
    limit 1
  ) tr on true
  where c.tenant_id=p_tenant
    and c.deleted_at is null
    and lower(coalesce(c.status,'active')) not in ('inactive','archived','deleted')
  on conflict (tenant_id,snapshot_month,client_id) where client_id is not null
  do update set
    client_name=excluded.client_name,
    client_since=excluded.client_since,
    client_owner=excluded.client_owner,
    source_created_on=excluded.source_created_on,
    tags=excluded.tags,
    spouse_name=excluded.spouse_name,
    client_display=excluded.client_display,
    assigned_associate=excluded.assigned_associate,
    last_payment=excluded.last_payment,
    transcripts=excluded.transcripts,
    state_res_hold=excluded.state_res_hold,
    quote=excluded.quote,
    resolution_step=excluded.resolution_step,
    updated_at=now();

  update public.book_whip_rows b
  set last_contact_date=x.last_contact::date::text,
      updated_at=now()
  from (
    select c.id,
      greatest(
        coalesce((select max(e.created_at) from public.emails e where e.tenant_id=c.tenant_id and (e.client_id=c.id or lower(coalesce(e."clientName",e.clientname,''))=lower(c.name))),'epoch'::timestamptz),
        coalesce((select max(s.created_at) from public.sms_messages s where s.tenant_id=c.tenant_id and (s.client_id=c.id or lower(coalesce(s."clientName",''))=lower(c.name))),'epoch'::timestamptz),
        coalesce((select max(n.created_at) from public.client_notes n where n.tenant_id=c.tenant_id and (n.client_id=c.id or lower(coalesce(n.clientname,''))=lower(c.name))),'epoch'::timestamptz)
      ) last_contact
    from public.clients c
    where c.tenant_id=p_tenant
  ) x
  where b.tenant_id=p_tenant and b.snapshot_month=date_trunc('month',p_month)::date
    and b.client_id=x.id and x.last_contact>'epoch'::timestamptz;

  select count(*) into v_count from public.book_whip_rows
  where tenant_id=p_tenant and snapshot_month=date_trunc('month',p_month)::date;
  return v_count;
end;
$$;

create or replace function public.create_book_whip_month(p_month date)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_tenant uuid;
begin
  v_tenant:=current_tenant_id();
  if v_tenant is null then raise exception 'No tenant context'; end if;
  if current_employee_permission('perm_reports')<2 then raise exception 'Reports edit permission required'; end if;
  if v_tenant='489ace07-1a6b-4864-833a-4f8420568b40'::uuid then
    raise exception 'Nashville Book Whip is managed in the Nashville CRM';
  end if;
  return public.refresh_book_whip_tenant(v_tenant,p_month);
end;
$$;
grant execute on function public.create_book_whip_month(date) to authenticated;
revoke all on function public.refresh_book_whip_tenant(uuid,date) from public,anon,authenticated;

create or replace function public.book_whip_client_upsert()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.tenant_id='489ace07-1a6b-4864-833a-4f8420568b40'::uuid then return new; end if;
  if new.deleted_at is null and lower(coalesce(new.status,'active')) not in ('inactive','archived','deleted') then
    insert into public.book_whip_rows(
      tenant_id,snapshot_month,client_id,client_name,client_since,client_owner,
      source_created_on,tags,spouse_name,client_display,assigned_associate,
      state_res_hold,quote,resolution_step,source,updated_at
    )
    values(
      new.tenant_id,date_trunc('month',current_date)::date,new.id,
      regexp_replace(coalesce(new.name,''),'\s+[0-9]{5}$','','g'),
      coalesce(new."clientSince",new.clientsince),
      coalesce(new."salesRep",new.assignedto,new."assignedTo"),
      new.created_at,new.tags,coalesce(new."spouseName",new.spousename),
      regexp_replace(coalesce(new.name,''),'\s+[0-9]{5}$','','g'),
      coalesce(new."taxAssociate",new.assignedto,new."assignedTo"),
      coalesce(new."stateStatus",new."irsOrState"),
      case when new."contractFee" is not null then new."contractFee"::text else null end,
      coalesce(new."pipelineStage",new.pipelinestage),
      'crm_live_client',now()
    )
    on conflict (tenant_id,snapshot_month,client_id) where client_id is not null
    do update set
      client_name=excluded.client_name,
      client_since=excluded.client_since,
      client_owner=excluded.client_owner,
      source_created_on=excluded.source_created_on,
      tags=excluded.tags,
      spouse_name=excluded.spouse_name,
      client_display=excluded.client_display,
      assigned_associate=excluded.assigned_associate,
      state_res_hold=excluded.state_res_hold,
      quote=excluded.quote,
      resolution_step=excluded.resolution_step,
      updated_at=now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_book_whip_client_upsert on public.clients;
create trigger trg_book_whip_client_upsert
after insert or update of status,deleted_at,"assignedTo",assignedto,"taxAssociate","pipelineStage",pipelinestage,"contractFee",tags
on public.clients
for each row execute function public.book_whip_client_upsert();

create or replace function public.system_refresh_all_book_whips()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare r record; v_total integer:=0;
begin
  for r in select id from public.tenants
    where lower(coalesce(status,'')) in ('active','trial')
      and id<>'489ace07-1a6b-4864-833a-4f8420568b40'::uuid loop
    v_total:=v_total+public.refresh_book_whip_tenant(r.id,current_date);
  end loop;
  return v_total;
end;
$$;
revoke all on function public.system_refresh_all_book_whips() from public,anon,authenticated;

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='taxres-book-whip-hourly';
    perform cron.unschedule(jobid) from cron.job where jobname='taxres-book-whip-monthly';
    perform cron.schedule('taxres-book-whip-hourly','17 * * * *','select public.system_refresh_all_book_whips();');
    perform cron.schedule('taxres-book-whip-monthly','5 5 1 * *','select public.system_refresh_all_book_whips();');
  end if;
end $$;
