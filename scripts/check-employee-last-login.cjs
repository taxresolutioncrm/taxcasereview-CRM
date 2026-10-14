const fs = require('fs')

const emp = fs.readFileSync('src/pages/Employees.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(emp.includes("const LOGIN_TIME_ZONE = 'America/Chicago'"), 'employee login display must use Central Time')
assert(emp.includes("● Logged in today · ${time} CT"), 'today login label must match approved copy')
assert(emp.includes("◷ Last login · ${date}, ${time} CT"), 'historical login label must match approved copy')
assert(emp.includes("◷ Never logged in"), 'never-login label must match approved copy')
assert(emp.includes(".from('activity_log')"), 'employee cards must use existing activity_log')
assert(emp.includes(".eq('tenant_id', tenantId)"), 'login history must remain tenant scoped')
assert(emp.includes(".eq('action', 'session_login')"), 'login history must use session_login events')
assert(emp.includes("lastLoginByEmail[String(emp.email || '').trim().toLowerCase()]"), 'cards must map login history by employee email')

if (failures.length) {
  console.error('Employee last-login card guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Employee last-login card guardrails')
