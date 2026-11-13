import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  defaultDepartments, normalizeDepartments, departmentForPath,
  isRouteInDepartments, isNavigationVisible, isHrFeatureEnabled, normalizeHrFeatures, workspaceLabel, CENTURION_TENANT_ID, NASHVILLE_TENANT_ID
} from '../src/lib/departmentWorkspaces.js'
const all=['resolution','preparation','bookkeeping','formation','hr']
const tcr='61a89aef-0e7e-4ea2-b222-44ab2024655a'
const taxres='a0000000-0000-0000-0000-000000000001'
assert.deepEqual(defaultDepartments(CENTURION_TENANT_ID),['resolution'])
for (const tenant of [tcr,taxres,NASHVILLE_TENANT_ID]) assert.deepEqual(defaultDepartments(tenant),all)
assert.deepEqual(normalizeDepartments(['resolution','unknown','resolution']),['resolution'])
assert.equal(workspaceLabel(['resolution']),'Tax Resolution')
assert.equal(isNavigationVisible('/books',['resolution']),false)
assert.equal(isNavigationVisible('/training',['resolution']),false)
assert.equal(isNavigationVisible('/cases',['resolution']),true)
assert.equal(isNavigationVisible('/training',all),true)
assert.equal(isNavigationVisible('/timeclock',all,['time_tracking']),true)
assert.equal(isNavigationVisible('/payroll',all,['time_tracking']),false)
assert.equal(isNavigationVisible('/payroll',all,['payroll']),true)
assert.equal(isNavigationVisible('/timeclock',['resolution']),false)
assert.equal(isRouteInDepartments('/timeclock',['resolution','hr'],['payroll']),false)
assert.equal(isRouteInDepartments('/payroll',['resolution','hr'],['time_tracking']),false)
assert.equal(isHrFeatureEnabled('/payroll',['payroll']),true)
assert.deepEqual(normalizeHrFeatures(['payroll','invalid']),['payroll'])
for (const route of ['/cases','/cases/123','/irsforms','/irsportal','/deadlines','/stateforms','/irsreference','/ai-government-calls']) {
  assert.equal(departmentForPath(route),'resolution',route)
  assert.ok(isRouteInDepartments(route,['resolution']),route)
}
for(const route of ['/taxreturns','/taxreturns/42','/books','/formacorp']) {
  assert.equal(isRouteInDepartments(route,['resolution']),false,route)
  assert.equal(isRouteInDepartments(route,all),true,route)
}
for(const route of ['/clients/123','/leads','/email','/sms','/fax','/documents','/tasks','/invoices','/payments','/calendar','/settings']) {
  assert.equal(isRouteInDepartments(route,['resolution']),true,route)
}
const read=p=>fs.readFileSync(p,'utf8')
const sidebar=read('src/components/layout/Sidebar.jsx')
const app=read('src/App.jsx')
const dashboard=read('src/pages/Dashboard.jsx')
const reports=read('src/pages/Reports.jsx')
assert.ok(reports.includes('useOfficeWorkspace(myTenantId || FIRM.tenantId)'), 'Reports must use selected office departments')
assert.ok(reports.includes('visibleTabs.map(t=>'), 'Reports tabs must follow enabled departments')
for(const pair of ["taxreturns:'preparation'","formacorp:'formation'","books:'bookkeeping'","cases:'resolution'"]) assert.ok(reports.includes(pair), 'Missing Reports department mapping: '+pair)
assert.ok(reports.includes("officeDepartments.includes('preparation') &&"), 'Tax Return overview KPI must be conditional')
assert.ok(reports.includes("officeDepartments.includes('formation') ?"), 'Formation summary must be conditional')
assert.ok(reports.includes("officeDepartments.includes('bookkeeping') ?"), 'Bookkeeping summary must be conditional')

const migration=read('supabase/migrations/20261113164500_tenant_department_workspaces.sql')
const hrMigration=read('supabase/migrations/20261113190000_hr_payroll_department_preferences.sql')
const clientTimeMigration=read('supabase/migrations/20261113190500_client_focused_work_sessions.sql')
assert.ok(sidebar.includes('visibleSections.map(section =>'))
assert.ok(sidebar.includes('isNavigationVisible(item.path,officeDepartments,hrFeatures)'))
assert.ok(app.includes('const routeAllowedByOffice = isRouteInDepartments(window.location.pathname,officeDepartments,hrFeatures)'))
assert.ok(app.includes('filter(([,path]) => isRouteInDepartments(path,officeDepartments,hrFeatures))'))
assert.ok(!dashboard.includes('focusedResolutionCards'), 'Resolution-only office must not hide financial KPIs')
for(const label of ['MTD 1st Trades','MTD 2nd Trades','AR Outstanding','Unpaid Invoices','Active Cases','Open Leads','Open Tasks','Clients','Upcoming DL','Overdue DL']) {
  assert.ok(new RegExp('label:\\s*\\x27'+label+'\\x27').test(dashboard), 'Tax Resolution Home missing '+label)
}
assert.ok(dashboard.includes('repeat(auto-fit, minmax(min(100%, 220px), 1fr))'), 'Dashboard KPI grid must adapt to different office card counts')
assert.ok(isNavigationVisible('/payments',['resolution']), 'Payments must remain accessible in a focused Tax Resolution office')
assert.ok(migration.includes('tenant_department_config_select_own'))
assert.ok(migration.includes('tenant_id = (select public.current_tenant_id())'))
assert.ok(migration.includes('tenant_department_config_owner_insert'))
assert.ok(migration.includes('tenant_department_config_owner_update'))
assert.ok(migration.includes('(select public._is_platform_admin())'))
assert.ok(migration.includes('auth.uid()'))
const settings=read('src/pages/Settings.jsx')
const adminUI=read('src/components/settings/OfficeDepartmentsSettings.jsx')
assert.ok(settings.includes('isPlatformOwner && <OfficeDepartmentsSettings'))
assert.ok(settings.includes("'departments'"))
assert.ok(adminUI.includes("supabase.rpc('admin_tenant_overview')"))
assert.ok(adminUI.includes(".upsert({"))
assert.ok(adminUI.includes("onConflict:'tenant_id'"))
assert.ok(adminUI.includes('const confirmed=normalizeDepartments(data.departments,[])'))
assert.ok(adminUI.includes("row.id!==NASHVILLE"))
assert.ok(adminUI.includes('id:TAXRES'), 'Platform TaxRes office must appear in department selector')
assert.ok(migration.includes('cardinality(departments) between 1 and 4'), 'Empty department sets must be rejected at the database')

assert.ok(!migration.includes('NASHVILLE_TENANT_ID'))
assert.ok(hrMigration.includes("'time_tracking','payroll'"))
assert.ok(hrMigration.includes('cardinality(departments) between 1 and 5'))
assert.ok(hrMigration.includes("'61a89aef-0e7e-4ea2-b222-44ab2024655a'"))
assert.ok(!hrMigration.includes("489ace07-1a6b-4864-833a-4f8420568b40'::uuid"))
assert.ok(clientTimeMigration.includes('client_work_sessions_insert_self'))
assert.ok(clientTimeMigration.includes('client_work_sessions_update_self'))
assert.ok(clientTimeMigration.includes('tenant_id = (select public.current_tenant_id())'))
assert.ok(!clientTimeMigration.includes('insert into public.billing_time_entries'))
const clientScreen=read('src/pages/Clients.jsx')
const timeScreen=read('src/pages/TimeEntry.jsx')
const workHook=read('src/hooks/useAutoClientWorkTracking.js')
assert.ok(clientScreen.includes('useAutoClientWorkTracking({'))
assert.ok(timeScreen.includes('Recently tracked client work'))
assert.ok(workHook.includes("document.hidden||now-lastActivity>90000"))
assert.ok(workHook.includes(".upsert(payload,{onConflict:'id'})"))
assert.ok(workHook.includes('tenant_id:tenantId'))
assert.ok(workHook.includes('Math.min(5500'))
assert.ok(adminUI.includes('HR & Payroll features'))
assert.ok(adminUI.includes("hr_features:hrFeatures"))
const portal=read('src/pages/AdminPortal.jsx')
const newOffice=read('src/pages/NewOffice.jsx')
const provision=read('supabase/functions/provision-tenant/index.ts')
assert.ok(portal.includes("path:'/crm-admin/departments'"), 'Admin Portal navigation must offer shared office controls')
assert.ok(portal.includes('path="/departments"'), 'Admin Portal route must render shared office controls')
assert.ok(portal.includes('<OfficeDepartmentsSettings user={user} showToast={showToast}'), 'Portal and CRM must reuse same office settings component')
assert.ok(newOffice.includes("departments:['resolution']"), 'New office defaults to focused tax resolution')
assert.ok(newOffice.includes('departments: form.departments, hr_features: form.hr_features'), 'New office must send both department lists')
assert.ok(newOffice.includes("ALL_DEPARTMENTS.map(key=>"), 'New office must allow five departments')
assert.ok(newOffice.includes("form.departments.length"), 'New office must reject empty departments')
assert.ok(provision.includes('validateChoices(b.departments'), 'Provisioning must validate choices server-side')
assert.ok(provision.includes("admin.from('tenant_department_config').upsert"), 'Provisioning must save to the shared configuration')
assert.ok(provision.includes("if (readError || !confirmed)"), 'Provisioning must fail closed on configuration verification')
assert.ok(provision.indexOf("tenant_department_config').upsert") < provision.indexOf('admin.auth.admin.createUser'), 'Departments must be persisted before office admin login')
assert.ok(!provision.includes('nashville.taxrescrm.app'), 'Separate Nashville office must not be reconfigured')

// Keep the ORIGINAL Home route and sidebar item, with no invented department Home pages.
assert.ok(sidebar.includes("path: '/',          icon: GridIcon,    label: 'Home'"), 'Original Home sidebar tab must remain')
assert.ok(app.includes('<Route path="/"            element={<Dashboard />} />'),'Original Home must open shared Dashboard')
assert.ok(!sidebar.includes("key: 'departmenthomes'"), 'Unexpected Department Homes sidebar group')
assert.ok(!app.includes('path="/workspace/:department"'), 'Unexpected department homepage route')
assert.ok(!dashboard.includes('aria-label="Department homepages"'),'Unexpected department cards on Home')
assert.ok(isNavigationVisible('/', ['resolution']), 'Original Home must be visible for resolution-only Centurion')
assert.ok(isNavigationVisible('/', all), 'Original Home must be visible for all-feature offices')

// One and only one original Home route; dashboard data comes from the proper tenant.
for(const key of ['preparation','bookkeeping','formation','time_tracking','payroll']){
  assert.ok(dashboard.includes("['"+key+"',"),"Missing genuine "+key+" source count")
}
for(const table of ['tax_returns','bookkeeping','formacorp','timeentries','payrollruns']){
  assert.ok(dashboard.includes("['"+(table==='tax_returns'?'preparation':table==='timeentries'?'time_tracking':table==='payrollruns'?'payroll':table==='formacorp'?'formation':'bookkeeping')+"','"+table+"']"),"Unexpected source for "+table)
}
for(const route of ['/taxreturns','/books','/formacorp','/timeclock','/payroll']){
  assert.ok(dashboard.includes("'"+route+"'"),'Focused Home missing drill-through '+route)
}
assert.ok(dashboard.includes("const scoped=q=>tf(q,officeTenantId)"),'Dashboard must query active office tenant')
assert.ok(dashboard.includes(".eq('tenant_id',tenantId)"),'Active office scope must be applied in queries')
assert.ok(dashboard.includes("onClick={() => navigate('/clients/'+encodeURIComponent(c.id))}"),'Recent clients must open their own profile')
assert.ok(dashboard.includes("officeDepartments.includes('resolution') && ("),'Resolution-only news rail must not spill into unrelated departments')
assert.ok(dashboard.includes("isRouteInDepartments(to,officeDepartments,hrFeatures)"),'Quick actions must respect the enabled office features')
assert.ok(dashboard.includes("role={to?'button':undefined}"),'KPI drill-through must be keyboard accessible')
assert.ok(!dashboard.includes('aria-label="Department homepages"'),'No new department home cards are authorized')
assert.ok(!app.includes('DepartmentHome'),'No separate department page should exist')
console.log('PASS: shared CRM tenant workspace department defaults, navigation, routing, dashboard and SQL contract')
