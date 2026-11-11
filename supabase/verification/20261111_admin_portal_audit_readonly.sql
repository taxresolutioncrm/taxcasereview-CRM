-- Read-only postflight for Admin Portal v3.2.94.
-- Run after controlled migration deployment; do not mutate client records.
select
  (select pg_get_functiondef('public.admin_delete_product_calendar_event(text,text)'::regprocedure)
       like '%c.product_id = p_product_id%') as calendar_delete_checks_product,
  (select has_function_privilege('anon','public.admin_delete_product_calendar_event(text,text)','EXECUTE')) as anon_can_delete_calendar,
  (select has_function_privilege('authenticated','public.admin_delete_product_calendar_event(text,text)','EXECUTE')) as signed_in_can_call_guarded_delete,
  (select has_function_privilege('anon','public.admin_update_support_ticket_status(uuid,text)','EXECUTE')) as anon_can_update_support,
  (select has_function_privilege('authenticated','public.admin_update_support_ticket_status(uuid,text)','EXECUTE')) as signed_in_can_call_guarded_support,
  (select has_function_privilege('anon','public.admin_taxres_crm_scope_metrics(uuid)','EXECUTE')) as anon_can_call_admin_metrics;

select c.relname,c.relrowsecurity as rls_enabled,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  has_table_privilege('anon',c.oid,'INSERT') as anon_insert,
  has_table_privilege('authenticated',c.oid,'SELECT') as staff_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('call_logs','fax_logs','support_tickets')
order by c.relname;

select count(*) as marketing_ga4_traffic_rows from public.marketing_ga4_traffic
where product_id='romylabs' and date >= current_date - 31;
select count(*) as preserved_calendar_event_count from public.calevents;
select count(*) as preserved_support_ticket_count from public.support_tickets;
