const fs = require('fs')

const app = fs.readFileSync('src/context/AppContext.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(!app.includes('supabase.realtime.disconnect()'), 'idle wake must never tear down the shared Realtime socket')
assert(!app.includes('central-global-notifications-${user.id}'), 'central notifications must not share one blast-radius channel')
assert(app.includes('function withReconnect(name, table, handler, event = \'INSERT\')'), 'managed notification channels need the reconnect helper')
assert(app.includes('if (cancelled || fallbackReconnectTimer) return'), 'each managed channel must guard reconnect timers')
assert(app.includes('await disposeFallback()'), 'managed notification channels must remove stale subscriptions before replacement')
assert(app.includes("window.addEventListener('focus', wake)"), 'managed notification channels must recover when the app regains focus')
assert(app.includes("window.addEventListener('online', online)"), 'managed notification channels must recover when connectivity returns')
assert(app.includes("host !== 'nashville.taxrescrm.app'"), 'central notification changes must leave Nashville runtime on its existing path')

const centralManaged = (app.match(/channelCleanups\.push\(withReconnect\('central-/g) || []).length
assert(centralManaged === 9, 'central notification channel count must stay fixed at 9; found '+centralManaged)

if (failures.length) {
  console.error('Realtime channel guardrail check FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Realtime channel lifecycle guardrails')
