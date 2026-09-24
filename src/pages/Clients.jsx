import { validateFile } from '../lib/uploadUtils'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { PIPELINE_STAGES, DEFAULT_PIPELINE_STAGE, pipelineStageLabel, CASE_SERVICES } from '../lib/caseStatuses'
import { NOTE_TEMPLATES } from '../lib/noteTemplates'
import { logActivity, getActor } from '../lib/activityLog'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import IRSFormFiller from '../components/IRSFormFiller'
import ErrorBoundary from '../components/ErrorBoundary'
import InPlaceCaller from '../components/InPlaceCaller'
import CallAISummaries from '../components/CallAISummaries'
import ClientTransactions from '../components/ClientTransactions'
import BookingWidget from '../components/BookingWidget'
import QuickEmail from '../components/QuickEmail'
import { ESIGN_DOC_TYPES } from '../lib/esignDocTypes'
import StripePaymentMethodModal from '../components/StripePaymentMethodModal'
import SendPaymentLinkModal from '../components/SendPaymentLinkModal'
import SavedCardsPanel from '../components/SavedCardsPanel'
import SplitPaymentModal from '../components/SplitPaymentModal'
import FinancialProfile from './FinancialProfile'
import TimeEntry from './TimeEntry'
import ClientActivityReport from './ClientActivityReport'
import OrganizerView from '../components/OrganizerView'
import { supabase } from '../lib/supabase'
import { triggerWorkflow, applyWorkflowTemplate } from '../lib/triggerWorkflow'
import { useApp } from '../context/AppContext'
import { useCall } from '../context/CallContext'
import { generateAddendum, sendAddendumForSignature } from '../lib/docUtils'
import ChargeResolutionFeeModal from '../components/ChargeResolutionFeeModal'
import { RESOLUTION_SERVICES, resolveStateFormUrl } from '../lib/irsFormUtils'
import { generatePOACoverLetterPdf } from '../lib/irsFormUtils'
import { SMS_TEMPLATES, applySmsTemplate } from '../lib/smsTemplates'
import { FIRM, label } from '../lib/firmBranding'

// Tenant-resolved firm name so onboarding email + POA/addendum SMS bodies
// read for whichever firm is signed in. Mirrors Leads.jsx and docUtils.
const firmName  = () => FIRM.name || 'Tax Case Review'
const firmEmail = () => (FIRM.email || '').trim() || 'info@' + firmName().toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com'

const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS   = Array.from({length:31},(_,i)=>String(i+1).padStart(2,'0'))
const YDOB   = Array.from({length:100},(_,i)=>new Date().getFullYear()-18-i)

const IRS_STATUS_OPTIONS = ['ACS','Notice Status','Queue for ACS','Currently Not Collectible','Installment Agreement','Garnishment','Levy Issued','Levied','Lien Filed','Appeals','Litigation','Released','Other']

const BLANK_DEP = { name:'', ssn:'', dob:'', relationship:'Child' }
const BLANK = {
  clientType:'Individual', name:'', business_name:'', taxAssociate:'', phone:'', phone2:'', email:'',
  biz_street:'', biz_city:'', biz_state:'', biz_zip:'', biz_same_as_personal:false,
  street:'', city:'', state:'', zip:'', county:'',
  ssn:'', ein:'', dobM:'', dobD:'', dobY:'',
  spouseName:'', spouseSsn:'', spouseDob:'', filingStatus:'Single',
  irsBalance:'', stateBalance:'', issueType:'OIC', irsOrState:'IRS Federal', taxYears:'',
  filingRequirements:[],
  irsStatus:'', irsStatusOther:'', irsDeadline:'',
  stateStatus:'', stateStatusOther:'', stateDeadline:'',
  clientSince:'', status:'Active', notes:'', assignedTo:'',
  pipelineStage:DEFAULT_PIPELINE_STAGE, dependents:[],
  autopay_enabled:false, autopay_amount:'', autopay_frequency:'monthly', autopay_next_charge:'',
}

function Bdg({s,c,style}) { return <span className={`bdg ${c||'bn'}`} style={style}>{s}</span> }
// Resolves the logged-in user's display name against the employees table by
// email first (the one identifier that's always reliable), so notes/logs are
// attributed with the same name Team Chat uses ("Romy Cruz") instead of
// falling back to an email-prefix guess ("romy") that avatar matching can't
// find. Falls back to auth metadata / email prefix only if no employee row matches.
function resolveActorName(user, employees) {
  const email = user?.email?.toLowerCase()
  const emp = email ? employees.find(e => e.email && e.email.toLowerCase() === email) : null
  return emp?.name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
}

// Human-readable labels for the field-diff audit log. Anything not listed
// here still logs, just with its raw key as the label.
const FIELD_LABELS = {
  name:'Name', email:'Email', phone:'Phone', phone2:'Phone 2', address:'Address',
  city:'City', state:'State', zip:'Zip', ssn:'SSN', ein:'EIN', dob:'DOB',
  filingStatus:'Filing Status', maritalStatus:'Marital Status', occupation:'Occupation',
  employer:'Employer', spouseName:'Spouse Name', spouseSsn:'Spouse SSN', spouseDob:'Spouse DOB',
  taxFee:'Tax Fee', source:'Source', assignedTo:'Assigned To', businessName:'Business Name',
  business_name:'Business Name', clientType:'Client Type', irsOrState:'IRS or State', dependents:'Dependents',
}
// Fields that either change automatically as a side-effect of other actions
// (so logging them here would be noisy/redundant with their own dedicated
// log line) or are internal bookkeeping never worth showing to a human.
const SKIP_DIFF_FIELDS = new Set(['id','created_at','updated_at','tenant_id','pipelineStage','status','archived','dobM','dobD','dobY'])
function summarizeFieldChanges(before, after) {
  if (!before || !after) return []
  const changes = []
  for (const key of Object.keys(after)) {
    if (SKIP_DIFF_FIELDS.has(key)) continue
    const oldVal = before[key], newVal = after[key]
    if ((oldVal ?? '') === (newVal ?? '')) continue
    if (typeof newVal === 'object') continue // skip nested objects/arrays — not worth diffing here
    const label = FIELD_LABELS[key] || key
    const fmt = v => (v===null||v===undefined||v==='') ? '(empty)' : String(v).slice(0,60)
    changes.push(`${label}: ${fmt(oldVal)} → ${fmt(newVal)}`)
  }
  return changes
}
function PhoneLink({val, name}) {
  const { startCall, relayStatus } = useCall()
  if (!val) return <span style={{color:'var(--t3)'}}>—</span>
  function dial(e) {
    e.preventDefault(); e.stopPropagation()
    startCall({ name: name||val, phone: val, entityType: 'client' })
  }
  return (
    <span onClick={relayStatus==='ready' ? dial : undefined}
      style={{color:relayStatus==='ready'?'var(--blue)':'var(--t2)',fontWeight:600,cursor:relayStatus==='ready'?'pointer':'default',display:'inline-flex',alignItems:'center',gap:5}}
      title={relayStatus==='ready'?'Click to call':'Dialer not connected'}
      onMouseEnter={e=>{if(relayStatus==='ready')e.currentTarget.style.textDecoration='underline'}}
      onMouseLeave={e=>e.currentTarget.style.textDecoration='none'}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.18 1h3a2 2 0 012 1.72 12.05 12.05 0 00.7 2.81 2 2 0 01-.45 2.11L4.91 8.15a16 16 0 006.29 6.29l1.51-1.52a2 2 0 012.11-.45 12.05 12.05 0 002.81.7A2 2 0 0122 16.92z"/></svg>
      {val}
    </span>
  )
}
function DR({label,val,name,entityId,onLogged,showToast}) {
  const isPhone = label==='Phone'||label==='Phone 2'||label==='Phone2'
  const renderVal = () => {
    if (!val) return <span style={{color:'var(--t3)'}}>—</span>
    if (isPhone) return (
      <InPlaceCaller phone={val} name={name} entityType="client" entityId={entityId} supabase={supabase} showToast={showToast} onLogged={onLogged}/>
    )
    if (String(label).endsWith('Address')) return (
      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(val)}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)'}}>{val} ↗</a>
    )
    return val
  }
  return (
    <div style={{display:'flex',borderBottom:'1px solid var(--br)',padding:'7px 0',gap:12}}>
      <div style={{minWidth:130,fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--t3)',paddingTop:1}}>{label}</div>
      <div style={{flex:1,fontSize:13,color:'var(--tx)'}}>{renderVal()}</div>
    </div>
  )
}
const CSED_FORM_LABELS = {
  '1040':'Personal Federal (1040)', 'STATE':'Personal State', 'CP':'Business CP (Federal)',
  '940':'Business 940 (FUTA)', '941':'Business 941 (Payroll)', '1120S':'Business 1120-S'
}
function CsedSummaryCard({clientName}) {
  const [recs, setRecs] = useState(null)
  useEffect(() => {
    if (!clientName) return
    supabase.from('client_compliance_records').select('form_type,tax_year,quarter,csed')
      .eq('client_name', clientName).not('csed','is',null)
      .then(({data}) => setRecs(data||[]))
  }, [clientName])
  if (!recs || recs.length===0) return null
  const sorted = [...recs].sort((a,b)=>new Date(a.csed)-new Date(b.csed))
  const first = sorted[0]
  const last = sorted[sorted.length-1]
  const fmt = r => `${CSED_FORM_LABELS[r.form_type]||r.form_type} ${r.tax_year}${r.quarter?` Q${r.quarter}`:''} — ${r.csed}`
  return (
    <div className="card">
      <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>CSED Summary</div>
      <DR label="1st to Expire" val={fmt(first)}/>
      <DR label="Last to be Removed" val={fmt(last)}/>
    </div>
  )
}
function formatBalance(val) {
  if (!val) return '—'
  if (typeof val==='string'&&(val.includes('$')||isNaN(Number(val)))) return val
  const n=Number(val); return isNaN(n)?val:'$'+n.toLocaleString()
}
function parseDependents(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

// ─── Action Button ────────────────────────────────────────────────────────────
function ActionBtn({color, icon, label, sub, onClick}) {
  return (
    <button onClick={onClick} style={{
      background:color, color:'#fff', border:'none', borderRadius:10,
      padding:'14px 10px', cursor:'pointer', display:'flex', flexDirection:'column',
      alignItems:'center', gap:5, fontSize:12.5, fontWeight:700, textAlign:'center',
      width:'100%', transition:'transform .1s,opacity .1s',
    }}
      onMouseEnter={e=>{e.currentTarget.style.opacity='.85';e.currentTarget.style.transform='translateY(-2px)'}}
      onMouseLeave={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.transform=''}}
    >
      <span style={{fontSize:22}}>{icon}</span>
      <span>{label}</span>
      {sub && <span style={{fontSize:9.5,opacity:.8,fontWeight:400}}>{sub}</span>}
    </button>
  )
}


// ── Inline Fax Form ─────────────────────────────────────────────────────────
function InlineFaxForm({ client, onClose, showToast, onLogged }) {
  // TO stays blank on open — the client's phone number is not the fax number,
  // and prefilling led users to send to the wrong destination.
  const [toNum,   setToNum]   = useState('')
  const [subject, setSubject] = useState('')
  const [notes,   setNotes]   = useState('')
  const [file,    setFile]    = useState(null)
  const [sending, setSending] = useState(false)
  const [poaBusy, setPoaBusy] = useState(false)

  async function usePOATemplate() {
    setPoaBusy(true)
    try {
      const bytes = await generatePOACoverLetterPdf(client)
      const fname = `POA-Cover-Letter-${(client?.name||'client').replace(/[^a-zA-Z0-9]+/g,'-')}.pdf`
      setFile(new File([bytes], fname, { type: 'application/pdf' }))
      if (!subject) setSubject('Power of Attorney Cover Letter — Form 2848')
    } catch (e) {
      showToast('Error generating POA Cover Letter: ' + e.message, 'err')
    } finally {
      setPoaBusy(false)
    }
  }

  async function send() {
    const rawDigits = toNum.replace(/\D/g,'')
    const faxDigits = rawDigits.length === 11 && rawDigits.startsWith('1') ? rawDigits.slice(1) : rawDigits
    if (faxDigits.length !== 10) { showToast('Enter a valid 10-digit fax number.','err'); return }
    if (!file) { showToast('Attach a document before sending the fax.','err'); return }
    setSending(true)
    let fileUrl = null
    const toFull = '+1' + faxDigits
    try {
      const path = `fax/${client?.id || 'client'}/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]/g,'_')}`
      const { error: uploadErr } = await supabase.storage.from('documents').upload(path, file, {upsert:false, contentType:file.type || 'application/pdf'})
      if (uploadErr) throw uploadErr
      const { data:u, error: signErr } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      if (signErr || !u?.signedUrl) throw signErr || new Error('Could not create secure fax document URL')
      fileUrl = u.signedUrl

      const { data: resData, error: invokeErr } = await supabase.functions.invoke('send-fax', {
        body: { to:toFull, document_url:fileUrl }
      })
      if (invokeErr) throw invokeErr
      if (!resData?.success) throw new Error(resData?.error || 'Fax provider rejected the send')

      const faxBackendAlreadyLogs = resData?.backend_logged || window.location.hostname.toLowerCase() === 'nashville.taxrescrm.app'
      if (!faxBackendAlreadyLogs) {
        await supabase.from('fax_logs').insert([{
          to_number:toFull, client_name:client?.name, subject, notes,
          file_name:file?.name||null, file_url:fileUrl, status:'Sent',
          ...(resData?.provider === 'telnyx' ? { telnyx_fax_id: resData?.sid || null } : { signalwire_fax_id: resData?.sid || null }), sent_at:new Date().toISOString(), created_at:new Date().toISOString()
        }])
      }

      const { data: { user } } = await supabase.auth.getUser()
      const actor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
      const noteContent = `📠 Fax sent to ${toFull}${subject?' — '+subject:''}${file?.name?' ('+file.name+')':''}${notes?' — '+notes:''}`
      const { error: noteErr } = await supabase.from('client_notes').insert([{
        clientname: client?.name, text: noteContent, author: actor, visible_to_client:false, created_at:new Date().toISOString()
      }])
      if (noteErr) console.error('[client_notes] insert failed (InlineFaxForm):', noteErr)

      showToast('📠 Fax sent!')
      onLogged?.(); onClose()
    } catch (e) {
      console.error('[InlineFaxForm] send failed:', e)
      showToast('Fax failed: ' + (e?.message || 'Unknown provider error'),'err')
    } finally {
      setSending(false)
    }
  }
  return (
    <div style={{padding:'0 4px 4px'}}>
      <div className="field"><label>To Fax Number</label>
        <input value={toNum} onChange={e=>setToNum(e.target.value.replace(/\D/g,''))} placeholder="10 digits"/>
      </div>
      <div className="field"><label>Subject</label>
        <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="e.g. Form 2848"/>
      </div>
      <button type="button" onClick={usePOATemplate} disabled={poaBusy} className="btn sec" style={{fontSize:11,padding:'5px 10px',marginBottom:10}}>
        {poaBusy?'Generating…':'📋 Use POA Cover Letter Template'}
      </button>
      <div className="field"><label>Attach PDF</label>
        <input type="file" accept=".pdf,.tiff,.jpg,.png" onChange={e=>setFile(e.target.files[0])}
          style={{padding:'6px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',width:'100%',fontSize:12}}/>
        {file && <div style={{fontSize:11,color:'var(--ok)',marginTop:4}}>📄 {file.name}</div>}
      </div>
      <div className="field"><label>Notes</label>
        <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Internal notes"/>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={onClose}>Cancel</button>
        <button className="btn pri" style={{flex:1,justifyContent:'center',background:'#dc2626',borderColor:'#dc2626'}} onClick={send} disabled={sending}>
          {sending?'Sending…':'📠 Send Fax'}
        </button>
      </div>
    </div>
  )
}

// ── Inline E-Sign Form ───────────────────────────────────────────────────────
const DOC_TYPES_INLINE = ESIGN_DOC_TYPES

function InlineEsignForm({ client, onClose, showToast }) {
  const [docType,  setDocType]  = useState('Tax Service Agreement')
  const [message,  setMessage]  = useState('Please review and sign the attached document at your earliest convenience.')
  const [priority, setPriority] = useState('Normal')
  const [saving,   setSaving]   = useState(false)
  const [link,     setLink]     = useState('')
  const [customFile, setCustomFile] = useState(null)
  const [sendVia, setSendVia] = useState(client?.email ? 'email' : 'sms')
  const [delivered, setDelivered] = useState([])

  async function create() {
    if(docType==='Custom Document' && !message.trim() && !customFile){
      showToast('For a custom document, type the text to sign or attach a PDF.','err');return
    }
    setSaving(true)
    let pdfAttachments=null
    if(docType==='Custom Document' && customFile){
      try{
        const path=`esign-custom/${(client?.name||'client').replace(/[^A-Za-z0-9 _-]/g,'')}/${Date.now()}-${customFile.name}`
        const{error:upErr}=await supabase.storage.from('documents').upload(path,customFile,{upsert:true})
        if(upErr) throw upErr
        const{data:u,error:signErr}=await supabase.storage.from('documents').createSignedUrl(path, 3600)
        if(signErr || !u?.signedUrl) throw signErr || new Error('Could not create secure document link')
        pdfAttachments=[{formType:'custom',label:customFile.name,url:u.signedUrl,storage_path:path}]
      }catch(e){
        console.error('custom upload:',e)
        setSaving(false)
        showToast('Custom document upload failed: '+(e?.message||'Unknown upload error'),'err')
        return
      }
    }
    const { data, error } = await supabase.from('esigns').insert([{
      doc_type: docType, client_name: client?.name, client_email: client?.email||'', client_phone: client?.phone||'',
      message, pdf_attachments:pdfAttachments, priority, status:'Awaiting', sent_at: new Date().toISOString(), created_at: new Date().toISOString(),
      tenant_id: FIRM.tenantId || undefined
    }]).select().single()
    if (error) { setSaving(false); showToast('Error: '+error.message,'err'); return }
    const url = window.location.origin+'/sign/'+data.id+'?token='+encodeURIComponent(data.signer_token||'')
    setLink(url)

    let emailSent=false, smsSent=false
    if ((sendVia==='email'||sendVia==='both') && client?.email) {
      try {
        const { data:emailData, error:emailErr } = await supabase.functions.invoke('send-email', {
          body:{
            tenant_id:FIRM.tenantId||undefined,
            to:client.email,
            subject:`Action Required: Sign Your ${docType} — ${firmName()}`,
            html:`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px"><h2>Signature Requested</h2><p>Hi <strong>${client.name}</strong>,</p><p>${message}</p><p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Review &amp; Sign</a></p><p style="font-size:12px;color:#64748b;word-break:break-all">${url}</p><p><strong>${firmName()}</strong></p></div>`
          }
        })
        emailSent=!emailErr && emailData?.success!==false
      } catch(_) {}
    }
    if ((sendVia==='sms'||sendVia==='both') && client?.phone) {
      try {
        const {data:smsData,error:smsErr}=await supabase.functions.invoke('send-sms',{
          body:{to:client.phone,body:`${firmName()}: please review and sign your ${docType}: ${url}`,client_id:client.id||null}
        })
        smsSent=!smsErr && !!smsData?.success
      } catch(_) {}
    }
    const sent=[emailSent&&'email',smsSent&&'SMS'].filter(Boolean)
    setDelivered(sent)
    setSaving(false)
    showToast(sent.length ? `✅ Signing request sent via ${sent.join(' & ')}!` : '✅ Signing link created — delivery was not completed')
  }

  if (link) return (
    <div style={{padding:'0 4px 4px'}}>
      <div style={{background:'rgba(34,197,94,.08)',border:'1px solid rgba(34,197,94,.3)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--ok)',marginBottom:6}}>{delivered.length ? `✅ Signing request sent via ${delivered.join(' & ')}!` : '✅ Signing link created!'}</div>
        <a href={link} target="_blank" rel="noreferrer" style={{display:'block',fontSize:11,color:'var(--blue)',wordBreak:'break-all',marginBottom:8}}>{link}</a>
        <div style={{fontSize:11,color:'var(--t2)'}}>When they sign, their IP address and timestamp are automatically recorded and a copy is saved to their documents.</div>
      </div>
      <button className="btn sec" style={{width:'100%',justifyContent:'center'}} onClick={onClose}>Done</button>
    </div>
  )

  return (
    <div style={{padding:'0 4px 4px'}}>
      <div className="field"><label>Document Type</label>
        <select value={docType} onChange={e=>setDocType(e.target.value)}>
          {DOC_TYPES_INLINE.map(t=><option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="field"><label>{docType==='Custom Document'?'Document Text':'Message to Client'}</label>
        <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={3}
          placeholder={docType==='Custom Document'?"Type the document text they'll review and sign… (or attach a PDF below)":''}
          style={{width:'100%',resize:'vertical',padding:'8px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:13,fontFamily:'inherit'}}/>
      </div>
      {docType==='Custom Document'&&(
        <div className="field"><label>Or attach a PDF</label>
          <input type="file" accept="application/pdf" onChange={e=>setCustomFile(e.target.files?.[0]||null)}/>
          {customFile&&<div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>📎 {customFile.name}</div>}
        </div>
      )}
      <div className="field"><label>Priority</label>
        <select value={priority} onChange={e=>setPriority(e.target.value)}>
          <option>Normal</option><option>High</option><option>Urgent</option>
        </select>
      </div>
      <div className="field"><label>Send Via</label>
        <div style={{display:'flex',gap:8}}>
          {[['email','Email'],['sms','Text'],['both','Both']].map(([v,l])=>(
            <button key={v} type="button" onClick={()=>setSendVia(v)}
              disabled={(v==='email'&&!client?.email)||(v==='sms'&&!client?.phone)||(v==='both'&&(!client?.email||!client?.phone))}
              style={{flex:1,padding:'7px 4px',borderRadius:7,border:'1px solid',fontSize:12,fontWeight:600,cursor:'pointer',
                borderColor:sendVia===v?'var(--blue)':'var(--br)',background:sendVia===v?'var(--blue)22':'var(--s2)',color:sendVia===v?'var(--blue)':'var(--t2)'}}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div style={{background:'var(--s2)',borderRadius:6,padding:'8px 12px',fontSize:11,color:'var(--t3)',marginBottom:14,lineHeight:1.6}}>
        💡 A unique signing link will be generated and delivered using the selected channel. Their signature, IP, and timestamp are recorded automatically.
      </div>
      <div style={{display:'flex',gap:8}}>
        <button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={onClose}>Cancel</button>
        <button className="btn pri" style={{flex:1,justifyContent:'center',background:'#7c3aed',borderColor:'#7c3aed'}} onClick={create} disabled={saving}>
          {saving?'Creating…':'✍️ Create Signing Link'}
        </button>
      </div>
    </div>
  )
}


function InlinePortalForm({ client, onClose, showToast }) {
  const [sendVia, setSendVia] = useState(client?.email ? 'email' : 'sms')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(null)

  const url = window.location.origin + '/portal/' + client?.id
  const last4 = (client?.ssn || '').replace(/\D/g, '').slice(-4)

  async function send() {
    setSending(true)
    let emailSent = false, smsSent = false
    // Safety net: never leave "Sending..." stuck if email/SMS are not configured
    const sendTimeout = setTimeout(() => { setSending(false); setDone({ sent: [], timedOut: true }) }, 12000)

    if ((sendVia === 'email' || sendVia === 'both') && client?.email) {
      try {
        const { error } = await supabase.functions.invoke('send-email', {
          body: { tenant_id: FIRM.tenantId || undefined,
            to: client.email,
            subject: `Your ${firmName()} Client Portal Is Ready — Welcome, ${client.name}!`,
            html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- Header banner -->
  <tr><td style="background:linear-gradient(135deg,#0f2d5c 0%,#1a4080 50%,#0e3060 100%);border-radius:16px 16px 0 0;padding:36px 40px;text-align:center">
    <img src="${FIRM.logoUrl}" alt="${FIRM.name}" style="max-height:64px;max-width:220px;object-fit:contain;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto" onerror="this.style.display='none'"/>
    <div style="font-size:11px;font-weight:800;color:#93c5fd;letter-spacing:.15em;text-transform:uppercase;margin-bottom:12px">${FIRM.name}</div>
    <div style="font-size:28px;font-weight:800;color:#ffffff;margin-bottom:6px">Welcome, ${client.name}!</div>
    <div style="font-size:15px;color:#bfdbfe;margin-bottom:0">Your Client Portal is ready and waiting for you.</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#ffffff;padding:36px 40px">

    <p style="font-size:15px;color:#1e293b;line-height:1.7;margin:0 0 20px">
      We're thrilled to have you as a client at <strong>${firmName()}</strong>. Your dedicated team is already working hard on your case, and your personal Client Portal gives you a front-row seat to everything that's happening — 24 hours a day, 7 days a week.
    </p>

    <p style="font-size:15px;color:#1e293b;line-height:1.7;margin:0 0 24px">
      You've made a smart decision investing in your financial future, and we take that trust seriously. Here's everything you can access right now in your portal:
    </p>

    <!-- Feature list -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
        <table><tr>
          <td style="font-size:20px;padding-right:14px;vertical-align:top">📋</td>
          <td><div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px">Compliance Dashboard</div>
          <div style="font-size:13px;color:#64748b;line-height:1.5">See exactly where you stand with the IRS — filing status, balances owed, liens, and key deadlines for every tax year in your case.</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
        <table><tr>
          <td style="font-size:20px;padding-right:14px;vertical-align:top">📁</td>
          <td><div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px">Your Documents</div>
          <div style="font-size:13px;color:#64748b;line-height:1.5">Access all your signed agreements, IRS forms, correspondence, and case documents. Upload new documents directly to your file anytime.</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
        <table><tr>
          <td style="font-size:20px;padding-right:14px;vertical-align:top">💳</td>
          <td><div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px">Payments & Payment Plan</div>
          <div style="font-size:13px;color:#64748b;line-height:1.5">Choose your own monthly payment amount with our flexible 1–10 month payment plan slider. Lock in your plan and manage autopay — all without calling us.</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
        <table><tr>
          <td style="font-size:20px;padding-right:14px;vertical-align:top">🧾</td>
          <td><div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px">Invoices</div>
          <div style="font-size:13px;color:#64748b;line-height:1.5">View and pay outstanding invoices securely at any time.</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
        <table><tr>
          <td style="font-size:20px;padding-right:14px;vertical-align:top">📊</td>
          <td><div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px">Income & Expenses</div>
          <div style="font-size:13px;color:#64748b;line-height:1.5">Keep your financial information up to date. Your advisor uses this to build the strongest possible resolution strategy for your case.</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:10px 0">
        <table><tr>
          <td style="font-size:20px;padding-right:14px;vertical-align:top">💬</td>
          <td><div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px">Messages & Notes</div>
          <div style="font-size:13px;color:#64748b;line-height:1.5">View your full text message history with your advisor and read updates posted directly to your account.</div></td>
        </tr></table>
      </td></tr>
    </table>

    <!-- CTA button -->
    <div style="text-align:center;margin:32px 0">
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;padding:16px 40px;border-radius:10px;letter-spacing:.02em">
        Access My Client Portal →
      </a>
      <div style="font-size:12px;color:#94a3b8;margin-top:12px">You'll verify with your email + last 4 digits of your SSN</div>
    </div>

    <!-- Trust bar -->
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:24px;text-align:center">
      <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px">Have questions? We're here for you.</div>
      <div style="font-size:13px;color:#475569;line-height:1.7">
        Call us toll-free: <strong style="color:#1d4ed8">${FIRM.phone}</strong><br/>
        Or reply to this email and your representative will get back to you promptly.
      </div>
    </div>

    <p style="font-size:13px;color:#64748b;line-height:1.7;margin:0">
      Thank you for choosing ${firmName()}. We are committed to delivering the best possible outcome for your case and will be with you every step of the way.
    </p>
    <p style="font-size:14px;color:#1e293b;margin:16px 0 0"><strong>The ${firmName()} Team</strong></p>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0f172a;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center">
    <div style="font-size:12px;color:#60a5fa;font-weight:700;margin-bottom:6px">${firmName()}</div>
    <div style="font-size:11px;color:#475569;line-height:1.7">
      ${FIRM.address}<br/>
      Toll-Free: ${FIRM.phone}<br/>
      <a href="${url}" style="color:#3b82f6;text-decoration:none">Access Your Portal</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`
          }
        })
        if (!error) emailSent = true
      } catch (e) { console.error('Email error:', e) }
    }
    if ((sendVia === 'sms' || sendVia === 'both') && client?.phone) {
      try {
        const { data: smsData, error: smsErr } = await supabase.functions.invoke('send-sms', {
          body: { to: client.phone, body: `Hi ${client.name}, your ${firmName()} Client Portal is ready! View your case, documents, invoices, and more here: ${url} (you'll need your email + last 4 of your SSN to log in)`, client_id: client.id || null }
        })
        if (!smsErr && smsData?.success) smsSent = true
      } catch (e) { console.error('SMS error:', e) }
    }
    clearTimeout(sendTimeout)
    setSending(false)
    const sent = [emailSent && 'email', smsSent && 'SMS'].filter(Boolean)
    setDone({ sent })
  }

  if (done) return (
    <div style={{padding:'0 4px 4px'}}>
      <div style={{background:'rgba(34,197,94,.08)',border:'1px solid rgba(34,197,94,.3)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--ok)',marginBottom:6}}>
          {done.sent.length ? `✅ Portal link sent via ${done.sent.join(' & ')}!` : '📋 Link ready to share'}
        </div>
        {!done.sent.length && <div style={{fontSize:11,color:'var(--warn)',marginBottom:6}}>Email/SMS not configured — share the link manually.</div>}
        <div style={{fontSize:11,color:'var(--t3)',wordBreak:'break-all'}}>{url}</div>
      </div>
      <button className="btn sec" style={{width:'100%',justifyContent:'center'}} onClick={onClose}>Done</button>
    </div>
  )

  return (
    <div style={{padding:'0 4px 4px'}}>
      <div style={{fontSize:12,color:'var(--t2)',marginBottom:14,lineHeight:1.6}}>
        {client?.name} can view their tax compliance findings (filing status, balances, liens, CSED dates) and download their own Excel copy — without logging into the CRM.
      </div>
      <div style={{background:'var(--s2)',borderRadius:6,padding:'9px 12px',marginBottom:12,fontSize:12,color:'var(--t3)',lineHeight:1.7}}>
        <div>📧 {client?.email || <span style={{color:'var(--warn)'}}>No email on file</span>}</div>
        <div>📱 {client?.phone || <span style={{color:'var(--warn)'}}>No phone on file</span>}</div>
        <div style={{marginTop:6}}>
          🔒 Access requires email + last 4 of SSN: {last4 && client?.email ? <strong style={{color:'var(--tx)'}}>{client.email} / ***{last4}</strong> : <span style={{color:'var(--bad)'}}>{!last4 && !client?.email ? 'No SSN or email on file' : !last4 ? 'No SSN on file' : 'No email on file'} — client won't be able to unlock the portal</span>}
        </div>
      </div>
      <div className="field"><label>Send Via</label>
        <div style={{display:'flex',gap:8}}>
          {[['email','Email Only'],['sms','SMS Only'],['both','Both']].map(([v,l])=>(
            <button key={v} type="button"
              style={{flex:1,padding:'7px 4px',borderRadius:7,border:'1px solid',fontSize:12,fontWeight:600,cursor:'pointer',
                borderColor:sendVia===v?'var(--blue)':'var(--br)',
                background:sendVia===v?'var(--blue)22':'var(--s2)',
                color:sendVia===v?'var(--blue)':'var(--t2)'}}
              onClick={()=>setSendVia(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:14}}>
        <button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={onClose}>Cancel</button>
        <button className="btn sm" style={{flex:1,justifyContent:'center',background:'#0ea5e9',color:'#fff',borderColor:'#0ea5e9'}} onClick={send} disabled={sending || !last4 || !client?.email}>
          {sending?'Sending…':'🔓 Send Portal Link'}
        </button>
      </div>
    </div>
  )
}

// ── Tax Organizer Quick Action — picks a year, creates the record, sends link ──
function InlineOrganizerForm({ client, onClose, showToast }) {
  const [year, setYear] = useState(String(new Date().getFullYear() + 1))
  const [sendVia, setSendVia] = useState(client?.email ? 'email' : 'sms')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(null)

  async function send() {
    if (!/^\d{4}$/.test(year.trim())) { showToast('Enter a valid 4-digit tax year'); return }
    setSending(true)
    let orgId
    const { data: existing } = await supabase.from('tax_organizer_responses')
      .select('id').eq('client_name', client.name).eq('tax_year', year.trim()).maybeSingle()
    if (existing) {
      orgId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase.from('tax_organizer_responses').insert([{
        client_name: client.name, client_email: client.email || '', tax_year: year.trim(),
        answers: {}, status: 'In Progress', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }]).select().single()
      if (createErr) { setSending(false); showToast('Error: ' + createErr.message); return }
      orgId = created.id
    }

    const url = window.location.origin + '/organizer/' + orgId
    let emailSent = false, smsSent = false
    if ((sendVia === 'email' || sendVia === 'both') && client?.email) {
      try {
        const { error } = await supabase.functions.invoke('send-email', {
          body: { tenant_id: FIRM.tenantId || undefined,
            to: client.email,
            subject: `Your ${year.trim()} Tax Organizer — ${FIRM.name || 'Tax Case Review'}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><div style="text-align:center;margin-bottom:20px"><img src=\"${FIRM.logoUrl}\" alt=\"${FIRM.name}\" style=\"max-height:56px;max-width:190px;object-fit:contain;display:block;margin:0 auto 8px\" onerror=\"this.style.display='none'\"/><div style="font-size:12px;font-weight:800;color:#1d4ed8;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">${FIRM.name}</div></div><p>Dear <strong>${client.name}</strong>,</p><p>Please complete your ${year.trim()} tax organizer so we can begin preparing your return. It only takes a few minutes, and you can save your progress and come back anytime.</p><p style="text-align:center;margin:24px 0"><a href="${url}" style="background:#9333ea;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Start My Tax Organizer</a></p><p style="font-size:12px;color:#64748b">Link: ${url}</p><p style="font-size:11px;color:#94a3b8;margin-top:24px">${firmName()} · ${FIRM.address}</p></div>`
          }
        })
        if (!error) emailSent = true
      } catch (e) { console.error('Email error:', e) }
    }
    if ((sendVia === 'sms' || sendVia === 'both') && client?.phone) {
      try {
        const { data: smsData, error: smsErr } = await supabase.functions.invoke('send-sms', {
          body: { to: client.phone, body: `Hi ${client.name}, please complete your ${year.trim()} tax organizer here: ${url}`, client_id: client.id || null }
        })
        if (!smsErr && smsData?.success) smsSent = true
      } catch (e) { console.error('SMS error:', e) }
    }
    setSending(false)
    const sent = [emailSent && 'email', smsSent && 'SMS'].filter(Boolean)
    setDone({ sent, url })
  }

  if (done) return (
    <div style={{padding:'0 4px 4px'}}>
      <div style={{background:'rgba(34,197,94,.08)',border:'1px solid rgba(34,197,94,.3)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--ok)',marginBottom:6}}>
          {done.sent.length ? `✅ Organizer link sent via ${done.sent.join(' & ')}!` : '📋 Link ready to share'}
        </div>
        {!done.sent.length && <div style={{fontSize:11,color:'var(--warn)',marginBottom:6}}>Email/SMS not configured — share the link manually.</div>}
        <div style={{fontSize:11,color:'var(--t3)',wordBreak:'break-all'}}>{done.url}</div>
      </div>
      <button className="btn sec" style={{width:'100%',justifyContent:'center'}} onClick={onClose}>Done</button>
    </div>
  )

  return (
    <div style={{padding:'0 4px 4px'}}>
      <div style={{fontSize:12,color:'var(--t2)',marginBottom:14,lineHeight:1.6}}>
        Send {client?.name} a multi-step tax organizer to fill out for a specific filing year. Their answers sync straight into the CRM, and the same organizer is also available inside their Client Portal.
      </div>
      <div className="field"><label>Tax Year</label>
        <input value={year} onChange={e=>setYear(e.target.value)} maxLength={4} style={{maxWidth:120}}/>
      </div>
      <div style={{background:'var(--s2)',borderRadius:6,padding:'9px 12px',marginTop:10,marginBottom:12,fontSize:12,color:'var(--t3)',lineHeight:1.7}}>
        <div>📧 {client?.email || <span style={{color:'var(--warn)'}}>No email on file</span>}</div>
        <div>📱 {client?.phone || <span style={{color:'var(--warn)'}}>No phone on file</span>}</div>
      </div>
      <div className="field"><label>Send Via</label>
        <div style={{display:'flex',gap:8}}>
          {[['email','Email Only'],['sms','SMS Only'],['both','Both']].map(([v,l])=>(
            <button key={v} type="button"
              style={{flex:1,padding:'7px 4px',borderRadius:7,border:'1px solid',fontSize:12,fontWeight:600,cursor:'pointer',
                borderColor:sendVia===v?'var(--blue)':'var(--br)',
                background:sendVia===v?'var(--blue)22':'var(--s2)',
                color:sendVia===v?'var(--blue)':'var(--t2)'}}
              onClick={()=>setSendVia(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:14}}>
        <button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={onClose}>Cancel</button>
        <button className="btn sm" style={{flex:1,justifyContent:'center',background:'#9333ea',color:'#fff',borderColor:'#9333ea'}} onClick={send} disabled={sending || !year.trim()}>
          {sending?'Sending…':'🧾 Send Tax Organizer'}
        </button>
      </div>
    </div>
  )
}

// ── Canopy-style Document Manager for a specific client ──────────────────────
export const DOC_FOLDERS = ['IRS Docs','Tax Returns','Agreements','POA & Forms','Transcripts','Correspondence','Financial Statements','E-Signatures','Call Recording','Other']
const QUICK_TASK_TITLES = ['Request transcripts from IRS','Follow up with client','Prepare & send POA (2848/8821)','Call IRS for account status','Draft engagement letter','Collect financial documents','File tax return','Submit installment agreement','Prepare Offer in Compromise','Follow up on offer','Request wage & income transcripts','Schedule consultation','Send resolution options','Collect payment / trade']
// WIP summary widget shown in the client Overview tab
// WIP stats shown on Overview — read-only, no button
function ClientWIPWidget({ clientId, clientName }) {
  const [wip, setWip] = useState({ hours: 0, amount: 0 })
  useEffect(() => {
    if (!clientName) return
    const q = clientId
      ? supabase.from('billing_time_entries').select('hours,amount,billed').eq('client_id', clientId).eq('billed', false)
      : supabase.from('billing_time_entries').select('hours,amount,billed').eq('client_name', clientName).eq('billed', false)
    q.then(({ data }) => {
      if (!data) return
      setWip({
        hours:  data.reduce((s, e) => s + Number(e.hours || 0), 0),
        amount: data.reduce((s, e) => s + Number(e.amount || 0), 0),
      })
    })
  }, [clientId, clientName])
  return (
    <>
      <div>
        <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>WIP Hours</div>
        <div style={{fontSize:22,fontWeight:800,color:'#f59e0b'}}>{Number(wip.hours).toFixed(1)}h</div>
      </div>
      <div>
        <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>WIP Amount</div>
        <div style={{fontSize:22,fontWeight:800,color:'#f59e0b'}}>${Number(wip.amount).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
      </div>
    </>
  )
}

const FILE_EXT_ICON = n => { const e=(n||'').split('.').pop().toLowerCase(); return {pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',jpg:'🖼️',jpeg:'🖼️',png:'🖼️',tiff:'🖼️'}[e]||'📎' }
const fmt = b => b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'KB':(b/1048576).toFixed(1)+'MB'

export function ClientDocs({ clientId, clientName, supabase, showToast, onLogged }) {
  const [docs,       setDocs]       = useState([])
  const [folder,     setFolder]     = useState('All')
  const [uploading,  setUploading]  = useState(false)
  const [form,       setForm]       = useState({ name:'', docType:'IRS Docs', notes:'' })
  const [file,       setFile]       = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [preview,    setPreview]    = useState(null)
  const fileRef = useRef(null)

  useEffect(() => { loadDocs() }, [clientId, clientName])

  async function loadDocs() {
    let q = supabase.from('documents').select('*')
    q = clientId ? q.eq('client_id', String(clientId)) : q.eq('client', clientName)
    const { data } = await q.order('created_at', { ascending: false })
    setDocs(data || [])
  }

  async function upload() {
    if (!form.name.trim()) { showToast('Document name required'); return }
    setSaving(true)
    let fileUrl = null, fileName = null, fileSize = null, storagePath = null
    if (file) {
      const folderKey = String(form.docType || 'Documents').replace(/[^a-zA-Z0-9._-]+/g,'-')
      const ownerKey = clientId ? String(clientId) : clientName.replace(/\s+/g,'-')
      const path = `docs/${ownerKey}/${folderKey}/${Date.now()}_${file.name}`
      storagePath = path
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
      if (upErr) { showToast('Upload error: '+upErr.message); setSaving(false); return }
      const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      fileUrl = urlData?.signedUrl || null; fileName = file.name; fileSize = file.size
    }
    const { error } = await supabase.from('documents').insert([{
      name: form.name, client: clientName, clientname: clientName,
      client_id: clientId ? String(clientId) : null,
      docType: form.docType,
      notes: form.notes, file_url: fileUrl, file_name: fileName,
      storage_path: storagePath,
      file_size: fileSize, created_at: new Date().toISOString()
    }])
    setSaving(false)
    if (error) { showToast('Error: '+error.message); return }
    showToast('✅ Document saved!')
    const loggedName = form.name, loggedType = form.docType
    setForm({ name:'', docType:'IRS Docs', notes:'' }); setFile(null); setUploading(false); loadDocs()
    if (onLogged) await onLogged(`📁 Document added: "${loggedName}" (${loggedType})`)
  }

  async function openClientDoc(doc) {
    if (!doc) return
    const tab = window.open('about:blank','_blank')
    if (tab) tab.opener = null
    try {
      let url = doc.file_url || ''
      const storagePath = doc.storage_path
        || (String(doc.file_url || '').startsWith('storage://documents/') ? String(doc.file_url).replace('storage://documents/','') : '')
      if (storagePath) {
        const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, 3600)
        if (error || !data?.signedUrl) throw error || new Error('Could not open document')
        url = data.signedUrl
      }
      if (!url) throw new Error('Document file is unavailable')
      if (tab) tab.location.href = url
      else showToast('Allow pop-ups to open documents')
    } catch (e) {
      if (tab) tab.close()
      showToast('Could not open document: ' + (e?.message || e))
    }
  }

  async function delDoc(doc) {
    if (doc.file_name) {
      const path = doc.storage_path || (String(doc.file_url || '').startsWith('storage://documents/') ? String(doc.file_url).replace('storage://documents/','') : doc.file_url?.split('/documents/')[1])
      if (path) await supabase.storage.from('documents').remove([path]).catch(()=>{})
    }
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    if (error) { showToast('Error: ' + error.message); return }
    showToast('Deleted'); loadDocs()
    if (onLogged) await onLogged(`🗑️ Document deleted: "${doc.name}"`)
  }

  // Group by folder
  const byFolder = {}
  DOC_FOLDERS.forEach(f => { byFolder[f] = [] })
  docs.forEach(d => {
    const f = d.docType || 'Other'
    if (!byFolder[f]) byFolder[f] = []
    byFolder[f].push(d)
  })

  const visible = folder === 'All' ? docs : (byFolder[folder] || [])

  return (
    <div className="card" style={{padding:0,overflow:'hidden'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderBottom:'1px solid var(--br)'}}>
        <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)'}}>
          📁 Documents ({docs.length})
        </div>
        <button className="btn pri" style={{fontSize:11,padding:'3px 10px'}} onClick={()=>setUploading(v=>!v)}>
          {uploading ? '✕ Cancel' : '+ Add Doc'}
        </button>
      </div>

      {/* Upload form */}
      {uploading && (
        <div style={{padding:'10px 14px',background:'var(--s2)',borderBottom:'1px solid var(--br)'}}>
          <div className="fg2">
            <div className="field"><label>Name *</label>
              <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. 2023 Tax Return"/>
            </div>
            <div className="field"><label>Folder</label>
              <select value={form.docType} onChange={e=>setForm(f=>({...f,docType:e.target.value}))}>
                {DOC_FOLDERS.map(f=><option key={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div style={{border:'2px dashed var(--br)',borderRadius:7,padding:'10px',textAlign:'center',cursor:'pointer',background:file?'rgba(34,197,94,.05)':'transparent',marginBottom:8}}
            onClick={()=>fileRef.current?.click()}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='var(--blue)'}}
            onDragLeave={e=>e.currentTarget.style.borderColor='var(--br)'}
            onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)setFile(f);e.currentTarget.style.borderColor='var(--br)'}}>
            {file
              ? <span style={{fontSize:12,color:'var(--ok)',fontWeight:600}}>{FILE_EXT_ICON(file.name)} {file.name} ({fmt(file.size)})</span>
              : <span style={{fontSize:11,color:'var(--t3)'}}>📎 Drop file here or click to browse</span>
            }
            <input ref={fileRef} type="file" style={{display:'none'}} onChange={e=>setFile(e.target.files[0])}/>
          </div>
          <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Notes (optional)"
            style={{width:'100%',padding:'6px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12,marginBottom:8}}/>
          <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:7}} onClick={upload} disabled={saving}>
            {saving?'Saving…':'💾 Save Document'}
          </button>
        </div>
      )}

      {/* 2-pane layout */}
      <div style={{display:'flex',minHeight:docs.length>0?200:80}}>
        {/* Left: folder tree */}
        <div style={{width:180,flexShrink:0,borderRight:'1px solid var(--br)',padding:'8px 0',background:'var(--s2)'}}>
          <div onClick={()=>setFolder('All')}
            style={{padding:'5px 12px',cursor:'pointer',fontSize:12,fontWeight:folder==='All'?700:400,
              background:folder==='All'?'var(--blt)':'transparent',color:folder==='All'?'var(--b2)':'var(--tx)',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>🗂️ All</span>
            <span style={{fontSize:10,background:'var(--s3)',borderRadius:10,padding:'0 5px'}}>{docs.length}</span>
          </div>
          {DOC_FOLDERS.map(f=>(
            <div key={f} onClick={()=>setFolder(f)}
              style={{padding:'7px 14px',cursor:'pointer',fontSize:12.5,fontWeight:folder===f?700:400,
                background:folder===f?'var(--blt)':'transparent',color:folder===f?'var(--b2)':(byFolder[f]?.length?'var(--tx)':'var(--t3)'),
                display:'flex',justifyContent:'space-between',alignItems:'center',transition:'background .12s'}}
              onMouseEnter={e=>{if(folder!==f)e.currentTarget.style.background='var(--s3)'}}
              onMouseLeave={e=>{if(folder!==f)e.currentTarget.style.background='transparent'}}>
              <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>📂 {f}</span>
              <span style={{fontSize:10,background:'var(--s3)',borderRadius:10,padding:'0 5px',flexShrink:0,minWidth:16,textAlign:'center'}}>{byFolder[f]?.length||0}</span>
            </div>
          ))}
        </div>

        {/* Right: file grid */}
        <div style={{flex:1,padding:10,overflowY:'auto',maxHeight:400}}>
          {visible.length===0 ? (
            <div style={{color:'var(--t3)',fontSize:13,padding:'40px 20px',textAlign:'center'}}>
              <div style={{fontSize:36,marginBottom:8}}>📁</div>
              No documents in {folder==='All'?'this client file':folder} yet.
            </div>
          ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10}}>
              {visible.map(d=>(
                <div key={d.id}
                  style={{border:'1px solid var(--br)',borderRadius:10,padding:'12px 12px',background:'var(--sf)',
                    cursor:'pointer',transition:'all .15s ease',position:'relative',boxShadow:'0 1px 2px rgba(0,0,0,.08)'}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--blue)';e.currentTarget.style.transform='translateY(-3px)';e.currentTarget.style.boxShadow='0 8px 16px rgba(0,0,0,.18)'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--br)';e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,.08)'}}>
                  <div style={{fontSize:34,textAlign:'center',marginBottom:7}}>{FILE_EXT_ICON(d.file_name||d.name)}</div>
                  <div style={{fontSize:12,fontWeight:600,lineHeight:1.3,marginBottom:5,overflow:'hidden',textOverflow:'ellipsis',
                    display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
                    {d.name}
                  </div>
                  <div style={{fontSize:10,color:'var(--t3)',marginBottom:8}}>
                    {d.created_at?.slice(0,10)}{d.file_size?` · ${fmt(d.file_size)}`:''}
                  </div>
                  <div style={{display:'flex',gap:4}}>
                    {(d.file_url || d.storage_path) && (
                      <button type="button" onClick={e=>{e.stopPropagation();openClientDoc(d)}}
                        style={{flex:1,padding:'3px 0',background:'var(--blue)',color:'#fff',border:0,borderRadius:5,
                          fontSize:9,fontWeight:700,textAlign:'center',cursor:'pointer'}}>
                        View
                      </button>
                    )}
                    <button onClick={e=>{e.stopPropagation();delDoc(d)}}
                      style={{padding:'3px 6px',background:'var(--bad)',color:'#fff',border:'none',
                        borderRadius:5,cursor:'pointer',fontSize:9,fontWeight:700}}>
                      Del
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Clients() {
  const navigate = useNavigate()
  const { id: urlId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const openedFromCases = searchParams.get('from') === 'cases'
  const { user, searchQ, myTenantId } = useApp()

  // Cache office communications settings at load time
  const settingsRef = useRef(null)
  async function getSettings() {
    if (settingsRef.current) return settingsRef.current
    const { data } = await supabase.from('settings').select('sw_inbound_did,sw_space_url').limit(1).maybeSingle()
    settingsRef.current = data || {}
    return settingsRef.current
  }

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setForm(BLANK)
      setModal(true)
    }
  }, [searchParams])
  const [quickEmail, setQuickEmail] = useState(null)
  const [clients,   setClients]   = useState([])
  const [employees, setEmployees] = useState([])
  const [statusCategories, setStatusCategories] = useState([])
  const [filter,    setFilter]    = useState('All')
  const [filterStatus,   setFilterStatus]   = useState('All')
  const [filterRep,      setFilterRep]      = useState('All')
  const [filterPipeline, setFilterPipeline] = useState('All')
  const [clientSearch, setClientSearch] = useState('')
  // Sync TopBar search into local clientSearch so both inputs work
  useEffect(() => { setClientSearch(searchQ) }, [searchQ])
  const [sortCol, setSortCol] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const [showArchived, setShowArchived] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null)
  const [modal,     setModal]     = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [form,      setForm]      = useState(BLANK)
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState('')
  const [detail,    setDetail]    = useState(null)
  const [showFlow,  setShowFlow]  = useState(false)
  // Addendum + 2nd Trade combined modal
  const [addModal,    setAddModal]    = useState(false)
  const [addModalTab, setAddModalTab] = useState('addendum') // 'addendum' | 'charge'
  const [addForm,     setAddForm]     = useState({ resolutionFee:'', paymentPlan:'', startDate:'', notes:'', services:[], sendVia:'email' })
  const [addendumSending, setAddendumSending] = useState(false)
  const [rewriteModal, setRewriteModal] = useState(false)
  const [rewriteSaving, setRewriteSaving] = useState(false)
  const [rewriteForm, setRewriteForm] = useState({ resolutionFee:'', paymentPlan:'', startDate:'', notes:'', services:[], sendVia:'email' })
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [poaModal, setPoaModal] = useState(false)
  const [poaClient, setPoaClient] = useState(null)
  const [poaSending, setPoaSending] = useState(false)
  const [poaSendVia, setPoaSendVia] = useState('email')
  // Related data for detail view
  const [relCases,    setRelCases]    = useState([])
  const [relDeadlines,setRelDeadlines]= useState([])
  const [relDocs,     setRelDocs]     = useState([])
  const [uploadingDoc,setUploadingDoc]= useState(false)
  const [docForm,     setDocForm]     = useState({ name:'', docType:'IRS Notice', notes:'' })
  const [relNotes,    setRelNotes]    = useState([])
  const [notesExpanded, setNotesExpanded] = useState(false)
  const [newNote,     setNewNote]     = useState('')
  const [noteVisibleToClient, setNoteVisibleToClient] = useState(false)
  const [addingNote,  setAddingNote]  = useState(false)
  const [relTasks,    setRelTasks]    = useState([])
  const [clientTaskFilter, setClientTaskFilter] = useState('all') // 'all' | 'active' | 'completed'
  const [taskSubTab,  setTaskSubTab]  = useState('tasks') // 'tasks' | 'time'
  const [clientSectionOverride, setClientSectionOverride] = useState({})
  const [relInvoices, setRelInvoices] = useState([])
  const [relPayments, setRelPayments] = useState([])
  const [relSms,      setRelSms]      = useState([])
  const [smsBody,     setSmsBody]     = useState('')
  const [smsSending,  setSmsSending]  = useState(false)
  const [loadingRel,  setLoadingRel]  = useState(false)
  const [detailTab,   setDetailTabRaw] = useState(() => searchParams.get('tab') || 'overview')
  function setDetailTab(tab) {
    const el = document.querySelector('.page-content')
    const y = el ? el.scrollTop : 0
    setDetailTabRaw(tab)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', tab)
      return next
    }, { replace: true })
    if (!el) return
    // Fixed-delay reapply wasn't enough -- whatever resets scroll (browser
    // scroll anchoring, async content settling, or both) can still happen
    // after the last timed reapply ended. Instead, lock scrollTop to y
    // using a MutationObserver that reapplies it on every DOM change for a
    // full second, catching anything content-driven immediately rather
    // than on a guessed delay. Deliberately NOT also listening for scroll
    // events here -- that would fight genuine user scrolling during the
    // lock window, which is worse than the original bug.
    let active = true
    const reapply = () => { if (active) el.scrollTop = y }
    reapply()
    const observer = new MutationObserver(reapply)
    observer.observe(el, { childList: true, subtree: true, attributes: true })
    setTimeout(() => { active = false; observer.disconnect() }, 1000)
  }
  const [fillerClient, setFillerClient] = useState(null)
  const [bookingClient, setBookingClient] = useState(null)
  // Quick add task inline
  const [quickTask,   setQuickTask]   = useState('')
  const [addingTask,  setAddingTask]  = useState(false)
  // Add task modal (from action button)
  const [taskModal,   setTaskModal]   = useState(false)
  const [taskTitle,   setTaskTitle]   = useState('')
  const [taskPriority,setTaskPriority]= useState('Normal')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [taskSectionTitle, setTaskSectionTitle] = useState('')
  // When set, the quick-add box below the Tasks list is adding a sub-task
  // into this existing section instead of creating a new standalone task.
  const [pendingSection, setPendingSection] = useState('')
  const [templateModal, setTemplateModal] = useState(false)
  const [availableTemplates, setAvailableTemplates] = useState([])
  const [templateSearch, setTemplateSearch] = useState('')
  const [applyingTemplateId, setApplyingTemplateId] = useState('')
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([])
  // Add payment modal
  const [payModal,    setPayModal]    = useState(false)
  const [faxModal,    setFaxModal]    = useState(false)
  const [stripeModal, setStripeModal] = useState(false)
  const [paymentLinkModal, setPaymentLinkModal] = useState(false)
  const [splitPaymentModal, setSplitPaymentModal] = useState(false)
  const [installmentModal, setInstallmentModal] = useState(false)
  const [installmentForm, setInstallmentForm] = useState({ totalFee: '', months: '4', irsLiability: '', description: '' })
  const [installmentLoading, setInstallmentLoading] = useState(false)
  const [installmentDone, setInstallmentDone] = useState(null)
  const [faxClient,   setFaxClient]   = useState(null)
  const [esignModal,  setEsignModal]  = useState(false)
  const [esignClient, setEsignClient] = useState(null)
  const [portalModal, setPortalModal] = useState(false)
  const [portalClient, setPortalClient] = useState(null)
  const [orgModal, setOrgModal] = useState(false)
  const [orgClient, setOrgClient] = useState(null)
  const [payForm,     setPayForm]     = useState({ amount:'', method:'Credit Card', date:'', notes:'' })
  const [savingPay,   setSavingPay]   = useState(false)

  useEffect(() => {
    // Guard: don't load until auth session confirmed so current_tenant_id()
    // is established before the first query — prevents wrong-tenant data on hard refresh.
    if (!user) return
    load()
    const ch = supabase.channel('clients-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

  // Live-update the currently-open client's related data (notes, tasks,
  // payments, documents, cases) — these previously only loaded once when the
  // client was opened, with no way to see changes from another staff member
  // or an automated process without a manual refresh. Scoped to only run
  // while a specific client is open, and re-subscribes if you switch clients.
  useEffect(() => {
    if (!detail?.name) return
    const name = detail.name
    function reload() { loadRelated(name) }
    const ch = supabase.channel('client-detail-rt-' + (detail.id || name))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_notes' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, reload)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [detail?.id, detail?.name])

  // Save scroll position before refresh/navigation away, restore after detail (+ related data) loads.
  // Note: this targets .page-content, the element with overflow-y:auto — the
  // window itself never scrolls (.app-shell is height:100vh + overflow:hidden),
  // so window.scrollY/scrollTo were always a no-op here.
  useEffect(() => {
    if (!detail) return
    const key = `clientScroll_${detail.id}`
    const el = document.querySelector('.page-content')
    const saveScroll = () => { if (el) sessionStorage.setItem(key, String(el.scrollTop)) }
    window.addEventListener('beforeunload', saveScroll)
    window.addEventListener('pagehide', saveScroll)
    return () => {
      saveScroll()
      window.removeEventListener('beforeunload', saveScroll)
      window.removeEventListener('pagehide', saveScroll)
    }
  }, [detail?.id])

  // Restore scroll position once related data has finished loading (page height stable)
  useEffect(() => {
    if (!detail || loadingRel) return
    const key = `clientScroll_${detail.id}`
    const saved = sessionStorage.getItem(key)
    if (saved) {
      const el = document.querySelector('.page-content')
      requestAnimationFrame(() => { if (el) el.scrollTop = parseInt(saved, 10) || 0 })
    }
  }, [detail?.id, loadingRel])
  // Fast path: arriving directly at /clients/:id (e.g. clicking a record,
  // a deep link, or a page refresh) shouldn't wait on the entire client
  // list to download first just to find one row client-side. Fetch that
  // single record immediately; the full list still loads in the
  // background for the table view, but it no longer blocks opening
  // a record you already know the id of.
  useEffect(() => {
    if (!urlId || detail) return
    let cancelled = false
    supabase.from('clients').select('*').eq('id', urlId).single().then(({ data }) => {
      if (!cancelled && data) openDetail(data, { preserveTab: true, full: true })
    })
    return () => { cancelled = true }
  }, [urlId])
  useEffect(() => {
    if (urlId && clients.length > 0 && !detail) {
      const found = clients.find(c => String(c.id) === String(urlId))
      if (found) openDetail(found, { preserveTab: true })
    }
  }, [urlId, clients])
  // If the URL no longer points at the client currently being shown
  // (e.g. clicking "Clients" in the sidebar while a detail page is open,
  // or a link elsewhere jumping straight to a different client), drop the
  // stale detail state so the page actually reflects the URL again.
  useEffect(() => {
    if (detail && String(detail.id) !== String(urlId || '')) {
      setDetail(null)
    }
  }, [urlId, detail])

  async function load() {
    const [{ data:cl },{ data:em },{ data:cats },{ data:sts }] = await Promise.all([
      supabase.from('clients').select('id,name,status,email,phone,city,state,"clientType","assignedTo","taxAssociate","pipelineStage","irsBalance","issueType","spouseName",tags,ssn,archived,deleted_at,"business_name",created_at').or('archived.eq.true,deleted_at.is.null').order('name',{ascending:true}),
      supabase.from('employees').select('id,name,avatar_url,email'),
      supabase.from('workflow_status_categories').select('*').order('sort_order'),
      supabase.from('workflow_statuses').select('*').order('sort_order'),
    ])
    if (cl) setClients(cl)
    if (em) setEmployees(em)
    if (cats) setStatusCategories(cats.map(cat => ({ ...cat, statuses: (sts||[]).filter(s => s.category_id === cat.id) })))
  }

  // Single shared entry point for auto-logging an action as a client note.
  // Every action-logging call in this file should go through this instead of
  // hand-writing its own insert, so error handling (and the note format) is
  // consistent in exactly one place — a hand-written insert with a silently
  // swallowed error is what caused the pipeline-stage bug.
  // client_notes' real columns, confirmed directly from the schema:
  // id, clientname, text, author, type, created_at, visible_to_client,
  // note_type, tenant_id. There is no 'content' column and no 'created_by'
  // column — the note text goes in 'text', the creator goes in 'author'.
  async function insertClientNote({ clientname, content, created_by, created_at, note_type, visible_to_client }) {
    const payload = { clientname, text: content, author: created_by }
    if (created_at !== undefined) payload.created_at = created_at
    if (note_type !== undefined) payload.note_type = note_type
    if (visible_to_client !== undefined) payload.visible_to_client = visible_to_client
    const { error } = await supabase.from('client_notes').insert(payload)
    if (error) console.error('[client_notes] insert failed:', error)
    return { error }
  }

  async function logAction(clientName, text) {
    if (!clientName) return
    const actor = resolveActorName(user, employees)
    const { error } = await insertClientNote({ clientname: clientName, content: text, note_type: 'System', created_by: actor, created_at: new Date().toISOString() })
    if (error) showToast('Action completed, but failed to log note: ' + error.message)
    return !error
  }

  async function loadRelated(clientName, clientId = (detail?.name === clientName ? detail?.id : null)) {
    setLoadingRel(true)
    const [casesRes,tasksRes,invoicesRes,docsRes,clientNotesRes,paymentsRes,smsRes,deadlinesRes] = await Promise.all([
      supabase.from('cases').select('*').eq('clientName', clientName).order('created_at',{ascending:false}),
      supabase.from('tasks').select('*').eq('clientName', clientName).not('deleted','is',true).order('dueDate',{ascending:true}).order('created_at',{ascending:true}),
      supabase.from('invoices').select('*').eq('clientName', clientName).order('created_at',{ascending:false}),
      (clientId ? supabase.from('documents').select('*').eq('client_id', String(clientId)) : supabase.from('documents').select('*').eq('client', clientName)).order('created_at',{ascending:false}),
      supabase.from('client_notes').select('*').eq('clientname', clientName).order('created_at',{ascending:false}),
      supabase.from('payments').select('*').eq('clientName', clientName).order('created_at',{ascending:false}),
      supabase.from('sms_messages').select('*').eq('clientName', clientName).order('created_at',{ascending:false}),
      supabase.from('deadlines').select('*').eq('clientName', clientName).order('dueDate',{ascending:true}),
    ])
    // These 8 queries used to only look at .data, silently discarding any
    // .error — a table failing here (RLS, schema cache, anything) looked
    // identical to "genuinely has zero records", with no way to tell the
    // difference. Logging now so a real failure shows up in the console.
    const named = { cases:casesRes, tasks:tasksRes, invoices:invoicesRes, documents:docsRes, client_notes:clientNotesRes, payments:paymentsRes, sms_messages:smsRes, deadlines:deadlinesRes }
    Object.entries(named).forEach(([table, res]) => {
      if (res.error) console.error(`[loadRelated] ${table} query failed:`, res.error.message, res.error.hint || '', res.error.details || '')
    })
    const cases = casesRes.data, tasks = tasksRes.data, invoices = invoicesRes.data, docs = docsRes.data,
          clientNotes = clientNotesRes.data, payments = paymentsRes.data, sms = smsRes.data, deadlines = deadlinesRes.data
    setRelCases(cases||[])
    setRelTasks(tasks||[])
    setRelInvoices(invoices||[])
    setRelDocs(docs||[])
    setRelNotes(clientNotes||[])
    setRelPayments(payments||[])
    setRelSms(sms||[])
    setRelDeadlines(deadlines||[])
    setLoadingRel(false)
  }

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(''),3500)}
  function fld(k,v){setForm(f=>({...f,[k]:v}))}

  function fmtPhone(v) {
    const d = v.replace(/\D/g,'').slice(0,10)
    if (d.length <= 3) return d
    if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  }
  function fmtSsn(v) {
    const d = v.replace(/\D/g,'').slice(0,9)
    if (d.length <= 3) return d
    if (d.length <= 5) return `${d.slice(0,3)}-${d.slice(3)}`
    return `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}`
  }
  function fmtEin(v) {
    const d = v.replace(/\D/g,'').slice(0,9)
    if (d.length <= 2) return d
    return `${d.slice(0,2)}-${d.slice(2)}`
  }
  async function handleZip(v) {
    const d = v.replace(/\D/g,'').slice(0,5)
    fld('zip', d)
    if (d.length === 5) {
      try {
        const r = await fetch(`https://api.zippopotam.us/us/${d}`)
        if (r.ok) {
          const data = await r.json()
          const place = data.places?.[0]
          if (place) setForm(f=>({...f, zip:d, city: place['place name'], state: place['state abbreviation']}))
        }
      } catch(e) {}
    }
  }
  const repOptions = useMemo(() => ['All', ...Array.from(new Set(clients.map(c => c.assignedTo).filter(Boolean))).sort()], [clients])
  const pipelineOptions = useMemo(() => ['All', ...Array.from(new Set(clients.map(c => c.pipelineStage).filter(Boolean))).sort()], [clients])
  const filtered = useMemo(() => {
    const q = clientSearch.toLowerCase().trim()
    return clients
      .filter(c => showArchived ? !!c.archived : !c.archived)
      .filter(c => filter==='All' || c.clientType===filter)
      .filter(c => filterStatus==='All' || (c.status||'Active')===filterStatus)
      .filter(c => filterRep==='All' || (c.assignedTo||'')===filterRep)
      .filter(c => filterPipeline==='All' || (c.pipelineStage||'')===filterPipeline)
      .filter(c => !q || (
        (c.name||'').toLowerCase().includes(q) ||
        (c.email||'').toLowerCase().includes(q) ||
        (c.phone||'').replace(/\D/g,'').includes(q.replace(/\D/g,'')) ||
        (c.assignedTo||'').toLowerCase().includes(q) ||
        (c.taxAssociate||'').toLowerCase().includes(q) ||
        (c.city||'').toLowerCase().includes(q) ||
        (c.business_name||'').toLowerCase().includes(q) ||
        (c.spouseName||'').toLowerCase().includes(q) ||
        (c.tags||'').toLowerCase().includes(q) ||
        (c.ssn||'').replace(/-/g,'').includes(q.replace(/-/g,''))
      ))
  }, [clients, clientSearch, showArchived, filter, filterStatus, filterRep, filterPipeline])

  // Sort
  const sortedFiltered = useMemo(() => [...filtered].sort((a, b) => {
    let av, bv
    if (sortCol === 'name')         { av = a.name||''; bv = b.name||'' }
    else if (sortCol === 'type')    { av = a.clientType||''; bv = b.clientType||'' }
    else if (sortCol === 'balance') { av = parseFloat(a.irsBalance)||0; bv = parseFloat(b.irsBalance)||0 }
    else if (sortCol === 'issue')   { av = a.issueType||''; bv = b.issueType||'' }
    else if (sortCol === 'assigned'){ av = a.assignedTo||''; bv = b.assignedTo||'' }
    else if (sortCol === 'pipeline'){ av = a.pipelineStage||''; bv = b.pipelineStage||'' }
    else if (sortCol === 'status')  { av = a.status||''; bv = b.status||'' }
    else                            { av = a.name||''; bv = b.name||'' }
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  }), [filtered, sortCol, sortDir])

  function buildPayload(f) {
    const {
      dobM, dobD, dobY, id, created_at, pipelineStage,
      // Fields returned by select('*') that must never be in an update payload:
      tenant_id, deleted_at, archived, dnd, biz_same_as_personal,
      autopay_last_charged_at, autopay_last_result,
      stripe_checkout_sent_at, payment_plan_changes,
      qb_id, qb_synced_at, xero_id, xero_synced_at,
      // Lowercase duplicate columns — Postgres has both cases; only update the canonical ones
      assignedto, clientsince, clienttype, filingstatus, irsbalance, irsorstate,
      issuetype, pipelinestage, spousedob, spousename, spousessn, spouseoccupation,
      ...rest
    } = f
    const dob = dobM && dobD && dobY ? `${dobM}/${dobD}/${dobY}` : f.dob || ''
    // Persist the canonical mixed-case pipelineStage column. The edit form exposes
    // this field, so excluding it made the dropdown appear to save while silently
    // leaving the previous stage in the database.
    const safe = { ...rest, pipelineStage: pipelineStage || DEFAULT_PIPELINE_STAGE, dob, dependents: JSON.stringify(f.dependents || []), filingRequirements: JSON.stringify(f.filingRequirements || []) }
    // Empty-string values blow up non-text columns (date, numeric) with
    // "invalid input syntax" — Postgres wants null for "no value", not ''.
    Object.keys(safe).forEach(k => { if (safe[k] === '') safe[k] = null })
    return safe
  }

  async function save() {
    if (!form.name.trim()){showToast('Name is required');return}
    setSaving(true)
    const payload = {...buildPayload(form),created_at:new Date().toISOString()}
    const { error } = await supabase.from('clients').insert([payload])
    setSaving(false)
    if (error){showToast('Error: '+error.message);return}
    showToast('✅ Client added!')
    const actorC = resolveActorName(user, employees)
    await triggerWorkflow('client_created', 'client', form.name, actorC).catch(()=>{})
    await logActivity(supabase,{employeeName:actorC,action:'client_created',category:'client',description:`Added client: ${form.name}`,entityName:form.name}).catch(()=>{})
    setModal(false); setForm(BLANK)
    // Reload then navigate straight into the new client's detail
    const { data: allClients } = await supabase.from('clients').select('id,name,status,email,phone,city,state,"clientType","assignedTo","taxAssociate","pipelineStage","irsBalance","issueType","spouseName",tags,ssn,archived,deleted_at,"business_name",created_at').or('archived.eq.true,deleted_at.is.null').order('name', { ascending: true })
    if (allClients) setClients(allClients)
    const newest = allClients?.find(c => c.name === form.name)
    if (newest) { setDetail(newest); loadRelated(newest.name); navigate('/clients/' + newest.id, { replace: false }) }
  }

  async function saveEdit() {
    setSaving(true)
    const before = clients.find(cl=>cl.id===form.id) || detail
    const payload = buildPayload(form)
    const { error } = await supabase.from('clients').update(payload).eq('id',form.id)
    setSaving(false)
    if (error){showToast('Error: '+error.message);return}
    showToast('✅ Saved!')
    setEditModal(false)
    const {data}=await supabase.from('clients').select('*').eq('id',form.id).single()
    if (data){setDetail(data);loadRelated(data.name)}
    load()
    if (data) {
      const changes = summarizeFieldChanges(before, data)
      if (changes.length) { await logAction(data.name, `✏️ Updated: ${changes.join(', ')}`); loadRelated(data.name) }
    }
  }

  // Clients are archived, never permanently deleted — this hides them from
  // the active roster but keeps every field, note, document, and payment intact.
  async function archiveClient(id,name) { setConfirmArchive({id,name}) }
  async function confirmArchiveClient() {
    const {id,name} = confirmArchive; setConfirmArchive(null)
    const { error } = await supabase.from('clients').update({ archived: true, deleted_at: new Date().toISOString() }).eq('id',id)
    if (error) { showToast('Error: '+error.message); return }
    const actorA = resolveActorName(user, employees)
    await triggerWorkflow('client_archived', 'client', name || '', actorA).catch(()=>{})
    await logAction(name, '🗄️ Client archived')
    // Update local state immediately — no refresh needed
    setClients(prev => prev.map(c => c.id === id ? { ...c, archived: true } : c))
    setDetail(null)
    navigate('/clients', { replace: true })
    showToast('Client archived')
    const _caa=getActor(user); await logActivity(supabase,{employeeName:_caa.name,employeeEmail:_caa.email,action:'client_archived',category:'client',description:`Archived client: ${name}`,entityName:name}).catch(()=>{})
  }

  async function restoreClient(id) {
    const client = clients.find(c=>c.id===id)
    const { error } = await supabase.from('clients').update({ archived: false, deleted_at: null }).eq('id',id)
    if (error) { showToast('Error: '+error.message); return }
    showToast('Client restored');load()
    if (client) await logAction(client.name, '📤 Client restored from archive')
  }

  // Sends an SMS to this client right from their file -- same send-sms
  // Edge Function and sms_messages table the global SMS page uses, so
  // every message sent here also shows up there automatically (it's the
  // same data, just filtered to one client). Also drops a matching
  // client_notes entry, same auto-log pattern used for pipeline stage
  // changes, so a quick glance at Notes shows texts alongside everything
  // else without needing to switch tabs.
  async function sendClientSms(c) {
    if (!smsBody.trim()) { showToast('Message required'); return }
    if (!c.phone) { showToast('No phone number on file for this client'); return }
    setSmsSending(true)

    const toNum = '+1' + c.phone.replace(/\D/g,'').slice(-10)
    const settings = await getSettings()
    let status = 'Sent', swId = null, errMsg = null

    if (settings?.sw_space_url || myTenantId === 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae') {
      try {
        const { data: resData, error: invokeErr } = await supabase.functions.invoke('send-sms', {
          body: { to: toNum, body: smsBody, client_id: c.id || null, user_id: user?.id || null }
        })
        if (!invokeErr && resData?.success) {
          swId = resData.sid || null
        } else {
          status = 'Failed'
          errMsg = resData?.error || invokeErr?.message || 'SignalWire send failed'
        }
      } catch (e) {
        status = 'Failed'
        errMsg = e.message
      }
    } else {
      status = 'Logged (not sent)'
    }

    const actor = resolveActorName(user, employees)
    let error = null
    if (!(myTenantId === 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae' && swId)) {
      ;({ error } = await supabase.from('sms_messages').insert([{
        clientName: c.name, phone: toNum, body: smsBody, status,
        signalwire_sms_id: swId, sent_by: actor, error_msg: errMsg,
        created_at: new Date().toISOString(),
      }]))
    }
    setSmsSending(false)
    if (error) { showToast('Error: '+error.message); return }

    if (status === 'Sent') { showToast('✅ Text sent!'); const actorS = resolveActorName(user, employees); await triggerWorkflow('client_sms_sent', 'client', c?.name || '', actorS).catch(()=>{}) }
    else if (status === 'Failed') showToast('SignalWire error: ' + (errMsg||'send failed'))
    else showToast('Logged — add SignalWire credentials in Settings to actually send')

    // Auto-log to Notes, same pattern as pipeline stage changes.
    const noteContent = `💬 Text sent: "${smsBody.length > 120 ? smsBody.slice(0,120)+'…' : smsBody}"`
    await insertClientNote({ clientname: c.name, content: noteContent, created_by: actor, created_at: new Date().toISOString() })

    setSmsBody('')
    loadRelated(c.name)
  }

  async function toggleTask(task) {
    const {error}=await supabase.from('tasks').update({done:!task.done}).eq('id',task.id)
    if (!error && detail) {
      loadRelated(detail.name)
      await logAction(detail.name, `${!task.done ? '✅' : '↩️'} Task ${!task.done ? 'completed' : 'reopened'}: "${task.title}"`)
    }
  }

  async function updateTaskStatus(task, value) {
    if (!value) { await supabase.from('tasks').update({status_category:null, status_label:null}).eq('id',task.id); loadRelated(detail.name); return }
    const [category, label] = value.split('|||')
    const completed = statusCategories.find(c=>c.name===category)?.name?.toLowerCase() === 'completed'
    const prevLabel = task.status_label || (task.done ? 'Completed' : 'Ready to Start')
    await supabase.from('tasks').update({status_category:category, status_label:label, done:completed}).eq('id',task.id)
    const actor = resolveActorName(user, employees)
    await insertClientNote({
      clientname: detail.name,
      content: `🔄 Task status changed: "${task.title}" — ${prevLabel} → ${label}`,
      created_by: actor,
    })
    loadRelated(detail.name)
  }

  // Promotes an existing task into a named section (if it isn't one already)
  // and arms the quick-add box to drop the next task into that same section.
  async function addSubtask(task) {
    const sectionTitle = task.section_title || task.title
    if (!task.section_title) {
      await supabase.from('tasks').update({ section_title: sectionTitle }).eq('id', task.id)
      loadRelated(detail.name)
    }
    setPendingSection(sectionTitle)
  }

  async function openTemplatePicker() {
    const { data } = await supabase.from('workflow_templates').select('id,name,description').in('entity_type',['client','both']).eq('active',true).order('name')
    setAvailableTemplates(data || [])
    setTemplateSearch('')
    setSelectedTemplateIds([])
    setTemplateModal(true)
  }

  function toggleTemplateSelection(id) {
    setSelectedTemplateIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function applySelectedTemplates() {
    if (!selectedTemplateIds.length) return
    setApplyingTemplateId('__batch__')
    const actorName = resolveActorName(user, employees)
    const result = await applyWorkflowTemplate(selectedTemplateIds, detail.name, actorName, 'client')
    setApplyingTemplateId('')
    if (result?.error) { showToast('❌ ' + result.error); return }
    const names = availableTemplates.filter(t => selectedTemplateIds.includes(t.id)).map(t => t.name).join(', ')
    setTemplateModal(false)
    showToast(`✅ Applied "${names}" — ${result.count} task(s) created`)
    loadRelated(detail.name)
  }

  async function addQuickTask() {
    if (!quickTask.trim()||!detail) return
    setAddingTask(true)
    const {error}=await supabase.from('tasks').insert([{
      title:quickTask.trim(), clientName:detail.name, priority:'Normal',
      done:false, section_title: pendingSection || null, created_at:new Date().toISOString()
    }])
    setAddingTask(false)
    if (error){showToast('Task error: '+error.message);return}
    setQuickTask('')
    setPendingSection('')
    loadRelated(detail.name)
    showToast('✅ Task added!')
    await logAction(detail.name, `📌 Task created: "${quickTask.trim()}"`)
    loadRelated(detail.name)
  }

  async function addClientNote(visibleToClient = false) {
    if (!newNote.trim()||!detail) return
    setAddingNote(true)
    const {error}=await insertClientNote({
      clientname:detail.name, content:newNote.trim(),
      created_by:resolveActorName(user, employees), visible_to_client: visibleToClient,
      created_at:new Date().toISOString()
    })
    setAddingNote(false)
    if(error){showToast('Error: '+error.message);return}
    setNewNote('');loadRelated(detail.name)
    showToast('✅ Note added!')
  }

  async function addTaskFromModal() {
    if (!taskTitle.trim()||!detail) return
    setAddingTask(true)
    const {error}=await supabase.from('tasks').insert([{
      title:taskTitle.trim(), clientName:detail.name,
      priority:taskPriority, dueDate:taskDueDate||null,
      section_title: taskSectionTitle.trim() || null,
      done:false, created_at:new Date().toISOString()
    }])
    setAddingTask(false)
    if(error){showToast('Task error: '+error.message);return}
    const loggedTitle = taskTitle.trim()
    setTaskTitle('');setTaskPriority('Normal');setTaskDueDate('');setTaskSectionTitle('')
    setTaskModal(false)
    loadRelated(detail.name)
    showToast('✅ Task added!')
    await logAction(detail.name, `📌 Task created: "${loggedTitle}"`)
    loadRelated(detail.name)
  }

  const STATE_POA_FORMS = [
    { num:'FL-DR-835',state:'FL',label:'Power of Attorney',file:'FL_POA.pdf' },
    { num:'NC-GEN-58B',state:'NC',label:'Power of Attorney',file:'NC_POA.pdf' },
    { num:'TX-89-224',state:'TX',label:'Power of Attorney',file:'TX_POA.pdf' },
    { num:'OH-1-2',state:'OH',label:'Power of Attorney',file:'OH_POA.pdf' },
    { num:'NY-POA-1',state:'NY',label:'Power of Attorney',file:'NY_POA.pdf' },
    { num:'PA-REV-677',state:'PA',label:'Power of Attorney',file:'PA_POA.pdf' },
    { num:'CA-3520-PIT',state:'CA',label:'Individual or Fiduciary POA',file:'CA_POA.pdf' },
    { num:'GA-RD-1061',state:'GA',label:'Power of Attorney',file:'GA_POA.pdf' },
    { num:'IL-2848',state:'IL',label:'Power of Attorney',file:'IL_POA.pdf' },
    { num:'MA-M-2848',state:'MA',label:'Power of Attorney',file:'MA_POA.pdf' },
    { num:'MO-2827',state:'MO',label:'Power of Attorney',file:'MO_POA.pdf' },
    { num:'OR-150-800-005',state:'OR',label:'Tax Info Auth & POA',file:'OR_POA.pdf' },
    { num:'TN-RV-F0103801',state:'TN',label:'Power of Attorney',file:'TN_POA.pdf' },
    { num:'WA-42-2446',state:'WA',label:'Confidential Tax Info Auth',file:'Washington_POA.pdf' },
    { num:'WY-POA',state:'WY',label:'Power of Attorney',file:'Wyoming.pdf' },
    { num:'AZ-285-I',state:'AZ',label:'Individual Tax Disclosure / POA',file:'AZ_POA.pdf' },
    { num:'ID-POA',state:'ID',label:'Power of Attorney',file:'ID_POA.pdf' },
  ]

  async function sendStatePOA(client, formDef, via) {
    setPoaSending(true)
    try {
      const actor = resolveActorName(user, employees)
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const pdfRes = await fetch(await resolveStateFormUrl(base, formDef.file))
      if (!pdfRes.ok) throw new Error('Could not load ' + formDef.state + ' POA PDF')
      const rawBytes = new Uint8Array(await pdfRes.arrayBuffer())
      const { generateStatePOAWithCover } = await import('../lib/irsFormUtils')
      const mergedBytes = await generateStatePOAWithCover(client, rawBytes)
      const pdfBlob = new Blob([mergedBytes], { type: 'application/pdf' })
      const safeName = (client.name||'client').replace(/[^a-zA-Z0-9]+/g,'-')
      const path = `docs/${safeName}/state-poa/${formDef.state}_POA_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, pdfBlob, { upsert:true, contentType:'application/pdf' })
      if (upErr) throw new Error(upErr.message)
      const { data: urlData, error: signedUrlErr } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
      if (signedUrlErr || !urlData?.signedUrl) throw new Error(signedUrlErr?.message || 'Could not create secure State POA link')
      const { data: esign, error: esignErr } = await supabase.from('esigns').insert([{
        doc_type: `State POA — ${formDef.state} (${formDef.num})`,
        client_name: client.name, client_email: client.email||'', client_phone: client.phone||'',
        message: `Please review and sign your ${formDef.state} Power of Attorney. This authorizes ${FIRM.name || 'Tax Case Review'} to represent you before the ${formDef.state} tax authority.`,
        pdf_attachments: [{ formType:'state_poa', label:`${formDef.state} POA — ${formDef.label}`, url:urlData.signedUrl, storage_path:path }],
        priority:'Normal', status:'Awaiting', sent_at:new Date().toISOString(), created_at:new Date().toISOString(), sent_by:actor,
        tenant_id: FIRM.tenantId || undefined,
      }]).select().single()
      if (esignErr) throw new Error(esignErr.message)
      const sigUrl = `${window.location.origin}/sign/${esign.id}?token=${encodeURIComponent(esign.signer_token || '')}`
      let emailSent=false, smsSent=false
      if ((via==='email'||via==='both') && client.email) {
        const { error:eErr } = await supabase.functions.invoke('send-email', { body: { tenant_id: FIRM.tenantId || undefined, to:client.email, subject:`Action Required: Sign Your ${formDef.state} Power of Attorney — ${FIRM.name}`, html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><div style="text-align:center;margin-bottom:20px"><img src=\"${FIRM.logoUrl}\" alt=\"${FIRM.name}\" style=\"max-height:56px;max-width:190px;object-fit:contain;display:block;margin:0 auto 8px\" onerror=\"this.style.display='none'\"/><div style="font-size:12px;font-weight:800;color:#1d4ed8;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">${FIRM.name}</div></div><p>Dear <strong>${client.name}</strong>,</p><p>Your <strong>${formDef.state} Power of Attorney (${formDef.num})</strong> is ready for your review and signature.</p><p style="text-align:center;margin:24px 0"><a href="${sigUrl}" style="background:#1d4ed8;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">Review &amp; Sign →</a></p><p style="font-size:12px;color:#64748b">${sigUrl}</p><p style="font-size:11px;color:#94a3b8;margin-top:24px">${firmName()} · ${FIRM.address}<br/>📞 ${FIRM.phone}</p></div>` }})
        emailSent = !eErr
      }
      if ((via==='sms'||via==='both') && client.phone) {
        try {
          const { data:smsData, error:smsErr } = await supabase.functions.invoke('send-sms', {
            body:{to:client.phone, body:`${firmName()}: sign your ${formDef.state} POA here: ${sigUrl}`, client_id:client.id||null}
          })
          smsSent = !smsErr && !!smsData?.success
        } catch(_) {}
      }
      await insertClientNote({ clientname:client.name, content:`🏛️ ${formDef.state} State POA sent for e-signature (${formDef.num})${emailSent?' via email':''}${smsSent?' via SMS':''}`, created_by:actor, visible_to_client:false, created_at:new Date().toISOString() })
      setPoaModal(false)
      showToast(emailSent||smsSent ? `✅ ${formDef.state} POA sent for signature!` : '✅ Signing request created — delivery was not completed')
    } catch(e) { showToast('Error: '+e.message) }
    setPoaSending(false)
  }

  // Sends the Service Addendum for e-signature (vs. the print-only path,
  // which stays available as a separate button in the same modal). Mirrors
  // handleSendFullPackage's email/SMS pattern in Leads.jsx.
  async function sendAddendum() {
    if (!addForm.resolutionFee) { showToast('Enter the resolution fee first'); return }
    const via = addForm.sendVia || 'email'
    if (via !== 'sms' && !c.email) { showToast('Client has no email on file'); return }
    if (via !== 'email' && !c.phone) { showToast('Client has no phone on file'); return }
    setAddendumSending(true)
    const actor = resolveActorName(user, employees)
    const res = await sendAddendumForSignature(c, addForm, supabase, actor)
    if (res.error) { setAddendumSending(false); showToast('Error: '+res.error); return }

    const url = res.url
    // Generate Stripe checkout link for resolution fee so client can pay inline
    let stripePayUrl = null
    try {
      const { data: stripeData } = await supabase.functions.invoke('stripe-create-checkout-session', {
        body: {
          recordType: 'client', recordId: c.id, name: c.name, email: c.email,
          amount: String(addForm.resolutionFee),
          description: `Resolution Service Fee — ${c.name}`,
          purpose: 'resolution_fee',
        }
      })
      if (stripeData?.url) stripePayUrl = stripeData.url
    } catch(_) {}

    const feeDisplay = `$${Number(addForm.resolutionFee).toLocaleString()}`
    const planDisplay = addForm.paymentPlan ? ` ($${Number(addForm.paymentPlan).toLocaleString()}/mo)` : ''

    const paymentSection = stripePayUrl ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.06em">💳 Step 2 — Pay Your Resolution Fee</p>
      <p style="margin:0 0 14px;font-size:14px;color:#15803d;line-height:1.6">Your Resolution Service Fee is <strong>${feeDisplay}${planDisplay}</strong>. Pay securely below — your card will be saved on file.</p>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
        <a href="${stripePayUrl}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:-.01em;box-shadow:0 4px 14px rgba(14,165,233,.35)">Pay ${feeDisplay} Now →</a>
      </td></tr></table>
    </div>` : ''

    let emailSent=false, smsSent=false

    if ((via==='email'||via==='both') && c.email) {
      const { error: eErr } = await supabase.functions.invoke('send-email', { body: { tenant_id: FIRM.tenantId || undefined,
        to: c.email,
        subject: `Action Required: Sign Your Service Addendum — ${FIRM.name || 'Tax Case Review'}`,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%);padding:32px 40px;text-align:center">
    <img src="${FIRM.logoUrl}" alt="${FIRM.name}" style="max-height:60px;max-width:240px;object-fit:contain" onerror="this.style.display='none'"/>
    <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:12px">${FIRM.name}</div>
    <div style="font-size:12px;color:#93c5fd;margin-top:4px;letter-spacing:.08em;text-transform:uppercase">IRS Resolution Services</div>
  </td></tr>
  <tr><td style="padding:40px 40px 32px">
    <p style="margin:0 0 16px;font-size:16px;color:#0f172a">Dear <strong>${c.name}</strong>,</p>
    <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7">Your <strong>Service Addendum</strong> is ready for your review and signature. This document authorizes ${FIRM.name || 'Tax Case Review'} to proceed with the resolution services we've outlined for your case and confirms the associated service fee.</p>
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.06em">✍️ Step 1 — Review &amp; Sign</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 20px">
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:700;font-size:17px;box-shadow:0 4px 14px rgba(22,163,74,.35)">Review &amp; Sign Addendum →</a>
    </td></tr></table>
    <p style="margin:0 0 24px;font-size:12px;color:#94a3b8;text-align:center;word-break:break-all"><a href="${url}" style="color:#3b82f6">${url}</a></p>
    ${paymentSection}
    <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;border-left:4px solid #3b82f6">
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.6">💬 <strong>Questions?</strong> We're here to help.<br>📞 <strong>${FIRM.phone}</strong> &nbsp;·&nbsp; ✉️ <strong>${firmEmail()}</strong></p>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.8">${firmName()} &nbsp;·&nbsp; ${FIRM.address}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
      }})
      emailSent = !eErr
    }
    if ((via==='sms'||via==='both') && c.phone) {
      try {
        const { data:smsData, error:smsErr } = await supabase.functions.invoke('send-sms', {
          body:{to:c.phone, body:`${firmName()}: please review and sign your Service Addendum here: ${url}`, client_id:c.id||null}
        })
        smsSent = !smsErr && !!smsData?.success
      } catch (_) {}
    }

    const feeText = `$${Number(addForm.resolutionFee).toLocaleString()}`
    const channels = [emailSent&&'email', smsSent&&'sms'].filter(Boolean).join(' + ')
    const noteContent = `📋 Service Addendum sent for e-signature — Resolution Fee ${feeText}${channels?` (${channels})`:''}`
    await insertClientNote({ clientname: c.name, content: noteContent, created_by: actor, created_at: new Date().toISOString() })

    setAddendumSending(false)
    setAddModal(false)
    loadRelated(c.name)
    showToast(emailSent||smsSent ? '✅ Addendum sent for signature!' : '⚠️ Link copied — configure email/SMS to send automatically')
  }

  async function saveRewritePlan() {
    if (!rewriteForm.resolutionFee || !detail) { showToast('Enter the new resolution fee first'); return }
    const fee = Number(rewriteForm.resolutionFee)
    if (!Number.isFinite(fee) || fee <= 0) { showToast('Enter a valid resolution fee'); return }
    const via = rewriteForm.sendVia || 'email'
    if ((via === 'email' || via === 'both') && !detail.email) { showToast('Client has no email on file'); return }
    if ((via === 'sms' || via === 'both') && !detail.phone) { showToast('Client has no phone on file'); return }

    setRewriteSaving(true)
    try {
      const actor = resolveActorName(user, employees)
      const plan = {
        ...rewriteForm,
        services: Array.isArray(rewriteForm.services) ? rewriteForm.services : [],
      }

      // Generate the replacement agreement first. Client terms are not changed
      // unless a valid token-bound signing request exists.
      const res = await sendAddendumForSignature(detail, plan, supabase, actor)
      if (res.error) throw new Error(res.error)
      const url = res.url
      let emailSent=false, smsSent=false
      if ((via==='email'||via==='both') && detail.email) {
        const { data:emailData, error:emailErr } = await supabase.functions.invoke('send-email', { body: {
          tenant_id: FIRM.tenantId || undefined,
          to: detail.email,
          subject: `Action Required: Review Your New Payment Plan — ${firmName()}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px"><h2>Updated Service Plan</h2><p>Hi <strong>${detail.name}</strong>,</p><p>Your updated service/payment plan is ready for review and signature.</p><p><strong>Resolution fee:</strong> ${fee.toLocaleString()}${plan.paymentPlan ? `<br><strong>New payment:</strong> ${Number(plan.paymentPlan).toLocaleString()}/mo` : ''}${plan.startDate ? `<br><strong>Start date:</strong> ${plan.startDate}` : ''}</p><p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Review &amp; Sign New Plan</a></p><p>If you have questions, reply to this message before signing.</p><p><strong>${firmName()}</strong></p></div>`
        }})
        emailSent = !emailErr && emailData?.success !== false
      }
      if ((via==='sms'||via==='both') && detail.phone) {
        const { data:smsData, error:smsErr } = await supabase.functions.invoke('send-sms', { body: {
          to: detail.phone,
          body: `${firmName()}: your updated service/payment plan is ready to review and sign: ${url}`,
          client_id: detail.id || null
        }})
        smsSent = !smsErr && !!smsData?.success
      }

      const nextChanges = Number(detail.payment_plan_changes || 0) + 1
      const { error:updateErr } = await supabase.from('clients').update({
        contractFee: fee,
        services: plan.services,
        payment_plan_changes: nextChanges,
      }).eq('id', detail.id)
      if (updateErr) throw updateErr

      const servicesText = plan.services.length ? ` · Services: ${plan.services.join(', ')}` : ''
      const paymentText = plan.paymentPlan ? ` · New payment: ${Number(plan.paymentPlan).toLocaleString()}/mo` : ''
      const startText = plan.startDate ? ` · Starts: ${plan.startDate}` : ''
      await insertClientNote({
        clientname: detail.name,
        content: `🔄 Rewrite created — Default → New Plan · Resolution fee: ${fee.toLocaleString()}${paymentText}${startText}${servicesText}`,
        created_by: actor,
        created_at: new Date().toISOString(),
      })

      const { data:fresh } = await supabase.from('clients').select('*').eq('id',detail.id).single()
      if (fresh) setDetail(fresh)
      loadRelated(detail.name, detail.id)
      setRewriteModal(false)
      showToast(emailSent||smsSent ? '✅ Rewrite saved and sent for signature!' : '✅ Rewrite saved — delivery was not completed')
    } catch (e) {
      showToast('Rewrite error: ' + (e?.message || 'Unable to create new plan'))
    } finally {
      setRewriteSaving(false)
    }
  }

  async function addPaymentForClient() {
    if (!payForm.amount||!detail) return
    setSavingPay(true)
    const {error}=await supabase.from('payments').insert([{
      clientName:detail.name, amount:payForm.amount,
      method:payForm.method, date:payForm.date||new Date().toISOString().slice(0,10),
      notes:payForm.notes, status:'Cleared',
      created_at:new Date().toISOString()
    }])
    setSavingPay(false)
    if(error){showToast('Payment error: '+error.message);return}
    const loggedAmount = payForm.amount, loggedMethod = payForm.method
    setPayForm({amount:'',method:'Credit Card',date:'',notes:''})
    setPayModal(false)
    showToast('✅ Payment recorded!')
    await logAction(detail.name, `💵 Payment recorded: $${loggedAmount} (${loggedMethod})`)
    loadRelated(detail.name)
  }

  async function createInstallmentPlan() {
    if (!installmentForm.totalFee || !installmentForm.months || !detail) return
    setInstallmentLoading(true)
    setInstallmentDone(null)
    try {
      const { data, error } = await supabase.functions.invoke('stripe-create-subscription', {
        body: {
          clientId: detail.id,
          clientName: detail.name,
          email: detail.email || '',
          totalAmount: parseFloat(installmentForm.totalFee),
          months: parseInt(installmentForm.months),
          description: installmentForm.description || `Tax Resolution Services — ${installmentForm.months}-Month Plan`,
        }
      })
      if (error || data?.error) throw new Error(data?.error || error?.message)

      const monthlyAmt = parseFloat(installmentForm.totalFee) / parseInt(installmentForm.months)
      const now = new Date()

      // Create AR schedule entries in payments table
      const arRows = Array.from({ length: parseInt(installmentForm.months) }, (_, i) => {
        const dueDate = new Date(now.getFullYear(), now.getMonth() + i, now.getDate())
        return {
          clientName: detail.name,
          amount: monthlyAmt.toFixed(2),
          method: 'Stripe Subscription',
          date: dueDate.toISOString().slice(0, 10),
          scheduled_date: dueDate.toISOString().slice(0, 10),
          payment_status: i === 0 ? 'Paid' : 'Scheduled', // first month charges immediately
          trade_type: '2nd Trade',
          status: i === 0 ? 'Cleared' : 'Scheduled',
          notes: `Installment ${i + 1} of ${installmentForm.months}${installmentForm.irsLiability ? ` | IRS Liability: $${installmentForm.irsLiability}` : ''}`,
          subscription_id: data.subscription_id || null,
          created_at: new Date().toISOString(),
        }
      })
      await supabase.from('payments').insert(arRows)

      // Log to client notes
      await insertClientNote({
        clientname: detail.name,
        content: `💳 2nd Trade Installment Plan Created — $${parseFloat(installmentForm.totalFee).toLocaleString()} over ${installmentForm.months} months ($${monthlyAmt.toFixed(2)}/mo)${data.mode === 'checkout' ? '\nCheckout link sent to collect card.' : '\nSubscription started on saved card.'}`,
        note_type: 'System',
        created_by: resolveActorName(user, employees),
        created_at: new Date().toISOString(),
      })

      setInstallmentDone({ mode: data.mode, checkoutUrl: data.checkout_url, monthlyAmt, months: parseInt(installmentForm.months) })
      if (data.mode === 'checkout' && data.checkout_url) {
        window.open(data.checkout_url, '_blank')
      }
      showToast('✅ Installment plan created!')
      // Refresh payments
      const { data: pData } = await supabase.from('payments').select('*').eq('clientName', detail.name).order('created_at', { ascending: false })
      if (pData) setRelPayments(pData)
    } catch (e) {
      showToast('Error: ' + e.message)
    }
    setInstallmentLoading(false)
  }

  function openEdit(c) {
    const deps=parseDependents(c.dependents)
    const filingReqs=parseDependents(c.filingRequirements)
    let dobM='',dobD='',dobY=''
    if (c.dob){const p=c.dob.split('/');if(p.length===3){dobM=p[0];dobD=p[1];dobY=p[2]}}
    setForm({...BLANK,...c,dobM,dobD,dobY,dependents:deps,filingRequirements:filingReqs})
    setEditModal(true)
  }

  function openDetail(c, opts = {}) {
    if (!opts.preserveTab) setDetailTab('overview')
    setDetail(c)
    setRelCases([]);setRelTasks([]);setRelInvoices([]);setRelSms([]);setRelDeadlines([])
    loadRelated(c.name, c.id)
    const qs = opts.preserveTab ? searchParams.toString() : ''
    navigate(`/clients/${c.id}${qs ? `?${qs}` : ''}`, { replace: false })
    // If opened from the list (narrow columns), upgrade to full row in background
    if (!opts.full) {
      supabase.from('clients').select('*').eq('id', c.id).single().then(({ data }) => {
        if (data) setDetail(data)
      })
    }
  }

  const reps=employees.length>0?employees.map(e=>e.name):['Romy Cruz','Dana Richard','Yesenia Gonzalez']
  const stageIdx=c=>PIPELINE_STAGES.findIndex(s=>s.key===(c.pipelineStage||DEFAULT_PIPELINE_STAGE))

  // ── Detail View ──────────────────────────────────────────────────────────────
  if (detail) {
    const c=detail
    const deps=parseDependents(c.dependents)
    const si=stageIdx(c)
    // Palette for the flow chips (PIPELINE_STAGES have no colors of their own).
    const STAGE_PALETTE=['#6366f1','#8b5cf6','#3b82f6','#0ea5e9','#06b6d4','#14b8a6','#10b981','#84cc16','#f59e0b','#f97316','#ef4444','#ec4899','#64748b']
    // Toggle a parallel service/action on/off (clients.services text[]).
    // Log a client_note and refresh the notes panel — same pattern as
    // applyPipelineStage, so Active Services and IRS/State status changes show
    // up on the client's timeline the way stage changes do.
    const logAndRefreshNote=async(content)=>{
      const actor=resolveActorName(user,employees)
      const {error:noteErr}=await insertClientNote({clientname:c.name,content,created_by:actor,created_at:new Date().toISOString()})
      if(noteErr){showToast('Saved, but failed to log note: '+noteErr.message);return}
      if(detail?.id===c.id){
        const{data:notesData}=await supabase.from('client_notes').select('*').eq('clientname',c.name).order('created_at',{ascending:false})
        if(notesData)setRelNotes(notesData)
      }
    }
    const toggleService=async(svc)=>{
      const cur=Array.isArray(c.services)?c.services:[]
      const added=!cur.includes(svc)
      const next=added?[...cur,svc]:cur.filter(x=>x!==svc)
      const {error}=await supabase.from('clients').update({services:next}).eq('id',c.id)
      if(error){showToast('Error updating services: '+error.message);return}
      const {data}=await supabase.from('clients').select('*').eq('id',c.id).single()
      if(data)setDetail(data)
      await logAndRefreshNote(`🔧 Service ${added?'added':'removed'}: ${svc}`)
    }
    // Update the client's current IRS or State status inline (+ log a note).
    const STATUS_FIELD_LABEL={irsStatus:'IRS status',stateStatus:'State status',irsStatusOther:'IRS status detail',stateStatusOther:'State status detail'}
    const applyStatusField=async(field,value)=>{
      const prev=c[field]||''
      if(prev===(value||'')) return
      const {error}=await supabase.from('clients').update({[field]:value}).eq('id',c.id)
      if(error){showToast('Error updating status: '+error.message);return}
      const {data}=await supabase.from('clients').select('*').eq('id',c.id).single()
      if(data)setDetail(data)
      const lbl=STATUS_FIELD_LABEL[field]||field
      const note=(field==='irsStatusOther'||field==='stateStatusOther')
        ? `🏛️ ${lbl} set: ${value||'—'}`
        : `🏛️ ${lbl} changed: ${prev||'—'} → ${value||'—'}`
      await logAndRefreshNote(note)
    }
    // Shared stage-change logic — used by both the dropdown and the View Flow modal.
    const applyPipelineStage=async(newKey)=>{
      if(newKey===c.pipelineStage) return
      const prevStage=PIPELINE_STAGES.find(p=>p.key===(c.pipelineStage||DEFAULT_PIPELINE_STAGE))
      const newStage=PIPELINE_STAGES.find(p=>p.key===newKey)
      const {error}=await supabase.from('clients').update({pipelineStage:newKey}).eq('id',c.id)
      if(error){showToast('Error updating pipeline stage: '+error.message);return}
      const {data}=await supabase.from('clients').select('*').eq('id',c.id).single()
      if(data)setDetail(data)
      const actor=resolveActorName(user,employees)
      const noteContent=`📊 Pipeline stage changed: ${prevStage?.label||'—'} → ${newStage?.label||newKey}`
      const {error:noteErr}=await insertClientNote({clientname:c.name,content:noteContent,created_by:actor,created_at:new Date().toISOString()})
      if(noteErr){showToast('Stage updated, but failed to log note: '+noteErr.message)}
      else if(detail?.id===c.id){
        const{data:notesData}=await supabase.from('client_notes').select('*').eq('clientname',c.name).order('created_at',{ascending:false})
        if(notesData)setRelNotes(notesData)
      }
    }

    return (
      <div style={{maxWidth:960,margin:'0 auto'}}>
        {toast&&<div className="toast show">{toast}</div>}

        {/* Back + top actions */}
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,flexWrap:'wrap'}}>
          <button className="btn" style={{padding:'8px 16px',fontSize:13,fontWeight:600}} onClick={()=>{setDetail(null);navigate('/clients',{replace:true})}}>← Back to Clients</button>
          <a href="/cases" className={openedFromCases ? "btn pri" : "btn"} style={{padding:'8px 16px',fontSize:13,fontWeight:600,textDecoration:'none'}}>← Back to Cases</a>
          <button className="btn pri" style={{marginLeft:'auto',padding:'8px 18px',fontSize:13,fontWeight:700}} onClick={()=>openEdit(c)}>✏️ Edit</button>
          {c.archived ? (
            <button className="btn" style={{padding:'8px 18px',fontSize:13,fontWeight:700}} onClick={()=>restoreClient(c.id)}>↩ Restore</button>
          ) : (
            <button className="btn del" style={{padding:'8px 18px',fontSize:13,fontWeight:700}} onClick={()=>archiveClient(c.id,c.name)}>🗑 Archive</button>
          )}
        </div>

        {/* Header card */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',gap:16,padding:'4px 0 8px',flexWrap:'wrap'}}>
            <div style={{width:56,height:56,borderRadius:'50%',background:'var(--blue)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900,fontSize:22,color:'#fff',flexShrink:0}}>
              {(c.name||'?')[0].toUpperCase()}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:22,fontWeight:800}}>{c.name}</div>
              {c.business_name && c.business_name !== c.name && (
                <div style={{fontSize:14,fontWeight:600,color:'var(--t2)',marginTop:2}}>🏢 {c.business_name}</div>
              )}
              <div style={{display:'flex',gap:6,marginTop:5,flexWrap:'wrap'}}>
                <Bdg s={c.clientType||'Individual'} c="bb" style={{fontSize:13,padding:'4px 10px'}}/>
                <Bdg s={c.status||'Active'} c={c.status==='Active'?'bg':'bn'} style={{fontSize:13,padding:'4px 10px'}}/>
                {c.irsOrState&&<Bdg s={c.irsOrState} c="ba" style={{fontSize:13,padding:'4px 10px'}}/>}
                {c.issueType&&<Bdg s={c.issueType} c="bb" style={{fontSize:13,padding:'4px 10px'}}/>}
                {/* Renders from pipelineStage itself, so it can never disagree
                    with the pipeline row below — one source of truth. */}
                <Bdg s={'📊 '+pipelineStageLabel(c.pipelineStage||DEFAULT_PIPELINE_STAGE)} c="ba" style={{fontSize:13,padding:'4px 10px'}}/>
                {c.assignedTo&&<Bdg s={'👤 '+c.assignedTo} c="bn" style={{fontSize:13,padding:'4px 10px'}}/>}
              </div>
            </div>
            {c.internal_note && (
              <div style={{maxWidth:280,background:'rgba(245,158,11,.12)',border:'1.5px solid #f59e0b',borderRadius:8,padding:'8px 12px',fontSize:11,lineHeight:1.5}}>
                <div style={{fontWeight:700,color:'#f59e0b',marginBottom:3,display:'flex',alignItems:'center',gap:4}}>📌 Staff Note</div>
                <div style={{color:'var(--tx)'}}>{c.internal_note}</div>
              </div>
            )}
          </div>

          {/* Pipeline — compact current-stage display (no horizontal overflow) */}
          <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--br)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Case Pipeline</div>
              <button className="btn sec" style={{padding:'2px 8px',fontSize:10}} onClick={()=>setShowFlow(true)}>📊 View Flow</button>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <span className="bdg ba" style={{fontSize:14,fontWeight:700,padding:'6px 14px',borderRadius:24}}>
                📊 {pipelineStageLabel(c.pipelineStage||DEFAULT_PIPELINE_STAGE)}
              </span>
              <span style={{fontSize:12,color:'var(--t3)',fontWeight:600}}>Stage {si+1} of {PIPELINE_STAGES.length}</span>
              <select
                value={c.pipelineStage||DEFAULT_PIPELINE_STAGE}
                onChange={e=>applyPipelineStage(e.target.value)}
                style={{fontSize:13,padding:'6px 10px',borderRadius:8,background:'var(--s2)',color:'var(--tx)',border:'1px solid var(--br)',cursor:'pointer'}}
              >
                {PIPELINE_STAGES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div style={{marginTop:8,height:6,background:'var(--s3)',borderRadius:4,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${Math.round(((si+1)/PIPELINE_STAGES.length)*100)}%`,background:'var(--blue)',borderRadius:4,transition:'width .3s'}}/>
            </div>
            {/* Active Services — parallel actions, not pipeline stages (a client can have several at once) */}
            <div style={{marginTop:14,paddingTop:12,borderTop:'1px solid var(--br)'}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Active Services</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {CASE_SERVICES.map(svc=>{
                  const on=(Array.isArray(c.services)?c.services:[]).includes(svc)
                  return (
                    <div key={svc} onClick={()=>toggleService(svc)} style={{
                      padding:'6px 14px',borderRadius:24,fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',
                      background:on?'#10b981':'var(--s3)',color:on?'#fff':'var(--t3)',
                      border:on?'2px solid #10b981':'2px solid transparent',transition:'all .15s'
                    }}>{on?'✓ ':''}{svc}</div>
                  )
                })}
              </div>
            </div>
            {/* Current IRS / State status — the client's standing (distinct from pipeline & services) */}
            <div style={{marginTop:14,paddingTop:12,borderTop:'1px solid var(--br)'}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Current IRS / State Status</div>
              <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                {(c.irsOrState||'IRS Federal')!=='State' && (
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--t3)',width:36}}>IRS</span>
                    <span className="bdg ba" style={{fontSize:13,fontWeight:700,padding:'5px 12px',borderRadius:20}}>{c.irsStatus==='Other'?(c.irsStatusOther||'Other'):(c.irsStatus||'—')}</span>
                    <select value={c.irsStatus||''} onChange={e=>applyStatusField('irsStatus',e.target.value)} style={{fontSize:12,padding:'5px 8px',borderRadius:8,background:'var(--s2)',color:'var(--tx)',border:'1px solid var(--br)',cursor:'pointer'}}>
                      <option value="">—</option>
                      {IRS_STATUS_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                    {c.irsStatus==='Other'&&(
                      <input key={'irsOther-'+c.id} defaultValue={c.irsStatusOther||''}
                        onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.irsStatusOther||''))applyStatusField('irsStatusOther',v)}}
                        placeholder="Specify IRS status"
                        style={{fontSize:12,padding:'5px 8px',borderRadius:8,background:'var(--s2)',color:'var(--tx)',border:'1px solid var(--br)',width:150}}/>
                    )}
                  </div>
                )}
                {(c.irsOrState||'IRS Federal')!=='IRS Federal' && (
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--t3)',width:36}}>State</span>
                    <span className="bdg ba" style={{fontSize:13,fontWeight:700,padding:'5px 12px',borderRadius:20}}>{c.stateStatus==='Other'?(c.stateStatusOther||'Other'):(c.stateStatus||'—')}</span>
                    <select value={c.stateStatus||''} onChange={e=>applyStatusField('stateStatus',e.target.value)} style={{fontSize:12,padding:'5px 8px',borderRadius:8,background:'var(--s2)',color:'var(--tx)',border:'1px solid var(--br)',cursor:'pointer'}}>
                      <option value="">—</option>
                      {IRS_STATUS_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                    {c.stateStatus==='Other'&&(
                      <input key={'stateOther-'+c.id} defaultValue={c.stateStatusOther||''}
                        onBlur={e=>{const v=e.target.value.trim(); if(v!==(c.stateStatusOther||''))applyStatusField('stateStatusOther',v)}}
                        placeholder="Specify state status"
                        style={{fontSize:12,padding:'5px 8px',borderRadius:8,background:'var(--s2)',color:'var(--tx)',border:'1px solid var(--br)',width:150}}/>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Case Pipeline Flow Modal */}
          {showFlow && (
            <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setShowFlow(false)}>
              <div className="modal" style={{maxWidth:900,width:'95vw'}}>
                <div className="mh">
                  <span className="mt">📊 Case Pipeline Flow</span>
                  <button className="xbtn" onClick={()=>setShowFlow(false)}>&times;</button>
                </div>
                <div style={{overflowX:'auto',padding:'8px 0'}}>
                  <div style={{display:'flex',alignItems:'center',gap:0,flexWrap:'wrap',rowGap:12}}>
                    {PIPELINE_STAGES.map((s,i,arr)=>(
                      <div key={s.key} style={{display:'flex',alignItems:'center',gap:0}}>
                        <div onClick={()=>{applyPipelineStage(s.key);setShowFlow(false)}} style={{background:STAGE_PALETTE[i%STAGE_PALETTE.length],color:'#fff',borderRadius:6,padding:'7px 9px',fontSize:11,fontWeight:700,textAlign:'center',width:120,lineHeight:1.2,cursor:'pointer',opacity:c.pipelineStage===s.key?1:0.55,outline:c.pipelineStage===s.key?'2px solid #fff':'none',outlineOffset:-2,transition:'opacity .15s'}}>{s.label}</div>
                        {i<arr.length-1 && <div style={{color:'var(--t3)',fontSize:13,margin:'0 3px'}}>→</div>}
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:14,fontSize:11,color:'var(--t3)'}}>Click a stage to move this client to it.</div>
                </div>
              </div>
            </div>
          )}

          {/* Balance summary */}
          {(() => {
            const totalPaid = relPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
            const rawBal = c.irsBalance
            const irsNum = rawBal && !isNaN(Number(rawBal)) ? Number(rawBal) : null
            const remaining = irsNum !== null ? irsNum - totalPaid : null
            if (!irsNum && totalPaid === 0) return null
            return (
              <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--br)',display:'flex',gap:20,flexWrap:'wrap'}}>
                {irsNum !== null && (
                  <div style={{display:'flex',flexDirection:'column',gap:2}}>
                    <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)'}}>IRS Balance</div>
                    <div style={{fontSize:16,fontWeight:800,color:'var(--bad)'}}>${irsNum.toLocaleString()}</div>
                  </div>
                )}
                {totalPaid > 0 && (
                  <div style={{display:'flex',flexDirection:'column',gap:2}}>
                    <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)'}}>Paid to Firm</div>
                    <div style={{fontSize:16,fontWeight:800,color:'var(--ok)'}}>${totalPaid.toLocaleString()}</div>
                  </div>
                )}
                {remaining !== null && (
                  <div style={{display:'flex',flexDirection:'column',gap:2}}>
                    <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)'}}>Remaining Balance</div>
                    <div style={{fontSize:16,fontWeight:800,color:remaining<=0?'var(--ok)':'var(--tx)'}}>${Math.max(0,remaining).toLocaleString()}</div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* Action Buttons */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>Quick Actions</div>
          <div className="ovx">
          <div style={{display:'grid',gridTemplateColumns:'repeat(10, 1fr)',gap:8,minWidth:800}}>
            <ActionBtn color="#0891b2" icon="📅" label="Schedule" sub="Book Appointment" onClick={()=>setBookingClient(c)}/>
            <ActionBtn color="#7c3aed" icon="✅" label="Add Task" sub="Assign Work" onClick={()=>{setTaskTitle('');setTaskPriority('Normal');setTaskDueDate('');setTaskModal(true)}}/>
            <ActionBtn color="#dc2626" icon="📠" label="Send Fax" sub="SignalWire Fax" onClick={()=>{setFaxClient(c);setFaxModal(true)}}/>
            <ActionBtn color="#e11d48" icon="✍️" label="E-Signature" sub="Request Sign" onClick={()=>{setEsignClient(c);setEsignModal(true)}}/>
            <ActionBtn color="#0369a1" icon="📋" label="Pre-Fill 8821/2848" sub="IRS PDF Forms" onClick={()=>{
              try {
                if (!c) { showToast('Error: no client data found'); return }
                setFillerClient({...c, address:c.street, business_name:c.business_name||c.name})
              } catch (err) { showToast('Error opening form: ' + err.message) }
            }}/>
            <ActionBtn color="#0f766e" icon="🏛️" label="Pre-Fill State POA" sub={c.state ? c.state+' Form' : 'State Form'} onClick={()=>{ setPoaClient(c); setPoaModal(true) }}/>
            <ActionBtn color="#d97706" icon="📋" label="Addendum" sub="Add Services" onClick={()=>{setAddForm({resolutionFee:String(c.contractFee||''),paymentPlan:'',startDate:'',notes:'',services:Array.isArray(c.services)?c.services:[],sendVia:'email',trade1Amount:c.trade1Amount||'',trade1Date:c.trade1Date||'',trade2Amount:c.trade2Amount||'',trade2Date:c.trade2Date||'',trade3Amount:c.trade3Amount||'',trade3Date:c.trade3Date||''});setAddModal(true)}}/>
            <ActionBtn color="#991b1b" icon="🔄" label="Rewrite" sub="Default → New Plan" onClick={()=>{setRewriteForm({resolutionFee:String(c.contractFee||''),paymentPlan:'',startDate:'',notes:'',services:Array.isArray(c.services)?c.services:[],sendVia:'email'});setRewriteModal(true)}}/>
            <ActionBtn color="#0ea5e9" icon="🔓" label="Client Portal" sub="Compliance Access" onClick={()=>{setPortalClient(c);setPortalModal(true)}}/>
            <ActionBtn color="#4338ca" icon="🧾" label="Tax Organizer" sub="Send for Filing" onClick={()=>{setOrgClient(c);setOrgModal(true)}}/>
          </div>
          </div>
        </div>


        {/* ── Overview / Docs / Notes / Payments ─────────────── */}
                {/* ── Tabbed Detail Section ─────────────────────────── */}
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          {/* Tab Bar */}
          <div style={{display:'flex',flexWrap:'nowrap',overflowX:'auto',borderBottom:'1px solid var(--br)',background:'var(--s2)',paddingBottom:2}}>
            {[
              {key:'overview',   icon:'📋', text:'Overview'},
              {key:'notes',      icon:'📝', text:'Notes'},
              {key:'tasks',      icon:'✅', text:'Tasks'},
              {key:'docs',       icon:'📁', text:'Docs'},
              {key:'finprofile', icon:'🧮', text:'Financial Profile'},
              {key:'sms',        icon:'💬', text:'SMS'},
              {key:'invoices',   icon:'🧾', text:'Invoices'},
              {key:'payments',   icon:'💳', text:'Payments'},
              {key:'cases',      icon:'📁', text:'Cases'},
              {key:'organizer',  icon:'🧾', text:'Tax-Organizer'},
              {key:'activity',   icon:'📋', text:'Activity Report'},
              {key:'calls',      icon:'📞', text:'Calls'},
              {key:'transactions', icon:'💰', text:'Transactions'},
            ].map(t=>(
              <button key={t.key} onClick={()=>setDetailTab(t.key)}
                style={{display:'inline-flex',alignItems:'center',gap:5,padding:'12px 9px',border:'none',borderBottom:detailTab===t.key?'2px solid var(--blue)':'2px solid transparent',
                  background:'none',cursor:'pointer',fontWeight:detailTab===t.key?700:500,
                  color:detailTab===t.key?'var(--blue)':'var(--t2)',whiteSpace:'nowrap',transition:'all .15s',flexShrink:0}}>
                <span style={{fontSize:22,lineHeight:1}}>{t.icon}</span>
                <span style={{fontSize:11}}>{t.text}</span>
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {detailTab==='overview'&&(
            <div style={{padding:16}}>
              {(relNotes.length>0||c.notes)&&(
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:6}}>Case Notes</div>
                  {relNotes.length>0?(
                    <>
                      <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{relNotes[0].text}</div>
                      <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>{relNotes[0].author||'Staff'} · {relNotes[0].created_at?new Date(relNotes[0].created_at).toLocaleString():''}</div>
                    </>
                  ):(
                    <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{c.notes}</div>
                  )}
                </div>
              )}
              <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Documents</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--blue)'}}>{relDocs.length}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Notes</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--blue)'}}>{relNotes.length}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Tasks</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--ok)'}}>{relTasks.filter(t=>t.done).length}/{relTasks.length}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Payments</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--ok)'}}>{relPayments.length}</div>
                </div>
                <ClientWIPWidget clientId={c.id} clientName={c.name} />
              </div>
            </div>
          )}

          {/* SMS Tab */}
          {detailTab==='sms'&&(
            <div style={{padding:16}}>
              {c.phone && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                  {SMS_TEMPLATES.map(t=>(
                    <button key={t.label} className="btn sec" style={{fontSize:11,padding:'4px 10px'}}
                      onClick={()=>setSmsBody(applySmsTemplate(t,c.name))}>{t.label}</button>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:8,marginBottom:14}}>
                <textarea
                  value={smsBody} onChange={e=>setSmsBody(e.target.value)}
                  placeholder={c.phone ? `Text ${c.name}…` : 'No phone number on file for this client'}
                  disabled={!c.phone}
                  style={{flex:1,padding:'8px 10px',borderRadius:8,border:'1px solid var(--br)',resize:'vertical',minHeight:60,fontSize:13,fontFamily:'inherit',background:'var(--s2)',color:'var(--tx)'}}
                />
                <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end',justifyContent:'space-between'}}>
                  <span style={{fontSize:10,color:smsBody.length>160?'var(--warn)':'var(--t3)',whiteSpace:'nowrap'}}>{smsBody.length} chars</span>
                  <button className="btn pri" style={{padding:'8px 14px',fontSize:12,whiteSpace:'nowrap'}}
                    disabled={!smsBody.trim()||!c.phone||smsSending}
                    onClick={()=>sendClientSms(c)}>
                    {smsSending?'…':'Send'}
                  </button>
                </div>
              </div>
              {!c.phone && (
                <div style={{fontSize:12,color:'var(--warn)',marginBottom:12}}>Add a phone number to this client to send texts.</div>
              )}
              {relSms.length===0&&<div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No texts yet.</div>}
              {relSms.map(s=>(
                <div key={s.id} style={{padding:'10px 0',borderBottom:'1px solid var(--br)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                    {s.direction==='inbound'
                      ? <span title="Received" style={{color:'var(--blue)',fontSize:11}}>📥 Received</span>
                      : <span title="Sent" style={{color:'var(--t3)',fontSize:11}}>📤 Sent</span>}
                    <span className={`bdg ${s.status==='Sent'?'bg':s.status==='Failed'?'br':'bn'}`} style={{fontSize:9}}>{s.status||'Sent'}</span>
                  </div>
                  <div style={{fontSize:13,lineHeight:1.6,color:'var(--tx)',whiteSpace:'pre-wrap'}}>{s.body}</div>
                  <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>{s.sent_by||'Staff'} · {s.created_at?new Date(s.created_at).toLocaleString():''}</div>
                </div>
              ))}
            </div>
          )}

          {/* Financial Profile Tab */}
          {detailTab==='finprofile'&&(
            <div style={{padding:16}}>
              <ErrorBoundary>
                <FinancialProfile clientName={c.name} client={c}/>
              </ErrorBoundary>
            </div>
          )}

          {/* Tax Organizer Tab */}
          {detailTab==='organizer'&&(
            <ErrorBoundary>
              <OrganizerView clientName={c.name}/>
            </ErrorBoundary>
          )}

          {/* Activity Report Tab */}
          {detailTab==='activity'&&(
            <ErrorBoundary>
              <ClientActivityReport entityId={c.id} entityName={c.name} entityType="client" />
            </ErrorBoundary>
          )}

          {/* Calls Tab */}
          {detailTab==='calls'&&(
            <div style={{padding:'0 4px'}}>
              <CallAISummaries clientId={c.id} tenantId={c.tenant_id} />
            </div>
          )}

          {/* Transactions Tab */}
          {detailTab==='transactions'&&(
            <div style={{padding:'0 4px'}}>
              <ClientTransactions clientId={c.id} clientName={c.name} tenantId={c.tenant_id} />
            </div>
          )}

          {/* Docs Tab */}
          {detailTab==='docs'&&(
            <div style={{padding:0}}>
              <ClientDocs clientId={c.id} clientName={c.name} supabase={supabase} showToast={showToast} onLogged={(text)=>logAction(c.name, text)}/>
            </div>
          )}

          {/* Notes Tab */}
          {detailTab==='notes'&&(
            <div style={{padding:16}}>
              {/* Add note */}
              <div style={{display:'flex',gap:8,marginBottom:14}}>
                <textarea
                  value={newNote} onChange={e=>setNewNote(e.target.value)}
                  placeholder="Add a note…"
                  style={{flex:1,padding:'8px 10px',borderRadius:8,border:'1px solid var(--br)',resize:'vertical',minHeight:60,fontSize:13,fontFamily:'inherit',background:'var(--s2)',color:'var(--tx)'}}
                />
                <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-start'}}>
                  {/* Fills the box for the rep to finish; never posts on its own. */}
                  <select value="" style={{fontSize:11,padding:'5px 8px',borderRadius:6,width:'100%'}}
                    onChange={e=>{
                      const t = NOTE_TEMPLATES.flatMap(g=>g.items).find(i=>i.label===e.target.value)
                      if (!t) return
                      setNewNote(prev => prev.trim() ? prev.trim()+'\n\n'+t.text : t.text)
                    }}>
                    <option value="">📝 Template…</option>
                    {NOTE_TEMPLATES.map(g=>(
                      <optgroup key={g.group} label={g.group}>
                        {g.items.map(i=><option key={i.label} value={i.label}>{i.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--t3)',cursor:'pointer',whiteSpace:'nowrap'}}>
                    <input type="checkbox" checked={noteVisibleToClient} onChange={e=>setNoteVisibleToClient(e.target.checked)}/>
                    Visible to client
                  </label>
                  <button className="btn pri" style={{padding:'8px 14px',fontSize:12}}
                    disabled={!newNote.trim()||addingNote}
                    onClick={async()=>{
                      setAddingNote(true)
                      const {error}=await insertClientNote({clientname:c.name,content:newNote.trim(),created_by:resolveActorName(user, employees),visible_to_client:noteVisibleToClient,created_at:new Date().toISOString()})
                      setAddingNote(false)
                      if(error){
                        console.error('client_notes insert error (full):', error)
                        showToast('Error: '+error.message+(error.hint?' | Hint: '+error.hint:'')+(error.details?' | Details: '+error.details:''))
                        return
                      }
                      setNewNote('');setNoteVisibleToClient(false)
                      const{data}=await supabase.from('client_notes').select('*').eq('clientname',c.name).order('created_at',{ascending:false})
                      if(data)setRelNotes(data)
                    }}>
                    {addingNote?'…':'+ Add'}
                  </button>
                </div>
              </div>
              {relNotes.length===0&&<div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No notes yet.</div>}
              {relNotes.length>0 && (() => {
                const typeConfig = {
                  'Email':  { icon: '📧', color: '#2563eb', bg: 'rgba(37,99,235,.12)' },
                  'SMS':    { icon: '💬', color: '#0891b2', bg: 'rgba(8,145,178,.12)' },
                  'Call':   { icon: '📞', color: '#16a34a', bg: 'rgba(22,163,74,.12)' },
                  'Fax':    { icon: '📠', color: '#7c3aed', bg: 'rgba(124,58,237,.12)' },
                  'System': { icon: '⚙️', color: '#6b7280', bg: 'rgba(107,114,128,.12)' },
                  'Note':   { icon: '📝', color: '#d97706', bg: 'rgba(217,119,6,.12)' },
                }
                const AVATAR_PALETTE = ['#e8590c','#2563eb','#16a34a','#9333ea','#d97706','#0891b2','#dc2626','#4f46e5']
                function avatarColor(name){
                  const s = name || '?'
                  let hash = 0
                  for (let i=0;i<s.length;i++) hash = s.charCodeAt(i) + ((hash<<5)-hash)
                  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
                }
                function initials(name){ return (name||'?').trim().split(/\s+/).filter(Boolean).map(p=>p[0]).join('').slice(0,2).toUpperCase() || '?' }

                // Group notes the same way Karbon's activity feed does: Today,
                // This Week, then by month for anything older — newest group first.
                const now = new Date()
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7)
                const todayNotes = [], weekNotes = [], monthMap = new Map()
                relNotes.forEach(n => {
                  const d = n.created_at ? new Date(n.created_at) : null
                  if (d && d >= startOfToday) todayNotes.push(n)
                  else if (d && d >= startOfWeek) weekNotes.push(n)
                  else {
                    const label = d ? d.toLocaleDateString('en-US', { month:'long', ...(d.getFullYear()!==now.getFullYear() ? {year:'numeric'} : {}) }) : 'Earlier'
                    if (!monthMap.has(label)) monthMap.set(label, [])
                    monthMap.get(label).push(n)
                  }
                })
                const sections = []
                if (todayNotes.length) sections.push({ label:'Today', notes:todayNotes })
                if (weekNotes.length) sections.push({ label:'This Week', notes:weekNotes })
                monthMap.forEach((notes,label) => sections.push({ label, notes }))

                return sections.map(sec => (
                  <div key={sec.label} style={{marginBottom:20}}>
                    <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:8}}>{sec.label}</div>
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      {sec.notes.map((n,i) => {
                        const tc = typeConfig[n.note_type] || typeConfig['Note']
                        // Exact name match first; fall back to first-name-only match for
                        // older notes saved before resolveActorName (e.g. "romy" instead
                        // of "Romy Cruz") so their avatar still resolves correctly.
                        // Strip org suffix e.g. "Romy Cruz (TaxRes CRM)" → "romy cruz"
                        const authorLower = (n.author||'').replace(/\s*\(.*?\)\s*$/,'').toLowerCase().trim()
                        const emp = employees.find(e => e.name && e.name.toLowerCase()===authorLower)
                          || employees.find(e => e.name && e.name.toLowerCase().split(' ')[0]===authorLower)
                          || employees.find(e => e.email && e.email.toLowerCase()===authorLower)
                          || employees.find(e => e.email && e.email.toLowerCase().split('@')[0]===authorLower)
                        return (
                          <div key={n.id||i} style={{display:'flex',gap:10,padding:'12px 14px',borderRadius:10,border:'1px solid var(--br)',background:'var(--s2)'}}>
                            <div style={{width:34,height:34,borderRadius:'50%',flexShrink:0,overflow:'hidden',background:avatarColor(n.author),display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:'#fff'}}>
                              {emp?.avatar_url
                                ? <img src={emp.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                                : initials(n.author)}
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
                                <span style={{fontWeight:700,fontSize:13,color:'var(--tx)'}}>{n.author||'Staff'}</span>
                                {n.note_type && (
                                  <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:99,background:tc.bg,color:tc.color}}>{tc.icon} {n.note_type}</span>
                                )}
                                <span style={{fontSize:11,color:'var(--t3)'}}>{n.created_at ? new Date(n.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : ''}</span>
                                {n.visible_to_client && <span style={{fontSize:10,fontWeight:700,color:'var(--ok)',background:'rgba(34,197,94,.12)',padding:'1px 7px',borderRadius:99}}>👁 Client can see this</span>}
                              </div>
                              <div style={{fontSize:13,lineHeight:1.6,color:'var(--tx)',whiteSpace:'pre-wrap'}}>{n.text}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}

          {/* Payments Tab */}
          {detailTab==='payments'&&(
            <div style={{padding:16}}>
              <SavedCardsPanel
                record={c} recordType="client" showToast={showToast}
                onChanged={async()=>{ const {data}=await supabase.from('clients').select('*').eq('id',c.id).single(); if (data) setDetail(data) }}
              />

              <div className="card" style={{marginTop:12,marginBottom:12}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:4}}>💸 Split Payment</div>
                    <div style={{fontSize:11,color:'var(--t3)'}}>Charge part on one saved card, the rest on another.</div>
                  </div>
                  <button className="btn pri" style={{padding:'4px 10px',fontSize:11}} onClick={()=>setSplitPaymentModal(true)}>Split Payment</button>
                </div>
              </div>

              <div className="card" style={{marginBottom:12}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                  <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)'}}>🔗 Send Payment Link</div>
                  <button className="btn pri" style={{padding:'4px 10px',fontSize:11}} onClick={()=>setPaymentLinkModal(true)}>Send Link</button>
                </div>
                <div style={{fontSize:11,color:'var(--t3)'}}>
                  {c.stripe_checkout_sent_at ? `Last link sent ${new Date(c.stripe_checkout_sent_at).toLocaleString()}` : 'No link sent yet — use this if they\'d rather enter their own card.'}
                </div>
              </div>

              {/* 2nd Trade Installment Builder */}
              <div className="card" style={{marginBottom:12,borderLeft:'3px solid #7c3aed'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'#7c3aed',marginBottom:4}}>📅 2nd Trade Installment Plan</div>
                    <div style={{fontSize:11,color:'var(--t3)'}}>Create a Stripe subscription with automatic monthly billing + AR schedule.</div>
                  </div>
                  <button className="btn sec" style={{padding:'4px 10px',fontSize:11,borderColor:'#7c3aed',color:'#7c3aed'}} onClick={()=>{setInstallmentModal(true);setInstallmentDone(null)}}>Set Up Plan</button>
                </div>
              </div>

              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>
                  💳 Payments & AR ({relPayments.length})
                </div>
                <button className="btn pri" style={{fontSize:11,padding:'5px 12px'}} onClick={()=>setPayModal(true)}>+ Add Payment</button>
              </div>
              {loadingRel&&<div style={{color:'var(--t3)',fontSize:12}}>Loading…</div>}
              {!loadingRel&&relPayments.length===0&&(
                <div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No payments recorded yet.</div>
              )}
              {relPayments.map(p=>{
                const today = new Date(); today.setHours(0,0,0,0)
                const arStatus = p.payment_status || (p.status === 'Cleared' ? 'Paid' : null)
                const isScheduled = arStatus === 'Scheduled'
                const isOverdue = isScheduled && p.scheduled_date && new Date(p.scheduled_date) < today
                return (
                  <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--br)'}}>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:14,fontWeight:700,color:isScheduled?'var(--t3)':'var(--ok)'}}>
                          {isScheduled?'⏳':'+'} ${Number(p.amount||0).toLocaleString()}
                        </span>
                        {p.trade_type&&<span style={{fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:99,background:p.trade_type==='1st Trade'?'rgba(37,99,235,.12)':'rgba(124,58,237,.12)',color:p.trade_type==='1st Trade'?'var(--blue)':'#7c3aed'}}>{p.trade_type}</span>}
                        {isOverdue&&<span style={{fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:99,background:'rgba(239,68,68,.12)',color:'var(--bad)'}}>⚠ Overdue</span>}
                      </div>
                      <div style={{fontSize:11,color:'var(--t3)'}}>{p.method||'Payment'} · {p.scheduled_date||p.date||''}</div>
                      {p.notes&&<div style={{fontSize:11,color:'var(--t2)',marginTop:2}}>{p.notes}</div>}
                    </div>
                    {isScheduled&&(
                      <button className="btn sec" style={{fontSize:10,padding:'3px 8px'}}
                        onClick={async()=>{ await supabase.from('payments').update({payment_status:'Paid',status:'Cleared',date:new Date().toISOString().slice(0,10)}).eq('id',p.id); const{data}=await supabase.from('payments').select('*').eq('clientName',c.name).order('created_at',{ascending:false}); if(data)setRelPayments(data) }}>
                        Mark Paid
                      </button>
                    )}
                  </div>
                )
              })}
              {relPayments.length>0&&(
                <div style={{marginTop:12,paddingTop:12,borderTop:'2px solid var(--br)',display:'flex',justifyContent:'space-between'}}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--t3)'}}>Total Collected</div>
                  <div style={{fontSize:16,fontWeight:800,color:'var(--ok)'}}>
                    ${relPayments.filter(p=>p.payment_status==='Paid'||p.status==='Cleared').reduce((s,p)=>s+Number(p.amount||0),0).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tasks Tab */}
          {detailTab==='tasks'&&(
            <div style={{padding:16}}>
              {/* Inner sub-tabs — same pattern as Financial Profile */}
              <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:'1px solid var(--br)',flexWrap:'wrap'}}>
                {[
                  {key:'tasks', label:'✅ Tasks'},
                  {key:'time',  label:'⏱️ Time & Billing'},
                ].map(t=>(
                  <button key={t.key} onClick={()=>setTaskSubTab(t.key)} style={{
                    padding:'8px 16px', borderRadius:'8px 8px 0 0',
                    border:'1px solid var(--br)', borderBottom: taskSubTab===t.key ? '1px solid var(--sf)' : '1px solid var(--br)',
                    background: taskSubTab===t.key ? 'var(--sf)' : 'var(--s2)',
                    color: taskSubTab===t.key ? 'var(--tx)' : 'var(--t3)',
                    fontWeight: taskSubTab===t.key ? 700 : 400,
                    cursor:'pointer', fontSize:13, marginBottom:-1
                  }}>{t.label}</button>
                ))}
              </div>

              {/* Tasks sub-tab */}
              {taskSubTab==='tasks'&&(
              <>
                <div style={{fontSize:12,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>
                  ✅ Tasks ({relTasks.length})
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <select value={clientTaskFilter} onChange={e=>setClientTaskFilter(e.target.value)}
                    style={{fontSize:11,padding:'5px 8px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)'}}>
                    <option value="all" style={{color:'#000',background:'#fff'}}>Show: All</option>
                    <option value="active" style={{color:'#000',background:'#fff'}}>Show: Active</option>
                    <option value="completed" style={{color:'#000',background:'#fff'}}>Show: Completed</option>
                  </select>
                  <button className="btn sec" style={{fontSize:11,padding:'5px 12px'}} onClick={openTemplatePicker}>📋 Apply Work Template</button>
                </div>
              {loadingRel&&<div style={{color:'var(--t3)',fontSize:12}}>Loading…</div>}
              {!loadingRel&&relTasks.length===0&&(
                <div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No tasks yet for this client.</div>
              )}
              {(() => {
                // Group tasks sharing a section_title under one heading
                // (same pattern as the main Tasks page). Tasks with no
                // section render individually exactly as before.
                const groups = []
                const byKey = new Map()
                relTasks.forEach(t => {
                  const key = t.section_title || `t-${t.id}`
                  if (!byKey.has(key)) {
                    const g = { key, section_title: t.section_title || null, tasks: [] }
                    byKey.set(key, g); groups.push(g)
                  }
                  byKey.get(key).tasks.push(t)
                })
                const TASK_AVATAR_PALETTE = ['#e8590c','#2563eb','#16a34a','#9333ea','#d97706','#0891b2','#dc2626','#4f46e5']
                function taskAvatarColor(name){
                  const s = name || '?'
                  let hash = 0
                  for (let i=0;i<s.length;i++) hash = s.charCodeAt(i) + ((hash<<5)-hash)
                  return TASK_AVATAR_PALETTE[Math.abs(hash) % TASK_AVATAR_PALETTE.length]
                }
                function taskInitials(name){ return (name||'?').trim().split(/\s+/).filter(Boolean).map(p=>p[0]).join('').slice(0,2).toUpperCase() || '?' }
                const renderTask = t => {
                  const emp = employees.find(e => e.name && t.assignedTo && e.name.toLowerCase()===t.assignedTo.toLowerCase())
                  const overdue = t.dueDate && new Date(t.dueDate)<new Date() && !t.done
                  return (
                  <div key={t.id} style={{display:'flex',gap:10,alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--br)'}}>
                    <div
                      onClick={()=>toggleTask(t)}
                      style={{width:18,height:18,borderRadius:4,border:'1.5px solid var(--b2c)',background:t.done?'var(--ok)':'var(--s2)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,color:'#fff',fontSize:11}}
                    >{t.done?'✓':''}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:t.done?400:600,textDecoration:t.done?'line-through':'none',color:t.done?'var(--t3)':'var(--tx)'}}>{t.title}</div>
                      {t.priority&&<div style={{marginTop:2}}><span className={`bdg ${t.priority==='High'?'br':t.priority==='Low'?'bn':'ba'}`} style={{fontSize:9}}>{t.priority}</span></div>}
                    </div>
                    <div style={{width:110,flexShrink:0,position:'relative'}}>
                      <select
                        value={t.status_category && t.status_label ? `${t.status_category}|||${t.status_label}` : ''}
                        onChange={e=>updateTaskStatus(t, e.target.value)}
                        style={{
                          width:'100%',fontSize:9,fontWeight:700,padding:'3px 16px 3px 6px',borderRadius:20,textAlign:'center',
                          border:'1px solid rgba(148,163,184,.35)',cursor:'pointer',appearance:'none',WebkitAppearance:'none',
                          background:t.done?'rgba(22,163,74,.15)':'rgba(148,163,184,.15)',
                          color:t.done?'var(--ok)':'var(--tx)'
                        }}
                      >
                        <option value="" style={{color:'#000',background:'#fff'}}>{t.done?'Completed':'Ready to Start'}</option>
                        {statusCategories.map(cat => (
                          <optgroup key={cat.id} label={cat.name} style={{color:'#000',background:'#fff'}}>
                            <option value={`${cat.name}|||${cat.name}`} style={{color:'#000',background:'#fff',fontWeight:700}}>{cat.name} (general)</option>
                            {cat.statuses.map(s => <option key={s.id} value={`${cat.name}|||${s.label}`} style={{color:'#000',background:'#fff'}}>{s.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      <span style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',fontSize:8,color:t.done?'var(--ok)':'var(--tx)',pointerEvents:'none'}}>▾</span>
                    </div>
                    <span style={{fontSize:10,color:overdue?'var(--bad)':'var(--t3)',flexShrink:0,width:72,textAlign:'center'}}>{t.dueDate || '—'}</span>
                    {t.assignedTo && (
                      <div style={{width:22,height:22,borderRadius:'50%',flexShrink:0,overflow:'hidden',background:taskAvatarColor(t.assignedTo),display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:'#fff'}} title={t.assignedTo}>
                        {emp?.avatar_url ? <img src={emp.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : taskInitials(t.assignedTo)}
                      </div>
                    )}
                    <button className="btn sec" style={{fontSize:10,padding:'3px 8px',flexShrink:0}} onClick={()=>addSubtask(t)}>+ Sub</button>
                  </div>
                )}
                return groups.map(g => {
                  const allDone = g.tasks.length > 0 && g.tasks.every(t => t.done)
                  const visibleTasks = g.tasks.filter(t =>
                    clientTaskFilter === 'all' || (clientTaskFilter === 'active' ? !t.done : t.done)
                  )
                  if (g.section_title) {
                    const isExpanded = clientSectionOverride[g.key] !== undefined ? clientSectionOverride[g.key] : !allDone
                    return (
                      <div key={g.key} style={{marginBottom:10,borderRadius:8,overflow:'hidden',border:'1px solid var(--br)'}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:'var(--s2)'}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',flex:1}}
                            onClick={()=>setClientSectionOverride(prev=>({...prev,[g.key]:!isExpanded}))}>
                            <span style={{fontSize:10,color:'var(--t3)',transform:isExpanded?'rotate(90deg)':'none',transition:'transform .15s',display:'inline-block'}}>▶</span>
                            <div style={{fontSize:12,fontWeight:700,color:'var(--tx)'}}>
                              📋 {g.section_title} {allDone && <span style={{color:'var(--ok)',fontWeight:600}}>· All done ✓</span>}
                            </div>
                          </div>
                          <button className="btn pri" style={{fontSize:10,padding:'3px 10px',fontWeight:600}} onClick={()=>setPendingSection(g.section_title)}>+ Add Task</button>
                        </div>
                        {isExpanded && (
                          <div style={{padding:'2px 12px 2px'}}>
                            {visibleTasks.length === 0
                              ? <div style={{color:'var(--t3)',fontSize:12,padding:'10px 0',textAlign:'center'}}>No tasks match this filter.</div>
                              : visibleTasks.map(renderTask)}
                          </div>
                        )}
                      </div>
                    )
                  }
                  return visibleTasks.map(renderTask)
                })
              })()}
              {/* Quick add task */}
              {pendingSection && (
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:11,color:'var(--t3)',marginTop:10}}>
                  <span>Adding to section: <strong style={{color:'var(--tx)'}}>{pendingSection}</strong></span>
                  <button onClick={()=>setPendingSection('')} style={{background:'none',border:'none',color:'var(--bad)',cursor:'pointer',fontSize:11}}>Cancel</button>
                </div>
              )}
              <div style={{display:'flex',gap:6,marginTop:pendingSection?4:10}}>
                <select value="" onChange={e=>{if(e.target.value)setQuickTask(e.target.value)}}
                  style={{flex:1,padding:'5px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--t2)',fontSize:12}}>
                  <option value="">⚡ Quick-pick a common task…</option>
                  {QUICK_TASK_TITLES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{display:'flex',gap:6,marginTop:4}}>
                <input
                  value={quickTask}
                  onChange={e=>setQuickTask(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&addQuickTask()}
                  placeholder={pendingSection ? 'Add a sub-task…' : 'Add a task…'}
                  style={{flex:1,padding:'5px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}
                />
                <button className="btn pri" style={{fontSize:11,padding:'5px 12px'}} onClick={addQuickTask} disabled={addingTask}>
                  {addingTask?'…':'+ Add'}
                </button>
              </div>


              </>)}

              {/* Time & Billing sub-tab */}
              {taskSubTab==='time'&&(
                <ErrorBoundary>
                  <TimeEntry clientId={c.id} clientName={c.name} embed />
                </ErrorBoundary>
              )}
            </div>
          )}

          {/* Cases Tab */}
          {detailTab==='cases'&&(
            <div style={{padding:16}}>
              <div style={{fontSize:12,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:12}}>
                📁 Cases ({relCases.length})
              </div>
              {loadingRel&&<div style={{color:'var(--t3)',fontSize:12}}>Loading…</div>}
              {!loadingRel&&relCases.length===0&&(
                <div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No cases linked to this client.</div>
              )}
              {relCases.map(cas=>(
                <div key={cas.id} onClick={()=>navigate('/cases/'+cas.id)}
                  style={{borderBottom:'1px solid var(--br)',padding:'10px 0',cursor:'pointer',transition:'background .12s'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13}}>{cas.caseType||'Case'}</div>
                      <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>
                        {cas.irsBalance&&<span>Balance: {formatBalance(cas.irsBalance)} · </span>}
                        {cas.assignedTo&&<span>Rep: {cas.assignedTo}</span>}
                      </div>
                    </div>
                    <span className={`bdg ${cas.status==='Open'?'bb':cas.status==='Closed'?'bg':'bn'}`}>{cas.status||'Open'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Invoices Tab */}
          {detailTab==='invoices'&&(
            <div style={{padding:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>
                  🧾 Invoices ({relInvoices.length})
                </div>
                <button className="btn pri" style={{fontSize:11,padding:'5px 12px'}} onClick={()=>navigate('/invoices')}>+ New Invoice</button>
              </div>
              {loadingRel&&<div style={{color:'var(--t3)',fontSize:12}}>Loading…</div>}
              {!loadingRel&&relInvoices.length===0&&(
                <div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No invoices for this client.</div>
              )}
              {relInvoices.map(inv=>(
                <div key={inv.id} style={{borderBottom:'1px solid var(--br)',padding:'10px 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:13}}>{inv.caseNum?`#${inv.caseNum} · `:''}{inv.lineItems||'Invoice'}</div>
                    <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>
                      {inv.dueDate&&<span>Due: {inv.dueDate}</span>}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontSize:13}}>{inv.total?'$'+Number(inv.total).toLocaleString():'—'}</div>
                    <span className={`bdg ${inv.status==='Paid'?'bg':inv.status==='Overdue'?'br':'bn'}`}>{inv.status||'Unpaid'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {detailTab==='overview' && (
        <div className="detail-2col" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignItems:'start'}}>
          {/* LEFT COLUMN */}
          <div style={{display:'flex',flexDirection:'column',gap:12}}>

            {/* Contact Info */}
            <div className="card">
              <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>Contact Info</div>
              <DR label="Phone"   val={c.phone} name={c.name} entityId={c.id} showToast={showToast} onLogged={()=>{ loadRelated(c.name) }}/>
              <DR label="Phone 2" val={c.phone2} name={c.name} entityId={c.id} showToast={showToast} onLogged={()=>{ loadRelated(c.name) }}/>
              <DR label="Email"   val={c.email ? <span style={{color:'var(--blue)',cursor:'pointer',textDecoration:'underline'}} title="Send email" onClick={()=>setQuickEmail({ name:c.name, email:c.email })}>{c.email} ✉️</span> : null}/>
              <DR label={c.business_name ? "Personal Address" : "Address"} val={[c.street,c.city,c.state,c.zip].filter(Boolean).join(', ')}/>
              <DR label="Business Address" val={[c.biz_street,c.biz_city,c.biz_state,c.biz_zip].filter(Boolean).join(', ')}/>
              {c.contactPerson  && <DR label="Contact Person" val={c.contactPerson}/>}
              {c.businessType   && <DR label="Business Type"  val={c.businessType}/>}
              {c.industry       && <DR label="Industry"       val={c.industry}/>}
              <DR label="County"  val={c.county}/>
              {c.occupation && <DR label="Occupation" val={c.occupation}/>}
              {c.employer   && <DR label="Employer"   val={c.employer}/>}
              {c.leadSource && <DR label="Lead Source" val={c.leadSource}/>}
              {c.referredBy && <DR label="Referred By" val={c.referredBy}/>}
              {c.tags && (
                <div style={{padding:'8px 0',borderBottom:'1px solid var(--br)',display:'flex',alignItems:'flex-start',gap:10}}>
                  <div style={{fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'.04em',color:'var(--t3)',minWidth:130,paddingTop:2}}>Tags</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                    {c.tags.split(',').map(t=>t.trim()).filter(Boolean).map(t=>(
                      <span key={t} style={{background:'var(--blue)22',color:'var(--blue)',border:'1px solid var(--blue)44',borderRadius:4,padding:'1px 7px',fontSize:11,fontWeight:600}}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Taxpayer Info (+ Dependents, merged into one card) */}
            <div className="card">
              <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>🔒 Taxpayer Info</div>
              <DR label="SSN"           val={c.ssn?'***-**-'+c.ssn.replace(/-/g,'').slice(-4):null}/>
              <DR label="EIN"           val={c.ein}/>
              <DR label="Date of Birth" val={c.dob}/>
              <DR label="Filing Status" val={c.filingStatus}/>
              <DR label="Spouse Name"   val={c.spouseName}/>
              <DR label="Spouse DOB"    val={c.spouseDob}/>
              <DR label="Spouse SSN"    val={c.spouseSsn?'***-**-'+c.spouseSsn.replace(/-/g,'').slice(-4):null}/>

              {deps.length>0&&(
                <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid var(--br)'}}>
                  <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>👨‍👩‍👧 Dependents ({deps.length})</div>
                  {deps.map((d,i)=>(
                    <div key={i} style={{borderBottom:'1px solid var(--br)',padding:'8px 0',display:'flex',gap:10}}>
                      <div style={{width:26,height:26,borderRadius:'50%',background:'var(--s3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'var(--t2)',flexShrink:0}}>{i+1}</div>
                      <div>
                        <div style={{fontWeight:600,fontSize:13}}>{d.name||'Unnamed'}</div>
                        <div style={{fontSize:11,color:'var(--t3)',marginTop:2,display:'flex',gap:10,flexWrap:'wrap'}}>
                          <span>{d.relationship||'—'}</span>
                          {d.dob&&<span>DOB: {d.dob}</span>}
                          {d.ssn&&<span>SSN: ***-**-{d.ssn.replace(/-/g,'').slice(-4)}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>


          </div>

          {/* RIGHT COLUMN */}
          <div style={{display:'flex',flexDirection:'column',gap:12}}>

            {/* IRS / Case Info */}
            <div className="card">
              <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>IRS / Case Info</div>
              {c.clientOwes && <DR label="Canopy Balance" val={c.clientOwes}/>}
              <DR label="IRS Balance"  val={formatBalance(c.irsBalance)}/>
              {(c.irsOrState||'IRS Federal')!=='IRS Federal' && (
                <DR label="State Balance" val={formatBalance(c.stateBalance)}/>
              )}
              <DR label="Issue Type"   val={c.issueType}/>
              <DR label="IRS or State" val={c.irsOrState}/>
              <DR label="Tax Years"    val={c.taxYears}/>
              <DR label="Filing Reqs"  val={parseDependents(c.filingRequirements).join(', ')}/>
              {(c.irsOrState||'IRS Federal')!=='State' && (
                <>
                  <DR label="IRS Status"   val={c.irsStatus==='Other'?c.irsStatusOther:c.irsStatus}/>
                  <DR label="IRS Deadline" val={c.irsDeadline}/>
                </>
              )}
              {(c.irsOrState||'IRS Federal')!=='IRS Federal' && (
                <>
                  <DR label="State Status"   val={c.stateStatus==='Other'?c.stateStatusOther:c.stateStatus}/>
                  <DR label="State Deadline" val={c.stateDeadline}/>
                </>
              )}
              <DR label={label("assignedTo","Tax Advisor")} val={c.assignedTo}/>
              <DR label={label("taxAssociate","Tax Associate")} val={c.taxAssociate}/>
              <DR label="Client Since" val={c.clientSince}/>
            </div>

            {/* Deadlines */}
            <div className="card">
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)'}}>⏰ Deadlines ({relDeadlines.length})</div>
                <span onClick={()=>navigate('/deadlines')} style={{fontSize:11,color:'var(--blue)',cursor:'pointer',fontWeight:600}}>Manage all →</span>
              </div>
              {relDeadlines.length===0
                ? <div style={{color:'var(--t3)',fontSize:12,textAlign:'center',padding:'8px 0'}}>No deadlines for this client.</div>
                : relDeadlines.map(d=>{
                  const due = d.dueDate||d.due_date
                  const dy = due ? Math.ceil((new Date(due)-new Date())/86400000) : 999
                  const status = d.status||'Tracking'
                  const dColor = dy<0?'var(--bad)':dy<=3?'var(--bad)':dy<=7?'var(--warn)':'var(--t2)'
                  const dBdg   = dy<0?'br':dy<=3?'br':dy<=7?'ba':'bg'
                  const dText  = status==='Completed'?'Done':dy<0?'OVERDUE':dy===0?'TODAY':dy+'d left'
                  return (
                    <div key={d.id} style={{borderBottom:'1px solid var(--br)',padding:'8px 0'}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:13,color:status==='Completed'?'var(--t2)':'var(--tx)'}}>{d.name||d.title||'—'}</div>
                          <div style={{fontSize:11,color:'var(--t3)',marginTop:2,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                            <span className="bdg bb" style={{fontSize:10}}>{d.type}</span>
                            <span style={{color:dColor}}>{due||'—'}</span>
                            <span className={`bdg ${status==='Completed'?'bg':dBdg}`}>{dText}</span>
                          </div>
                        </div>
                        <select
                          value={status}
                          onChange={async e=>{
                            await supabase.from('deadlines').update({status:e.target.value}).eq('id',d.id)
                            loadRelated(c.name)
                          }}
                          style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:5,color:'var(--tx)',fontSize:11,padding:'3px 6px',cursor:'pointer',flexShrink:0}}
                        >
                          {['Tracking','Action Required','Scheduled','Completed'].map(s=><option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  )
                })
              }
            </div>

            {/* Payment & Autopay */}
            <div className="card">
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)'}}>💳 Payment & Autopay</div>
                <button className="btn" style={{padding:'4px 10px',fontSize:11}} onClick={()=>setStripeModal(true)}>{c.default_payment_method_id?'Update':'+ Add'} Payment Method</button>
              </div>
              <DR label="Payment Method" val={c.default_payment_method_id ? `${c.payment_method_brand||''} •••• ${c.payment_method_last4||''}` : 'None on file'}/>
              <DR label="Autopay" val={c.autopay_enabled ? `✅ ${c.autopay_frequency||'monthly'} — $${c.autopay_amount||0}` : 'Off'}/>
              {c.autopay_enabled && <DR label="Next Charge" val={c.autopay_next_charge}/>}
              {c.autopay_last_result && <DR label="Last Charge" val={c.autopay_last_result==='succeeded' ? `✅ Succeeded ${c.autopay_last_charged_at?new Date(c.autopay_last_charged_at).toLocaleDateString():''}` : `❌ Failed ${c.autopay_last_charged_at?new Date(c.autopay_last_charged_at).toLocaleDateString():''}`}/>}
            </div>

            {/* CSED Summary */}
            <CsedSummaryCard clientName={c.name}/>

          </div>
        </div>
        )}

        {editModal&&<ClientFormModal form={form} fld={fld} reps={reps} saving={saving} onSave={saveEdit} onClose={()=>setEditModal(false)} title="Edit Client"/>}

        {fillerClient && (
          <ErrorBoundary onClose={()=>setFillerClient(null)}>
            <IRSFormFiller client={fillerClient} onClose={()=>setFillerClient(null)}/>
          </ErrorBoundary>
        )}

        {bookingClient && (
          <BookingWidget mode="client" contact={{id:bookingClient.id, name:bookingClient.name, email:bookingClient.email, phone:bookingClient.phone}} onClose={()=>setBookingClient(null)}/>
        )}
        {quickEmail && <QuickEmail contact={{ name: quickEmail.name, email: quickEmail.email }} kind="client" onSent={() => loadRelated(quickEmail.name)} onClose={() => setQuickEmail(null)} />}

        {/* ── Add Task Modal ── */}
        {taskModal&&(
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setTaskModal(false)}>
            <div className="modal" style={{width:440}}>
              <div className="mh">
                <span className="mt">✅ Add Task — {detail?.name}</span>
                <button className="xbtn" onClick={()=>setTaskModal(false)}>&times;</button>
              </div>
              <div className="field"><label>Task Title *</label>
                <input value={taskTitle} onChange={e=>setTaskTitle(e.target.value)}
                  placeholder="e.g. Request transcripts, Follow up on offer..."
                  onKeyDown={e=>e.key==='Enter'&&addTaskFromModal()}
                  autoFocus/>
                <select value="" onChange={e=>{if(e.target.value)setTaskTitle(e.target.value)}}
                  style={{marginTop:6,fontSize:12,color:'var(--t2)'}}>
                  <option value="">⚡ Quick-pick a common task…</option>
                  {QUICK_TASK_TITLES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
                <div style={{marginTop:8,fontSize:11.5,color:'var(--t3)'}}>
                  Need a full set of tasks?{' '}
                  <span style={{color:'var(--blue)',cursor:'pointer',textDecoration:'underline'}}
                    onClick={()=>{setTaskModal(false);setTemplateModal(true)}}>Apply a workflow template →</span>
                </div>
              </div>
              <div className="field"><label>Section</label>
                <input value={taskSectionTitle} onChange={e=>setTaskSectionTitle(e.target.value)}
                  placeholder="Optional — groups with other sub-tasks"/>
              </div>
              <div className="fg2">
                <div className="field"><label>Priority</label>
                  <select value={taskPriority} onChange={e=>setTaskPriority(e.target.value)}>
                    <option>Low</option><option>Normal</option><option>High</option><option>Urgent</option>
                  </select>
                </div>
                <div className="field"><label>Due Date</label>
                  <input type="date" value={taskDueDate} onChange={e=>setTaskDueDate(e.target.value)}/>
                </div>
              </div>
              <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={addTaskFromModal} disabled={addingTask}>
                {addingTask?'Adding…':'✅ Add Task'}
              </button>
            </div>
          </div>
        )}

        {/* ── Apply Work Template Modal ── */}
        {templateModal&&(
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setTemplateModal(false)}>
            <div className="modal" style={{width:480,maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
              <div className="mh">
                <span className="mt">📋 Apply Work Template — {detail?.name}</span>
                <button className="xbtn" onClick={()=>setTemplateModal(false)}>&times;</button>
              </div>
              <div style={{padding:'0 4px 12px'}}>
                <input
                  value={templateSearch}
                  onChange={e=>setTemplateSearch(e.target.value)}
                  placeholder="Search templates..."
                  style={{width:'100%',boxSizing:'border-box',padding:'9px 13px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,color:'var(--tx)',fontSize:13}}
                />
              </div>
              <div style={{overflowY:'auto',flex:1}}>
                {availableTemplates.length===0 && (
                  <div style={{color:'var(--t3)',fontSize:12,textAlign:'center',padding:'20px 0'}}>No active workflow templates for clients yet. Build one in Workflows first.</div>
                )}
                {availableTemplates
                  .filter(t => !templateSearch.trim() || t.name.toLowerCase().includes(templateSearch.toLowerCase()))
                  .map(t => (
                    <div key={t.id} onClick={()=>!applyingTemplateId && toggleTemplateSelection(t.id)}
                      style={{padding:'12px 10px',borderBottom:'1px solid var(--br)',cursor:applyingTemplateId?'default':'pointer',opacity:applyingTemplateId?0.5:1,display:'flex',gap:10,alignItems:'flex-start'}}>
                      <input type="checkbox" checked={selectedTemplateIds.includes(t.id)} readOnly style={{marginTop:3}}/>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:'var(--tx)'}}>{t.name}</div>
                        {t.description&&<div style={{fontSize:11,color:'var(--t3)',marginTop:3,lineHeight:1.5}}>{t.description}</div>}
                      </div>
                    </div>
                  ))
                }
              </div>
              <div style={{padding:'12px 4px 4px',borderTop:'1px solid var(--br)'}}>
                <button className="btn pri" style={{width:'100%'}} disabled={!selectedTemplateIds.length||!!applyingTemplateId} onClick={applySelectedTemplates}>
                  {applyingTemplateId ? 'Applying…' : selectedTemplateIds.length ? `Apply Selected (${selectedTemplateIds.length})` : 'Select a template to apply'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Add Payment Modal ── */}
        {payModal&&(
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setPayModal(false)}>
            <div className="modal" style={{width:440}}>
              <div className="mh">
                <span className="mt">💳 Record Payment — {detail?.name}</span>
                <button className="xbtn" onClick={()=>setPayModal(false)}>&times;</button>
              </div>
              <div className="field">
                <label>Amount *</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--t3)'}}>$</span>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(payForm.amount)} onChange={e=>setPayForm(f=>({...f,amount:parseMoney(e.target.value)}))} style={{paddingLeft:22}} placeholder="0.00" autoFocus/>
                </div>
              </div>
              <div className="fg2">
                <div className="field"><label>Method</label>
                  <select value={payForm.method} onChange={e=>setPayForm(f=>({...f,method:e.target.value}))}>
                    {['Credit Card','ACH / Bank Transfer','Check','Cash','Zelle','Venmo','Wire Transfer','Other'].map(m=><option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="field"><label>Date</label>
                  <input type="date" value={payForm.date} onChange={e=>setPayForm(f=>({...f,date:e.target.value}))}/>
                </div>
              </div>
              <div className="field"><label>Notes (optional)</label>
                <input value={payForm.notes||''} onChange={e=>setPayForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. Partial payment, invoice INV-XXXXX"/>
              </div>
              <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={addPaymentForClient} disabled={savingPay}>
                {savingPay?'Saving…':'💳 Record Payment'}
              </button>
            </div>
          </div>
        )}

        {addModal&&(
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setAddModal(false)}>
            <div className="modal" style={{width:620,maxHeight:'90vh',overflowY:'auto'}}>
              <div className="mh">
                <span className="mt">📋 Addendum & 2nd Trade — {c.name}</span>
                <button className="xbtn" onClick={()=>setAddModal(false)}>&times;</button>
              </div>

              {/* ── Addendum Section ── */}
              <div style={{fontSize:11,fontWeight:700,color:'var(--blue)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>📋 Service Addendum</div>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:14}}>
                Fill in the resolution fee and scope details, check off the services that apply, then print or send for e-signature.
              </div>
              <div className="fg2">
                <div className="field"><label>Resolution Service Fee ($) *</label>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(addForm.resolutionFee)} onChange={e=>setAddForm(f=>({...f,resolutionFee:parseMoney(e.target.value)}))} placeholder="e.g. 3500"/>
                </div>
                <div className="field"><label>Monthly Payment Plan ($)</label>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(addForm.paymentPlan)} onChange={e=>setAddForm(f=>({...f,paymentPlan:parseMoney(e.target.value)}))} placeholder="e.g. 350"/>
                </div>
              </div>
              <div className="field"><label>Payments Start Date</label>
                <input type="date" value={addForm.startDate} onChange={e=>setAddForm(f=>({...f,startDate:e.target.value}))}/>
              </div>
              <div className="field"><label>Resolution Services Authorized — based on investigation results</label>
                <div style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,padding:'8px 12px',maxHeight:180,overflowY:'auto'}}>
                  {RESOLUTION_SERVICES.map(s=>(
                    <label key={s.key} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',fontSize:12.5,cursor:'pointer'}}>
                      <input type="checkbox" style={{width:'auto'}}
                        checked={addForm.services.includes(s.key)}
                        onChange={()=>setAddForm(f=>({...f,services:f.services.includes(s.key)?f.services.filter(k=>k!==s.key):[...f.services,s.key]}))}/>
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field"><label>Additional Scope / Work Notes</label>
                <textarea value={addForm.notes} onChange={e=>setAddForm(f=>({...f,notes:e.target.value}))} style={{minHeight:60}} placeholder="e.g. Includes filing 3 years of unfiled returns..."/>
              </div>
              <div className="field"><label>Send Via</label>
                <select value={addForm.sendVia} onChange={e=>setAddForm(f=>({...f,sendVia:e.target.value}))}>
                  <option value="email">Email</option>
                  <option value="sms">Text Message</option>
                  <option value="both">Email + Text</option>
                </select>
              </div>
              <div style={{display:'flex',gap:8,marginBottom:20}}>
                <button className="btn sec" style={{flex:1,justifyContent:'center',padding:11}} onClick={()=>{
                  if(!addForm.resolutionFee){showToast('Enter the resolution fee first');return}
                  generateAddendum(c, addForm)
                }}>🖨️ Print</button>
                <button className="btn pri" style={{flex:2,justifyContent:'center',padding:11}} disabled={addendumSending} onClick={sendAddendum}>
                  {addendumSending ? 'Sending…' : '✍️ Send for E-Signature'}
                </button>
              </div>

              {/* ── Divider ── */}
              <div style={{borderTop:'1px solid var(--br)',paddingTop:18,marginTop:4}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--ok)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>💳 Charge 2nd Trade</div>
                <div style={{fontSize:12,color:'var(--t3)',marginBottom:12,lineHeight:1.6}}>
                  Charge the resolution fee directly to the card on file. Commission goes to whoever sent the addendum.
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 14px',border:'1px solid var(--br)',marginBottom:12,fontSize:13}}>
                  <div style={{fontWeight:700}}>{c.name}</div>
                  {c.email&&<div style={{fontSize:12,color:'var(--t3)',marginTop:2}}>{c.email}</div>}
                  {addForm.resolutionFee&&<div style={{fontSize:12,color:'var(--ok)',marginTop:4,fontWeight:600}}>Fee entered: ${Number(addForm.resolutionFee).toLocaleString()}</div>}
                </div>
                <button className="btn pri" style={{width:'100%',padding:11,fontWeight:700,justifyContent:'center'}}
                  onClick={()=>{setAddModal(false);setShowChargeModal(true)}}>
                  💳 Open Stripe Charge Form →
                </button>
              </div>
            </div>
          </div>
        )}

        {rewriteModal&&(
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setRewriteModal(false)}>
            <div className="modal" style={{width:580,maxHeight:'88vh',overflowY:'auto'}}>
              <div className="mh">
                <span className="mt">🔄 Rewrite — Default → New Plan</span>
                <button className="xbtn" onClick={()=>setRewriteModal(false)}>&times;</button>
              </div>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:16,lineHeight:1.6}}>
                Replace the defaulted terms with a new service/payment plan for <strong>{c.name}</strong>. The new plan is saved to the client file and sent as a fresh token-secured agreement.
              </div>
              <div className="fg2">
                <div className="field"><label>New Resolution Fee ($) *</label>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(rewriteForm.resolutionFee)}
                    onChange={e=>setRewriteForm(f=>({...f,resolutionFee:parseMoney(e.target.value)}))}/>
                </div>
                <div className="field"><label>New Monthly Payment ($)</label>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(rewriteForm.paymentPlan)}
                    onChange={e=>setRewriteForm(f=>({...f,paymentPlan:parseMoney(e.target.value)}))}/>
                </div>
              </div>
              <div className="field"><label>New Plan Start Date</label>
                <input type="date" value={rewriteForm.startDate} onChange={e=>setRewriteForm(f=>({...f,startDate:e.target.value}))}/>
              </div>
              <div className="field"><label>Services on New Plan</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:7,marginTop:6}}>
                  {RESOLUTION_SERVICES.map(svc=>{
                    const on=(rewriteForm.services||[]).includes(svc)
                    return <label key={svc} style={{display:'flex',gap:7,alignItems:'center',fontSize:12,cursor:'pointer'}}>
                      <input type="checkbox" checked={on} onChange={()=>setRewriteForm(f=>({...f,services:on?f.services.filter(x=>x!==svc):[...f.services,svc]}))}/>
                      <span>{svc}</span>
                    </label>
                  })}
                </div>
              </div>
              <div className="field"><label>Internal / Plan Notes</label>
                <textarea value={rewriteForm.notes} onChange={e=>setRewriteForm(f=>({...f,notes:e.target.value}))} style={{minHeight:70}}/>
              </div>
              <div className="field"><label>Send Via</label>
                <select value={rewriteForm.sendVia} onChange={e=>setRewriteForm(f=>({...f,sendVia:e.target.value}))}>
                  <option value="email">Email</option>
                  <option value="sms">Text Message</option>
                  <option value="both">Email + Text</option>
                </select>
              </div>
              <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:12,fontWeight:700}}
                disabled={rewriteSaving||!rewriteForm.resolutionFee} onClick={saveRewritePlan}>
                {rewriteSaving?'Creating New Plan…':'🔄 Save & Send New Plan'}
              </button>
            </div>
          </div>
        )}

        {showChargeModal&&(
          <ChargeResolutionFeeModal
            lead={c}
            showToast={showToast}
            onClose={()=>setShowChargeModal(false)}
            onPaid={()=>{ setShowChargeModal(false); loadRelated(c.name); showToast('✅ 2nd Trade charged!') }}
          />
        )}

        {poaModal && poaClient && (() => {
          const matchedForms = STATE_POA_FORMS.filter(f => f.state === poaClient.state)
          const hasMatch = matchedForms.length > 0
          return (
            <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setPoaModal(false)}>
              <div className="modal" style={{width:560,maxHeight:'88vh',overflowY:'auto'}}>
                <div className="mh">
                  <span className="mt">🏛️ State POA — {poaClient.name}</span>
                  <button className="xbtn" onClick={()=>setPoaModal(false)}>&times;</button>
                </div>
                <div style={{fontSize:12,color:'var(--t3)',marginBottom:16,lineHeight:1.6}}>
                  Send the {poaClient.state||'state'} Power of Attorney for e-signature. Works exactly like the 2848 — client gets an email/text with a signing link.
                </div>

                {/* Client info */}
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13}}>
                  <div style={{fontWeight:700}}>{poaClient.name}</div>
                  <div style={{color:'var(--t3)',marginTop:2}}>{poaClient.email} {poaClient.phone ? '· '+poaClient.phone : ''}</div>
                  {poaClient.state && <div style={{color:'var(--blue)',marginTop:2,fontWeight:600}}>State: {poaClient.state}</div>}
                </div>

                {!poaClient.state ? (
                  <div style={{color:'var(--warn)',fontSize:13,marginBottom:16}}>⚠️ No state on file for this client. Edit the client profile to add their state first.</div>
                ) : !hasMatch ? (
                  <div style={{color:'var(--t3)',fontSize:13,marginBottom:16}}>No state POA form on file for {poaClient.state}. Available states: FL, NC, TX, OH, NY, PA, CA, GA, IL, MA, MO, OR, TN, WA, WY, AZ, ID.</div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
                    {matchedForms.map(form=>(
                      <div key={form.num} style={{background:'var(--s2)',borderRadius:8,padding:'10px 14px',border:'1px solid var(--br)'}}>
                        <div style={{fontWeight:600,fontSize:13}}>{form.state} — {form.label}</div>
                        <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>{form.num}</div>
                      </div>
                    ))}
                  </div>
                )}

                {hasMatch && poaClient.state && (<>
                  <div className="field"><label>Send Via</label>
                    <select value={poaSendVia} onChange={e=>setPoaSendVia(e.target.value)}>
                      <option value="email">Email</option>
                      <option value="sms">Text Message</option>
                      <option value="both">Email + Text</option>
                    </select>
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:6}}>
                    <button className="btn sec" style={{flex:1,justifyContent:'center',padding:11}}
                      onClick={()=>{ const base=import.meta.env.BASE_URL.replace(/\/$/,''); window.open(`${base}/state-forms/${matchedForms[0].file}`,'_blank') }}>
                      ⬇ Download Blank
                    </button>
                    <button className="btn pri" style={{flex:2,justifyContent:'center',padding:11}}
                      disabled={poaSending} onClick={()=>sendStatePOA(poaClient, matchedForms[0], poaSendVia)}>
                      {poaSending ? 'Sending…' : '✍️ Send for E-Signature'}
                    </button>
                  </div>
                </>)}
              </div>
            </div>
          )
        })()}

      {faxModal && faxClient && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setFaxModal(false)}>
          <div className="modal" style={{width:500}}>
            <div className="mh"><span className="mt">📠 Send Fax — {faxClient.name}</span><button className="xbtn" onClick={()=>setFaxModal(false)}>&times;</button></div>
            <InlineFaxForm client={faxClient} onClose={()=>setFaxModal(false)} showToast={showToast} onLogged={()=>loadRelated(faxClient.name)}/>
          </div>
        </div>
      )}

      {esignModal && esignClient && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setEsignModal(false)}>
          <div className="modal" style={{width:500}}>
            <div className="mh"><span className="mt">✍️ E-Signature — {esignClient.name}</span><button className="xbtn" onClick={()=>setEsignModal(false)}>&times;</button></div>
            <InlineEsignForm client={esignClient} onClose={()=>setEsignModal(false)} showToast={showToast}/>
          </div>
        </div>
      )}

      {stripeModal && (
        <StripePaymentMethodModal
          client={c}
          showToast={showToast}
          onClose={()=>setStripeModal(false)}
          onSaved={async()=>{ const {data}=await supabase.from('clients').select('*').eq('id',c.id).single(); if (data) setDetail(data) }}
        />
      )}
      {paymentLinkModal && (
        <SendPaymentLinkModal
          record={c}
          recordType="client"
          showToast={showToast}
          onClose={async()=>{ setPaymentLinkModal(false); const {data}=await supabase.from('clients').select('*').eq('id',c.id).single(); if (data) setDetail(data) }}
        />
      )}
      {splitPaymentModal && (
        <SplitPaymentModal
          record={c}
          recordType="client"
          showToast={showToast}
          onClose={()=>setSplitPaymentModal(false)}
          onCharged={async()=>{ const {data}=await supabase.from('clients').select('*').eq('id',c.id).single(); if (data) setDetail(data) }}
        />
      )}

      {installmentModal && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setInstallmentModal(false)}>
          <div className="modal" style={{width:480}}>
            <div className="mh">
              <span className="mt">📅 2nd Trade Installment Plan — {c.name}</span>
              <button className="xbtn" onClick={()=>setInstallmentModal(false)}>&times;</button>
            </div>

            {!installmentDone ? (
              <>
                <div style={{fontSize:12,color:'var(--t3)',marginBottom:16,lineHeight:1.6}}>
                  Creates a Stripe monthly subscription and auto-generates the AR schedule in the CRM.
                  {c.stripe_default_pm ? ' ✅ Client has a saved card — subscription starts immediately.' : ' ⚠️ No card on file — client will receive a Checkout link to enter their card.'}
                </div>

                <div className="fg2">
                  <div className="field">
                    <label>IRS Liability ($)</label>
                    <input type="text" inputMode="decimal" value={formatMoneyInput(installmentForm.irsLiability)}
                      onChange={e=>setInstallmentForm(f=>({...f,irsLiability:parseMoney(e.target.value)}))}
                      placeholder="e.g. 45000"/>
                  </div>
                  <div className="field">
                    <label>Tax Resolution Fee ($) *</label>
                    <input type="text" inputMode="decimal" value={formatMoneyInput(installmentForm.totalFee)}
                      onChange={e=>setInstallmentForm(f=>({...f,totalFee:parseMoney(e.target.value)}))}
                      placeholder="e.g. 3000"/>
                  </div>
                </div>

                <div className="field">
                  <label>Payment Term</label>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginTop:4}}>
                    {['1','2','4','8'].map(m=>{
                      const amt = installmentForm.totalFee ? (parseFloat(installmentForm.totalFee)/parseInt(m)).toFixed(2) : null
                      const selected = installmentForm.months === m
                      return (
                        <button key={m} type="button"
                          onClick={()=>setInstallmentForm(f=>({...f,months:m}))}
                          style={{padding:'10px 8px',borderRadius:8,border:`2px solid ${selected?'var(--blue)':'var(--br)'}`,
                            background:selected?'rgba(37,99,235,.1)':'var(--s2)',cursor:'pointer',textAlign:'center'}}>
                          <div style={{fontWeight:700,fontSize:13,color:selected?'var(--blue)':'var(--tx)'}}>{m} mo</div>
                          {amt&&<div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>${parseFloat(amt).toLocaleString()}/mo</div>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {installmentForm.totalFee && (
                  <div style={{background:'var(--s2)',borderRadius:8,padding:'12px 14px',marginBottom:14,fontSize:12,color:'var(--t2)',lineHeight:1.8}}>
                    <div style={{fontWeight:700,color:'var(--tx)',marginBottom:4}}>Payment Summary</div>
                    {installmentForm.irsLiability&&<div>IRS Liability: <strong>${parseFloat(installmentForm.irsLiability).toLocaleString()}</strong></div>}
                    <div>Total Resolution Fee: <strong>${parseFloat(installmentForm.totalFee).toLocaleString()}</strong></div>
                    <div>Monthly Payment: <strong>${(parseFloat(installmentForm.totalFee)/parseInt(installmentForm.months)).toFixed(2)}</strong></div>
                    <div>Term: <strong>{installmentForm.months} month{installmentForm.months!=='1'?'s':''}</strong></div>
                  </div>
                )}

                <div className="field">
                  <label>Description (optional)</label>
                  <input value={installmentForm.description}
                    onChange={e=>setInstallmentForm(f=>({...f,description:e.target.value}))}
                    placeholder="Tax Resolution Services — 4-Month Plan"/>
                </div>

                <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:12,fontSize:14,fontWeight:700}}
                  onClick={createInstallmentPlan}
                  disabled={!installmentForm.totalFee||installmentLoading}>
                  {installmentLoading?'Creating Plan…':'🚀 Create Installment Plan'}
                </button>
              </>
            ) : (
              <div style={{textAlign:'center',padding:'20px 0'}}>
                <div style={{fontSize:32,marginBottom:12}}>✅</div>
                <div style={{fontWeight:700,fontSize:16,color:'var(--tx)',marginBottom:8}}>Installment Plan Created!</div>
                <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7,marginBottom:16}}>
                  <strong>${installmentDone.monthlyAmt.toFixed(2)}/month</strong> for <strong>{installmentDone.months} months</strong><br/>
                  {installmentDone.mode==='checkout'
                    ? 'A Checkout link was opened for the client to enter their card. The subscription starts once they pay.'
                    : 'Subscription started on saved card. AR schedule created in Payments tab.'}
                </div>
                <button className="btn sec" onClick={()=>setInstallmentModal(false)}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {portalModal && portalClient && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setPortalModal(false)}>
          <div className="modal" style={{width:500}}>
            <div className="mh"><span className="mt">🔓 Client Portal — {portalClient.name}</span><button className="xbtn" onClick={()=>setPortalModal(false)}>&times;</button></div>
            <InlinePortalForm client={portalClient} onClose={()=>setPortalModal(false)} showToast={showToast}/>
          </div>
        </div>
      )}

      {orgModal && orgClient && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setOrgModal(false)}>
          <div className="modal" style={{width:500}}>
            <div className="mh"><span className="mt">🧾 Tax Organizer — {orgClient.name}</span><button className="xbtn" onClick={()=>setOrgModal(false)}>&times;</button></div>
            <InlineOrganizerForm client={orgClient} onClose={()=>setOrgModal(false)} showToast={showToast}/>
          </div>
        </div>
      )}
      </div>
    )
  }

  // ── List View ────────────────────────────────────────────────────────────────
  const totalClients   = filtered.filter(c=>!c.archived).length
  const activeClients  = filtered.filter(c=>!c.archived&&c.status==='Active').length
  const indivClients   = filtered.filter(c=>!c.archived&&(c.clientType||'Individual')==='Individual').length
  const bizClients     = filtered.filter(c=>!c.archived&&c.clientType==='Business').length

  return (
    <div>
      {toast&&<div className="toast show">{toast}</div>}

      {/* Stat cards */}
      {!showArchived&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:14}}>
          {[
            {label:'Total Clients', val:totalClients,  color:'var(--tx)'},
            {label:'Active',        val:activeClients,  color:'var(--green)'},
            {label:'Individuals',   val:indivClients,   color:'var(--blue)'},
            {label:'Businesses',    val:bizClients,     color:'var(--warn)'},
          ].map(({label,val,color})=>(
            <div key={label} className="card" style={{padding:'12px 16px',textAlign:'center'}}>
              <div style={{fontSize:26,fontWeight:900,color,lineHeight:1}}>{val}</div>
              <div style={{fontSize:10,color:'var(--t3)',marginTop:4,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="ch">
          <span className="ct">{showArchived?'Archived Clients':'Client Roster'} <span style={{fontSize:12,fontWeight:500,color:'var(--t3)',marginLeft:6}}>({filtered.length})</span>{showArchived && <span style={{fontSize:11,fontWeight:500,color:'var(--t3)',marginLeft:8}}>· permanently deleted 30 days after archiving · Restore to keep</span>}</span>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <input
              type="search"
              placeholder="Search clients…"
              value={clientSearch}
              onChange={e=>setClientSearch(e.target.value)}
              style={{padding:'5px 10px',borderRadius:6,border:'1px solid var(--br)',background:'var(--s2)',color:'var(--tx)',fontSize:13,width:200,outline:'none'}}
            />
            {['All','Individual','Business'].map(f=>(
              <span key={f} className={`chip${filter===f?' on':''}`} onClick={()=>setFilter(f)}>{f}</span>
            ))}
            <span className={`chip${showArchived?' on':''}`} onClick={()=>{ setShowArchived(a=>!a); setFilterStatus('All'); setFilterRep('All'); setFilterPipeline('All') }}>🗄 Archived</span>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
              style={{fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid var(--br)',background:'var(--s2)',color:'var(--tx)',cursor:'pointer'}}>
              <option value="All">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Archived">Archived</option>
            </select>
            <select value={filterRep} onChange={e=>setFilterRep(e.target.value)}
              style={{fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid var(--br)',background:'var(--s2)',color:'var(--tx)',cursor:'pointer',maxWidth:150}}>
              {repOptions.map(r=><option key={r} value={r}>{r==='All'?'All Reps':r}</option>)}
            </select>
            <select value={filterPipeline} onChange={e=>setFilterPipeline(e.target.value)}
              style={{fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid var(--br)',background:'var(--s2)',color:'var(--tx)',cursor:'pointer',maxWidth:160}}>
              {pipelineOptions.map(p=><option key={p} value={p}>{p==='All'?'All Stages':p}</option>)}
            </select>
            <button className="btn pri" onClick={()=>{setForm(BLANK);setModal(true)}}>+ Add Client</button>
          </div>
        </div>
        <div className="ovx">
          <table>
            <thead>
              <tr>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('name')}>Name{sortCol==='name'?(sortDir==='asc'?' ↑':' ↓'):''  }</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('type')}>Type{sortCol==='type'?(sortDir==='asc'?' ↑':' ↓'):''  }</th>
                <th>Phone</th>
                <th>Email</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('balance')}>IRS Balance{sortCol==='balance'?(sortDir==='asc'?' ↑':' ↓'):''  }</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('issue')}>Issue{sortCol==='issue'?(sortDir==='asc'?' ↑':' ↓'):''  }</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('assigned')}>Assigned{sortCol==='assigned'?(sortDir==='asc'?' ↑':' ↓'):''  }</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('pipeline')}>Pipeline{sortCol==='pipeline'?(sortDir==='asc'?' ↑':' ↓'):''  }</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('status')}>Status{sortCol==='status'?(sortDir==='asc'?' ↑':' ↓'):''  }</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length===0?(
                <tr><td colSpan={10}>
                  <div style={{textAlign:'center',padding:'48px 20px',color:'var(--t3)'}}>
                    <div style={{fontSize:36,marginBottom:10}}>👤</div>
                    <div style={{fontWeight:700,fontSize:15,color:'var(--tx)',marginBottom:4}}>No clients yet</div>
                    <div style={{fontSize:13}}>Add your first client to get started.</div>
                  </div>
                </td></tr>
              ):sortedFiltered.map(c=>(
                <tr key={c.id} style={{cursor:'pointer'}} onClick={()=>openDetail(c)}>
                  <td style={{fontWeight:700,color:'var(--tx)',fontSize:13}}>{c.name}</td>
                  <td><span className="bdg bb" style={{fontSize:12,padding:'3px 9px'}}>{c.clientType||'Individual'}</span></td>
                  <td onClick={e=>e.stopPropagation()}><PhoneLink val={c.phone} name={c.name}/></td>
                  <td style={{color:'var(--t2)',fontSize:12}}>{c.email||'—'}</td>
                  <td style={{color:c.irsBalance?'var(--bad)':'var(--t3)',fontWeight:c.irsBalance?600:400}}>{formatBalance(c.irsBalance)}</td>
                  <td><span className="bdg bn" style={{fontSize:12,padding:'3px 9px'}}>{c.issueType||'—'}</span></td>
                  <td style={{color:'var(--t2)',fontSize:12}}>{c.assignedTo||'—'}</td>
                  <td><span className="bdg ba" style={{fontSize:12,padding:'3px 9px'}}>📊 {pipelineStageLabel(c.pipelineStage||DEFAULT_PIPELINE_STAGE)}</span></td>
                  <td><span className={`bdg ${c.status==='Active'?'bg':'bn'}`} style={{fontSize:12,padding:'3px 9px'}}>{c.status||'Active'}</span></td>
                  <td onClick={e=>e.stopPropagation()}>
                    {c.archived
                      ? <button className="btn" style={{padding:'3px 8px',fontSize:12}} onClick={()=>restoreClient(c.id)}>↩ Restore</button>
                      : <button className="btn del" style={{padding:'3px 8px',fontSize:13}} onClick={()=>archiveClient(c.id,c.name)}>🗑</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal&&<ClientFormModal form={form} fld={fld} reps={reps} saving={saving} onSave={save} onClose={()=>setModal(false)} title="Add Client"/>}

      {/* ✅ Fixed: DeleteConfirmModal must live HERE in the parent component, not inside ClientFormModal */}
      <DeleteConfirmModal
        open={!!confirmArchive}
        label={`client "${confirmArchive?.name}"`}
        onConfirm={confirmArchiveClient}
        onCancel={() => setConfirmArchive(null)}
      />
    </div>
  )
}

// ── Form Modal ────────────────────────────────────────────────────────────────
function ClientFormModal({form,fld,reps,saving,onSave,onClose,title}) {
  // Keep all input-format/state helpers inside the modal's lexical scope.
  // This component lives outside Clients(), so calling helpers declared inside
  // Clients() throws at input time and makes controlled fields appear read-only.
  function fmtPhoneInput(v) {
    const d=String(v||'').replace(/\D/g,'').slice(0,10)
    if (d.length<=3) return d
    if (d.length<=6) return `(${d.slice(0,3)}) ${d.slice(3)}`
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  }
  function fmtSsnInput(v) {
    const d=String(v||'').replace(/\D/g,'').slice(0,9)
    if (d.length<=3) return d
    if (d.length<=5) return `${d.slice(0,3)}-${d.slice(3)}`
    return `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}`
  }
  function fmtEinInput(v) {
    const d=String(v||'').replace(/\D/g,'').slice(0,9)
    if (d.length<=2) return d
    return `${d.slice(0,2)}-${d.slice(2)}`
  }
  async function handleZipInput(v) {
    const d=String(v||'').replace(/\D/g,'').slice(0,5)
    setPersonalAddressField('zip',d)
    if (d.length!==5) return
    try {
      const r=await fetch(`https://api.zippopotam.us/us/${d}`)
      if (!r.ok) return
      const data=await r.json()
      const place=data.places?.[0]
      if (place) {
        setPersonalAddressField('city',place['place name']||'')
        setPersonalAddressField('state',place['state abbreviation']||'')
      }
    } catch (_) {}
  }
  function toggleBusinessAddressSame(checked) {
    fld('biz_same_as_personal',checked)
    if (checked) {
      fld('biz_street',form.street||'')
      fld('biz_city',form.city||'')
      fld('biz_state',form.state||'')
      fld('biz_zip',form.zip||'')
    }
  }
  function setPersonalAddressField(key,value) {
    fld(key,value)
    if (!form.biz_same_as_personal) return
    const bizKey={street:'biz_street',city:'biz_city',state:'biz_state',zip:'biz_zip'}[key]
    if (bizKey) fld(bizKey,value)
  }
  function addDep(){fld('dependents',[...(form.dependents||[]),{...BLANK_DEP}])}
  function updDep(i,k,v){const d=[...(form.dependents||[])];d[i]={...d[i],[k]:v};fld('dependents',d)}
  function remDep(i){const d=[...(form.dependents||[])];d.splice(i,1);fld('dependents',d)}

  return (
    <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{width:680,maxHeight:'92vh',overflowY:'auto'}}>
        <div className="mh">
          <span className="mt">{title}</span>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>

        <div className="fg2">
          <div className="field"><label>Client Type</label>
            <select value={form.clientType} onChange={e=>fld('clientType',e.target.value)}>
              <option>Individual</option><option>Business</option><option>Individual &amp; Biz</option>
            </select>
          </div>
          <div className="field"><label>Full Name *</label>
            <input value={form.name} onChange={e=>fld('name',e.target.value)} placeholder="First Last"/>
          </div>
        </div>
        {form.clientType !== 'Individual' && (
          <div className="fg2">
            <div className="field"><label>Business Name *</label>
              <input value={form.business_name||''} onChange={e=>fld('business_name',e.target.value)} placeholder="Business Name"/>
            </div>
          </div>
        )}
        <div className="fg3">
          <div className="field"><label>Phone 1</label><input value={form.phone||''} onChange={e=>fld('phone',fmtPhoneInput(e.target.value))} placeholder="(305) 555-0000" maxLength={14}/></div>
          <div className="field"><label>Phone 2</label><input value={form.phone2||''} onChange={e=>fld('phone2',fmtPhoneInput(e.target.value))} placeholder="(305) 555-0000" maxLength={14}/></div>
          <div className="field"><label>Email</label><input value={form.email||''} onChange={e=>fld('email',e.target.value)}/></div>
        </div>
        <div className="field" style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0' }}>
          <input
            type="checkbox"
            id="clientSmsConsentCheck"
            checked={!!form.smsConsent}
            onChange={e=>{
              const checked = e.target.checked
              fld('smsConsent', checked)
              fld('smsConsentDate', checked ? new Date().toISOString() : null)
            }}
            style={{ width:16, height:16 }}
          />
          <label htmlFor="clientSmsConsentCheck" style={{ fontSize:13, fontWeight:400, color:'var(--t2)' }}>
            Client has verbally or in writing consented to receive text message updates about their case (required before sending SMS — TCR compliance)
          </label>
        </div>
        <div style={{fontSize:11,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',margin:'6px 0 4px'}}>
          {form.clientType === 'Business' ? 'Address' : 'Personal Address'}
        </div>
        <div className="field"><label>Street Address</label><input value={form.street||''} onChange={e=>setPersonalAddressField('street',e.target.value)}/></div>
        <div className="fg3">
          <div className="field"><label>City</label><input value={form.city||''} onChange={e=>setPersonalAddressField('city',e.target.value)}/></div>
          <div className="field"><label>State</label>
            <select value={form.state||''} onChange={e=>setPersonalAddressField('state',e.target.value)}>
              <option value="">Select…</option>{STATES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field"><label>ZIP</label><input value={form.zip||''} onChange={e=>handleZipInput(e.target.value)} maxLength={5} placeholder="33408"/></div>
        </div>
        <div className="field"><label>County</label><input value={form.county||''} onChange={e=>fld('county',e.target.value)} placeholder="e.g. Palm Beach"/></div>
        {form.clientType !== 'Individual' && (
          <>
            <div style={{display:'flex',alignItems:'center',gap:10,margin:'14px 0 4px'}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Business Address</div>
              <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--t3)',cursor:'pointer'}}>
                <input type="checkbox" checked={!!form.biz_same_as_personal}
                  onChange={e=>toggleBusinessAddressSame(e.target.checked)}/>
                Same as personal
              </label>
            </div>
            <div className="field"><label>Business Street Address</label>
              <input value={form.biz_street||''} disabled={!!form.biz_same_as_personal} onChange={e=>fld('biz_street',e.target.value)}/>
            </div>
            <div className="fg3">
              <div className="field"><label>City</label>
                <input value={form.biz_city||''} disabled={!!form.biz_same_as_personal} onChange={e=>fld('biz_city',e.target.value)}/>
              </div>
              <div className="field"><label>State</label>
                <select value={form.biz_state||''} disabled={!!form.biz_same_as_personal} onChange={e=>fld('biz_state',e.target.value)}>
                  <option value="">Select…</option>{STATES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field"><label>ZIP</label>
                <input value={form.biz_zip||''} disabled={!!form.biz_same_as_personal} onChange={e=>fld('biz_zip',e.target.value)} maxLength={5}/>
              </div>
            </div>
          </>
        )}

        {/* Taxpayer */}
        <div style={{background:'var(--s3)',borderRadius:8,padding:12,marginBottom:10}}>
          <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>🔒 Taxpayer Info</div>
          <div className="fg2">
            <div className="field"><label>SSN</label><input value={form.ssn||''} onChange={e=>fld('ssn',fmtSsnInput(e.target.value))} placeholder="XXX-XX-XXXX" maxLength={11}/></div>
            <div className="field"><label>EIN (if business)</label><input value={form.ein||''} onChange={e=>fld('ein',fmtEinInput(e.target.value))} placeholder="XX-XXXXXXX" maxLength={10}/></div>
          </div>
          <div className="field"><label>Date of Birth</label>
            <div style={{display:'flex',gap:6}}>
              <select value={form.dobM||''} onChange={e=>fld('dobM',e.target.value)} style={{flex:2}}>
                <option value="">Month</option>{MONTHS.map((m,i)=><option key={m} value={String(i+1).padStart(2,'0')}>{m}</option>)}
              </select>
              <select value={form.dobD||''} onChange={e=>fld('dobD',e.target.value)} style={{flex:1}}>
                <option value="">Day</option>{DAYS.map(d=><option key={d}>{d}</option>)}
              </select>
              <select value={form.dobY||''} onChange={e=>fld('dobY',e.target.value)} style={{flex:2}}>
                <option value="">Year</option>{YDOB.map(y=><option key={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Spouse */}
        <div style={{background:'var(--s3)',borderRadius:8,padding:12,marginBottom:10}}>
          <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>👥 Spouse / Partner</div>
          <div className="fg2">
            <div className="field"><label>Spouse Full Name</label><input value={form.spouseName||''} onChange={e=>fld('spouseName',e.target.value)}/></div>
            <div className="field"><label>Spouse SSN</label><input value={form.spouseSsn||''} onChange={e=>fld('spouseSsn',fmtSsnInput(e.target.value))} placeholder="XXX-XX-XXXX" maxLength={11}/></div>
          </div>
          <div className="fg2">
            <div className="field"><label>Spouse Date of Birth</label><input type="date" value={form.spouseDob||''} onChange={e=>fld('spouseDob',e.target.value)}/></div>
            <div className="field"><label>Filing Status</label>
              <select value={form.filingStatus||'Single'} onChange={e=>fld('filingStatus',e.target.value)}>
                {['Single','Married Filing Jointly','Married Filing Separately','Head of Household','Qualifying Widow(er)'].map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Autopay */}
        <div style={{background:'var(--s3)',borderRadius:8,padding:12,marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div style={{fontWeight:700,fontSize:12}}>💳 Autopay</div>
            <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer'}}>
              <input type="checkbox" checked={!!form.autopay_enabled} onChange={e=>fld('autopay_enabled',e.target.checked)}/> Enabled
            </label>
          </div>
          {!form.default_payment_method_id && <div style={{fontSize:11,color:'var(--warn)',marginBottom:8}}>No payment method on file yet — add one from the client's Overview tab before enabling autopay.</div>}
          <div className="fg3">
            <div className="field"><label>Amount ($)</label><input type="text" inputMode="decimal" value={formatMoneyInput(form.autopay_amount||'')} onChange={e=>fld('autopay_amount',parseMoney(e.target.value))}/></div>
            <div className="field"><label>Frequency</label>
              <select value={form.autopay_frequency||'monthly'} onChange={e=>fld('autopay_frequency',e.target.value)}>
                {['weekly','biweekly','monthly','one-time'].map(o=><option key={o} value={o}>{o[0].toUpperCase()+o.slice(1)}</option>)}
              </select>
            </div>
            <div className="field"><label>Next Charge Date</label><input type="date" value={form.autopay_next_charge||''} onChange={e=>fld('autopay_next_charge',e.target.value)}/></div>
          </div>
        </div>

        {/* Dependents */}
        <div style={{background:'var(--s3)',borderRadius:8,padding:12,marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <div style={{fontWeight:700,fontSize:12}}>👨‍👩‍👧 Dependents ({(form.dependents||[]).length})</div>
            <button className="btn sec" style={{fontSize:11,padding:'3px 10px'}} onClick={addDep}>+ Add</button>
          </div>
          {(form.dependents||[]).length===0&&<div style={{color:'var(--t3)',fontSize:12,textAlign:'center',padding:'6px 0'}}>None added</div>}
          {(form.dependents||[]).map((d,i)=>(
            <div key={i} style={{background:'var(--s2)',borderRadius:6,padding:10,marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <span style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase'}}>Dependent {i+1}</span>
                <button onClick={()=>remDep(i)} style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:16}}>×</button>
              </div>
              <div className="fg2">
                <div className="field"><label>Full Name</label><input value={d.name||''} onChange={e=>updDep(i,'name',e.target.value)}/></div>
                <div className="field"><label>Relationship</label>
                  <select value={d.relationship||'Child'} onChange={e=>updDep(i,'relationship',e.target.value)}>
                    {['Child','Stepchild','Foster Child','Sibling','Parent','Other'].map(r=><option key={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg2">
                <div className="field"><label>Date of Birth</label><input type="date" value={d.dob||''} onChange={e=>updDep(i,'dob',e.target.value)}/></div>
                <div className="field"><label>SSN</label><input value={d.ssn||''} onChange={e=>updDep(i,'ssn',fmtSsnInput(e.target.value))} placeholder="XXX-XX-XXXX" maxLength={11}/></div>
              </div>
            </div>
          ))}
        </div>

        {/* IRS Info */}
        <div className="fg2">
          <div className="field"><label>Est. IRS Balance</label><input type="text" value={form.irsBalance||''} onChange={e=>fld('irsBalance',e.target.value)} placeholder="e.g. 45000 or $30,000 - $50,000"/></div>
          <div className="field"><label>Issue Type</label>
            <select value={form.issueType||'OIC'} onChange={e=>fld('issueType',e.target.value)}>
              {['OIC','Installment Agreement','CNC','Penalty Abatement','Lien Withdrawal','TFRP','Payroll Tax','Unfiled Returns','Appeals','Audit','Liens/Levies','Tax Investigation','ACS','Notice Status','Other'].map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
        </div>
        {(form.irsOrState||'IRS Federal')!=='IRS Federal' && (
          <div className="fg2">
            <div className="field"><label>Est. State Balance</label><input type="text" value={form.stateBalance||''} onChange={e=>fld('stateBalance',e.target.value)} placeholder="e.g. 12000 or $10,000 - $20,000"/></div>
          </div>
        )}
        <div className="fg2">
          <div className="field"><label>IRS or State?</label>
            <select value={form.irsOrState||'IRS Federal'} onChange={e=>fld('irsOrState',e.target.value)}>
              <option>IRS Federal</option><option>State</option><option>Both IRS + State</option>
            </select>
          </div>
          <div className="field"><label>Tax Years</label><input value={form.taxYears||''} onChange={e=>fld('taxYears',e.target.value)} placeholder="2020, 2021, 2022"/></div>
        </div>
        <div className="field">
          <label>Filing Requirements</label>
          <div style={{display:'flex',gap:14,flexWrap:'wrap',padding:'6px 0'}}>
            {['1040','1120','1065','1120S','940','941'].map(ft=>(
              <label key={ft} style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:13,cursor:'pointer'}}>
                <input type="checkbox" style={{width:'auto'}}
                  checked={(form.filingRequirements||[]).includes(ft)}
                  onChange={()=>fld('filingRequirements', (form.filingRequirements||[]).includes(ft)
                    ? form.filingRequirements.filter(x=>x!==ft)
                    : [...(form.filingRequirements||[]),ft])}/>
                {ft}
              </label>
            ))}
          </div>
        </div>
        {(form.irsOrState||'IRS Federal')!=='State' && (
          <div className="fg2">
            <div className="field"><label>IRS Status</label>
              <select value={form.irsStatus||''} onChange={e=>fld('irsStatus',e.target.value)}>
                <option value="">— Select —</option>
                {IRS_STATUS_OPTIONS.map(o=><option key={o}>{o}</option>)}
              </select>
              {form.irsStatus==='Other'&&<input style={{marginTop:6}} value={form.irsStatusOther||''} onChange={e=>fld('irsStatusOther',e.target.value)} placeholder="Specify status"/>}
            </div>
            <div className="field"><label>IRS Deadline</label><input type="date" value={form.irsDeadline||''} onChange={e=>fld('irsDeadline',e.target.value)}/></div>
          </div>
        )}
        {(form.irsOrState||'IRS Federal')!=='IRS Federal' && (
          <div className="fg2">
            <div className="field"><label>State Status</label>
              <select value={form.stateStatus||''} onChange={e=>fld('stateStatus',e.target.value)}>
                <option value="">— Select —</option>
                {IRS_STATUS_OPTIONS.map(o=><option key={o}>{o}</option>)}
              </select>
              {form.stateStatus==='Other'&&<input style={{marginTop:6}} value={form.stateStatusOther||''} onChange={e=>fld('stateStatusOther',e.target.value)} placeholder="Specify status"/>}
            </div>
            <div className="field"><label>State Deadline</label><input type="date" value={form.stateDeadline||''} onChange={e=>fld('stateDeadline',e.target.value)}/></div>
          </div>
        )}
        <div className="fg2">
          <div className="field"><label>Pipeline Stage</label>
            <select value={form.pipelineStage||DEFAULT_PIPELINE_STAGE} onChange={e=>fld('pipelineStage',e.target.value)}>
              {PIPELINE_STAGES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="field"><label>Client Since</label><input type="date" value={form.clientSince||''} onChange={e=>fld('clientSince',e.target.value)}/></div>
        </div>
        <div className="fg2">
          <div className="field"><label>Status</label>
            <select value={form.status||'Active'} onChange={e=>fld('status',e.target.value)}>
              <option>Active</option><option>Inactive</option><option>Prospect</option>
            </select>
          </div>
          <div className="field"><label>{label("assignedTo","Tax Advisor")}</label>
            <select value={form.assignedTo||''} onChange={e=>fld('assignedTo',e.target.value)}>
              <option value="">Unassigned</option>{reps.map(r=><option key={r}>{r}</option>)}
            </select>
          </div>
          {/* Named associate overrides the round-robin pick on workflow steps. */}
          <div className="field"><label>{label("taxAssociate","Tax Associate")}</label>
            <select value={form.taxAssociate||''} onChange={e=>fld('taxAssociate',e.target.value)}>
              <option value="">Auto (round-robin)</option>{reps.map(r=><option key={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label style={{display:'flex',alignItems:'center',gap:6}}>
            <span>📌 Internal Note</span>
            <span style={{fontSize:10,color:'var(--warn)',fontWeight:400}}>(staff only — shows as sticky alert on file)</span>
          </label>
          <input value={form.internal_note||''} onChange={e=>fld('internal_note',e.target.value)}
            placeholder="e.g. Call husband John for updates, not the wife — (850) 555-0100"
            style={{width:'100%'}}/>
        </div>
        <div className="field"><label>Notes</label><textarea value={form.notes||''} onChange={e=>fld('notes',e.target.value)} style={{minHeight:80}}/></div>

        <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={onSave} disabled={saving}>
          {saving?'Saving…':title}
        </button>
      </div>
    </div>
  )
}



