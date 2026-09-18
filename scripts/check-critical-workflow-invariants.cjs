const fs = require('fs')

function read(path) { return fs.readFileSync(path, 'utf8') }
function requireAll(path, snippets) {
  const src = read(path)
  for (const snippet of snippets) {
    if (!src.includes(snippet)) {
      console.error(`ERROR: ${path} is missing required audited invariant: ${snippet}`)
      process.exit(1)
    }
  }
  return src
}

const calendar = requireAll('src/pages/Calendar.jsx', [
  "client_id: ''",
  "supabase.from('clients').select('id,name,email,address')",
  "if (ev.client_id)",
  "clients.find(cl => cl.id === ev.client_id)",
  "value={form.client_id || ''}",
])
if (calendar.includes('datalist id="cal-clients"')) {
  console.error('ERROR: Calendar reverted to duplicate-prone name-only client selection.')
  process.exit(1)
}

for (const path of ['src/pages/Leads.jsx', 'src/pages/Clients.jsx']) {
  const src = requireAll(path, [
    "supabase.functions.invoke('send-fax'",
    "document_url",
    "resData?.success",
    "Fax provider rejected the send",
    "faxDigits.length !== 10",
    "telnyx_fax_id",
    "signalwire_fax_id",
  ])
  if (src.includes("signalwire_backend+'/fax/send")) {
    console.error(`ERROR: ${path} reverted to legacy inline fax backend.`)
    process.exit(1)
  }
  if (src.includes('provider_sid:')) {
    console.error(`ERROR: ${path} writes non-existent fax_logs.provider_sid.`)
    process.exit(1)
  }
}

requireAll('supabase/functions/send-fax/index.ts', [
  "return json({ success: true, provider, sid:",
])

requireAll('src/pages/Payments.jsx', [
  "client_id:''",
  "select('id,invNum,clientName,client_id,total,taxRate,paid,status')",
  "fld('client_id',c.id)",
  "fld('client_id', inv.client_id || '')",
])

const invoiceSync = requireAll('src/lib/invoiceSync.js', [
  "select('id, invNum, total, taxRate, paid, status')",
  "subtotal + (subtotal * taxRate / 100)",
  "paid >= total - 0.005",
])
if (invoiceSync.includes(".maybeSingle()")) {
  console.error('ERROR: invoiceSync reverted to duplicate-sensitive maybeSingle invoice lookup.')
  process.exit(1)
}

requireAll('src/lib/i18n.js', [
  "'+ New Event': '+ Nuevo evento'",
  "'Save Event': 'Guardar evento'",
  "'Track IRS deadlines, CSED dates, and compliance due dates.': 'Controle vencimientos del IRS, fechas CSED y fechas de cumplimiento.'",
  "'Deadline Name *': 'Nombre del vencimiento *'",
  "'faltan $1 d'",
])

const callContext = requireAll('src/context/CallContext.jsx', [
  "const legRecoveryPendingRef = useRef(false)",
  "const CALL_SESSION_KEY = phoneContext === 'romylabs' ? 'romylabs_active_call_v1' : 'taxres_active_call_v1'",
  "async function providerCallStillActive()",
  "function markBrowserLegRecovery(reason)",
  "async function recoverBrowserLeg(clientOverride = null)",
  "markBrowserLegRecovery('signalwire.socket.close')",
  "markBrowserLegRecovery('blade.disconnect')",
  "Connection interrupted — reconnecting active call…",
  "finalizeCallEnd({ alreadyHungUp: true, skipConferenceKill: true })",
])
if (callContext.includes("if (await finalizeCallEnd({ alreadyHungUp: true }))")) {
  console.error('ERROR: browser/provider terminal events can still kill the live conference without provider-state verification.')
  process.exit(1)
}

requireAll('src/pages/AdminPortal.jsx', [
  "async function deleteRecording(id)",
  "function loadRecentCallIntoDialer(call)",
  "onClick={()=>loadRecentCallIntoDialer(call)}",
  "body:{ action:'delete_recording', id }",
  "preload=\"metadata\"",
  "Recording audio unavailable — refresh to retry secure retrieval.",
])

requireAll('supabase/functions/romylabs-phone-state/index.ts', [
  "async function signedRecordingUrl(rec:any)",
  "db.storage.from('voicemails').upload(path,blob",
  "if(action==='delete_recording')",
  "db.from('call_ai_summaries').delete()",
  "db.from('call_recordings').delete()",
])

console.log('Critical workflow invariants: PASS')
