const fs = require('fs')

const email = fs.readFileSync('src/pages/Email.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(email.includes('const [emailContextMenu, setEmailContextMenu] = useState(null)'), 'context-menu state must exist')
assert(email.includes('onContextMenu={ev => openEmailContextMenu(ev, e)}'), 'email rows must open the context menu')

const handlerActions = [
  ['reply', "if (action === 'reply') return beginReply(email, false)"],
  ['reply all', "if (action === 'reply-all') return beginReply(email, true)"],
  ['forward', "if (action === 'forward') return beginForward(email)"],
  ['archive', "if (action === 'archive') return archiveEmail(email.id)"],
  ['delete', "if (action === 'delete') return permanentlyDeleteEmail(email.id)"],
  ['add to tasks', "if (action === 'task') return await addEmailToTasks(email)"],
  ['find sender', "if (action === 'find-sender') return findEmailsFromSender(email)"],
  ['open window', "if (action === 'open-window') return openEmailInNewWindow(email)"],
]
for (const [label, signal] of handlerActions) assert(email.includes(signal), `context-menu handler missing ${label}`)

for (const label of ['Reply','Reply all','Forward','Archive','Delete','Add to Tasks','Move to','Open in new window']) {
  assert(email.includes(label), `context menu missing visible ${label} item`)
}

assert(email.includes("runEmailContextAction('move',t)"), 'Move to submenu must use existing triage move action')
assert(email.includes("emailContextMenu.email.is_read ? 'unread' : 'read'"), 'read/unread action must stay state-aware')
assert(email.includes("if (action === 'move') return await moveTriage(email.id, value)"), 'Move to must reuse existing triage logic')
assert(email.includes("await supabase.from('tasks').insert"), 'Add to Tasks must create a real CRM task')

if (failures.length) {
  console.error('Email context-menu guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Email Gmail-style context-menu guardrails')
