-- Remove direct anonymous execution from Nashville/internal CRM RPCs.
revoke all on function public.create_book_whip_month(date) from public, anon;
grant execute on function public.create_book_whip_month(date) to authenticated;

revoke all on function public.get_sidebar_badge_counts() from public, anon;
grant execute on function public.get_sidebar_badge_counts() to authenticated;

revoke all on function public.reports_overview_snapshot(date) from public, anon;
grant execute on function public.reports_overview_snapshot(date) to authenticated;

revoke all on function public.nashville_book_whip_client_upsert() from public, anon, authenticated;
