const fs=require('fs')
const read=p=>read(p).replace(/\r\n/g,'\n')

const clients=read('src/pages/Clients.jsx')
const cases=read('src/pages/Cases.jsx')
const clientLink=read('src/components/ClientLink.jsx')
const signPage=read('src/pages/SignPage.jsx')
const esignArchive=read('supabase/functions/esign-archive-upload/index.ts')
const esignMigration=read('supabase/migrations/20260919213000_taxres_family_esign_tokens.sql')
const bookingWidget=read('src/components/BookingWidget.jsx')
const irsFormFiller=read('src/components/IRSFormFiller.jsx')
const docUtils=read('src/lib/docUtils.js')
const organizerRpcMigration=read('supabase/migrations/20260919235000_taxres_family_organizer_public_rpcs.sql')
const sendSms=read('supabase/functions/send-sms/index.ts')
const sendFax=read('supabase/functions/send-fax/index.ts')
const app=read('src/App.jsx')
const irsForms=read('src/lib/irsFormUtils.js')

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
  ['quick-action dependencies avoid native browser dialogs',!bookingWidget.includes('alert(')&&!bookingWidget.includes('confirm(')&&!bookingWidget.includes('prompt(')&&!clients.includes('alert(')&&!clients.includes('confirm(')&&!clients.includes('prompt(')],
  ['IRS pre-fill quick action is wired',clients.includes('label="Pre-Fill 8821/2848"')&&clients.includes('setFillerClient')],
  ['IRS form signing uses tokenized links and retained storage paths',irsFormFiller.includes('/sign/')&&irsFormFiller.includes('signer_token')&&irsFormFiller.includes('storage_path: path')],
  ['IRS form SMS uses tenant-aware Edge Function',irsFormFiller.includes("functions.invoke('send-sms'")&&!irsFormFiller.includes('signalwire_backend')],
  ['IRS form flow does not trigger clipboard permission prompts',!irsFormFiller.includes('navigator.clipboard.writeText')],
  ['State POA signing is tenant-bound and uses authenticated delivery',clients.includes('State POA')&&clients.includes('tenant_id: FIRM.tenantId || undefined')&&clients.includes("functions.invoke('send-sms'")&&clients.includes("functions.invoke('send-email'")],
  ['Addendum signing retains secure storage path and tenant binding',docUtils.includes('sendAddendumForSignature')&&docUtils.includes('storage_path: path')&&docUtils.includes('tenant_id: FIRM.tenantId || undefined')],
  ['Nashville organizer public link RPCs are provisioned',organizerRpcMigration.includes('organizer_get')&&organizerRpcMigration.includes('organizer_save_answers')&&organizerRpcMigration.includes('organizer_submit')&&organizerRpcMigration.includes('grant execute')],
  ['Demo and CloudCPA SMS relay through TaxRes when needed',sendSms.includes("'ADMIN'")&&sendSms.includes("'TRC-003'")&&sendSms.includes('61a89aef-0e7e-4ea2-b222-44ab2024655a')],
  ['Demo and CloudCPA fax relay through TaxRes when needed',sendFax.includes("'ADMIN'")&&sendFax.includes("'TRC-003'")&&sendFax.includes('61a89aef-0e7e-4ea2-b222-44ab2024655a')],
  ['Nashville fax quick action avoids duplicate provider logs',clients.includes("faxBackendAlreadyLogs")&&clients.includes("nashville.taxrescrm.app")],
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
