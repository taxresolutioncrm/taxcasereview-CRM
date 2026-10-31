-- Dedicated per-booking lead task deadlines, without touching CRM tenant tasks.
alter table public.romylabs_booking_alerts
 add column if not exists followup_due_at timestamptz;
update public.romylabs_booking_alerts
 set followup_due_at = booked_at + interval '15 minutes'
 where followup_due_at is null;
alter table public.romylabs_booking_alerts
 alter column followup_due_at set default (now() + interval '15 minutes');
create index if not exists romylabs_booking_due_idx
 on public.romylabs_booking_alerts(followup_due_at)
 where followup_status <> 'completed';
