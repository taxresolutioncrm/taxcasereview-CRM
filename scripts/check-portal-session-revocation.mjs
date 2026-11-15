import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const migration=readFileSync('supabase/migrations/20261115171500_revoke_portal_sessions_on_deactivation.sql','utf8')
for(const [table,trigger] of [['employees','security_employee_session_revoke'],['clients','security_client_session_revoke'],['leads','security_lead_session_revoke'],['tenants','security_tenant_session_revoke']]){
 assert.ok(migration.includes('CREATE TRIGGER '+trigger),'missing '+table+' revocation trigger')
 assert.ok(migration.includes('ON public.'+table),'wrong '+table+' target')
}
for(const guard of ['NEW.portal_pin IS DISTINCT FROM OLD.portal_pin','NEW.ssn IS DISTINCT FROM OLD.ssn','OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL',"lower(coalesce(NEW.status,'')) NOT IN ('active','trial')"]){
 assert.ok(migration.includes(guard),'missing session revocation guard: '+guard)
}
assert.ok(migration.includes('DELETE FROM public.employee_portal_sessions'))
assert.ok(migration.includes('DELETE FROM public.portal_sessions'))
assert.ok(migration.includes('SET search_path = pg_catalog, public, pg_temp'))
assert.ok(migration.includes('REVOKE ALL ON FUNCTION public._revoke_portal_sessions_on_identity_change()'))
assert.ok(!/(DROP TABLE|TRUNCATE TABLE|DELETE FROM public.clients|DELETE FROM public.leads|DELETE FROM public.employees)/i.test(migration.replace(/^--.*$/gm,'')),'never delete customer/employee records')
console.log('PASS: session revocation triggers cover deactivation, deletion, tenant suspension and credential changes; no customer deletes')
