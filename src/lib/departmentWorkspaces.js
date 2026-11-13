// Tenant-level workspace modules determine UI focus, NOT database authorization.
// Existing employee permissions and database RLS remain the security boundary.
export const DEPARTMENT_KEYS = Object.freeze(['resolution','preparation','bookkeeping','formation'])
export const ALL_DEPARTMENTS = Object.freeze([...DEPARTMENT_KEYS])
export const CENTURION_TENANT_ID = '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a'
export const NASHVILLE_TENANT_ID = '489ace07-1a6b-4864-833a-4f8420568b40'

const WORKSPACE_PATHS = Object.freeze({
  '/cases': 'resolution',
  '/deadlines': 'resolution',
  '/irsforms': 'resolution',
  '/stateforms': 'resolution',
  '/irsreference': 'resolution',
  '/irsportal': 'resolution',
  '/transcripts': 'resolution',
  '/ai-government-calls': 'resolution',
  '/taxreturns': 'preparation',
  '/books': 'bookkeeping',
  '/formacorp': 'formation',
})

// A focused workspace intentionally keeps only daily tools in the sidebar.
// Advanced shared tools are not deleted or re-permissioned; staff can still
// open authorized deep links. Existing employees' permissions remain intact.
const FOCUSED_COMMON_PATHS = new Set([
  '/', '/leads', '/clients', '/email', '/calendar', '/tasks', '/dialer',
  '/sms', '/fax', '/documents', '/esign', '/invoices', '/payments',
  '/employees', '/settings', '/reports', '/workflows',
])
export function isNavigationVisible(pathname, departments) {
  const enabled = normalizeDepartments(departments)
  if (enabled.length === 4) return true
  const root='/' + String(pathname||'').split('/').filter(Boolean)[0]
  const department=departmentForPath(root)
  return department ? enabled.includes(department) : FOCUSED_COMMON_PATHS.has(root)
}

// Shared workspace tools (clients, leads, documents, communications, billing,
// staff and administration) remain usable according to existing role permissions.
// Nashvile is a separate application; this is only a defensive default in the
// shared code to make its full-feature entitlement explicit.
export function defaultDepartments(tenantId) {
  return tenantId === CENTURION_TENANT_ID ? ['resolution'] : [...ALL_DEPARTMENTS]
}
export function normalizeDepartments(value, fallback=ALL_DEPARTMENTS) {
  if (!Array.isArray(value)) return [...fallback]
  const valid = DEPARTMENT_KEYS.filter(key => value.includes(key))
  // A real [] is allowed only for deliberate platform-managed configurations.
  return valid
}
export function departmentForPath(pathname) {
  const clean = String(pathname || '').split(/[?#]/,1)[0]
  const root = '/' + clean.split('/').filter(Boolean)[0]
  return WORKSPACE_PATHS[root] || null
}
export function isRouteInDepartments(pathname, departments) {
  const department = departmentForPath(pathname)
  return !department || normalizeDepartments(departments).includes(department)
}
export function workspaceLabel(departments) {
  const enabled = normalizeDepartments(departments)
  if (enabled.length === 4) return 'All Departments'
  if (enabled.length === 1) return ({
    resolution:'Tax Resolution',preparation:'Tax Preparation',
    bookkeeping:'Bookkeeping',formation:'Business Formation',
  })[enabled[0]] || 'Office Workspace'
  return 'Selected Departments'
}
