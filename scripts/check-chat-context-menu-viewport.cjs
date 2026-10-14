const fs = require('fs')

const chat = fs.readFileSync('src/pages/Chat.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(chat.includes('useLayoutEffect'), 'ContextMenu viewport correction must use layout measurement')
assert(chat.includes("maxHeight: 'calc(100vh - 16px)'"), 'ContextMenu must cap height to the viewport')
assert(chat.includes("overflowY: 'auto'"), 'ContextMenu must stay scrollable on short screens')
assert(chat.includes('window.innerHeight - rect.height - margin'), 'ContextMenu must clamp vertically to the viewport')
assert(chat.includes('window.innerWidth - rect.width - margin'), 'ContextMenu must clamp horizontally to the viewport')
assert(chat.includes('pos.y - rect.height'), 'ContextMenu must be able to open upward when needed')
assert(!chat.includes("position: 'fixed', top: pos.y, left: pos.x"), 'ContextMenu must not use raw click coordinates directly')

if (failures.length) {
  console.error('Team Chat context-menu viewport guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Team Chat context-menu viewport guardrails')
