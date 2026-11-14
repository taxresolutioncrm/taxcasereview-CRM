-- Scoped Supabase Security Advisor closeout (function_search_path_mutable).
-- All 13 functions were verified live as SECURITY INVOKER (not DEFINER).
-- ALTER FUNCTION modifies only configuration, not bodies, grants or ownership.
-- Explicit schema resolution retains public objects and puts pg_temp last.
ALTER FUNCTION public._employee_note_content_is_editable(text,text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fantasy_card(text,text,boolean,boolean) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_available_card(jsonb,text[]) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_churn_candidates(jsonb,integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_injury_block(jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_roster_line(jsonb,boolean) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.ff_top_waivers(jsonb,integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.hockey_churn_candidates(jsonb,integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.hockey_injury_block(jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.hockey_roster_group(jsonb,integer[]) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.hockey_waiver_block(jsonb,integer[],integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.prevent_romylabs_esign_event_mutation() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.taxres_standard_plan_rate(text) SET search_path = pg_catalog, public, pg_temp;
