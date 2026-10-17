const fs = require('fs')

const app = fs.readFileSync('src/context/AppContext.jsx','utf8')
const sidebar = fs.readFileSync('src/components/layout/Sidebar.jsx','utf8')
const globalHuddle = fs.readFileSync('src/components/GlobalTeamChatNotifier.jsx','utf8')
const chat = fs.readFileSync('src/pages/Chat.jsx','utf8')
const migration = fs.readFileSync('supabase/migrations/20261014_central_notification_realtime.sql','utf8')
const emailCountSync = fs.readFileSync('scripts/fix-email-bulk-counts.mjs','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

const requiredTables = ['chat_messages','emails','tasks','calevents','sms_messages','fax_logs','voicemails','esigns']
for (const table of requiredTables) {
  assert(app.includes(`table: '${table}'`), `central global notification channel missing ${table}`)
}

assert(app.includes("title: '📧 New Email'") && app.includes("target: '/email'"), 'new email must be globally actionable')
assert(!app.includes("tag: `email-${row.id}`,\n        suppressPath: '/email'"), 'new email alert must still display while the Email page is open')
assert(app.includes("title: '✅ New Task Assigned'") && app.includes("target: '/tasks'"), 'assigned task must be globally actionable')
assert(app.includes("title: '📅 New Appointment Booked'") && app.includes("target: '/calendar'"), 'new online booking must be globally actionable')
assert(app.includes("title: '💬 New SMS'") && app.includes("target: '/sms'"), 'inbound SMS must be globally actionable')
assert(app.includes("title: '📠 New Fax'") && app.includes("target: '/fax'"), 'inbound fax must be globally actionable')
assert(app.includes("title: '📞 New Voicemail'") && app.includes("target: '/dialer'"), 'voicemail must be globally actionable')
assert(app.includes("title: '✍️ E-Signature Sent'") && app.includes("title: '✅ E-Signature Completed'") && app.includes("target: '/esign'"), 'e-sign activity must be globally actionable')

const independentCentralChannels = [
  'central-chat-notify-','central-email-notify-','central-task-notify-',
  'central-calendar-notify-','central-sms-notify-','central-fax-notify-',
  'central-voicemail-notify-','central-esign-new-notify-','central-esign-signed-notify-'
]
for (const name of independentCentralChannels) {
  assert(app.includes(name), 'missing independent central notification channel '+name)
}
assert(app.includes("window.addEventListener('focus', wake)") && app.includes("window.addEventListener('online', online)"), 'notification channels must recover on focus/online wake')
assert(sidebar.includes('setInterval(loadCommsCounts, 180000)'), 'communications badges need fallback polling')
assert(sidebar.includes('setInterval(loadEmailTaskCounts, 180000)'), 'email/task badges need fallback polling')
assert(sidebar.includes('setInterval(loadCounts, 180000)'), 'client-work badges need fallback polling')
assert(sidebar.includes('setInterval(loadCalendarBadge, 180000)'), 'calendar badge needs fallback polling')
assert(!sidebar.includes("if (location.pathname.startsWith('/email')) {\n      setUnreadInbox(0)"), 'email badge must not be cleared merely by visiting /email')
assert(!sidebar.includes("if (item.path === '/email') setUnreadInbox(0)"), 'email badge must not be cleared by clicking the Email nav item')
assert(app.includes("window.addEventListener('pointerdown', request, true)") && app.includes("Notification.requestPermission()"), 'browser notification permission must be requested from a real user interaction')
assert(emailCountSync.includes("supabase.rpc('get_sidebar_badge_counts')"), 'email prebuild must preserve protected sidebar badge RPC')
assert(!emailCountSync.includes("const baseUnread = () => supabase.from('emails')"), 'email prebuild must not rewrite Sidebar to direct mailbox queries')

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
