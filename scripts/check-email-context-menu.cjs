const fs = require('fs')

const email = fs.readFileSync('src/pages/Email.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(email.includes('const [emailContextMenu, setEmailContextMenu] = useState(null)'), 'context-menu state must exist')
assert(email.includes('onContextMenu={ev => openEmailContextMenu(ev, e)}'), 'email rows must open the context menu')

const actions = [
  ['reply', "runEmailContextAction('reply')"],
  ['reply all', "runEmailContextAction('reply-all')"],
  ['forward', "runEmailContextAction('forward')"],
  ['archive', "runEmailContextAction('archive')"],
  ['delete', "runEmailContextAction('delete')"],
  ['add to tasks', "runEmailContextAction('task')"],
  ['find sender', "runEmailContextAction('find-sender')"],
  ['open window', "runEmailContextAction('open-window')"],
]
for (const [label, signal] of actions) assert(email.includes(signal), `context menu missing ${label}`)

assert(email.includes("runEmailContextAction('move',t)"), 'Move to submenu must use existing triage move action')
assert(email.includes("emailContextMenu.email.is_read ? 'unread' : 'read'"), 'read/unread action must stay state-aware')
assert(email.includes("if (action === 'archive') return archiveEmail(email.id)"), 'Archive must use existing provider-synced archive path')
assert(email.includes("if (action === 'delete') return permanentlyDeleteEmail(email.id)"), 'Delete must use existing provider-synced trash path')
assert(email.includes("if (action === 'move') return await moveTriage(email.id, value)"), 'Move to must reuse existing triage logic')
assert(email.includes("await supabase.from('tasks').insert"), 'Add to Tasks must create a real CRM task')

if (failures.length) {
  console.error('Email context-menu guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Email Gmail-style context-menu guardrails')
