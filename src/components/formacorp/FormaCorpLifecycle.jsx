import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fillForm } from '../../lib/irsFormUtils'
import { buildOperatingAgreementPdf, buildBankingResolutionPdf } from '../../lib/formacorpDocs'

const BIZEE_DASHBOARD_URL = 'https://orders.bizee.com/dashboard/login'

const FL_SERVICE_GUIDE = {
  'Annual Report Filing': { fee:'$138.75', url:'https://dos.fl.gov/sunbiz/manage-business/efile/annual-report', note:'Keeps the LLC active; Florida posts online credit-card filings immediately.' },
  'Registered Agent Change': { fee:'$25', url:'https://dos.fl.gov/sunbiz/forms/limited-liability-company', note:'Use the Florida LLC registered-agent / registered-office change filing.' },
  'Business Amendment': { fee:'$25', url:'https://dos.fl.gov/sunbiz/forms/limited-liability-company', note:'Florida LLC amendments use the Division of Corporations amendment form.' },
  'DBA / Fictitious Name': { fee:'State fee varies', url:'https://dos.fl.gov/sunbiz/start-business/efile/fl-fictitious-name', note:'Florida fictitious-name registration is a separate filing.' },
  'Foreign Qualification': { fee:'State fee applies', url:'https://dos.fl.gov/sunbiz/forms/limited-liability-company', note:'Use the Foreign LLC qualification filing when expanding into Florida.' },
  'Certificate of Good Standing': { fee:'$5', url:'https://dos.fl.gov/sunbiz/manage-business/certification/', note:'Florida calls this a Certificate of Status.' },
  'Reinstatement': { fee:'$100 + annual reports due', url:'https://dos.fl.gov/sunbiz/manage-business/efile/reinstatement', note:'For administratively dissolved/revoked entities.' },
  'Dissolution': { fee:'$25', url:'https://dos.fl.gov/sunbiz/manage-business/dissolve-withdraw-business/', note:'Formal Florida LLC dissolution / withdrawal.' },
}

const SERVICES = [
  'Annual Report Filing',
  'Registered Agent Change',
  'Registered Agent Service',
  'Business Amendment',
  'DBA / Fictitious Name',
  'Foreign Qualification',
  'Certificate of Good Standing',
  'Business License & Permit Research',
  'S-Corp Election / Form 2553',
  'Reinstatement',
  'Dissolution',
  'Virtual Business Address',
  'Trademark Search / Filing',
  'Business Insurance',
  'Business Contracts',
  'Domain & Business Email',
  'Business Phone',
  'Bookkeeping / Accounting Setup',
]

const LIFECYCLE_TABS = [
  ['overview','Overview'],
  ['ein','EIN'],
  ['agreement','Operating Agreement'],
  ['banking','Banking'],
  ['compliance','Compliance'],
  ['services','Company Services'],
  ['documents','Documents'],
]

function nextFloridaAnnualReportDate(formationDate) {
  const d = formationDate ? new Date(formationDate + 'T12:00:00') : new Date()
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()+1}-05-01`
}

function safeFilename(v) {
  return String(v || 'company').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'company'
}

function numericFee(v) {
  const m=String(v||'').match(/\$?([0-9]+(?:\.[0-9]+)?)/)
  return m ? Number(m[1]) : null
}

function Field({label,children,help}) {
  return <div className="field" style={{marginBottom:10}}>
    <label>{label}</label>
    {children}
    {help && <div style={{fontSize:10,color:'var(--t3)',marginTop:4,lineHeight:1.4}}>{help}</div>}
  </div>
}

function StatusPill({value}) {
  const good = ['Received','Signed','Opened','Current','Active','Filed','Complete','Connected'].some(x=>String(value||'').includes(x))
  const warn = ['Pending','Requested','Due','In Progress','Action'].some(x=>String(value||'').includes(x))
  return <span className={`bdg ${good?'bg':warn?'ba':'bn'}`} style={{fontSize:10}}>{value || 'Not Started'}</span>
}

export default function FormaCorpLifecycle({ caseRecord, showToast, onCasePatch }) {
  const [tab,setTab]=useState('overview')
  const [lifecycle,setLifecycle]=useState(null)
  const [requests,setRequests]=useState([])
  const [documents,setDocuments]=useState([])
  const [docType,setDocType]=useState('State Filing / Acceptance')
  const [busy,setBusy]=useState('')
  const [serviceType,setServiceType]=useState(SERVICES[0])
  const [serviceNotes,setServiceNotes]=useState('')
  const [einValue,setEinValue]=useState(caseRecord?.ein || '')
  const [signedSS4,setSignedSS4]=useState(null)

  useEffect(()=>{ setEinValue(caseRecord?.ein || '') },[caseRecord?.id,caseRecord?.ein])

  async function load() {
    if (!caseRecord?.id) return
    const [{data:l,error:le},{data:r,error:re},{data:docs,error:de}] = await Promise.all([
      supabase.from('formacorp_lifecycle').select('*').eq('case_id',caseRecord.id).maybeSingle(),
      supabase.from('formacorp_service_requests').select('*').eq('case_id',caseRecord.id).order('requested_at',{ascending:false}),
      supabase.from('formacorp_documents').select('*').eq('case_id',caseRecord.id).order('created_at',{ascending:false}),
    ])
    if (le) console.error('[FormaCorp lifecycle] load',le)
    if (re) console.error('[FormaCorp services] load',re)
    if (de) console.error('[FormaCorp documents] load',de)
    if (l) {
      let synced=l
      if(l.operating_agreement_esign_id){
        const {data:esign}=await supabase.from('esigns').select('id,status,signed_at,signeddate').eq('id',l.operating_agreement_esign_id).maybeSingle()
        const signed=esign && ['Signed','Completed','Complete'].includes(String(esign.status||''))
        if(signed && l.operating_agreement_status!=='Signed'){
          const signedAt=esign.signed_at || esign.signeddate || new Date().toISOString()
          const {data:updated}=await supabase.from('formacorp_lifecycle').update({operating_agreement_status:'Signed',operating_agreement_signed_at:signedAt,updated_at:new Date().toISOString()}).eq('id',l.id).select().single()
          if(updated)synced=updated
          if(caseRecord.stage==='Operating Agreement'){
            await supabase.from('formacorp').update({stage:'Bank Account Setup'}).eq('id',caseRecord.id)
            onCasePatch?.({stage:'Bank Account Setup'})
          }
        }
      }
      setLifecycle(synced)
      if (synced.annual_report_due_date) {
        await upsertComplianceDeadline('annual_report',synced.annual_report_due_date,`${caseRecord.entity_name} Annual Report`)
      }
      if (synced.registered_agent_renewal_date) {
        await upsertComplianceDeadline('registered_agent',synced.registered_agent_renewal_date,`${caseRecord.entity_name} Registered Agent Renewal`)
      }
    } else {
      const seed={
        case_id:caseRecord.id,
        service_plan:'Launch',
        selected_services:['State Filing','EIN','Operating Agreement','Banking','Compliance'],
        ein_status:caseRecord.ein?'Received':'Not Started',
        ein_responsible_party_name:caseRecord.authorized_representative || caseRecord.client_name || '',
        operating_agreement_status:'Not Started',
        banking_status:'Not Started',
        bank_account_type:'Business Checking',
        bank_signer:caseRecord.authorized_representative || caseRecord.client_name || '',
        annual_report_status:'Not Due',
        annual_report_due_date:caseRecord.state==='FL' ? nextFloridaAnnualReportDate(caseRecord.formation_date) : null,
        good_standing_status:caseRecord.state_file_num ? 'Verify with state' : 'Unknown',
      }
      const {data:newRow,error}=await supabase.from('formacorp_lifecycle').insert([seed]).select().single()
      if (error) console.error('[FormaCorp lifecycle] seed',error)
      else {
        setLifecycle(newRow)
        if (newRow.annual_report_due_date) {
          await upsertComplianceDeadline('annual_report',newRow.annual_report_due_date,`${caseRecord.entity_name} Annual Report`)
        }
      }
    }
    setRequests(r || [])
    setDocuments(docs || [])
  }

  useEffect(()=>{ load() },[caseRecord?.id])

  async function savePatch(patch, toast='Saved') {
    if (!lifecycle?.id) return false
    setBusy('save')
    const payload={...patch,updated_at:new Date().toISOString()}
    const {data,error}=await supabase.from('formacorp_lifecycle').update(payload).eq('id',lifecycle.id).select().single()
    setBusy('')
    if (error) { showToast?.('FormaCorp update failed: '+error.message,'err'); return false }
    setLifecycle(data)
    if (toast) showToast?.(toast)
    return true
  }

  function setLocal(k,v){ setLifecycle(x=>({...x,[k]:v})) }

  async function saveCurrent() {
    const {
      id,tenant_id,case_id,created_at,...rest
    }=lifecycle || {}
    await savePatch(rest,'✅ FormaCorp lifecycle saved')
  }

  async function uploadGenerated(blob, label, pathSuffix) {
    const path=`formacorp/${caseRecord.id}/${pathSuffix}`
    const {error:upErr}=await supabase.storage.from('documents').upload(path,blob,{upsert:true,contentType:'application/pdf'})
    if(upErr) throw upErr
    const {data:urlData,error:urlErr}=await supabase.storage.from('documents').createSignedUrl(path,94608000)
    if(urlErr) throw urlErr
    const url=urlData?.signedUrl || ''
    const fileName=pathSuffix.split('/').pop()
    const {error:vaultErr}=await supabase.from('formacorp_documents').insert([{
      case_id:caseRecord.id,
      document_type:label,
      file_name:fileName,
      storage_path:path,
      source:'FormaCorp',
    }])
    if(vaultErr) console.error('[FormaCorp vault index]',vaultErr)
    const {error:docErr}=await supabase.from('documents').insert([{
      clientname:caseRecord.client_name,
      client:caseRecord.client_name,
      type:'FormaCorp',
      docType:'Business Formation',
      filename:fileName,
      file_name:fileName,
      url,
      file_url:url,
      notes:label,
      source:'FormaCorp',
    }])
    if(docErr) console.error('[FormaCorp document index]',docErr)
    return {path,url,fileName}
  }

  async function uploadCompanyDocument(file) {
    if(!file)return
    setBusy('upload')
    try{
      const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'-')
      const path=`formacorp/${caseRecord.id}/uploads/${Date.now()}-${safe}`
      const {error:upErr}=await supabase.storage.from('documents').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'})
      if(upErr)throw upErr
      const {data:row,error:idxErr}=await supabase.from('formacorp_documents').insert([{
        case_id:caseRecord.id,document_type:docType,file_name:file.name,storage_path:path,source:'Uploaded'
      }]).select().single()
      if(idxErr)throw idxErr
      const {data:urlData}=await supabase.storage.from('documents').createSignedUrl(path,94608000)
      try {
        await supabase.from('documents').insert([{
          clientname:caseRecord.client_name,client:caseRecord.client_name,type:'FormaCorp',docType:'Business Formation',
          filename:file.name,file_name:file.name,url:urlData?.signedUrl||'',file_url:urlData?.signedUrl||'',notes:docType,source:'FormaCorp'
        }])
      } catch (_) {}
      setDocuments(x=>[row,...x])
      showToast?.('✅ Company document uploaded')
    }catch(e){showToast?.('Document upload failed: '+(e?.message||e),'err')}
    finally{setBusy('')}
  }

  async function downloadCompanyDocument(doc) {
    try{
      const {data,error}=await supabase.storage.from('documents').createSignedUrl(doc.storage_path,300)
      if(error||!data?.signedUrl)throw error||new Error('Could not create secure download link')
      window.open(data.signedUrl,'_blank','noopener,noreferrer')
    }catch(e){showToast?.('Could not open document: '+(e?.message||e),'err')}
  }

  async function generateSS4() {
    setBusy('ss4')
    try {
      const bytes=await fillForm('ss4',{
        name:caseRecord.authorized_representative || caseRecord.client_name,
        business_name:caseRecord.entity_name,
        trade_name:'',
        address:caseRecord.principal_address,
        street:caseRecord.principal_address,
        state:caseRecord.state,
        ein:caseRecord.ein || '',
      },true)
      const blob=new Blob([bytes],{type:'application/pdf'})
      const stamp=Date.now()
      const doc=await uploadGenerated(blob,'FormaCorp — Form SS-4 EIN application draft',`SS-4-${safeFilename(caseRecord.entity_name)}-${stamp}.pdf`)
      await savePatch({ss4_document_path:doc.path,ein_status:lifecycle.ein_status==='Not Started'?'Draft Prepared':lifecycle.ein_status},'✅ SS-4 draft generated and filed in Documents')
    } catch(e) {
      showToast?.('Could not generate SS-4: '+(e?.message||e),'err')
    } finally { setBusy('') }
  }

  async function submitSignedSS4ByFax() {
    if(!signedSS4){showToast?.('Attach the signed Form SS-4 first','err');return}
    setBusy('ss4fax')
    try{
      const safe=signedSS4.name.replace(/[^a-zA-Z0-9._-]+/g,'-')
      const path=`formacorp/${caseRecord.id}/ein/${Date.now()}-${safe}`
      const {error:upErr}=await supabase.storage.from('documents').upload(path,signedSS4,{upsert:false,contentType:'application/pdf'})
      if(upErr)throw upErr
      const {data:urlData,error:urlErr}=await supabase.storage.from('documents').createSignedUrl(path,3600)
      if(urlErr||!urlData?.signedUrl)throw urlErr||new Error('Could not create secure SS-4 filing URL')
      const {data:fax,error:faxErr}=await supabase.functions.invoke('send-fax',{body:{
        to:'+18556416935',
        document_url:urlData.signedUrl
      }})
      if(faxErr)throw faxErr
      if(!fax?.success)throw new Error(fax?.error||'Fax provider rejected the SS-4')
      await supabase.from('formacorp_documents').insert([{
        case_id:caseRecord.id,document_type:'Signed SS-4 / EIN Application',file_name:signedSS4.name,storage_path:path,source:'FormaCorp EIN Fax'
      }])
      await savePatch({
        ein_status:'Submitted',
        ein_application_method:'Form SS-4 / Fax',
        ein_requested_at:new Date().toISOString(),
        ein_confirmation_ref:fax.sid || lifecycle.ein_confirmation_ref || null,
        ss4_document_path:path,
      },'')
      setSignedSS4(null)
      showToast?.('✅ Signed SS-4 faxed to IRS EIN Operation and submission reference recorded')
    }catch(e){showToast?.('SS-4 fax submission failed: '+(e?.message||e),'err')}
    finally{setBusy('')}
  }

  async function recordEin() {
    const value=String(einValue||'').trim()
    if(!/^\d{2}-\d{7}$/.test(value)){ showToast?.('Enter the EIN as XX-XXXXXXX','err'); return }
    setBusy('ein')
    const now=new Date().toISOString()
    const {error}=await supabase.from('formacorp').update({ein:value,stage:'Operating Agreement'}).eq('id',caseRecord.id)
    if(error){ setBusy(''); showToast?.('Could not save EIN: '+error.message,'err'); return }
    await savePatch({ein_status:'Received',ein_received_at:now},'',)
    setBusy('')
    onCasePatch?.({ein:value,stage:'Operating Agreement'})
    showToast?.('✅ EIN recorded — Operating Agreement is next')
  }

  async function generateOperatingAgreement() {
    setBusy('agreement')
    try {
      const blob=await buildOperatingAgreementPdf(caseRecord,lifecycle)
      const stamp=Date.now()
      const doc=await uploadGenerated(blob,'FormaCorp — Operating Agreement draft',`Operating-Agreement-${safeFilename(caseRecord.entity_name)}-${stamp}.pdf`)
      await savePatch({operating_agreement_status:'Draft Generated',operating_agreement_generated_at:new Date().toISOString(),operating_agreement_path:doc.path},'✅ Operating Agreement draft generated and filed in Documents')
    }catch(e){showToast?.('Could not generate Operating Agreement: '+(e?.message||e),'err')}
    finally{setBusy('')}
  }

  async function sendAgreementForSignature() {
    if(!lifecycle.operating_agreement_path){showToast?.('Generate the Operating Agreement first','err');return}
    const to=String(caseRecord.correspondence_email||'').trim()
    if(!to){showToast?.('Add the correspondence email before sending for signature','err');return}
    setBusy('esign')
    try{
      const {data:urlData,error:urlErr}=await supabase.storage.from('documents').createSignedUrl(lifecycle.operating_agreement_path,60*60*24*30)
      if(urlErr||!urlData?.signedUrl)throw urlErr||new Error('Could not create document link')
      const {data:esign,error:esignErr}=await supabase.from('esigns').insert([{
        doc_type:'FormaCorp Operating Agreement',
        client_name:caseRecord.client_name,
        client_email:to,
        message:`Please review and sign the Operating Agreement for ${caseRecord.entity_name}.`,
        pdf_attachments:[{formType:'formacorp_operating_agreement',label:'Operating Agreement',url:urlData.signedUrl}],
        priority:'Normal',
        status:'Awaiting',
        sent_at:new Date().toISOString(),
        created_at:new Date().toISOString(),
      }]).select().single()
      if(esignErr)throw esignErr
      const signUrl=`${window.location.origin}/sign/${esign.id}`
      const {error:mailErr}=await supabase.functions.invoke('send-email',{body:{
        to,
        subject:`Signature Required: ${caseRecord.entity_name} Operating Agreement`,
        html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px"><h2>Operating Agreement Ready</h2><p>Please review and sign the Operating Agreement for <strong>${caseRecord.entity_name}</strong>.</p><p style="margin:24px 0"><a href="${signUrl}" style="background:#1d4ed8;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Review & Sign</a></p></div>`
      }})
      await savePatch({operating_agreement_status:'Awaiting Signature',operating_agreement_esign_id:esign.id},'',)
      if(mailErr){await navigator.clipboard.writeText(signUrl).catch(()=>{});showToast?.('Signing request created; email failed, so the signing link was copied','err')}
      else showToast?.('✅ Operating Agreement sent for e-signature')
    }catch(e){showToast?.('Could not create signing request: '+(e?.message||e),'err')}
    finally{setBusy('')}
  }

  async function markAgreementSigned() {
    const ok=await savePatch({operating_agreement_status:'Signed',operating_agreement_signed_at:new Date().toISOString()},'',)
    if(!ok)return
    const {error}=await supabase.from('formacorp').update({stage:'Bank Account Setup'}).eq('id',caseRecord.id)
    if(!error){onCasePatch?.({stage:'Bank Account Setup'});showToast?.('✅ Operating Agreement signed — Banking is next')}
  }

  async function generateBankingResolution() {
    setBusy('bankdoc')
    try {
      const blob=await buildBankingResolutionPdf(caseRecord,lifecycle)
      const stamp=Date.now()
      const doc=await uploadGenerated(blob,'FormaCorp — Banking Resolution / account-opening record',`Banking-Resolution-${safeFilename(caseRecord.entity_name)}-${stamp}.pdf`)
      await savePatch({banking_resolution_path:doc.path,bank_documents_ready:true},'✅ Banking resolution generated and filed in Documents')
    }catch(e){showToast?.('Could not generate banking resolution: '+(e?.message||e),'err')}
    finally{setBusy('')}
  }

  async function markBankOpened() {
    if(!String(lifecycle.bank_name||'').trim()){showToast?.('Enter the bank or credit union first','err');return}
    if(lifecycle.bank_account_last4 && !/^\d{4}$/.test(String(lifecycle.bank_account_last4))){showToast?.('Store only the final 4 account digits','err');return}
    const ok=await savePatch({banking_status:'Opened',bank_opened_at:lifecycle.bank_opened_at || new Date().toISOString().slice(0,10)},'',)
    if(!ok)return
    const {error}=await supabase.from('formacorp').update({stage:'Compliance & Maintenance'}).eq('id',caseRecord.id)
    if(!error){onCasePatch?.({stage:'Compliance & Maintenance'});showToast?.('✅ Business banking recorded — Compliance & Maintenance is now active')}
  }

  async function upsertComplianceDeadline(kind,due,title) {
    if(!due)return
    const marker=`[FormaCorp:${caseRecord.id}:${kind}]`
    const {data:existing}=await supabase.from('deadlines').select('id').eq('notes',marker).maybeSingle()
    const payload={
      name:title,title,client:caseRecord.client_name,clientname:caseRecord.client_name,clientName:caseRecord.client_name,
      type:'Business Compliance',duedate:due,dueDate:due,due_date:due,status:'Tracking',notes:marker,
    }
    return existing?.id
      ? supabase.from('deadlines').update(payload).eq('id',existing.id)
      : supabase.from('deadlines').insert([payload])
  }

  async function syncAnnualReportDeadline() {
    const due=lifecycle.annual_report_due_date
    if(!due){showToast?.('Set an annual-report due date first','err');return}
    const res=await upsertComplianceDeadline('annual_report',due,`${caseRecord.entity_name} Annual Report`)
    if(res.error){showToast?.('Could not sync deadline: '+res.error.message,'err');return}
    showToast?.('✅ Annual-report deadline synced to CRM Deadlines')
  }

  async function recordAnnualReportFiled() {
    const confirmation=window.prompt('Annual report confirmation / receipt number:',lifecycle.annual_report_confirmation||'')
    if(confirmation===null)return
    const filed=new Date().toISOString().slice(0,10)
    let nextDue=lifecycle.annual_report_due_date
    if(nextDue){
      const d=new Date(nextDue+'T12:00:00')
      if(!Number.isNaN(d.getTime())) nextDue=`${d.getFullYear()+1}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    }
    const ok=await savePatch({annual_report_status:'Filed',annual_report_filed_at:filed,annual_report_confirmation:String(confirmation||'').trim(),annual_report_due_date:nextDue},'',)
    if(!ok)return
    if(nextDue)await upsertComplianceDeadline('annual_report',nextDue,`${caseRecord.entity_name} Annual Report`)
    showToast?.('✅ Annual report filed and next compliance deadline rolled forward')
  }

  async function syncRegisteredAgentRenewal() {
    const due=lifecycle.registered_agent_renewal_date
    if(!due){showToast?.('Set a registered-agent renewal date first','err');return}
    const res=await upsertComplianceDeadline('registered_agent',due,`${caseRecord.entity_name} Registered Agent Renewal`)
    if(res?.error){showToast?.('Could not sync registered-agent deadline: '+res.error.message,'err');return}
    showToast?.('✅ Registered-agent renewal synced to CRM Deadlines')
  }

  async function createServiceRequest() {
    setBusy('service')
    const {data,error}=await supabase.from('formacorp_service_requests').insert([{
      case_id:caseRecord.id,
      service_type:serviceType,
      status:'Requested',
      jurisdiction_state:caseRecord.state || null,
      agency:caseRecord.state==='FL' ? 'Florida Division of Corporations' : null,
      state_fee:caseRecord.state==='FL' ? numericFee(FL_SERVICE_GUIDE[serviceType]?.fee) : null,
      payment_status:'Pending',
      notes:serviceNotes.trim() || null,
    }]).select().single()
    if(error){setBusy('');showToast?.('Could not create service request: '+error.message,'err');return}
    const taskTitle=`FormaCorp: ${serviceType} — ${caseRecord.entity_name}`
    await supabase.from('tasks').insert([{
      title:taskTitle,
      clientName:caseRecord.client_name,
      linkedcase:caseRecord.entity_name,
      dueDate:null,
      priority:'Normal',
      done:false,
      notes:`FormaCorp service request ${data.id}. ${serviceNotes.trim() || ''}`,
      section_title:'FormaCorp',
      status_category:'To Do',
      status_label:'Ready to Start',
    }])
    setBusy('')
    setRequests(x=>[data,...x]);setServiceNotes('')
    showToast?.('✅ FormaCorp service request created and added to Tasks')
  }

  async function generate2553() {
    if(!caseRecord.ein){showToast?.('Record the EIN before preparing Form 2553','err');return}
    setBusy('2553')
    try{
      const bytes=await fillForm('2553',{
        name:caseRecord.authorized_representative || caseRecord.client_name,
        business_name:caseRecord.entity_name,
        address:caseRecord.principal_address,
        street:caseRecord.principal_address,
        state:caseRecord.state,
        ein:caseRecord.ein,
      },true)
      const blob=new Blob([bytes],{type:'application/pdf'})
      const doc=await uploadGenerated(blob,'FormaCorp — Form 2553 S-Corp election draft',`Form-2553-${safeFilename(caseRecord.entity_name)}-${Date.now()}.pdf`)
      await savePatch({s_corp_election_status:'Ready'},'✅ Form 2553 draft generated and filed in Documents')
      return doc
    }catch(e){showToast?.('Could not generate Form 2553: '+(e?.message||e),'err')}
    finally{setBusy('')}
  }

  async function updateRequest(id,status) {
    const patch={status,completed_at:status==='Complete'?new Date().toISOString():null}
    if(status==='Submitted'){
      const ref=window.prompt('Submission / tracking reference (optional):','')
      if(ref===null)return
      patch.submission_reference=String(ref||'').trim()||null
      patch.submitted_at=new Date().toISOString()
    }
    if(status==='Complete'){
      const conf=window.prompt('Completion / agency confirmation (optional):','')
      if(conf===null)return
      patch.confirmation=String(conf||'').trim()||null
    }
    const {data,error}=await supabase.from('formacorp_service_requests').update(patch).eq('id',id).select().single()
    if(error){showToast?.('Service update failed: '+error.message,'err');return}
    setRequests(x=>x.map(r=>r.id===id?data:r))
    const email=String(caseRecord.correspondence_email||'').trim()
    if(email){
      supabase.functions.invoke('send-email',{body:{
        to:email,
        subject:`FormaCorp Update: ${data.service_type} — ${data.status}`,
        html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px"><h2>FormaCorp Service Update</h2><p><strong>${caseRecord.entity_name}</strong></p><p>${data.service_type}: <strong>${data.status}</strong></p>${data.submission_reference?`<p>Submission reference: ${data.submission_reference}</p>`:''}${data.confirmation?`<p>Confirmation: ${data.confirmation}</p>`:''}<p>Open the CRM for the current company record and documents.</p></div>`
      }}).catch(()=>{})
    }
  }

  async function updateRequestPayment(id,payment_status) {
    const {data,error}=await supabase.from('formacorp_service_requests').update({payment_status}).eq('id',id).select().single()
    if(error){showToast?.('Payment status update failed: '+error.message,'err');return}
    setRequests(x=>x.map(r=>r.id===id?data:r))
  }

  const visibleTabs=useMemo(()=>{
    const selected=new Set(Array.isArray(lifecycle?.selected_services)?lifecycle.selected_services:[])
    return LIFECYCLE_TABS.filter(([id])=>{
      if(['overview','compliance','services','documents'].includes(id)) return true
      if(id==='ein') return selected.has('EIN')
      if(id==='agreement') return selected.has('Operating Agreement')
      if(id==='banking') return selected.has('Banking')
      return true
    })
  },[lifecycle?.selected_services])

  useEffect(()=>{
    if(lifecycle && !visibleTabs.some(([id])=>id===tab)) setTab('overview')
  },[lifecycle?.id, visibleTabs, tab])

  const score=useMemo(()=>{
    if(!lifecycle)return 0
    const flags=[
      !!caseRecord.state_file_num,
      !!caseRecord.ein,
      lifecycle.operating_agreement_status==='Signed',
      lifecycle.banking_status==='Opened',
      !!lifecycle.annual_report_due_date,
      ['Current','Active'].includes(lifecycle.good_standing_status),
    ]
    return Math.round(flags.filter(Boolean).length/flags.length*100)
  },[lifecycle,caseRecord.state_file_num,caseRecord.ein])

  if(!lifecycle) return <div className="card" style={{padding:16,marginBottom:10,color:'var(--t3)',fontSize:12}}>Loading FormaCorp lifecycle…</div>

  const inputStyle={width:'100%',padding:'7px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}

  return <div className="card" style={{padding:'14px 16px',marginBottom:10}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginBottom:12}}>
      <div>
        <div className="stitle">🏢 Company Lifecycle</div>
        <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Formation is only the beginning: EIN, governing documents, banking, compliance, and company changes live here.</div>
      </div>
      <div style={{textAlign:'right'}}>
        <div style={{fontSize:18,fontWeight:800}}>{score}%</div>
        <div style={{fontSize:9,color:'var(--t3)',textTransform:'uppercase'}}>launch readiness</div>
        <div style={{fontSize:9,color:'var(--blue)',fontWeight:700,marginTop:3}}>{lifecycle.service_plan || 'Launch'} plan</div>
        <div style={{fontSize:8,color:'var(--t3)',marginTop:2}}>{Array.isArray(lifecycle.selected_services)?lifecycle.selected_services.length:0} services enabled</div>
      </div>
    </div>

    <div style={{display:'flex',gap:5,flexWrap:'wrap',borderBottom:'1px solid var(--br)',paddingBottom:8,marginBottom:12}}>
      {visibleTabs.map(([id,label])=><button key={id} className={`btn sm ${tab===id?'pri':''}`} onClick={()=>setTab(id)}>{label}</button>)}
    </div>

    {tab==='overview' && <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8}}>
        {[
          ['State Formation',caseRecord.state_file_num?'Accepted':'In Progress'],
          ['EIN',caseRecord.ein?'Received':lifecycle.ein_status],
          ['Operating Agreement',lifecycle.operating_agreement_status],
          ['Business Banking',lifecycle.banking_status],
          ['Annual Report',lifecycle.annual_report_status],
          ['Good Standing',lifecycle.good_standing_status],
        ].map(([label,value])=><div key={label} style={{padding:'10px 12px',background:'var(--s2)',borderRadius:8,border:'1px solid var(--br)'}}><div style={{fontSize:10,color:'var(--t3)',marginBottom:6}}>{label}</div><StatusPill value={value}/></div>)}
      </div>
      <div style={{fontSize:11,color:'var(--t3)',lineHeight:1.6,marginTop:10}}>This dashboard intentionally does not store full bank account or routing numbers. Sensitive banking credentials belong with the bank; FormaCorp stores status, last four digits, and supporting documents only.</div>
    </div>}

    {tab==='ein' && <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Field label="EIN Workflow Status"><select value={lifecycle.ein_status||'Not Started'} onChange={e=>setLocal('ein_status',e.target.value)} style={inputStyle}>{['Not Started','Draft Prepared','Ready to Apply','Submitted','Pending','Received','Action Required'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Responsible Party Name"><input value={lifecycle.ein_responsible_party_name||''} onChange={e=>setLocal('ein_responsible_party_name',e.target.value)} style={inputStyle}/></Field>
        <Field label="Application Method"><select value={lifecycle.ein_application_method||''} onChange={e=>setLocal('ein_application_method',e.target.value)} style={inputStyle}><option value="">— Select —</option><option>IRS Online</option><option>Form SS-4</option><option>Fax</option><option>Mail</option><option>Phone / International</option></select></Field>
        <Field label="IRS Confirmation / Reference"><input value={lifecycle.ein_confirmation_ref||''} onChange={e=>setLocal('ein_confirmation_ref',e.target.value)} style={inputStyle}/></Field>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
        <button className="btn sm" onClick={generateSS4} disabled={busy==='ss4'}>{busy==='ss4'?'Generating…':'📄 Generate SS-4 Draft'}</button>
        <a className="btn sm" href="https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number" target="_blank" rel="noreferrer">🏛️ Open Official IRS EIN</a>
        <button className="btn sm" onClick={saveCurrent} disabled={busy==='save'}>💾 Save EIN Workflow</button>
      </div>
      <div style={{padding:'10px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:800,marginBottom:4}}>Submit EIN application from FormaCorp</div>
        <div style={{fontSize:10,color:'var(--t3)',lineHeight:1.5,marginBottom:8}}>For a U.S. business, IRS currently accepts signed Form SS-4 by fax at 855-641-6935. Attach the completed and signed SS-4; FormaCorp sends it through the CRM fax service and records the provider submission reference. The IRS generally returns an EIN by fax in about 4 business days when a return fax number is provided on the form.</div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <input type="file" accept="application/pdf" onChange={e=>setSignedSS4(e.target.files?.[0]||null)} style={{fontSize:11,flex:1,minWidth:220}}/>
          <button className="btn pri sm" onClick={submitSignedSS4ByFax} disabled={busy==='ss4fax'||!signedSS4}>{busy==='ss4fax'?'Faxing…':'📠 Fax Signed SS-4 to IRS'}</button>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,alignItems:'end'}}>
        <Field label="Issued EIN" help="Stored in the existing protected CRM EIN field."><input value={einValue} onChange={e=>setEinValue(e.target.value)} placeholder="XX-XXXXXXX" style={inputStyle}/></Field>
        <button className="btn pri" style={{marginBottom:10}} onClick={recordEin} disabled={busy==='ein'}>Record EIN</button>
      </div>
    </div>}

    {tab==='agreement' && <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Field label="Operating Agreement Status"><select value={lifecycle.operating_agreement_status||'Not Started'} onChange={e=>setLocal('operating_agreement_status',e.target.value)} style={inputStyle}>{['Not Started','Draft Generated','Sent for Review','Awaiting Signature','Signed','Needs Revision'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Signed Date"><input type="date" value={lifecycle.operating_agreement_signed_at?String(lifecycle.operating_agreement_signed_at).slice(0,10):''} onChange={e=>setLocal('operating_agreement_signed_at',e.target.value?new Date(e.target.value+'T12:00:00').toISOString():null)} style={inputStyle}/></Field>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn sm" onClick={generateOperatingAgreement} disabled={busy==='agreement'}>{busy==='agreement'?'Generating…':'📄 Generate Operating Agreement'}</button>
        <button className="btn sm" onClick={sendAgreementForSignature} disabled={busy==='esign'}>{busy==='esign'?'Sending…':'✍️ Send for E-Signature'}</button>
        <button className="btn sm" onClick={saveCurrent}>💾 Save</button>
        <button className="btn pri sm" onClick={markAgreementSigned}>✅ Mark Signed & Continue</button>
      </div>
    </div>}

    {tab==='banking' && <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Field label="Banking Status"><select value={lifecycle.banking_status||'Not Started'} onChange={e=>setLocal('banking_status',e.target.value)} style={inputStyle}>{['Not Started','Documents Ready','Application Started','Pending Bank Review','Opened','Action Required','Declined'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Bank / Credit Union"><input value={lifecycle.bank_name||''} onChange={e=>setLocal('bank_name',e.target.value)} style={inputStyle}/></Field>
        <Field label="Account Type"><select value={lifecycle.bank_account_type||'Business Checking'} onChange={e=>setLocal('bank_account_type',e.target.value)} style={inputStyle}>{['Business Checking','Business Savings','Money Market','Merchant Account','Other'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Account Last 4 Digits" help="Never enter the full account number."><input maxLength={4} inputMode="numeric" value={lifecycle.bank_account_last4||''} onChange={e=>setLocal('bank_account_last4',e.target.value.replace(/\D/g,'').slice(0,4))} style={inputStyle}/></Field>
        <Field label="Authorized Signer"><input value={lifecycle.bank_signer||''} onChange={e=>setLocal('bank_signer',e.target.value)} style={inputStyle}/></Field>
        <Field label="Account Opened Date"><input type="date" value={lifecycle.bank_opened_at||''} onChange={e=>setLocal('bank_opened_at',e.target.value||null)} style={inputStyle}/></Field>
        <Field label="Opening Deposit"><input type="number" min="0" step="0.01" value={lifecycle.bank_opening_deposit ?? ''} onChange={e=>setLocal('bank_opening_deposit',e.target.value===''?null:Number(e.target.value))} style={inputStyle}/></Field>
        <Field label="Bookkeeping Connection"><select value={lifecycle.bookkeeping_status||'Not Connected'} onChange={e=>setLocal('bookkeeping_status',e.target.value)} style={inputStyle}>{['Not Connected','Planned','Connected','Needs Attention'].map(x=><option key={x}>{x}</option>)}</select></Field>
      </div>
      <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,marginBottom:10}}><input type="checkbox" checked={!!lifecycle.bank_documents_ready} onChange={e=>setLocal('bank_documents_ready',e.target.checked)} style={{width:'auto'}}/> Formation document, EIN confirmation, Operating Agreement, and signer ID are ready for the bank.</label>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn sm" onClick={generateBankingResolution} disabled={busy==='bankdoc'}>{busy==='bankdoc'?'Generating…':'📄 Generate Banking Resolution'}</button>
        <button className="btn sm" onClick={saveCurrent}>💾 Save Banking</button>
        <button className="btn pri sm" onClick={markBankOpened}>✅ Mark Account Opened</button>
      </div>
    </div>}

    {tab==='compliance' && <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Field label="Registered Agent Status"><select value={lifecycle.registered_agent_status||'Client / Self'} onChange={e=>setLocal('registered_agent_status',e.target.value)} style={inputStyle}>{['Client / Self','Third Party','Service Requested','Change Requested','Action Required'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Registered Agent Renewal"><input type="date" value={lifecycle.registered_agent_renewal_date||''} onChange={e=>setLocal('registered_agent_renewal_date',e.target.value||null)} style={inputStyle}/></Field>
        <Field label="Annual Report Status"><select value={lifecycle.annual_report_status||'Not Due'} onChange={e=>setLocal('annual_report_status',e.target.value)} style={inputStyle}>{['Not Due','Upcoming','Due','Ready to File','Filed','Late','Action Required'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Annual Report Due Date"><input type="date" value={lifecycle.annual_report_due_date||''} onChange={e=>setLocal('annual_report_due_date',e.target.value||null)} style={inputStyle}/></Field>
        <Field label="Good Standing"><select value={lifecycle.good_standing_status||'Unknown'} onChange={e=>setLocal('good_standing_status',e.target.value)} style={inputStyle}>{['Unknown','Verify with state','Current','Active','Not in Good Standing','Action Required'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Annual Report Confirmation"><input value={lifecycle.annual_report_confirmation||''} onChange={e=>setLocal('annual_report_confirmation',e.target.value)} style={inputStyle}/></Field>
        <Field label="S-Corp Election"><select value={lifecycle.s_corp_election_status||'Not Requested'} onChange={e=>setLocal('s_corp_election_status',e.target.value)} style={inputStyle}>{['Not Requested','Considering','Ready','Filed','Accepted','Rejected / Action Required'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="DBA / Fictitious Name"><select value={lifecycle.dba_status||'Not Requested'} onChange={e=>setLocal('dba_status',e.target.value)} style={inputStyle}>{['Not Requested','Requested','Filed','Active','Action Required'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Business Licenses / Permits"><select value={lifecycle.business_license_status||'Not Reviewed'} onChange={e=>setLocal('business_license_status',e.target.value)} style={inputStyle}>{['Not Reviewed','Research Needed','In Progress','Complete','Action Required'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Foreign Qualification"><select value={lifecycle.foreign_qualification_status||'Not Requested'} onChange={e=>setLocal('foreign_qualification_status',e.target.value)} style={inputStyle}>{['Not Requested','Requested','In Progress','Active','Action Required'].map(x=><option key={x}>{x}</option>)}</select></Field>
      </div>
      <Field label="Compliance Notes"><textarea rows={3} value={lifecycle.compliance_notes||''} onChange={e=>setLocal('compliance_notes',e.target.value)} style={{...inputStyle,resize:'vertical'}}/></Field>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn sm" onClick={saveCurrent}>💾 Save Compliance</button>
        <button className="btn sm" onClick={syncAnnualReportDeadline}>⏰ Sync Annual Report Deadline</button>
        <button className="btn sm" onClick={recordAnnualReportFiled}>✅ Record Annual Report Filed</button>
        <button className="btn sm" onClick={syncRegisteredAgentRenewal}>⏰ Sync Agent Renewal</button>
        <button className="btn sm" onClick={generate2553} disabled={busy==='2553'}>{busy==='2553'?'Generating…':'📄 Generate Form 2553'}</button>
        {caseRecord.state==='FL' && <a className="btn sm" href="https://efile.sunbiz.org/sbs_webapp/" target="_blank" rel="noreferrer">☀️ Florida Annual Report</a>}
      </div>
    </div>}

    {tab==='services' && <div>
      <div style={{fontSize:11,color:'var(--t3)',marginBottom:10,lineHeight:1.5}}>Ongoing company work belongs here instead of disappearing into notes. Requests can track amendments, DBA, foreign qualification, certificates, reinstatement, dissolution, registered-agent changes, annual reports, licensing, S-Corp election, and virtual address work.</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,alignItems:'end'}}>
        <Field label="Service"><select value={serviceType} onChange={e=>setServiceType(e.target.value)} style={inputStyle}>{SERVICES.map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Request Notes"><input value={serviceNotes} onChange={e=>setServiceNotes(e.target.value)} placeholder="What needs to change / be filed?" style={inputStyle}/></Field>
      </div>
      <div style={{padding:'9px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,fontSize:11,lineHeight:1.5,marginBottom:8}}>
        <strong>Primary fulfillment: Bizee Pro.</strong> Create the CRM service request here, then complete the provider workflow in the office's Bizee Pro dashboard.
        <a href={BIZEE_DASHBOARD_URL} target="_blank" rel="noreferrer" style={{marginLeft:8,color:'var(--blue)',fontWeight:700}}>Open Bizee Pro ↗</a>
        {caseRecord.state==='FL' && FL_SERVICE_GUIDE[serviceType] && <details style={{marginTop:6}}>
          <summary style={{cursor:'pointer',color:'var(--t3)',fontSize:10}}>Direct Florida fallback / reference</summary>
          <div style={{marginTop:4}}>{FL_SERVICE_GUIDE[serviceType].fee} · {FL_SERVICE_GUIDE[serviceType].note} <a href={FL_SERVICE_GUIDE[serviceType].url} target="_blank" rel="noreferrer" style={{color:'var(--blue)',fontWeight:700}}>Official state page ↗</a></div>
        </details>}
      </div>
      <button className="btn pri sm" onClick={createServiceRequest} disabled={busy==='service'}>{busy==='service'?'Creating…':'＋ Create Service Request'}</button>
      <div style={{marginTop:12}}>
        {requests.length===0?<div style={{fontSize:12,color:'var(--t3)'}}>No ongoing company-service requests yet.</div>:requests.map(r=><div key={r.id} style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',gap:8,alignItems:'center',padding:'8px 0',borderTop:'1px solid var(--br)'}}>
          <div><div style={{fontSize:12,fontWeight:700}}>{r.service_type}</div><div style={{fontSize:10,color:'var(--t3)'}}>{r.notes||'No notes'} · {new Date(r.requested_at).toLocaleDateString()}{r.state_fee!=null?` · State fee ${Number(r.state_fee).toFixed(2)}`:''}{r.submission_reference?` · Ref ${r.submission_reference}`:''}{r.confirmation?` · Confirmation ${r.confirmation}`:''}</div></div>
          <StatusPill value={r.status}/>
          <select value={r.payment_status||'Pending'} onChange={e=>updateRequestPayment(r.id,e.target.value)} style={{...inputStyle,width:105}}>{['Pending','Paid','Waived','Refunded'].map(x=><option key={x}>{x}</option>)}</select>
          <select value={r.status} onChange={e=>updateRequest(r.id,e.target.value)} style={{...inputStyle,width:135}}>{['Requested','In Progress','Waiting on Client','Submitted','State / Agency Review','Action Required','Complete','Cancelled'].map(x=><option key={x}>{x}</option>)}</select>
        </div>)}
      </div>
    </div>}

    {tab==='documents' && <div>
      <div style={{fontSize:11,color:'var(--t3)',marginBottom:10,lineHeight:1.5}}>Formation documents, state acceptance records, EIN letters, signed agreements, bank resolutions, registered-agent notices, and compliance correspondence are stored here and indexed in the CRM Documents area.</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,alignItems:'end',marginBottom:10}}>
        <Field label="Document Type"><select value={docType} onChange={e=>setDocType(e.target.value)} style={inputStyle}>{['State Filing / Acceptance','EIN Confirmation','Operating Agreement','Banking','Registered Agent Notice','Annual Report / Compliance','Amendment / Company Change','License / Permit','Other'].map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Upload Document"><input type="file" onChange={e=>{const f=e.target.files?.[0];if(f)uploadCompanyDocument(f);e.target.value=''}} style={inputStyle} disabled={busy==='upload'}/></Field>
      </div>
      <div>
        {documents.length===0?<div style={{fontSize:12,color:'var(--t3)'}}>No FormaCorp documents on this company yet.</div>:documents.map(doc=><div key={doc.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,alignItems:'center',padding:'8px 0',borderTop:'1px solid var(--br)'}}>
          <div><div style={{fontSize:12,fontWeight:700}}>{doc.file_name}</div><div style={{fontSize:10,color:'var(--t3)'}}>{doc.document_type} · {new Date(doc.created_at).toLocaleDateString()}</div></div>
          <button className="btn sm" onClick={()=>downloadCompanyDocument(doc)}>Open</button>
        </div>)}
      </div>
    </div>}
  </div>
}
