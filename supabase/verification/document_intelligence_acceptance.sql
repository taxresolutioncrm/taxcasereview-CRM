-- Read-only post-deploy verification for RomyLabs Document Intelligence.
-- Run after a synthetic acceptance document has been analyzed.

select
  to_regclass('public.document_ai_runs') is not null as runs_table_exists,
  to_regclass('public.document_ai_facts') is not null as facts_table_exists,
  to_regclass('public.document_ai_entities') is not null as entities_table_exists,
  to_regclass('public.document_ai_questions') is not null as questions_table_exists;

select tablename, rowsecurity
from pg_tables
where schemaname='public'
  and tablename in ('document_ai_runs','document_ai_facts','document_ai_entities','document_ai_questions')
order by tablename;

select tablename, policyname, roles, cmd
from pg_policies
where schemaname='public'
  and tablename in ('document_ai_runs','document_ai_facts','document_ai_entities','document_ai_questions')
order by tablename, policyname;

-- A passing result returns zero rows. AI-derived storage must not contain
-- full SSN-like or EIN-like values after server-side persistence sanitization.
select 'facts' as source, id::text, coalesce(normalized_text,'') || ' ' || coalesce(source_excerpt,'') || ' ' || coalesce(value_json::text,'') as leaked_value
from public.document_ai_facts
where (
  coalesce(normalized_text,'') || ' ' || coalesce(source_excerpt,'') || ' ' || coalesce(value_json::text,'')
) ~ '\\m[0-9]{3}-?[0-9]{2}-?[0-9]{4}\\M'
union all
select 'entities', id::text, coalesce(identifiers::text,'') || ' ' || coalesce(attributes::text,'')
from public.document_ai_entities
where (
  coalesce(identifiers::text,'') || ' ' || coalesce(attributes::text,'')
) ~ '\\m[0-9]{3}-?[0-9]{2}-?[0-9]{4}\\M';

-- Current-state overview must only count the latest successful run per document.
-- Replace the parameter with the synthetic test client's id after deployment:
-- select public.document_ai_client_overview('<client-id>');
