-- Security closeout: public portal documents must only be uploaded by
-- the token-checked, MIME/size-validated portal-action Edge Function.
-- The legacy RPC accepts a user-supplied file URL and is no longer called
-- by the frontend or portal-action. No schema/data/function-body changes.
REVOKE ALL ON FUNCTION public.portal_action_upload_document(text,text,text,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_action_upload_document(text,text,text,text,bigint) TO service_role;
