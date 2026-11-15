-- Fix rate-limit bookkeeping lost to PostgreSQL exception/statement rollback.
-- Original login functions called _public_auth_fail() then RAISE EXCEPTION,
-- so the rate-limit INSERT was rolled back and a PIN could be guessed repeatedly.
-- Return a generic unsuccessful response instead, committing the counter.
-- Success/auth/session paths remain unchanged. No table, tenant, data or grant edits.
DO $patch$
DECLARE
  item record;
  v_definition text;
  v_matches integer;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      (
        'public.emp_login_unchecked(text,text)',
        $old1$perform public._public_auth_fail('employee_portal',v_key); raise exception 'Email or PIN is incorrect.';$old1$,
        $new1$perform public._public_auth_fail('employee_portal',v_key); return json_build_object('error','Email or PIN is incorrect.');$new1$,
        1
      ),
      (
        'public.kiosk_login_unchecked(text,text,text)',
        $old2$perform public._public_auth_fail('kiosk',v_key); raise exception 'Employee or PIN is incorrect.';$old2$,
        $new2$perform public._public_auth_fail('kiosk',v_key); return json_build_object('error','Employee or PIN is incorrect.');$new2$,
        1
      ),
      (
        'public.portal_login_unchecked(text,text,text)',
        $old3$perform public._public_auth_fail('client_portal',v_key); raise exception 'That information doesn''t match what we have on file. Contact your representative if you need help accessing your portal.';$old3$,
        $new3$perform public._public_auth_fail('client_portal',v_key); return;$new3$,
        3
      )
    ) AS items(signature, unsafe_error, safe_return, expected_occurrences)
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(item.signature)) INTO v_definition;
    IF v_definition IS NULL THEN RAISE EXCEPTION 'Missing login RPC %', item.signature; END IF;
    v_matches := (length(v_definition)-length(replace(v_definition,item.unsafe_error,'')))/length(item.unsafe_error);
    IF v_matches<>item.expected_occurrences THEN
      RAISE EXCEPTION 'Unexpected % source pattern count: % (expected %)',item.signature,v_matches,item.expected_occurrences;
    END IF;
    EXECUTE replace(v_definition,item.unsafe_error,item.safe_return);
    SELECT pg_get_functiondef(to_regprocedure(item.signature)) INTO v_definition;
    IF position(item.unsafe_error IN v_definition)>0 OR position(item.safe_return IN v_definition)=0 THEN
      RAISE EXCEPTION 'RPC authentication patch verification failed: %',item.signature;
    END IF;
  END LOOP;
END
$patch$;
