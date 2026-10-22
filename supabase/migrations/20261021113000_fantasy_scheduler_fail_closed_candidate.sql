-- SANDBOX ONLY. FOOTBALL ONLY. Hockey behavior is intentionally unchanged.
create or replace function public.run_fantasy_daily_if_due()
returns text language plpgsql security definer set search_path=public,extensions as $$
declare
  dow integer := extract(isodow from now() at time zone 'America/New_York');
  hr integer := extract(hour from now() at time zone 'America/New_York');
  d date := (now() at time zone 'America/New_York')::date;
  kind text;
  gate jsonb;
  result jsonb;
begin
  if dow=6 then return 'skip_saturday'; end if;
  if hr not in (8,9) then return 'skip_hour'; end if;
  kind := case when dow in (2,4,7) then 'football' else 'hockey' end;
  if exists(select 1 from public.fantasy_scheduler_success where run_date=d)
    then return 'already_sent'; end if;

  if kind='football' then
    gate := public.fantasy_source_gate('football');
    if coalesce((gate->>'ok')::boolean,false) is not true then
      return 'football_blocked_source_validation:' || left(gate::text,160);
    end if;
    -- Legacy football generator lacks sourced expert research. Do not send it.
    return 'football_blocked_missing_expert_research_and_render_validation';
  end if;

  -- Preserve the ORIGINAL hockey scheduler behavior verbatim.
  begin
    result := public.send_fantasy_hockey_report();
    if coalesce((result->>'success')::boolean,false) then
      insert into public.fantasy_scheduler_success(run_date,report_type,http_status)
      values(d,'hockey',coalesce((result->>'http_status')::int,200))
      on conflict (run_date) do nothing;
      return 'sent_hockey';
    end if;
    return 'send_failed_' || coalesce(result->>'http_status','unknown');
  exception when others then
    return 'error_' || left(sqlerrm,180);
  end;
end $$;
-- Candidate only: no production deployment. Football content generation still needs full implementation.
