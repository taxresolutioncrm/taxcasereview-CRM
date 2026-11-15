-- Final SSN-last-four portal authentication shutdown.
-- Apply ONLY after v3.2.136 email-code UI is present on TCR, TaxRes and
-- Centurion and real outbound code delivery has been confirmed.
-- Portal data, documents, payment functions, staff Auth and RLS unchanged.
REVOKE ALL ON FUNCTION public.portal_login(text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_login_unchecked(text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_login(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_login_unchecked(text,text,text) TO service_role;

-- Reject reuse of any weak older portal sessions after SSN credential retirement.
-- New email-code login can immediately issue a fresh, independently verified
-- 12-hour opaque session. This touches only portal_sessions, never client data.
DELETE FROM public.portal_sessions WHERE created_at <= now();
