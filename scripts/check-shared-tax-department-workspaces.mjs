import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  defaultDepartments, normalizeDepartments, departmentForPath,
  isRouteInDepartments, workspaceLabel, CENTURION_TENANT_ID, NASHVILLE_TENANT_ID
} from '../src/lib/departmentWorkspaces.js'
const all=['resolution','preparation','bookkeeping','formation']
const tcr='61a89aef-0e7e-4ea2-b222-44ab2024655a'
const taxres='a0000000-0000-0000-0000-000000000001'
assert.deepEqual(defaultDepartments(CENTURION_TENANT_ID),['resolution'])
for (const tenant of [tcr,taxres,NASHVILLE_TENANT_ID]) assert.deepEqual(defaultDepartments(tenant),all)
assert.deepEqual(normalizeDepartments(['resolution','unknown','resolution']),['resolution'])
assert.equal(workspaceLabel(['resolution']),'Tax Resolution')
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
const migration=read('supabase/migrations/20261113164500_tenant_department_workspaces.sql')
assert.ok(sidebar.includes('visibleSections.map(section =>'))
assert.ok(sidebar.includes('isRouteInDepartments(item.path,officeDepartments)'))
assert.ok(app.includes('const routeAllowedByOffice = isRouteInDepartments(window.location.pathname,officeDepartments)'))
assert.ok(app.includes('filter(([,path]) => isRouteInDepartments(path,officeDepartments))'))
assert.ok(dashboard.includes('focusedResolutionCards'))
assert.ok(migration.includes('tenant_department_config_select_own'))
assert.ok(migration.includes('tenant_id = (select public.current_tenant_id())'))
assert.ok(!migration.includes('NASHVILLE_TENANT_ID'))
console.log('PASS: shared CRM tenant workspace department defaults, navigation, routing, dashboard and SQL contract')
