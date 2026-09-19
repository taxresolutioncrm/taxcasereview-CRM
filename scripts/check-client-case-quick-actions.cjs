const fs=require('fs')

const clients=fs.readFileSync('src/pages/Clients.jsx','utf8')
const cases=fs.readFileSync('src/pages/Cases.jsx','utf8')
const clientLink=fs.readFileSync('src/components/ClientLink.jsx','utf8')

const checks=[
  ['client links are real anchors for browser new-tab support',clientLink.includes('<a\n      href={href}')&&clientLink.includes('e.ctrlKey')&&clientLink.includes('e.metaKey')],
  ['cases client names use ClientLink',cases.includes('<ClientLink name={c.clientName}')],
  ['client detail has Back to Clients',clients.includes('← Back to Clients')],
  ['client detail has Back to Cases',clients.includes('← Back to Cases')],
  ['Schedule quick action is wired',clients.includes('label="Schedule"')&&clients.includes('setBookingClient(c)')&&clients.includes('<BookingWidget')],
  ['Add Task quick action is wired',clients.includes('label="Add Task"')&&clients.includes('setTaskModal(true)')&&clients.includes('addTaskFromModal')],
  ['Send Fax quick action is wired',clients.includes('label="Send Fax"')&&clients.includes('setFaxModal(true)')&&clients.includes("functions.invoke('send-fax'")],
  ['E-Signature quick action creates a tokenized signer link',clients.includes('label="E-Signature"')&&clients.includes("'/sign/'+data.id+'?token='")&&clients.includes('data.signer_token')],
  ['IRS pre-fill quick action is wired',clients.includes('label="Pre-Fill 8821/2848"')&&clients.includes('setFillerClient')],
  ['State POA quick action is wired',clients.includes('label="Pre-Fill State POA"')&&clients.includes('sendStatePOA')&&clients.includes('setPoaModal(true)')],
  ['Addendum quick action is wired',clients.includes('label="Addendum"')&&clients.includes('sendAddendumForSignature')&&clients.includes('sendAddendum')],
  ['Client Portal quick action is wired',clients.includes('label="Client Portal"')&&clients.includes('InlinePortalForm')],
  ['Tax Organizer quick action is wired',clients.includes('label="Tax Organizer"')&&clients.includes('InlineOrganizerForm')],
  ['quick-action SMS uses tenant-aware Edge Function',!clients.includes("signalwire_backend + '/sms/send'")&&!clients.includes("signalwire_backend+'/sms/send'")&&clients.includes("functions.invoke('send-sms'")],
  ['quick-action email uses authenticated Edge Function',clients.includes("functions.invoke('send-email'")],
]

let failed=0
for(const [name,ok] of checks){
  console.log(`${ok?'PASS':'FAIL'}  ${name}`)
  if(!ok) failed++
}
if(failed){
  console.error(`Client/case quick-action contract failed: ${failed} check(s)`)
  process.exit(1)
}
console.log('PASS  Client/case navigation and quick-action contract')
