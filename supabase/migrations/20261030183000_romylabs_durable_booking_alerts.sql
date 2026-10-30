-- Durable, product-scoped lead notifications for the central RomyLabs booking engine.
-- A successful booking is never dependent on email delivery, browser state, or Gmail.
create table if not exists public.romylabs_booking_alerts (
  booking_id text primary key references public.calevents(id) on delete cascade,
  product_id text not null,
  lead_name text not null,
  lead_email text,
  appointment_type text,
  appointment_date text,
  appointment_time text,
  booked_at timestamptz not null,
  acknowledged_at timestamptz,
  followup_status text not null default 'new' check (followup_status in ('new','acknowledged','contacted','completed')),
  contacted_at timestamptz,
  completed_at timestamptz,
  contact_outcome text,
  assigned_to text not null default 'RomyLabs Admin',
  notification_submission_id text,
  notification_submitted_at timestamptz,
  notification_last_error text,
  created_at timestamptz not null default now()
);
create index if not exists romylabs_booking_alerts_pending_idx
on public.romylabs_booking_alerts(acknowledged_at,booked_at desc);
alter table public.romylabs_booking_alerts enable row level security;
revoke all on public.romylabs_booking_alerts from anon;
grant select,update on public.romylabs_booking_alerts to authenticated;
create policy "Platform admins can read booking alerts" on public.romylabs_booking_alerts
for select to authenticated using (coalesce(public._is_platform_admin(),false));
create policy "Platform admins can acknowledge booking alerts" on public.romylabs_booking_alerts
for update to authenticated using (coalesce(public._is_platform_admin(),false))
with check (coalesce(public._is_platform_admin(),false));
create or replace function public.romylabs_record_booking_alert()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.source = 'online' and new.booking_token is not null
     and new.product_id is not null then
    insert into public.romylabs_booking_alerts
    (booking_id,product_id,lead_name,lead_email,appointment_type,appointment_date,appointment_time,booked_at)
    values (new.id,new.product_id,coalesce(nullif(new."clientName",''),'New lead'),
      new.contact_email,new."eventType",new.date,new.time,coalesce(new.created_at,now()))
    on conflict (booking_id) do update
      set product_id=excluded.product_id,lead_name=excluded.lead_name,
          lead_email=excluded.lead_email,appointment_type=excluded.appointment_type,
          appointment_date=excluded.appointment_date,appointment_time=excluded.appointment_time;
  end if;
  return new;
end $$;
drop trigger if exists romylabs_online_booking_alert on public.calevents;
create trigger romylabs_online_booking_alert
after insert or update of product_id,status on public.calevents
for each row execute function public.romylabs_record_booking_alert();
-- Include the missed Camvella lead and other recent online bookings.
insert into public.romylabs_booking_alerts
(booking_id,product_id,lead_name,lead_email,appointment_type,appointment_date,appointment_time,booked_at)
select id,product_id,coalesce(nullif("clientName",''),'New lead'),
contact_email,"eventType",date,time,coalesce(created_at,now())
from public.calevents
where source='online' and booking_token is not null and product_id is not null
  and created_at >= now() - interval '14 days'
on conflict (booking_id) do nothing;

-- An acknowledgement is not a completed follow-up.
create index if not exists romylabs_booking_followup_idx on public.romylabs_booking_alerts(followup_status,booked_at desc);
create or replace function public.guard_romylabs_booking_followup() returns trigger language plpgsql set search_path=public as $$
begin
 if new.followup_status in ('contacted','completed') and (new.contacted_at is null or nullif(trim(coalesce(new.contact_outcome,'')),'') is null) then
  raise exception 'Contact timestamp and outcome required';
 end if;
 if new.followup_status='completed' and old.followup_status not in ('contacted','completed') then
  raise exception 'Record contact before completing follow-up';
 end if;
 return new;
end $$;
drop trigger if exists guard_romylabs_booking_followup on public.romylabs_booking_alerts;
create trigger guard_romylabs_booking_followup before update on public.romylabs_booking_alerts for each row execute function public.guard_romylabs_booking_followup();
