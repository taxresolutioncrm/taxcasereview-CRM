-- Sandbox-only candidate. Do not apply to production without explicit "deploy".
-- Fail closed when source data is stale, incomplete, or misaligned with the current ESPN week.
create or replace function public.fantasy_source_gate(p_kind text)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare v_bad text[]:=array[]::text[]; v_count integer; v_week integer; v_at timestamptz; v_meta_at timestamptz; v_roster jsonb; v_id text;
begin
 if p_kind <> 'football' then return jsonb_build_object('ok',false,'reason','hockey_live_data_and_research_gate_not_implemented'); end if;
 foreach v_id in array array['342460','377176'] loop
   select s.captured_at,s.roster,m.current_matchup_period,m.refreshed_at
   into v_at,v_roster,v_week,v_meta_at
   from public.fantasy_live_snapshots s left join public.fantasy_league_meta m on m.league_id=s.league_id
   where s.league_id=v_id;
   if v_at is null or v_at < now()-interval '45 minutes' then v_bad:=array_append(v_bad,v_id||':stale_roster'); end if;
   if v_meta_at is null or v_meta_at < now()-interval '45 minutes' then v_bad:=array_append(v_bad,v_id||':stale_week'); end if;
   if jsonb_typeof(v_roster->'roster') <> 'array' then v_bad:=array_append(v_bad,v_id||':missing_roster');
   else
     v_count:=jsonb_array_length(v_roster->'roster');
     if v_count<8 then v_bad:=array_append(v_bad,v_id||':incomplete_roster'); end if;
   end if;
   if v_week is null or v_week < 1 then v_bad:=array_append(v_bad,v_id||':invalid_week'); end if;
 end loop;
 return jsonb_build_object('ok',cardinality(v_bad)=0,'failures',to_jsonb(v_bad));
end $$;
-- NOTE: Freshness alone cannot prove ESPN-week alignment or research quality.
-- This gate is intentionally insufficient for production: also require current ESPN
-- matchup period, player/slot reconciliation, dated analyst-source coverage and
-- rendered HTML acceptance before enabling sends.