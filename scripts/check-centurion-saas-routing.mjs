import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SHARED_SAAS_PROJECT_HOST, CENTURION_CRM_HOST, centurionBackendMismatch } from '../src/lib/sharedSaasRouting.js'

const shared = 'https://' + SHARED_SAAS_PROJECT_HOST
assert.equal(centurionBackendMismatch(CENTURION_CRM_HOST, shared), false, 'Centurion must accept the shared Supabase SaaS backend')
assert.equal(centurionBackendMismatch(CENTURION_CRM_HOST.toUpperCase(), shared), false, 'hostname matching should be case-insensitive')
assert.equal(centurionBackendMismatch(CENTURION_CRM_HOST, 'https://rkniemzmivnuhpdwkduc.supabase.co'), true, 'retired dedicated database must be rejected')
assert.equal(centurionBackendMismatch(CENTURION_CRM_HOST, 'https://unrelated-project.supabase.co'), true, 'unrelated backend must be rejected')
assert.equal(centurionBackendMismatch(CENTURION_CRM_HOST, 'http://' + SHARED_SAAS_PROJECT_HOST), true, 'backend must use HTTPS')
assert.equal(centurionBackendMismatch(CENTURION_CRM_HOST, 'bad-url'), true, 'malformed backend must fail closed')
assert.equal(centurionBackendMismatch('taxrescrm.app', shared), false, 'TaxRes must retain its normal login')
assert.equal(centurionBackendMismatch('tcr.taxrescrm.app', shared), false, 'TCR must retain its normal login')
assert.equal(centurionBackendMismatch('nashville.taxrescrm.app', shared), false, 'Nashville routing must not be changed here')

const login = fs.readFileSync('src/pages/Login.jsx', 'utf8')
const app = fs.readFileSync('src/App.jsx','utf8')
const client = fs.readFileSync('src/lib/supabase.js', 'utf8')
const release = fs.readFileSync('src/releaseInfo.js','utf8')
assert(login.includes("isCenturionBackendMismatch(window.location.hostname, SUPABASE_URL)"), 'Login must enforce shared SaaS connection on branded host')
assert(login.includes("isCentralTaxResHost() && isNashvilleIdentity(email)"), 'Nashville must still redirect away from central app')
assert(!login.includes('window.location.replace(CENTURION_LOGIN)'), 'Centurion staff must authenticate in-place against shared project')
assert(!login.includes("const CENTURION_LOGIN ="), 'Deleted-project era cross-host login redirect must not return')
assert(login.includes('if (isCenturionHost || domain === CENTURION_LOGIN_DOMAIN || isCenturionIdentity(email))'), 'Centurion branded hostname must render before email input')
assert(login.includes('const isCenturionBrand = isCenturionHost'), 'Centurion logo must not rely on autofill')
assert(login.includes('isCentralTaxResHost() && isNashvilleIdentity(target)'), 'Nashville reset must still route to Nashville')
assert(login.includes('supabase.auth.resetPasswordForEmail(target'), 'Password reset must still use configured shared Supabase client')
assert(login.includes('signInWithRecovery(email.trim(), password'), 'Existing recovery and password handlers must stay')
assert(app.includes("const NASHVILLE_LOGIN_URL = 'https://nashville.taxrescrm.app/login?switch=1'"), 'Independent Nashville login boundary must stay')
assert(client.includes("VITE_SUPABASE_URL || 'https://mpxgxfqdbquzkrvvejkh.supabase.co'"), 'Shared TaxRes/TCR/Centurion default client must stay pinned to common project')
assert(!login.includes('rkniemzmivnuhpdwkduc'), 'Deleted Centurion Supabase project cannot remain in runtime')
assert(release.includes('Centurion sign-in and password recovery use the shared TaxRes/TCR/Centurion SaaS project'), 'Release notes must not claim separate Centurion backend')
console.log('PASS SaaS: Centurion shared Auth with fail-closed wrong-project guard; TCR/TaxRes and Nashville boundaries preserved')
