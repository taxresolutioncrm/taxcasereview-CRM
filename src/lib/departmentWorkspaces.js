// Tenant-level workspace modules determine UI focus, NOT database authorization.
// Existing employee permissions and database RLS remain the security boundary.
export const DEPARTMENT_KEYS = Object.freeze(['resolution','preparation','bookkeeping','formation','hr'])
export const ALL_DEPARTMENTS = Object.freeze([...DEPARTMENT_KEYS])
export const HR_FEATURE_KEYS = Object.freeze(['time_tracking','payroll'])
export const ALL_HR_FEATURES = Object.freeze([...HR_FEATURE_KEYS])
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
  '/kiosk': 'hr',
  '/employee': 'hr',
  '/timeclock': 'hr',
  '/timeoff': 'hr',
  '/payroll': 'hr',
  '/activity-report': 'hr',
})

// A focused workspace intentionally keeps only daily tools in the sidebar.
// Advanced shared tools are not deleted or re-permissioned; staff can still
// open authorized deep links. Existing employees' permissions remain intact.
const FOCUSED_COMMON_PATHS = new Set([
  '/', '/leads', '/clients', '/email', '/calendar', '/tasks', '/dialer',
  '/sms', '/fax', '/documents', '/esign', '/invoices', '/payments',
  '/employees', '/settings', '/reports', '/workflows',
])
const HR_TIME_PATHS = new Set(['/kiosk','/employee','/timeclock','/timeoff','/activity-report'])
const HR_PAYROLL_PATHS = new Set(['/payroll'])
export function normalizeHrFeatures(value, fallback=ALL_HR_FEATURES) {
  if (!Array.isArray(value)) return [...fallback]
  return HR_FEATURE_KEYS.filter(key=>value.includes(key))
}
export function isHrFeatureEnabled(pathname, features=ALL_HR_FEATURES) {
  const root='/' + (String(pathname||'').split('/').filter(Boolean)[0] || '')
  const selected=normalizeHrFeatures(features)
  if (HR_TIME_PATHS.has(root)) return selected.includes('time_tracking')
  if (HR_PAYROLL_PATHS.has(root)) return selected.includes('payroll')
  return true
}
export function isNavigationVisible(pathname, departments, hrFeatures=ALL_HR_FEATURES) {
  const enabled = normalizeDepartments(departments)
  if (enabled.length === DEPARTMENT_KEYS.length) return isHrFeatureEnabled(pathname,hrFeatures)
  const root='/' + (String(pathname||'').split('/').filter(Boolean)[0] || '')
  const department=departmentForPath(pathname)
  return department ? enabled.includes(department) && isHrFeatureEnabled(pathname,hrFeatures) : FOCUSED_COMMON_PATHS.has(root)
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
export function isRouteInDepartments(pathname, departments, hrFeatures=ALL_HR_FEATURES) {
  const department = departmentForPath(pathname)
  return !department || (normalizeDepartments(departments).includes(department) && isHrFeatureEnabled(pathname,hrFeatures))
}
export function workspaceLabel(departments) {
  const enabled = normalizeDepartments(departments)
  if (enabled.length === DEPARTMENT_KEYS.length) return 'All Departments'
  if (enabled.length === 1) return ({
    resolution:'Tax Resolution',preparation:'Tax Preparation',
    bookkeeping:'Bookkeeping',formation:'Business Formation',hr:'HR & Payroll',
  })[enabled[0]] || 'Office Workspace'
  return 'Selected Departments'
}
