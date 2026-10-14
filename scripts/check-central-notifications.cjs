const fs = require('fs')

const app = fs.readFileSync('src/context/AppContext.jsx','utf8')
const globalHuddle = fs.readFileSync('src/components/GlobalTeamChatNotifier.jsx','utf8')
const chat = fs.readFileSync('src/pages/Chat.jsx','utf8')
const migration = fs.readFileSync('supabase/migrations/20261014_central_notification_realtime.sql','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

const requiredTables = ['chat_messages','emails','tasks','calevents','sms_messages','fax_logs','voicemails','esigns']
for (const table of requiredTables) {
  assert(app.includes(`table: '${table}'`), `central global notification channel missing ${table}`)
}

assert(app.includes("title: '📧 New Email'") && app.includes("target: '/email'"), 'new email must be globally actionable')
assert(app.includes("title: '✅ New Task Assigned'") && app.includes("target: '/tasks'"), 'assigned task must be globally actionable')
assert(app.includes("title: '📅 New Appointment Booked'") && app.includes("target: '/calendar'"), 'new online booking must be globally actionable')
assert(app.includes("title: '💬 New SMS'") && app.includes("target: '/sms'"), 'inbound SMS must be globally actionable')
assert(app.includes("title: '📠 New Fax'") && app.includes("target: '/fax'"), 'inbound fax must be globally actionable')
assert(app.includes("title: '📞 New Voicemail'") && app.includes("target: '/dialer'"), 'voicemail must be globally actionable')
assert(app.includes("title: '✍️ E-Signature Sent'") && app.includes("title: '✅ E-Signature Completed'") && app.includes("target: '/esign'"), 'e-sign activity must be globally actionable')

assert(app.includes("window.dispatchEvent(new CustomEvent('taxres:huddle-invite'"), 'central huddles must fan out locally from AppContext')
assert(globalHuddle.includes("window.addEventListener('taxres:huddle-invite'"), 'global huddle UI must consume local central fanout')
assert(chat.includes("window.addEventListener('taxres:huddle-invite'"), 'Team Chat must consume local central fanout')
assert(globalHuddle.includes("if(!location.pathname.includes('/chat'))"), 'global huddle card must be suppressed while Team Chat is already visible')

assert(migration.includes("where id = '61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid"), 'Realtime migration must be central-TCR guarded')
assert(migration.includes('alter publication supabase_realtime add table public.calevents'), 'calevents must be added to central Realtime publication')
assert(migration.includes('alter publication supabase_realtime add table public.esigns'), 'esigns must be added to central Realtime publication')

if (failures.length) {
  console.error('Central notification architecture check FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Central notification architecture')
