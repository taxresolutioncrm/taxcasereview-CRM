-- Preserve provider-level call termination details without changing the existing
-- outbound_calls.status contract used by the dialer UI.

alter table public.outbound_calls
  add column if not exists provider_status text,
  add column if not exists ended_at timestamptz,
  add column if not exists disconnect_source text,
  add column if not exists disconnect_initiator text,
  add column if not exists disconnect_reason text,
  add column if not exists disconnect_details jsonb not null default '{}'::jsonb,
  add column if not exists end_requested_at timestamptz,
  add column if not exists end_requested_by text;

comment on column public.outbound_calls.provider_status is
  'Raw terminal/lifecycle status reported by the telephony provider.';
comment on column public.outbound_calls.disconnect_source is
  'Best-known source of termination, e.g. admin_dialer, remote_or_provider, provider_failure.';
comment on column public.outbound_calls.disconnect_details is
  'Raw provider callback fields retained for post-call tracing.';
