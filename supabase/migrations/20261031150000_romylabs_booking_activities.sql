-- Append-only, admin-only timeline for central demo booking follow-ups.
create table if not exists public.romylabs_booking_activities (
 id uuid primary key default gen_random_uuid(),
 booking_id text not null references public.romylabs_booking_alerts(booking_id) on delete cascade,
 activity_type text not null check (activity_type in ('email_sent','called_no_answer','voicemail_left','spoke_with_lead','awaiting_response','followup_scheduled','other')),
 notes text not null check (length(trim(notes)) between 1 and 4000),
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid()
);
-- Preserve any prior recorded outcome as the first historical activity.
insert into public.romylabs_booking_activities (booking_id,activity_type,notes,created_at,created_by)
select a.booking_id,'other',a.contact_outcome,a.contacted_at, '00000000-0000-0000-0000-000000000000'::uuid
from public.romylabs_booking_alerts a
where a.contacted_at is not null and length(trim(coalesce(a.contact_outcome,'')))>0
and not exists (select 1 from public.romylabs_booking_activities h where h.booking_id=a.booking_id);
create index if not exists romylabs_booking_activities_lookup on public.romylabs_booking_activities(booking_id,created_at desc);
alter table public.romylabs_booking_activities enable row level security;
create policy "Platform admins can read demo activities" on public.romylabs_booking_activities for select to authenticated using (coalesce(public._is_platform_admin(),false));
create policy "Platform admins can append demo activities" on public.romylabs_booking_activities for insert to authenticated with check (coalesce(public._is_platform_admin(),false) and created_by=auth.uid());
grant select,insert on public.romylabs_booking_activities to authenticated;
create or replace function public.romylabs_record_booking_activity(p_booking_id text,p_activity_type text,p_notes text,p_next_followup timestamptz default null)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if not coalesce(public._is_platform_admin(),false) then raise exception 'Not authorized'; end if;
 if p_activity_type not in ('email_sent','called_no_answer','voicemail_left','spoke_with_lead','awaiting_response','followup_scheduled','other') or length(trim(coalesce(p_notes,''))) not between 1 and 4000 then raise exception 'Invalid activity'; end if;
 update public.romylabs_booking_alerts set followup_status='contacted',contacted_at=now(),acknowledged_at=coalesce(acknowledged_at,now()),contact_outcome=replace(p_activity_type,'_',' ')||' — '||trim(p_notes),followup_due_at=coalesce(p_next_followup,followup_due_at) where booking_id=p_booking_id;
 if not found then raise exception 'Booking not accessible'; end if;
 insert into public.romylabs_booking_activities(booking_id,activity_type,notes) values(p_booking_id,p_activity_type,trim(p_notes));
end;$$;
revoke all on function public.romylabs_record_booking_activity(text,text,text,timestamptz) from public,anon;
grant execute on function public.romylabs_record_booking_activity(text,text,text,timestamptz) to authenticated;
