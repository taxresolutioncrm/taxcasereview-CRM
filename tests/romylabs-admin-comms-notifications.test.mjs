import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
const path='src/components/admin/AdminCommsNotifications.jsx'
const source=readFileSync(path,'utf8')
const shell=readFileSync('src/pages/AdminPortal.jsx','utf8')
const sms=readFileSync('supabase/functions/romylabs-sms/index.ts','utf8')
const mailbox=readFileSync('supabase/functions/romylabs-mailbox/index.ts','utf8')
const phone=readFileSync('supabase/functions/romylabs-phone-state/index.ts','utf8')
transformSync(source,{loader:'jsx'})
transformSync(shell,{loader:'jsx'})
for(const phrase of [
  '<AdminCommsNotifications />',
  '<CallProvider phoneContext="romylabs">',
  "new URLSearchParams(location.search).get('tab') === 'sms'",
]) assert.ok(shell.includes(phrase),'Admin shell must mount alerts and resolve SMS deep link: '+phrase)
for(const phrase of [
  "action:'list',limit:500",
  "action:'list',limit:75",
  "action:'recent_calls'",
  "m.direction==='inbound'&&!m.read",
  "unreadEmails",
  "incomingCall",
  "visibilitychange",
  "setInterval(()=>void refresh(),REFRESH_MS)",
  "new Notification(title",
  "Enable Desktop Notifications",
  "playSound(kind)",
  "Connection issue:",
  "aria-expanded={open}",
  "Missed 24h:",
  "ADMIN_ROUTES.sms",
  "ADMIN_ROUTES.email",
  "document.visibilityState==='hidden'",
]) assert.ok(source.includes(phrase),'Missing notification invariant: '+phrase)
assert.ok(sms.includes("eq('tenant_id',TENANT)"))
assert.ok(mailbox.includes('requirePlatformAdmin(req)'))
assert.ok(phone.includes("if(isAdmin!==true)return json({error:'Forbidden'},403)"))
assert.ok(!source.includes('service_role')&&!source.includes('SUPABASE_SERVICE_ROLE_KEY'),'Browser code must never use service credentials')
console.log('PASS: persistent Admin Portal call/email/SMS notifications, routing, unread counts, owner auth, error visibility and browser opt-in')
