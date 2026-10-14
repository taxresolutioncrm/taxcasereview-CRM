const fs = require('fs')

const app = fs.readFileSync('src/context/AppContext.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(!app.includes('supabase.realtime.disconnect()'), 'idle wake must never tear down the shared Realtime socket')
assert(app.includes('central-global-notifications-${user.id}'), 'central notification runtime must use one stable global channel')
assert(app.includes('let reconnectAttempt = 0'), 'central notification channel must track reconnect attempts')
assert(app.includes('Math.min(1000 * (2 ** reconnectAttempt), 30000)'), 'central notification reconnect must use bounded exponential backoff')
assert(app.includes('if (cancelled || reconnectTimer) return'), 'central notification reconnect must have a single timer guard')
assert(app.includes('if (cancelled || channel !== ch) return'), 'stale central Realtime callbacks must be ignored')
assert(app.includes('await disposeCurrent()'), 'central notification channel must be removed before replacement')
assert(app.includes("host !== 'nashville.taxrescrm.app'"), 'central notification changes must leave Nashville runtime on its existing path')

if (failures.length) {
  console.error('Realtime channel guardrail check FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Realtime channel lifecycle guardrails')
