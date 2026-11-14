-- Security closeout: the public signer accesses documents exclusively through
-- token-validated esign-archive-upload / public-signer Edge Functions.
-- Legacy ID-only RPCs lack signer-token validation; direct anon/authenticated
-- invocation must not be possible. Keep service_role access for server-side
-- finalize/archive flows and preserve triggers, data, and existing documents.
-- No table or data changes.
REVOKE ALL ON FUNCTION public.esign_load(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_mark_signed(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_track_event(text,text,integer,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_finalize(text,text,text,text,text,timestamptz,text,text,jsonb,bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.esign_load(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_mark_signed(text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_track_event(text,text,integer,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_finalize(text,text,text,text,text,timestamptz,text,text,jsonb,bigint) TO service_role;
