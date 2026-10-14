const fs = require('fs')

const email = fs.readFileSync('src/pages/Email.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(email.includes("const [emailContextMenu, setEmailContextMenu] = useState(null)"), 'email context-menu state must be declared')
assert(email.includes('onContextMenu={ev => openEmailContextMenu(ev, e)}'), 'email rows must expose right-click menu')
assert(email.includes("return markRead(email)"), 'context menu must use existing markRead action')
assert(email.includes("return markUnread(email)"), 'context menu must use existing markUnread action')
assert(email.includes("return permanentlyDeleteEmail(email.id)"), 'context menu delete must use existing provider-synced trash path')

if (failures.length) {
  console.error('Email context-menu guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Email context-menu guardrails')
