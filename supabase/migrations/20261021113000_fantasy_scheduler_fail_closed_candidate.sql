-- SANDBOX ONLY: replace the report scheduler with fail-closed validation.
-- Prevent HTTP 200 from being interpreted as a content-quality PASS.
-- Do not deploy until an actual ESPN refresh + expert analysis pipeline exists.
create or replace function public.run_fantasy_daily_if_due()
returns text language plpgsql security definer set search_path=public,extensions as $$
declare
  dow int := extract(isodow from now() at time zone 'America/New_York');
  hr int := extract(hour from now() at time zone 'America/New_York');
  d date := (now() at time zone 'America/New_York')::date;
  kind text;
  gate jsonb;
  result jsonb;
begin
  if dow=6 then return 'skip_saturday'; end if;
  if hr not in (8,9) then return 'skip_hour'; end if;
  kind := case when dow in (2,4,7) then 'football' else 'hockey' end;
  if exists(select 1 from public.fantasy_scheduler_success where run_date=d and report_type=kind)
    then return 'already_sent'; end if;
  gate := public.fantasy_source_gate(kind);
  if coalesce((gate->>'ok')::boolean,false) is not true then
    return 'blocked_source_validation:' || left(gate::text,160);
  end if;
  -- Even with fresh data, the legacy generator has no researched expert analysis.
  -- Fail closed until full expert-content and render validations are implemented.
  return 'blocked_missing_expert_research_and_render_validation';
end $$;

-- Acceptance check (sandbox): stale snapshots must return ok=false.
-- select public.fantasy_source_gate('football');
-- select public.fantasy_source_gate('hockey');
-- Do not mark scheduler success for a blocked report.
