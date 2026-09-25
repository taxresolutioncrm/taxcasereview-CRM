-- One filed copy per PDF per office.
--
-- Every transcript the CRM files records the SHA-256 of its PDF bytes in raw_analysis.file_sha256
-- (helper, watched folder, drag-and-drop, "File It", and the IRS Portal manual upload all go through
-- storeTranscriptAnalysis). The app already refuses a PDF that is already filed in the office; this
-- unique index is the database backstop for two reps filing the same PDF at the same moment.
--
-- Safe to run more than once. Nothing is deleted:
--   * if an office already has more than one row with the same fingerprint, the EARLIEST row keeps it;
--     each later copy keeps its record but its fingerprint moves to raw_analysis.duplicate_file_sha256
--     with raw_analysis.duplicate_of_analysis_id pointing at the row that was kept;
--   * rows filed before fingerprints existed have no file_sha256 and are not affected.
-- Whether to delete any marked copies is a separate decision; this migration never does it.

begin;

do $$
declare
  v_type text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'transcript_analyses' and column_name = 'raw_analysis';
  if v_type is null then
    raise exception 'transcript_analyses.raw_analysis not found — stopping, nothing changed';
  end if;
  if v_type <> 'jsonb' then
    raise exception 'transcript_analyses.raw_analysis is %, expected jsonb — stopping, nothing changed', v_type;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transcript_analyses' and column_name = 'tenant_id') then
    raise exception 'transcript_analyses.tenant_id not found — stopping, nothing changed';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transcript_analyses' and column_name = 'created_at') then
    raise exception 'transcript_analyses.created_at not found — stopping, nothing changed';
  end if;
end $$;

-- Reconcile existing duplicates (same office + same PDF fingerprint) without deleting anything.
with ranked as (
  select id,
         raw_analysis->>'file_sha256' as sha,
         first_value(id) over w as keep_id,
         row_number()   over w as rn
  from public.transcript_analyses
  where coalesce(raw_analysis->>'file_sha256', '') <> ''
  window w as (partition by tenant_id, raw_analysis->>'file_sha256' order by created_at asc nulls last, id asc)
)
update public.transcript_analyses t
set raw_analysis = (t.raw_analysis - 'file_sha256')
                   || jsonb_build_object('duplicate_file_sha256', r.sha, 'duplicate_of_analysis_id', r.keep_id::text)
from ranked r
where t.id = r.id and r.rn > 1;

-- The backstop: one row per office per PDF fingerprint.
create unique index if not exists transcript_analyses_tenant_pdf_sha256_uniq
  on public.transcript_analyses (tenant_id, (raw_analysis->>'file_sha256'))
  where raw_analysis->>'file_sha256' is not null;

commit;
