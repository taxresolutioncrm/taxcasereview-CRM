import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const migration=readFileSync('supabase/migrations/20261114051000_employee_portal_rpc_search_path_hardening.sql','utf8')
for (const name of ['emp_clients','emp_cases','emp_sms_threads']) {
  assert.ok(migration.includes('ALTER FUNCTION public.'+name+'(text) SET search_path = public, pg_temp;'), name+' must pin search_path')
}
assert.ok(!/CREATE OR REPLACE FUNCTION|DROP FUNCTION|REVOKE |GRANT /i.test(migration.replace(/^--.*$/gm,'')), 'Do not rewrite function bodies or alter grants')
console.log('PASS: three employee portal RPCs use pinned search_path with existing tokens and grants preserved')
