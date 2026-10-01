import fs from 'node:fs'

const chatPath = 'src/pages/Chat.jsx'
const migrationPath = 'supabase/migrations/20260928135500_fix_employee_tenant_isolation.sql'

const fail = (msg) => {
  console.error('TENANT ISOLATION REGRESSION:', msg)
  process.exit(1)
}

const chat = fs.readFileSync(chatPath, 'utf8')
const migration = fs.readFileSync(migrationPath, 'utf8')

// Team Chat must resolve the signed-in employee's tenant and explicitly scope
// both the initial DM roster and directory refresh to that tenant.
if (!chat.includes("const { user, role, myTenantId } = useApp()")) {
  fail('Team Chat no longer resolves the active tenant from AppContext.')
}
if (!chat.includes(".eq('tenant_id', myTenantId)")) {
  fail('Team Chat roster/messages are not explicitly tenant-scoped.')
}
if (!chat.includes("chat-presence:${myTenantId}")) {
  fail('Team Chat presence is not isolated by tenant.')
}
if (!chat.includes("tenant_id: myTenantId, channel: channelId")) {
  fail('Team Chat writes do not persist the active tenant id.')
}
if (!chat.includes("dedupeEmployeeRoster")) {
  fail('Team Chat employee roster is not deduplicated.')
}

// The employee QA visibility policy must remain RESTRICTIVE. A permissive
// SELECT policy can OR with tenant_isolation and expose other offices.
if (!/create\s+policy\s+hide_qa_certification_employees_from_staff[\s\S]*?as\s+restrictive/i.test(migration)) {
  fail('Employee visibility policy is not RESTRICTIVE.')
}

console.log('PASS: Team Chat employee roster and employee RLS are tenant-isolated.')
