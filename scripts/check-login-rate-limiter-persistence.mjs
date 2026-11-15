import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync('supabase/migrations/20261115012500_public_login_failure_counters_persist.sql','utf8')
const emp=readFileSync('src/pages/EmployeePortal.jsx','utf8')
const kiosk=readFileSync('src/pages/ClockIn.jsx','utf8')
const portal=readFileSync('src/pages/ClientPortal.jsx','utf8')
for(const signature of ['emp_login_unchecked(text,text)','kiosk_login_unchecked(text,text,text)','portal_login_unchecked(text,text,text)'])
  assert.ok(sql.includes('public.'+signature),'all public login branches must persist counters')
for(const fragment of [
  "perform public._public_auth_fail('employee_portal',v_key); return json_build_object('error'",
  "perform public._public_auth_fail('kiosk',v_key); return json_build_object('error'",
  "perform public._public_auth_fail('client_portal',v_key); return;",
  'expected_occurrences'
])assert.ok(sql.includes(fragment),'missing safe failed-login behavior '+fragment)
assert.ok(emp.includes('if (error || !data?.token)'),'employee UI must treat returned error JSON as failed sign-in')
assert.ok(kiosk.includes('if(error||!data?.token)'),'time-clock UI must reject returned error JSON')
assert.ok(portal.includes('if (error || !row?.token)'),'client portal must reject zero-row sign-ins')
assert.ok(!/ALTER TABLE|TRUNCATE|DROP TABLE|GRANT |REVOKE /i.test(sql.replace(/^--.*$/gm,'')),'migration must not mutate tables or function permissions')
console.log('PASS: employee, kiosk and client portal logins now commit failure counters without weakening successful authentication')
