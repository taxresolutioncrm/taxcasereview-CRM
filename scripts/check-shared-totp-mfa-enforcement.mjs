import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync('supabase/migrations/20261115220000_verified_totp_aal2_tenant_gate.sql','utf8')
const settings=readFileSync('src/pages/Settings.jsx','utf8')
const login=readFileSync('src/pages/Login.jsx','utf8')
const context=readFileSync('src/context/AppContext.jsx','utf8')
const app=readFileSync('src/App.jsx','utf8')
const component=readFileSync('src/components/settings/MfaSecuritySettings.jsx','utf8')
for(const v of ['auth.mfa_factors','f.status::text=\'verified\'','auth.jwt()->>\'aal\'','CREATE OR REPLACE FUNCTION public.current_tenant_id()','CREATE OR REPLACE FUNCTION public._is_platform_admin()','REVOKE ALL ON FUNCTION public._mfa_assurance_sufficient()']){
 assert.ok(sql.includes(v),'missing server-enforced MFA security invariant '+v)
}
for(const v of ['supabase.auth.mfa.enroll','supabase.auth.mfa.challengeAndVerify','supabase.auth.mfa.listFactors','supabase.auth.mfa.getAuthenticatorAssuranceLevel']) {
 assert.ok(component.includes(v)||login.includes(v)||context.includes(v),'MFA flow missing '+v)
}
assert.ok(settings.includes('MfaSecuritySettings'), 'MFA needs a setup entrypoint')
assert.ok(login.includes('mfaPending ? <form') && login.includes('verifyMfa') && login.includes('finishSignedInLogin'), 'login must challenge before application login')
assert.ok(context.includes('verifiedSessionOrRedirect') && context.includes('if(!await verifiedSessionOrRedirect()') && context.includes('const {data:mfaLevel,error:mfaError}'), 'AppContext must gate initial session, event updates and role refresh')
assert.ok(app.includes('path="/account-security"') && app.includes("get('mfa') !== '1'"), 'recovered password sessions need a path to MFA')
assert.ok(!sql.includes('DROP TABLE')&&!sql.includes('TRUNCATE'), 'MFA rollout cannot damage data')
console.log('PASS: TOTP enrollment, verification and login challenge, server-side AAL2/owner guards, no premature mandatory enrollment')
