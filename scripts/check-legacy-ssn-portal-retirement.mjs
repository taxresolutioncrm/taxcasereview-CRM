import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync('supabase/migrations/20261115080000_retire_legacy_ssn_portal_login.sql','utf8')
const oldEndpoint=readFileSync('supabase/functions/portal-login/index.ts','utf8')
const newEndpoint=readFileSync('supabase/functions/portal-email-login/index.ts','utf8')
const portal=readFileSync('src/pages/ClientPortal.jsx','utf8')
for(const rpc of ['portal_login(text,text,text)','portal_login_unchecked(text,text,text)']){
 assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.'+rpc),'legacy SSN function public grants must be revoked')
 assert.ok(sql.includes('TO service_role;'),'server grants must be retained')
}
assert.ok(sql.includes('DELETE FROM public.portal_sessions WHERE created_at <= now();'),'previously issued weak credentials must be invalidated')
assert.ok(oldEndpoint.includes('status:410'),'deprecated endpoint must always return HTTP 410')
assert.ok(!oldEndpoint.includes('SUPABASE_SERVICE_ROLE_KEY')&&!oldEndpoint.includes('from(\'clients\')')&&!oldEndpoint.includes('ssn'),'retired endpoint must not access private data or SSNs')
assert.ok(newEndpoint.includes('portal_email_code_verify'),'replacement login must validate server-issued code')
assert.ok(portal.includes("functions.invoke('portal-email-login'"),'client browser must use new code flow')
assert.ok(!portal.includes("rpc('portal_login'")&&!portal.includes('Last 4 Digits of SSN'),'SSN login must not remain in frontend')
console.log('PASS: legacy SSN login revoked, old endpoint 410, old sessions invalidated; new email proof maintained')
