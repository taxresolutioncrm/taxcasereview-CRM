import fs from 'node:fs'

const read=p=>fs.readFileSync(p,'utf8')
const app=read('src/App.jsx')
const ctx=read('src/context/AppContext.jsx')
const page=read('src/pages/FamilyPassword.jsx')
const issue=read('supabase/functions/taxres-family-sso-issue/index.ts')
const redeem=read('supabase/functions/taxres-family-sso-redeem/index.ts')
const invite=read('supabase/functions/taxres-family-admin-invite/index.ts')
const nashProof=read('supabase/functions/taxres-family-admin-proof/index.ts')
const nashAccess=read('supabase/functions/employee-access-link/index.ts')
const migration=read('supabase/migrations/20260918221000_taxres_family_sso.sql')
const config=read('supabase/config.toml')
const employees=read('src/pages/Employees.jsx')
const inviteEmployee=read('supabase/functions/invite-employee/index.ts')

const checks=[
  ['family password route is public',app.includes('path="/family-password"')&&app.includes("'/family-password'")],
  ['family password page verifies invite/recovery token',page.includes('verifyOtp({token_hash:tokenHash,type})')],
  ['family password requires 10 characters',page.includes('password.length<10')],
  ['password recovery stays on family page',ctx.includes("window.location.pathname === '/family-password'")],
  ['SSO codes are private and RLS protected',migration.includes('taxres_family_sso_codes')&&migration.includes('enable row level security')&&migration.includes('revoke all')],
  ['SSO issue requires authenticated TaxRes session',issue.includes("Authentication required")&&issue.includes('code_challenge')],
  ['SSO issue expires codes quickly',issue.includes('2*60*1000')],
  ['SSO redeem requires verifier and consumes once',redeem.includes('code_verifier')&&redeem.includes("is('consumed_at',null)")],
  ['Nashville invite validates Nashville admin',invite.includes('taxres-family-admin-proof')&&invite.includes('Nashville Admin verification failed')],
  ['Nashville access validates the exact bearer token',nashAccess.includes('auth.getUser(token)')],
  ['Nashville admin proof validates the exact bearer token',nashProof.includes('auth.getUser(token)')],
  ['Nashville invite points to family password page',invite.includes("PASSWORD_PAGE='https://taxrescrm.app/family-password'")],
  ['config enables JWT on issue',config.includes('[functions.taxres-family-sso-issue]\nverify_jwt = true')],
  ['custom-code endpoints keep gateway JWT off',config.includes('[functions.taxres-family-sso-redeem]\nverify_jwt = false')&&config.includes('[functions.taxres-family-admin-invite]')],
  ['central employee invite requires authenticated caller',config.includes('[functions.invite-employee]\nverify_jwt = true')&&inviteEmployee.includes('Employee invite permission denied')],
  ['central employee invite validates the exact bearer token',inviteEmployee.includes('auth.getUser(token)')],
  ['central employee invite does not call .catch on Supabase RPC',!inviteEmployee.includes("rpc('_is_platform_admin').catch")],
  ['central recovery links use the supported generateLink payload',inviteEmployee.includes("{ type:'recovery', email }")&&!inviteEmployee.includes("generateLink({type:kind,email,options})")],
  ['platform admin invite path remains tenant scoped',inviteEmployee.includes("rpc('_is_platform_admin')")&&inviteEmployee.includes("rpc('current_tenant_id')")],
  ['central employee invite uses family password flow',inviteEmployee.includes("FAMILY_PASSWORD_PAGE='https://taxrescrm.app/family-password'")&&inviteEmployee.includes('admin.auth.admin.generateLink')],
  ['central employee invite uses office CRM mail transport',inviteEmployee.includes('/functions/v1/send-email')&&inviteEmployee.includes("delivery:'email'")],
  ['central employee invite preserves secure fallback link',inviteEmployee.includes("delivery:'manual'")&&inviteEmployee.includes('access_link:accessLink')],
  ['Nashville UI uses family access bridge',employees.includes("functionName = isNashville ? 'employee-access-link' : 'invite-employee'")],
]
let failed=0
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)failed++}
if(failed){console.error(`TaxRes family auth contract failed: ${failed} check(s)`);process.exit(1)}
console.log('PASS  TaxRes family auth source contract')
