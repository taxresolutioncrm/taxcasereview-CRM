alter table public.fax_logs
  add column if not exists pages integer;

comment on column public.fax_logs.pages is 'Number of pages reported by the fax provider for inbound or outbound fax documents.';
