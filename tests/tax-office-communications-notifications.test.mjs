import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
const panel=readFileSync('src/components/communications/TaxOfficeCommunicationsNotifications.jsx','utf8')
const sidebar=readFileSync('src/components/layout/Sidebar.jsx','utf8')
const app=readFileSync('src/context/AppContext.jsx','utf8')
const shell=readFileSync('src/App.jsx','utf8')
const release=readFileSync('src/releaseInfo.js','utf8')
transformSync(panel,{loader:'jsx'})
for(const term of [
  'taxoffice:comm-event','taxoffice:comm-counts',
  "detail?.owner!==user.id","can('view','dialer')","can('view','email')","can('view','sms')",
  "if(incomingCall)setOpen(false)","env(safe-area-inset-bottom,0px)",
  ".taxoffice-comms{left:12px;right:auto","@media(max-height:420px)",
  'aria-modal="false"',"e.key==='Escape'",
])assert(panel.includes(term),'Tax notification safety contract missing: '+term)
assert(shell.includes('<TaxOfficeCommunicationsNotifications />'),'Authenticated CRM must mount notification summary')
assert(app.includes("new CustomEvent('taxoffice:comm-event'"),'AppContext must reuse existing realtime notification events')
assert(sidebar.includes("new CustomEvent('taxoffice:comm-counts'"),'Sidebar must share existing badge state')
assert(sidebar.includes("select('id', { count: 'exact', head: true }).eq('is_read', false)"),'Voicemail count must not be truncated')
assert(!panel.includes("supabase.rpc")&&!panel.includes("supabase.channel"),'Do not duplicate employee network requests')
assert(!panel.includes('playSound(')&&!panel.includes('new Notification('),'No duplicate audio or desktop notifications')
assert(release.includes("version: '3.2.72'"),'Independent shared tax CRM release version missing')
console.log('PASS tax family employee channel permissions, one event stream, exact voicemail counts and mobile call priority')
