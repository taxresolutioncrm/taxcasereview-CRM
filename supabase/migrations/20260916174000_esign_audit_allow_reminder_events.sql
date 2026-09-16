-- Allow automatic reminder delivery to appear in the legacy signing audit trail.
alter table public.esign_audit_events
  drop constraint if exists esign_audit_events_event_type_check;
alter table public.esign_audit_events
  add constraint esign_audit_events_event_type_check
  check (event_type = any(array[
    'opened','reopened','view_25','view_50','view_75','view_90',
    'identity_started','signature_started','signing_started',
    'signed','completed','declined','voided','reminder_sent'
  ]::text[]));
