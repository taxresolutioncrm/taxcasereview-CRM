const fs = require('fs')

const login = fs.readFileSync('src/pages/Login.jsx','utf8')
const migration = fs.readFileSync('supabase/migrations/20261014222000_login_branding_by_employee_domain.sql','utf8')
const centurion = fs.readFileSync('supabase/migrations/20261014225500_centurion_full_access_branding.sql','utf8')
const firmBranding = fs.readFileSync('src/lib/firmBranding.js','utf8')
const logo = fs.readFileSync('public/centurion-logo.svg','utf8')
const favicon = fs.readFileSync('public/centurion-favicon.svg','utf8')
const centurionBrand = fs.readFileSync('src/lib/centurionBrand.js','utf8')
const sidebar = fs.readFileSync('src/components/layout/Sidebar.jsx','utf8')
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
check(centurion.includes("plan_tier = 'enterprise'"), 'Centurion must unlock the enterprise evaluation surface')
check(centurion.includes("perm_leads = 3") && centurion.includes("perm_reports = 3") && centurion.includes("perm_settings = 3") && centurion.includes("perm_comms = 3"), 'Centurion Super Admin permissions must be Full Admin')
check(centurion.includes("https://taxrescrm.app/centurion-logo.svg"), 'Centurion must use the committed logo asset')
check(centurion.includes("https://taxrescrm.app/centurion-favicon.svg"), 'Centurion pre-auth branding must use dedicated favicon')
check(firmBranding.includes("CENTURION_TENANT") && firmBranding.includes("CENTURION_FAVICON"), 'authenticated shell must pin Centurion favicon')
check(logo.includes("data:image/png;base64,"), 'Centurion logo asset must be embedded')
check(favicon.includes("data:image/png;base64,"), 'Centurion favicon asset must be embedded')

if (failures.length) {
  console.error('Login branding guard FAILED')
  failures.forEach(x => console.error(' - ' + x))
  process.exit(1)
}
console.log('PASS pre-auth tenant logo/title/favicon branding guard')

check(centurionBrand.includes("CENTURION_LOGO_DATA_URL") && centurionBrand.includes("data:image/png;base64,"), 'Centurion runtime logo must be embedded as a PNG data URL')
check(centurionBrand.includes("CENTURION_FAVICON_DATA_URL"), 'Centurion runtime favicon must be embedded')
check(login.includes("CENTURION_LOGO_DATA_URL") && login.includes("CENTURION_FAVICON_DATA_URL"), 'pre-auth login must bypass external Centurion asset URLs')
check(sidebar.includes("CENTURION_LOGO_DATA_URL"), 'authenticated sidebar must use embedded Centurion logo')
check(sidebar.includes("onError={() =>"), 'sidebar logo must recover instead of showing a broken image icon')
