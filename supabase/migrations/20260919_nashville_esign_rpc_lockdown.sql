-- Nashville E-sign public RPC lockdown.
-- Public signing traffic now goes through the token-validating esign-archive-upload edge function.
revoke all on function public.esign_public_load(text,text) from public, anon, authenticated;
revoke all on function public.esign_public_mark_signed(text,text,text,text) from public, anon, authenticated;
revoke all on function public.esign_public_track_event(text,text,text,integer,text,text,jsonb) from public, anon, authenticated;

grant execute on function public.esign_public_load(text,text) to service_role;
grant execute on function public.esign_public_mark_signed(text,text,text,text) to service_role;
grant execute on function public.esign_public_track_event(text,text,text,integer,text,text,jsonb) to service_role;
