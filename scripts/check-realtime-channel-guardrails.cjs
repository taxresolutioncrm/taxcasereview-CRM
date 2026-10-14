const fs = require('fs')

const app = fs.readFileSync('src/context/AppContext.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(!app.includes('supabase.realtime.disconnect()'), 'idle wake must never tear down the shared Realtime socket')
assert(!app.includes('supabase.channel(`${name}-${Date.now()}`)'), 'global notification channels must not use timestamped replacement names')
assert(app.includes('supabase.channel(name)'), 'managed Realtime channels must use stable names')
assert(app.includes('if (cancelled || reconnectTimer) return'), 'each managed channel must have one reconnect timer guard')
assert(app.includes('if (cancelled || channel !== ch) return'), 'stale Realtime callbacks must be ignored')
assert(app.includes('await disposeCurrent()'), 'current channel must be removed before replacement')
assert(app.includes('channelCleanups.forEach(cleanup'), 'managed channels must be removed on effect teardown')

const managed = (app.match(/channelCleanups\.push\(withReconnect\('/g) || []).length
assert(managed === 7, 'global notification channel count must stay fixed at 7; found '+managed)

if (failures.length) {
  console.error('Realtime channel guardrail check FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Realtime channel lifecycle guardrails')
