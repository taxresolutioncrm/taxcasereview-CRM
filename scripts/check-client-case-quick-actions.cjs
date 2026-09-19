const fs=require('fs')

const clients=fs.readFileSync('src/pages/Clients.jsx','utf8')
const cases=fs.readFileSync('src/pages/Cases.jsx','utf8')
const clientLink=fs.readFileSync('src/components/ClientLink.jsx','utf8')
const signPage=fs.readFileSync('src/pages/SignPage.jsx','utf8')
const esignArchive=fs.readFileSync('supabase/functions/esign-archive-upload/index.ts','utf8')
const esignMigration=fs.readFileSync('supabase/migrations/20260919213000_taxres_family_esign_tokens.sql','utf8')
const sendFax=fs.readFileSync('supabase/functions/send-fax/index.ts','utf8')
const app=fs.readFileSync('src/App.jsx','utf8')
const irsForms=fs.readFileSync('src/lib/irsFormUtils.js','utf8')
const docUtils=fs.readFileSync('src/lib/docUtils.js','utf8')

const requiredStateForms=['FL_POA.pdf','NC_POA.pdf','TX_POA.pdf','OH_POA.pdf','NY_POA.pdf','PA_POA.pdf','CA_POA.pdf','GA_POA.pdf','IL_POA.pdf','MA_POA.pdf','MO_POA.pdf','OR_POA.pdf','TN_POA.pdf','Washington_POA.pdf','Wyoming.pdf','AZ_POA.pdf','ID_POA.pdf']
const requiredIrsTemplates=['2848_Pers_RC.pdf','2848_RC_Biz.pdf','8821_Pers_RC.pdf','8821_Biz_RC.pdf','433A_Blank.pdf','433B_Blank.pdf','433D_Blank.pdf','433F_Blank.pdf','433H_Blank.pdf','656L_Blank.pdf','433A_OIC_Blank.pdf']

const checks=[
  ['global client links are real anchors for browser new-tab support',clientLink.includes('<a\n      href={href}')&&clientLink.includes('e.ctrlKey')&&clientLink.includes('e.metaKey')],
  ['Cases client names are direct native hrefs with return context',cases.includes('clientHrefForCase(c)')&&cases.includes('?from=cases')&&cases.includes('href={clientHrefForCase(c)}')],
  ['Cases table client click is isolated from case-row click',cases.includes("onClick={e=>e.stopPropagation()}")&&cases.includes('title="Open client file"')],
  ['client detail has Back to Clients',clients.includes('← Back to Clients')],
  ['client detail has native Back to Cases return link',clients.includes('href="/cases"')&&clients.includes('← Back to Cases')&&clients.includes("openedFromCases")],
  ['Schedule quick action is wired',clients.includes('label="Schedule"')&&clients.includes('setBookingClient(c)')&&clients.includes('<BookingWidget')],
  ['Add Task quick action is wired',clients.includes('label="Add Task"')&&clients.includes('setTaskModal(true)')&&clients.includes('addTaskFromModal')],
  ['Send Fax quick action is wired',clients.includes('label="Send Fax"')&&clients.includes('setFaxModal(true)')&&clients.includes("functions.invoke('send-fax'")],
  ['E-Signature quick action creates a tokenized signer link',clients.includes('label="E-Signature"')&&clients.includes("'/sign/'+data.id+'?token='")&&clients.includes('data.signer_token')],
  ['E-Signature quick action delivers by email text or both',clients.includes("Signing request sent via")&&clients.includes("functions.invoke('send-email'")&&clients.includes("functions.invoke('send-sms'")],
  ['Rewrite quick action is wired to a replacement token-secured agreement',clients.includes('label="Rewrite"')&&clients.includes('saveRewritePlan')&&clients.includes('sendAddendumForSignature(detail, plan')],
  ['quick actions do not trigger automatic clipboard permission prompts',!clients.includes('navigator.clipboard.writeText(')],
  ['IRS pre-fill quick action is wired',clients.includes('label="Pre-Fill 8821/2848"')&&clients.includes('setFillerClient')],
  ['State POA quick action is wired',clients.includes('label="Pre-Fill State POA"')&&clients.includes('sendStatePOA')&&clients.includes('setPoaModal(true)')],
  ['Addendum quick action is wired',clients.includes('label="Addendum"')&&clients.includes('sendAddendumForSignature')&&clients.includes('sendAddendum')],
  ['Addendum fails closed unless its secure PDF link exists',docUtils.includes('Could not create secure addendum link')&&docUtils.includes('storage_path: path')],
  ['Rewrite quick action is present in the 10-button row',clients.includes('label="Rewrite"')&&clients.includes('sub="Default → New Plan"')&&clients.includes("repeat(10, 1fr)")],
  ['Rewrite saves new plan terms and increments rewrite history',clients.includes('async function saveRewritePlan()')&&clients.includes('contractFee: fee')&&clients.includes('payment_plan_changes: nextChanges')],
  ['Rewrite preserves services as arrays across TaxRes-family schemas',clients.includes('services:Array.isArray(c.services)?c.services:[]')&&clients.includes('services: plan.services')&&!clients.includes("JSON.parse(c.services||'[]')")],
  ['Rewrite creates a fresh token-bound agreement and routes delivery',clients.includes('sendAddendumForSignature(detail, plan, supabase, actor)')&&clients.includes('Review Your New Payment Plan')&&clients.includes('updated service/payment plan is ready to review and sign')],
  ['Client Portal quick action is wired',clients.includes('label="Client Portal"')&&clients.includes('InlinePortalForm')],
  ['Tax Organizer quick action is wired',clients.includes('label="Tax Organizer"')&&clients.includes('InlineOrganizerForm')],
  ['quick-action SMS uses tenant-aware Edge Function',!clients.includes("signalwire_backend + '/sms/send'")&&!clients.includes("signalwire_backend+'/sms/send'")&&clients.includes("functions.invoke('send-sms'")],
  ['quick-action email uses authenticated Edge Function',clients.includes("functions.invoke('send-email'")],
  ['shared SignPage uses secure archive endpoint',signPage.includes("functions.invoke('esign-archive-upload'")],
  ['shared e-sign schema provisions signer tokens',esignMigration.includes('signer_token')&&esignMigration.includes("encode(gen_random_bytes(32),'hex')")],
  ['shared e-sign archive is tenant-derived, not Nashville-hardcoded',esignArchive.includes(".eq('id',id).eq('signer_token',token)")&&!esignArchive.includes("const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'")],
  ['shared e-sign archive supports the complete signing lifecycle',['load','sign','read','notify','prepare','finalize'].every(a=>esignArchive.includes(`action==='${a}'`))],
  ['quick-action public routes exist', ['/portal/:id','/organizer/:id','/sign/:id'].every(r=>app.includes(`path="${r}"`))],
  ['all configured State POA PDFs exist', requiredStateForms.every(f=>fs.existsSync('public/state-forms/'+f))],
  ['all IRS pre-fill templates exist', requiredIrsTemplates.every(f=>fs.existsSync('public/templates/'+f))],
  ['Demo fax uses the TaxRes platform relay',sendFax.includes("'TRC-003','ADMIN'")&&sendFax.includes('platformRelay = true')],
  ['custom E-Sign upload cannot silently lose its PDF',clients.includes('Custom document upload failed')&&clients.includes('storage_path:path')],
  ['State POA requires a secure signed document URL',clients.includes('Could not create secure State POA link')&&clients.includes('storage_path:path')],
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
