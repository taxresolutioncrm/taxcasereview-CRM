import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync('supabase/migrations/20261115194500_session_permission_change_and_stale_cleanup.sql','utf8')
for(const s of ['NEW.email IS DISTINCT FROM OLD.email','ROW(NEW.perm_leads','AFTER UPDATE OF status, tenant_id, portal_pin, email, access,','AFTER UPDATE OF deleted_at, tenant_id, ssn, email','DELETE FROM public.employee_portal_sessions','DELETE FROM public.portal_sessions','expires_at<=now()']){
 assert.ok(sql.includes(s),'Missing session invalidation scope '+s)
}
assert.ok(!/TRUNCATE|DELETE FROM public.clients|DELETE FROM public.leads|DELETE FROM public.employees/i.test(sql.replace(/^--.*$/gm,'')),'do not delete customer/employee records')
console.log('PASS: existing session tokens revoked on role, per-section permission and contact changes; stale sessions cleaned')
