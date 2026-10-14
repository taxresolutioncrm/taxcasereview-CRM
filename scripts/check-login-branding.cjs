const fs = require('fs')

const login = fs.readFileSync('src/pages/Login.jsx','utf8')
const migration = fs.readFileSync('supabase/migrations/20261014222000_login_branding_by_employee_domain.sql','utf8')
const failures = []
const check = (ok, msg) => { if (!ok) failures.push(msg) }

check(login.includes("applyLoginBrowserBranding"), 'login must apply browser branding before auth')
check(login.includes("data.favicon_url || data.logo_url"), 'login must prefer tenant favicon/logo')
check(login.includes("logo_url: data.logo_url || data.favicon_url || null"), 'login must use favicon as visible brand fallback')
check(login.includes("document.title = branding.firm_name + ' CRM'"), 'login must update browser title for tenant')
check(login.includes("apple.setAttribute('href', href)"), 'login must update apple touch icon')
check(migration.includes("FROM public.employees e"), 'branding RPC must resolve tenant from employee login domain')
check(migration.includes("split_part(coalesce(e.email,''),'@',2)"), 'branding RPC must match employee email domain')
check(migration.includes("'favicon_url'"), 'branding RPC must return favicon URL')
check(migration.includes("regexp_replace(trim(s.website), '/+$', '') || '/favicon.ico'"), 'branding RPC must derive tenant site favicon when no uploaded logo exists')
check(migration.includes("lower(coalesce(t.status,'')) IN ('active','trial')"), 'branding RPC must only expose active/trial tenants')

if (failures.length) {
  console.error('Login branding guard FAILED')
  failures.forEach(x => console.error(' - ' + x))
  process.exit(1)
}
console.log('PASS pre-auth tenant logo/title/favicon branding guard')
