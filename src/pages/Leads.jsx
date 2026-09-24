import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ClientActivityReport from './ClientActivityReport'
import { logActivity, getActor } from '../lib/activityLog'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { NOTE_TEMPLATES } from '../lib/noteTemplates'
import { triggerWorkflow, applyWorkflowTemplate } from '../lib/triggerWorkflow'
import { useApp } from '../context/AppContext'
import { useCall } from '../context/CallContext'
import { useFirm } from '../lib/useFirm'
import { generateClientPackage, generateAddendum, generatePOACoverLetter, sendFullPackage, generateCreditCardAuthForm, sendAddendumForSignature } from '../lib/docUtils'
import { generatePOACoverLetterPdf, RESOLUTION_SERVICES, generateFinancialIntakePdf, resolveStateFormUrl } from '../lib/irsFormUtils'
import { advanceLeadStatus } from '../lib/leadStatus'
import BookingWidget from '../components/BookingWidget'
import QuickEmail from '../components/QuickEmail'
import IRSFormFiller from '../components/IRSFormFiller'
import ErrorBoundary from '../components/ErrorBoundary'
import ComplianceGrids from './ComplianceGrids'
import { ClientDocs } from './Clients'
import { ESIGN_DOC_TYPES } from '../lib/esignDocTypes'
import InPlaceCaller from '../components/InPlaceCaller'
import ChargeResolutionFeeModal from '../components/ChargeResolutionFeeModal'
import FinancialIntakeView from '../components/FinancialIntakeView'
import FinancialProfile from './FinancialProfile'
import SendPaymentLinkModal from '../components/SendPaymentLinkModal'
import SavedCardsPanel from '../components/SavedCardsPanel'
import SplitPaymentModal from '../components/SplitPaymentModal'
import { SMS_TEMPLATES, applySmsTemplate } from '../lib/smsTemplates'
import { FIRM, label } from '../lib/firmBranding'

// Tenant-resolved firm name + contact email so the transactional email HTML,
// SMS bodies, and subject lines below read as whichever firm is signed in,
// not just the primary tenant. Mirrors docUtils.js:16-19 and SignPage.
const firmName  = () => FIRM.name || 'Tax Case Review'
const firmEmail = () =>
  (FIRM.email || '').trim() ||
  'info@' + firmName().toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com'

const STATUSES = ['New Lead','Contacted','Consultation Scheduled','Consultation Completed',
  'Tax Inv Agreement Sent','Tax Inv Agreement Signed','Tax Inv Fee Paid',
  'Tax Investigation Active','IRS Facts Received','Addendum Sent','Addendum Signed',
  'Resolution Fee Paid','Converted to Client','Dead','Do Not Contact']

const STATUS_C = {
  'New Lead':'bb','Contacted':'bn','Consultation Scheduled':'ba','Consultation Completed':'ba',
  'Tax Inv Agreement Sent':'ba','Tax Inv Agreement Signed':'bg','Tax Inv Fee Paid':'bg',
  'Tax Investigation Active':'bg','IRS Facts Received':'bg','Addendum Sent':'ba',
  'Addendum Signed':'bg','Resolution Fee Paid':'bg','Converted to Client':'bg',
  'Dead':'br','Do Not Contact':'br'
}

// Setting a lead to either of these statuses means the lead is done —
// no more follow-up is coming. Auto-archive it so it drops out of the
// default working list, instead of relying on someone to remember to
// click Archive separately. Still fully reversible via Restore.
const AUTO_ARCHIVE_STATUSES = ['Dead', 'Do Not Contact']

// Full status flow, in order, left to right — shared by the inline Pipeline
// widget on the lead card and the "View Flow" reference modal, so both
// always show the exact same 13 forward statuses with matching colors.
const STATUS_FLOW = [
  {s:'New Lead',c:'#3b82f6'},{s:'Contacted',c:'#6366f1'},
  {s:'Consultation Scheduled',c:'#8b5cf6'},{s:'Consultation Completed',c:'#a855f7'},
  {s:'Tax Inv Agreement Sent',c:'#f59e0b'},{s:'Tax Inv Agreement Signed',c:'#f97316'},
  {s:'Tax Inv Fee Paid',c:'#10b981'},{s:'Tax Investigation Active',c:'#059669'},
  {s:'IRS Facts Received',c:'#0ea5e9'},{s:'Addendum Sent',c:'#f59e0b'},
  {s:'Addendum Signed',c:'#f97316'},{s:'Resolution Fee Paid',c:'#10b981'},
  {s:'Converted to Client',c:'#25A25A'},
]
// Exit statuses — can be set from any stage above, not part of the linear sequence.
const EXIT_FLOW = [{s:'Dead',c:'#E84B5A'},{s:'Do Not Contact',c:'#E84B5A'}]

const YEARS  = Array.from({length:21},(_,i)=>2027-i)
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

const BLANK = {
  clientType:'Individual', name:'', business_name:'', first:'', mi:'', last:'', phone:'', phone2:'', email:'',
  smsConsent:false, smsConsentDate:null,
  ssn:'', ein:'', dob:'',
  spouseName:'', spouseSsn:'', spouseDob:'', filingStatus:'Single',
  street:'', city:'', state:'', zip:'', county:'', source:'Referral', taxAssociate:'',
  biz_street:'', biz_city:'', biz_state:'', biz_zip:'', biz_same_as_personal:false,
  irsBalance:'', stateBalance:'', issueType:'OIC', irsOrState:'IRS Federal', taxYears:[],
  filingRequirements:[],
  irsStatus:'', irsStatusOther:'', irsDeadline:'',
  stateStatus:'', stateStatusOther:'', stateDeadline:'',
  taxYearsCustom:'', notes:'', assignedTo:'', status:'New Lead', taxFee:'', taxFeeOverride:'',
  services:[], salesRep:'', contractFee:'', trade1Amount:'', trade1Date:'', trade2Amount:'', trade2Date:'', trade3Amount:'', trade3Date:''
}

const IRS_STATUS_OPTIONS = ['ACS','Notice Status','Queue for ACS','Currently Not Collectible','Installment Agreement','Garnishment','Levy Issued','Levied','Lien Filed','Appeals','Litigation','Released','Other']

function Bdg({s,style}) { return <span className={`bdg ${STATUS_C[s]||'bn'}`} style={style}>{s}</span> }
// Resolves the logged-in user's display name against the employees table by
// email first, so notes are attributed as "Romy Cruz" (matching Team Chat)
// instead of an email-prefix guess like "romy" that avatar matching can't find.
function resolveActorName(user, employees) {
  const email = user?.email?.toLowerCase()
  const emp = email ? employees.find(e => e.email && e.email.toLowerCase() === email) : null
  return emp?.name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
}

const LEAD_FIELD_LABELS = {
  name:'Name', email:'Email', phone:'Phone', phone2:'Phone 2', address:'Address',
  city:'City', state:'State', zip:'Zip', ssn:'SSN', ein:'EIN', dob:'DOB',
  filingStatus:'Filing Status', maritalStatus:'Marital Status', occupation:'Occupation',
  employer:'Employer', spouseName:'Spouse Name', taxFee:'Tax Fee', source:'Source',
  assignedTo:'Assigned To', businessName:'Business Name', business_name:'Business Name',
  clientType:'Client Type', irsOrState:'IRS or State',
}
const LEAD_SKIP_DIFF_FIELDS = new Set(['id','created_at','updated_at','tenant_id','status','archived','dobM','dobD','dobY'])
function summarizeLeadFieldChanges(before, after) {
  if (!before || !after) return []
  const changes = []
  for (const key of Object.keys(after)) {
    if (LEAD_SKIP_DIFF_FIELDS.has(key)) continue
    const oldVal = before[key], newVal = after[key]
    if ((oldVal ?? '') === (newVal ?? '')) continue
    if (typeof newVal === 'object') continue
    const label = LEAD_FIELD_LABELS[key] || key
    const fmt = v => (v===null||v===undefined||v==='') ? '(empty)' : String(v).slice(0,60)
    changes.push(`${label}: ${fmt(oldVal)} → ${fmt(newVal)}`)
  }
  return changes
}

function TypeBdg({t,style}) {
  const m = {'OIC':'bb','Installment Agreement':'bg','CNC':'bn','Penalty Abatement':'bb','Appeals':'bn','Payroll Tax':'br','Audit':'br','Liens/Levies':'br'}
  return <span className={`bdg ${m[t]||'bn'}`} style={style}>{t}</span>
}


const menuBtnStyle = {
  display:'block', width:'100%', textAlign:'left', padding:'9px 14px', fontSize:12.5,
  background:'none', border:'none', color:'var(--tx)', cursor:'pointer'
}
function PhoneLink({val, name}) {
  const { startCall, relayStatus } = useCall()
  if (!val) return <span style={{color:'var(--t3)'}}>—</span>
  function dial(e) {
    e.preventDefault(); e.stopPropagation()
    startCall({ name: name||val, phone: val, entityType: 'lead' })
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
function ActionBtn({color, icon, label, sub, onClick}) {
  return (
    <div onClick={onClick} style={{
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      gap:4,padding:'10px 8px',borderRadius:10,cursor:'pointer',minWidth:80,flex:'1 1 80px',
      background:color,color:'#fff',textAlign:'center',userSelect:'none',
      transition:'transform .1s,opacity .1s',
    }}
      onMouseEnter={e=>{e.currentTarget.style.opacity='.85';e.currentTarget.style.transform='translateY(-2px)'}}
      onMouseLeave={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.transform=''}}
    >
      <span style={{fontSize:20}}>{icon}</span>
      <span style={{fontSize:11,fontWeight:700,lineHeight:1.2}}>{label}</span>
      {sub&&<span style={{fontSize:9,opacity:.85,lineHeight:1.1}}>{sub}</span>}
    </div>
  )
}

function LeadInlineFax({ lead, onClose, onLogged }) {
  // TO stays blank on open — the lead's phone number is not the fax number,
  // and prefilling led users to send to the wrong destination.
  const [toNum,set0]=useState('')
  const [subject,set1]=useState('')
  const [file,set2]=useState(null)
  const [sending,set3]=useState(false)
  const [poaBusy,setPoaBusy]=useState(false)
  async function usePOATemplate() {
    setPoaBusy(true)
    try {
      const bytes = await generatePOACoverLetterPdf(lead)
      const fname = `POA-Cover-Letter-${(lead?.name||'lead').replace(/[^a-zA-Z0-9]+/g,'-')}.pdf`
      set2(new File([bytes], fname, { type: 'application/pdf' }))
      if (!subject) set1('Power of Attorney Cover Letter — Form 2848')
    } catch (e) {
      alert('Error generating POA Cover Letter: ' + e.message)
    } finally {
      setPoaBusy(false)
    }
  }
  async function send() {
    const rawDigits = toNum.replace(/\D/g,'')
    const faxDigits = rawDigits.length === 11 && rawDigits.startsWith('1') ? rawDigits.slice(1) : rawDigits
    if (faxDigits.length !== 10) { alert('Enter a valid 10-digit fax number.'); return }
    if (!file) { alert('Attach a document before sending the fax.'); return }
    set3(true)
    let fileUrl = null
    const toFull = '+1' + faxDigits
    try {
      const path = `fax/${lead?.id || 'lead'}/${Date.now()}_${file.name.replace(/[^A-Za-z0-9._-]/g,'_')}`
      const { error: uploadErr } = await supabase.storage.from('documents').upload(path, file, { upsert:false, contentType:file.type || 'application/pdf' })
      if (uploadErr) throw uploadErr
      const { data:u, error: signErr } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      if (signErr || !u?.signedUrl) throw signErr || new Error('Could not create secure fax document URL')
      fileUrl = u.signedUrl

      const { data: resData, error: invokeErr } = await supabase.functions.invoke('send-fax', {
        body: { to: toFull, document_url: fileUrl }
      })
      if (invokeErr) throw invokeErr
      if (!resData?.success) throw new Error(resData?.error || 'Fax provider rejected the send')

      await supabase.from('fax_logs').insert([{
        to_number:toFull, client_name:lead?.name, subject, file_url:fileUrl,
        file_name:file?.name||null, status:'Sent', ...(resData?.provider === 'telnyx' ? { telnyx_fax_id: resData?.sid || null } : { signalwire_fax_id: resData?.sid || null }),
        sent_at:new Date().toISOString(), created_at:new Date().toISOString()
      }])

      const { data: { user } } = await supabase.auth.getUser()
      const actor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
      const noteContent = `📠 Fax sent to ${toFull}${subject?' — '+subject:''}${file?.name?' (' + file.name + ')':''}`
      await supabase.from('lead_notes').insert([{ lead_id: lead.id, lead_name: lead?.name, text: noteContent, type:'System', author: actor, created_at: new Date().toISOString() }])

      onLogged?.(); onClose()
    } catch (e) {
      console.error('[LeadInlineFax] send failed:', e)
      alert('Fax failed: ' + (e?.message || 'Unknown provider error'))
    } finally {
      set3(false)
    }
  }
  return <div style={{padding:'0 4px 4px'}}>
    <div className="field"><label>To Fax Number</label><input value={toNum} onChange={e=>set0(e.target.value.replace(/\D/g,''))} placeholder="10 digits"/></div>
    <div className="field"><label>Subject</label><input value={subject} onChange={e=>set1(e.target.value)} placeholder="Document subject"/></div>
    <button type="button" onClick={usePOATemplate} disabled={poaBusy} className="btn sec" style={{fontSize:11,padding:'5px 10px',marginBottom:10}}>
      {poaBusy?'Generating…':'📋 Use POA Cover Letter Template'}
    </button>
    <div className="field"><label>Attach PDF</label><input type="file" accept=".pdf,.tiff,.jpg,.png" onChange={e=>set2(e.target.files[0])} style={{padding:'6px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',width:'100%',fontSize:12}}/>
      {file && <div style={{fontSize:11,color:'var(--ok)',marginTop:4}}>📄 {file.name}</div>}
    </div>
    <div style={{display:'flex',gap:8}}>
      <button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={onClose}>Cancel</button>
      <button className="btn sm" style={{flex:1,justifyContent:'center',background:'#dc2626',color:'#fff',borderColor:'#dc2626'}} onClick={send} disabled={sending}>{sending?'Sending…':'📠 Send'}</button>
    </div>
  </div>
}


function LeadInlineEsign({ lead, onClose }) {
  const [docType,set0]=useState('Tax Service Agreement')
  const [sendVia,setSendVia]=useState(lead?.email ? 'email' : 'sms')
  const [saving,set2]=useState(false)
  const [done,setDone]=useState(null)
  const [customMsg,setCustomMsg]=useState('')
  const [customFile,setCustomFile]=useState(null)
  const [uploading,setUploading]=useState(false)
  async function create() {
    if(docType==='Custom Document' && !customMsg.trim() && !customFile){
      alert('For a custom document, type the text to sign or attach a PDF.');return
    }
    set2(true)
    // Custom PDF → upload to storage and attach to the sign page
    let pdfAttachments=null
    if(docType==='Custom Document' && customFile){
      setUploading(true)
      try{
        const path=`esign-custom/${(lead?.name||'lead').replace(/[^A-Za-z0-9 _-]/g,'')}/${Date.now()}-${customFile.name}`
        const{error:upErr}=await supabase.storage.from('documents').upload(path,customFile,{upsert:true})
        if(!upErr){
          const{data:u}=await supabase.storage.from('documents').createSignedUrl(path,94608000)
          pdfAttachments=[{formType:'custom',label:customFile.name,url:u?.signedUrl||''}]
        }
      }catch(e){console.error('custom upload:',e)}
      setUploading(false)
    }
    const{data,error}=await supabase.from('esigns').insert([{
      doc_type:docType,
      client_name:lead?.name,
      client_email:lead?.email||'',
      client_phone:lead?.phone||'',
      message:docType==='Custom Document'?(customMsg.trim()||'Please review and sign the attached document.'):null,
      pdf_attachments:pdfAttachments,
      investigation_fee:lead?.taxFee||null,
      tax_years:lead?.taxYearsCustom||lead?.taxYears||null,
      rep_name:lead?.assignedTo||null,
      send_via:sendVia,
      priority:'Normal',status:'Awaiting',
      sent_at:new Date().toISOString(),created_at:new Date().toISOString()
    }]).select().single()
    if(error){set2(false);alert('Error: '+error.message);return}
    const url=window.location.origin+'/sign/'+data.id
    await navigator.clipboard.writeText(url).catch(()=>{})
    let smsSent=false,emailSent=false
    const cfg = await getSettings()
    if((sendVia==='email'||sendVia==='both')&&lead?.email){
      try{
        const{error:eErr}=await supabase.functions.invoke('send-email',{body:{ tenant_id: FIRM.tenantId || undefined,
          to:lead.email,
          subject:`Please Sign: ${docType} — ${firmName()}`,
          html:`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%);padding:32px 40px;text-align:center">
    <img src="${FIRM.logoUrl}" alt="${FIRM.name}" style="max-height:60px;max-width:240px;object-fit:contain" onerror="this.style.display='none'"/>
    <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:12px">${FIRM.name}</div>
    <div style="font-size:12px;color:#93c5fd;margin-top:4px;letter-spacing:.08em;text-transform:uppercase">IRS Resolution Services</div>
  </td></tr>
  <tr><td style="padding:40px 40px 32px">
    <p style="margin:0 0 16px;font-size:16px;color:#0f172a">Dear <strong>${lead.name}</strong>,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.7">Your <strong>${docType}</strong> is ready for your review and electronic signature. Please click the button below to open the document — it only takes a moment.</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 28px">
      <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:700;font-size:17px;box-shadow:0 4px 14px rgba(22,163,74,.35)">Review &amp; Sign Document →</a>
    </td></tr></table>
    <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;text-align:center">Or copy this link:</p>
    <p style="margin:0 0 32px;font-size:12px;color:#3b82f6;text-align:center;word-break:break-all"><a href="${url}" style="color:#3b82f6">${url}</a></p>
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
        if(!eErr)emailSent=true
      }catch(e){console.error('Email error:',e)}
    }
    if((sendVia==='sms'||sendVia==='both')&&lead?.phone&&cfg?.signalwire_backend){
      try{
        const r=await fetch(cfg.signalwire_backend+'/sms/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:lead.phone,body:`Hi ${lead?.name}, ${firmName()} sent you a document to sign: ${url}`})})
        const d=await r.json();if(d.success)smsSent=true
      }catch(e){console.error('SMS error:',e)}
    }
    set2(false)
    const sent=[emailSent&&'email',smsSent&&'SMS'].filter(Boolean)
    try {
      await supabase.from('lead_notes').insert({
        lead_id: lead.id, lead_name: lead?.name,
        text: `✍️ ${docType} sent for e-signature${sent.length?` via ${sent.join(' & ')}`:' (link copied)'}`,
        type:'System', author: lead?.assignedTo || 'System', created_at: new Date().toISOString()
      })
    } catch(_) {}
    setDone({url,sent})
  }
  if(done) return <div style={{padding:'0 4px 12px'}}>
    <div style={{background:'rgba(34,197,94,.08)',border:'1px solid rgba(34,197,94,.3)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--ok)',marginBottom:6}}>{done.sent.length?`Sent via ${done.sent.join(' & ')}!`:'Link copied — share manually'}</div>
      {!done.sent.length&&<div style={{fontSize:11,color:'var(--warn)',marginBottom:4}}>Email/SMS not configured in Settings yet.</div>}
      <div style={{fontSize:11,color:'var(--t3)',wordBreak:'break-all'}}>{done.url}</div>
    </div>
    <button className="btn sec" style={{width:'100%',justifyContent:'center'}} onClick={onClose}>Done</button>
  </div>
  return <div style={{padding:'0 4px 4px'}}>
    <div className="field"><label>Document Type</label>
      <select value={docType} onChange={e=>set0(e.target.value)}>
        {ESIGN_DOC_TYPES.map(t=><option key={t}>{t}</option>)}
      </select>
    </div>
    {docType==='Custom Document'&&(
      <div style={{marginBottom:12}}>
        <div className="field"><label>Document Text</label>
          <textarea value={customMsg} onChange={e=>setCustomMsg(e.target.value)} rows={4}
            placeholder="Type the document text they'll review and sign… (or attach a PDF below)"/>
        </div>
        <div className="field"><label>Or attach a PDF</label>
          <input type="file" accept="application/pdf" onChange={e=>setCustomFile(e.target.files?.[0]||null)}/>
          {customFile&&<div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>📎 {customFile.name}</div>}
        </div>
      </div>
    )}
    <div style={{background:'var(--s2)',borderRadius:6,padding:'9px 12px',marginBottom:12,fontSize:12,color:'var(--t3)',lineHeight:1.7}}>
      <div>Email: {lead?.email||<span style={{color:'var(--warn)'}}>No email on file</span>}</div>
      <div>Phone: {lead?.phone||<span style={{color:'var(--warn)'}}>No phone on file</span>}</div>
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
    <div style={{display:'flex',gap:8,marginTop:4}}>
      <button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={onClose}>Cancel</button>
      <button className="btn sm" style={{flex:1,justifyContent:'center',background:'#7c3aed',color:'#fff',borderColor:'#7c3aed'}} onClick={create} disabled={saving}>{uploading?'Uploading…':saving?'Sending...':'Send Request'}</button>
    </div>
  </div>
}

export default function Leads() {
  const { user, role, employeeName, leadWorkflowModel, myTenantId } = useApp()

  // ── Model-aware pipeline config ───────────────────────────────────────────
  // All pipeline rendering and logic reads from this — never hardcoded arrays.
  // getModel() falls back to investigation-resolution if model key is unknown.
  // Recalculated only when leadWorkflowModel changes (session/tenant switch).
  const activeModel  = React.useMemo(() => getModel(leadWorkflowModel), [leadWorkflowModel])
  const MODEL_STAGES = activeModel.stages         // ordered forward pipeline stages
  const MODEL_FLOW   = activeModel.flow           // [{s, c}] for the pipeline widget
  const MODEL_BADGE  = activeModel.badge          // {status: cssClass} for <Bdg>
  const MODEL_CLOSED = activeModel.closedStatuses // statuses that close a lead
  const { id: urlLeadId } = useParams()
  const [searchParams] = useSearchParams()
  const isTaxAdvisor = role === 'Tax Advisor'

  // Cache settings at load time — avoids re-fetching signalwire_backend on every action
  const settingsRef = useRef(null)
  async function getSettings() {
    if (settingsRef.current) return settingsRef.current
    const { data } = await supabase.from('settings').select('signalwire_backend,sw_inbound_did,sw_space_url').limit(1).maybeSingle()
    settingsRef.current = data || {}
    return settingsRef.current
  }

  // Auto-open Add Lead modal when navigated here with ?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setForm(isTaxAdvisor && employeeName ? { ...BLANK, assignedTo: employeeName } : BLANK)
      setModal(true)
      setShowScript(true)
    }
  }, [searchParams])
  const navigate = useNavigate()
  const [quickEmail, setQuickEmail] = useState(null)
  const [leads, setLeads]   = useState([])
  const [filter, setFilter] = useState('All')
  const [repFilter, setRepFilter] = useState('All')
  const [filterPipeline, setFilterPipeline] = useState('All')
  const [leadSearch, setLeadSearch] = useState('')
  const [sortCol, setSortCol] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  // Tax Advisors only ever see their own leads — lock the existing rep
  // filter to their name instead of building a separate filter path.
  useEffect(() => {
    if (isTaxAdvisor && employeeName) setRepFilter(employeeName)
  }, [isTaxAdvisor, employeeName])
  const [employees, setEmployees] = useState([])
  const [statusCategories, setStatusCategories] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null)
  const [modal, setModal]   = useState(false)
  const [showScript, setShowScript] = useState(false)
  const [bookingLead, setBookingLead] = useState(null)
  const [resolutionFeeLead, setResolutionFeeLead] = useState(null)
  const [fillerLead, setFillerLead] = useState(null)
  const [paymentLinkModal, setPaymentLinkModal] = useState(null)
  const [splitPaymentModal, setSplitPaymentModal] = useState(false)
  const [detail, setDetail] = useState(null)
  const [leadNotes, setLeadNotes]     = useState([])
  const [leadSms, setLeadSms]         = useState([])
  const [leadSmsBody, setLeadSmsBody] = useState('')
  const [leadSmsSending, setLeadSmsSending] = useState(false)
  const [leadTasks, setLeadTasks]     = useState([])
  const [leadTaskFilter, setLeadTaskFilter] = useState('all') // 'all' | 'active' | 'completed'
  const [leadSectionOverride, setLeadSectionOverride] = useState({}) // key -> true(expanded)/false(collapsed), only set once user manually toggles
  const [leadQuickTask, setLeadQuickTask] = useState('')
  const [pendingLeadSection, setPendingLeadSection] = useState('')
  const [templateModal, setTemplateModal] = useState(false)
  const [availableTemplates, setAvailableTemplates] = useState([])
  const [templateSearch, setTemplateSearch] = useState('')
  const [applyingTemplateId, setApplyingTemplateId] = useState('')
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([])
  const [addingLeadTask, setAddingLeadTask] = useState(false)
  const [addModal, setAddModal] = useState(false)
  const [poaLead, setPoaLead] = useState(null)
  const [poaModal, setPoaModal] = useState(false)
  const [poaSending, setPoaSending] = useState(false)
  const [poaSendVia, setPoaSendVia] = useState('email')
  const [addForm, setAddForm] = useState({ resolutionFee:'', paymentPlan:'', startDate:'', notes:'', services:[], sendVia:'email' })
  const [addendumSending, setAddendumSending] = useState(false)
  const [leadDetailTab, setLeadDetailTab] = useState('overview')
  const [newLeadNote, setNewLeadNote] = useState('')
  const [addingLeadNote, setAddingLeadNote] = useState(false)
  const [noteType, setNoteType]       = useState('Call')
  const [showAllNotes, setShowAllNotes] = useState(false)
  const [form, setForm]     = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [toast, setToast]   = useState('')
  const [converting, setConverting] = useState(false)
  const [pkgSending, setPkgSending] = useState(false)
  const [intakeSending, setIntakeSending] = useState(false)
  const [backfillingIntake, setBackfillingIntake] = useState(false)
  const [inlineFaxLead, setInlineFaxLead] = useState(null)
  const [showFaxModal, setShowFaxModal] = useState(false)
  const [inlineEsignLead, setInlineEsignLead] = useState(null)
  const [showEsignModal, setShowEsignModal] = useState(false)
  const [showFlow, setShowFlow]     = useState(false)
  const [leadDocCount, setLeadDocCount] = useState(0)

  useEffect(() => {
    // Guard: don't load until the auth session is confirmed so current_tenant_id()
    // is established in the DB before the first query fires. Without this, a hard
    // refresh can return the wrong tenant's records before RLS kicks in.
    if (!user) return
    load()
    const ch = supabase.channel('leads-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

  // Live-update the currently-open lead's related data (notes, tasks, docs)
  // — same reasoning and same pattern as the equivalent addition in
  // Clients.jsx. Scoped to only run while a specific lead is open.
  useEffect(() => {
    if (!detail?.id) return
    const id = detail.id, name = detail.name
    function reloadNotes() { loadLeadNotes(id) }
    function reloadTasks() { loadLeadTasks(name) }
    const ch = supabase.channel('lead-detail-rt-' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lead_notes' }, reloadNotes)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, reloadTasks)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [detail?.id, detail?.name])

  // Save scroll position before refresh/navigation away, restore once the
  // lead loads back in — keyed to .page-content, the element that actually scrolls.
  useEffect(() => {
    if (!detail) return
    const key = `leadScroll_${detail.id}`
    const el = document.querySelector('.page-content')
    const saveScroll = () => { if (el) sessionStorage.setItem(key, String(el.scrollTop)) }
    window.addEventListener('beforeunload', saveScroll)
    window.addEventListener('pagehide', saveScroll)
    const saved = sessionStorage.getItem(key)
    if (saved) requestAnimationFrame(() => { if (el) el.scrollTop = parseInt(saved, 10) || 0 })
    return () => {
      saveScroll()
      window.removeEventListener('beforeunload', saveScroll)
      window.removeEventListener('pagehide', saveScroll)
    }
  }, [detail?.id])
  useEffect(() => {
    if (!detail) return
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('client', detail.name)
      .then(({ count }) => setLeadDocCount(count || 0))
  }, [detail?.id])
  // Fast path: same fix as Clients — don't make opening one lead wait on
  // the entire leads table downloading first.
  useEffect(() => {
    if (!urlLeadId || detail) return
    let cancelled = false
    supabase.from('leads').select('*').eq('id', urlLeadId).single().then(({ data }) => {
      if (!cancelled && data) { setDetail(data); loadLeadNotes(data.id) }
    })
    return () => { cancelled = true }
  }, [urlLeadId])
  useEffect(() => {
    if (urlLeadId && leads.length > 0 && !detail) {
      const found = leads.find(l => String(l.id) === String(urlLeadId))
      if (found) { setDetail(found); loadLeadNotes(found.id) }
    }
  }, [urlLeadId, leads])
  // If the URL no longer points at the lead currently being shown (e.g.
  // clicking "Leads" in the sidebar while a detail page is open), drop the
  // stale detail state so the page actually reflects the URL again.
  useEffect(() => {
    if (detail && String(detail.id) !== String(urlLeadId || '')) {
      setDetail(null)
    }
  }, [urlLeadId, detail])

  async function load() {
    const [{ data }, { data: emp }, { data: cats }, { data: sts }] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id,name,avatar_url,email,role').order('name'),
      supabase.from('workflow_status_categories').select('*').order('sort_order'),
      supabase.from('workflow_statuses').select('*').order('sort_order'),
    ])
    if (emp) setEmployees(emp)
    if (cats) setStatusCategories(cats.map(cat => ({ ...cat, statuses: (sts||[]).filter(s => s.category_id === cat.id) })))
    if (data) {
      setLeads(data)
      // refresh detail if open
      if (detail) setDetail(data.find(l => l.id === detail.id) || null)
    }
  }

  async function loadLeadNotes(leadId) {
    const { data } = await supabase.from('lead_notes').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
    setLeadNotes(data || [])
  }

  // Single shared entry point for auto-logging an action as a lead note —
  // same pattern as Clients.jsx's logAction, kept consistent so error
  // handling doesn't get hand-rolled (and silently swallowed) per call site.
  async function logAction(leadId, leadName, text) {
    if (!leadId) return
    const actor = resolveActorName(user, employees)
    const { error } = await supabase.from('lead_notes').insert({
      lead_id: leadId, lead_name: leadName, text, type: 'System',
      author: actor, created_at: new Date().toISOString()
    })
    if (error) showToast('Action completed, but failed to log note: ' + error.message)
    return !error
  }

  // Scoped strictly to this lead's name — sms_messages.clientName is the
  // shared text key receive-sms already matches against both leads and
  // clients by phone number, so a lead's inbound replies were already
  // landing in the table correctly. There just wasn't a tab here to show
  // them, so the only place to see a lead's texts was the global SMS page
  // (every contact's messages, unfiltered).
  async function loadLeadSms(leadName) {
    const { data } = await supabase.from('sms_messages').select('*').eq('clientName', leadName).order('created_at', { ascending: false })
    setLeadSms(data || [])
  }
  // Same clientName key the tasks table already uses for clients, and that
  // convertToClient() already writes the onboarding tasks under (using
  // l.name, which becomes the new client's name unchanged). So a task
  // added here while still a lead doesn't need any copy/transfer step at
  // conversion time — it's the same row, same key, still there afterward.
  async function loadLeadTasks(leadName) {
    // Due date ascending is the order a rep actually works the file, and it
    // survives however the rows were inserted. Sorting on created_at desc put
    // the last workflow step at the top whenever the insert timestamps landed
    // in the same second. created_at breaks ties within a single due date.
    const { data } = await supabase.from('tasks').select('*').eq('clientName', leadName).not('deleted','is',true)
      .order('dueDate', { ascending: true }).order('created_at', { ascending: true })
    setLeadTasks(data || [])
  }
  // Covers every way the detail view can open — list click, direct URL/
  // refresh, the fast-path single-lead fetch — not just the row onClick.
  useEffect(() => {
    if (!detail) return
    loadLeadSms(detail.name)
    loadLeadTasks(detail.name)
  }, [detail?.id])

  async function toggleLeadTask(task) {
    const { error } = await supabase.from('tasks').update({ done: !task.done }).eq('id', task.id)
    if (!error && detail) {
      loadLeadTasks(detail.name)
      await logAction(detail.id, detail.name, `${!task.done ? '✅' : '↩️'} Task ${!task.done ? 'completed' : 'reopened'}: "${task.title}"`)
    }
  }

  async function updateLeadTaskStatus(task, value) {
    if (!value) { await supabase.from('tasks').update({status_category:null, status_label:null}).eq('id',task.id); loadLeadTasks(detail.name); return }
    const [category, label] = value.split('|||')
    const completed = statusCategories.find(c=>c.name===category)?.name?.toLowerCase() === 'completed'
    const prevLabel = task.status_label || (task.done ? 'Completed' : 'Ready to Start')
    await supabase.from('tasks').update({status_category:category, status_label:label, done:completed}).eq('id',task.id)
    const actor = resolveActorName(user, employees)
    await supabase.from('lead_notes').insert([{
      lead_id: detail.id, lead_name: detail.name,
      text: `🔄 Task status changed: "${task.title}" — ${prevLabel} → ${label}`,
      type: 'System', author: actor, created_at: new Date().toISOString()
    }])
    loadLeadTasks(detail.name)
  }

  async function addLeadSubtask(task) {
    const sectionTitle = task.section_title || task.title
    if (!task.section_title) {
      await supabase.from('tasks').update({ section_title: sectionTitle }).eq('id', task.id)
      loadLeadTasks(detail.name)
    }
    setPendingLeadSection(sectionTitle)
  }

  async function openTemplatePicker() {
    const { data } = await supabase.from('workflow_templates').select('id,name,description').in('entity_type',['lead','both']).eq('active',true).order('name')
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
    const result = await applyWorkflowTemplate(selectedTemplateIds, detail.name, actorName, 'lead')
    setApplyingTemplateId('')
    if (result?.error) { showToast('❌ ' + result.error); return }
    const names = availableTemplates.filter(t => selectedTemplateIds.includes(t.id)).map(t => t.name).join(', ')
    setTemplateModal(false)
    showToast(`✅ Applied "${names}" — ${result.count} task(s) created`)
    loadLeadTasks(detail.name)
  }

  async function addQuickLeadTask() {
    if (!leadQuickTask.trim() || !detail) return
    setAddingLeadTask(true)
    const { error } = await supabase.from('tasks').insert([{
      title: leadQuickTask.trim(), clientName: detail.name, priority: 'Normal',
      done: false, section_title: pendingLeadSection || null, created_at: new Date().toISOString()
    }])
    setAddingLeadTask(false)
    if (error) { showToast('Task error: ' + error.message); return }
    const loggedTitle = leadQuickTask.trim()
    setLeadQuickTask('')
    setPendingLeadSection('')
    loadLeadTasks(detail.name)
    showToast('✅ Task added!')
    await logAction(detail.id, detail.name, `📌 Task created: "${loggedTitle}"`)
  }

  // Sends the Service Addendum for e-signature (vs. the print-only path,
  // which stays available as a separate button in the same modal). Mirrors
  // the equivalent function in Clients.jsx — same docUtils helper, same
  // email/SMS pattern, just logs to lead_notes instead of client_notes.
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

  async function sendLeadStatePOA(lead, formDef, via) {
    setPoaSending(true)
    try {
      const actor = resolveActorName(user, employees)
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const pdfRes = await fetch(await resolveStateFormUrl(base, formDef.file))
      if (!pdfRes.ok) throw new Error('Could not load ' + formDef.state + ' POA PDF')
      const rawBytes = new Uint8Array(await pdfRes.arrayBuffer())
      const { generateStatePOAWithCover } = await import('../lib/irsFormUtils')
      const poaLead = { ...lead, business_name: lead.business_name || lead.name }
      // A state authorizes one taxpayer per form — an Individual & Biz lead
      // needs the person (SSN) and the entity (FEIN) on separate POAs.
      const parties =
        lead.clientType === 'Individual & Biz' ? ['personal','business']
        : lead.clientType === 'Business'       ? ['business']
        : ['personal']
      const safeName = (lead.name||'lead').replace(/[^a-zA-Z0-9]+/g,'-')
      const stamp = Date.now()
      const poaAttachments = []
      for (const party of parties) {
        const mergedBytes = await generateStatePOAWithCover(poaLead, rawBytes, party)
        const pdfBlob = new Blob([mergedBytes], { type: 'application/pdf' })
        const suffix = parties.length > 1 ? `_${party}` : ''
        const path = `docs/${safeName}/state-poa/${formDef.state}_POA${suffix}_${stamp}.pdf`
        const { error: upErr } = await supabase.storage.from('documents').upload(path, pdfBlob, { upsert:true, contentType:'application/pdf' })
        if (upErr) throw new Error(upErr.message)
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
        const partyLabel = parties.length > 1 ? ` (${party==='business'?'Business':'Personal'})` : ''
        poaAttachments.push({ formType:`state_poa${suffix}`, label:`${formDef.state} POA — ${formDef.label}${partyLabel}`, url:urlData?.signedUrl||'' })
      }
      const { data: esign, error: esignErr } = await supabase.from('esigns').insert([{
        doc_type: `State POA — ${formDef.state} (${formDef.num})`,
        client_name: lead.name, client_email: lead.email||'', client_phone: lead.phone||'',
        message: `Please review and sign your ${formDef.state} Power of Attorney. This authorizes ${firmName()} to represent you before the ${formDef.state} tax authority.`,
        pdf_attachments: poaAttachments,
        priority:'Normal', status:'Awaiting', sent_at:new Date().toISOString(), created_at:new Date().toISOString(), sent_by:actor,
      }]).select().single()
      if (esignErr) throw new Error(esignErr.message)
      const sigUrl = `${window.location.origin}/sign/${esign.id}?token=${encodeURIComponent(esign.signer_token || '')}`
      await navigator.clipboard.writeText(sigUrl).catch(()=>{})
      let emailSent=false, smsSent=false
      if ((via==='email'||via==='both') && lead.email) {
        const { error:eErr } = await supabase.functions.invoke('send-email', { body: { tenant_id: FIRM.tenantId || undefined, to:lead.email, subject:`Action Required: Sign Your ${formDef.state} Power of Attorney — ${FIRM.name}`, html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><div style="text-align:center;margin-bottom:20px"><img src=\"${FIRM.logoUrl}\" alt=\"${FIRM.name}\" style=\"max-height:56px;max-width:190px;object-fit:contain;display:block;margin:0 auto 8px\" onerror=\"this.style.display='none'\"/><div style="font-size:12px;font-weight:800;color:#1d4ed8;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">${FIRM.name}</div></div><p>Dear <strong>${lead.name}</strong>,</p><p>Your <strong>${formDef.state} Power of Attorney (${formDef.num})</strong> is ready for your review and signature.</p><p style="text-align:center;margin:24px 0"><a href="${sigUrl}" style="background:#1d4ed8;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">Review &amp; Sign →</a></p><p style="font-size:12px;color:#64748b">${sigUrl}</p><p style="font-size:11px;color:#94a3b8;margin-top:24px">${firmName()} · ${FIRM.address}</p></div>` }})
        emailSent = !eErr
      }
      if ((via==='sms'||via==='both') && lead.phone) {
        const cfg = await getSettings()
        if (cfg?.signalwire_backend) { try { await fetch(cfg.signalwire_backend+'/sms/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:lead.phone,body:`${firmName()}: sign your ${formDef.state} POA here: ${sigUrl}`})}); smsSent=true } catch(_){} }
      }
      await supabase.from('lead_notes').insert({ lead_id:lead.id, text:`🏛️ ${formDef.state} State POA sent for e-signature (${formDef.num})${emailSent?' via email':''}${smsSent?' via SMS':''}`, author:actor, created_at: new Date().toISOString() })
      setPoaModal(false)
      showToast(emailSent||smsSent ? `✅ ${formDef.state} POA sent for signature!` : '✅ Signing link copied to clipboard')
    } catch(e) { showToast('Error: '+e.message) }
    setPoaSending(false)
  }

  async function sendAddendum(l) {
    if (!addForm.resolutionFee) { showToast('Enter the resolution fee first'); return }
    const via = addForm.sendVia || 'email'
    if (via !== 'sms' && !l.email) { showToast('Lead has no email on file'); return }
    if (via !== 'email' && !l.phone) { showToast('Lead has no phone on file'); return }
    setAddendumSending(true)
    const actor = resolveActorName(user, employees)
    const res = await sendAddendumForSignature(l, addForm, supabase, actor)
    if (res.error) { setAddendumSending(false); showToast('Error: '+res.error); return }

    const url = res.url
    await navigator.clipboard.writeText(url).catch(()=>{})

    // Generate Stripe checkout link for resolution fee so client can pay inline
    let stripePayUrl = null
    try {
      const { data: stripeData } = await supabase.functions.invoke('stripe-create-checkout-session', {
        body: {
          recordType: 'lead', recordId: l.id, name: l.name, email: l.email,
          amount: String(addForm.resolutionFee),
          description: `Resolution Service Fee — ${l.name}`,
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

    if ((via==='email'||via==='both') && l.email) {
      const { error: eErr } = await supabase.functions.invoke('send-email', { body: { tenant_id: FIRM.tenantId || undefined,
        to: l.email,
        subject: `Action Required: Sign Your Service Addendum — ${firmName()}`,
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
    <p style="margin:0 0 16px;font-size:16px;color:#0f172a">Dear <strong>${l.name}</strong>,</p>
    <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7">Your <strong>Service Addendum</strong> is ready for your review and signature. This document authorizes ${firmName()} to proceed with the resolution services we've outlined for your case and confirms the associated service fee.</p>
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
    if ((via==='sms'||via==='both') && l.phone) {
      const cfg = await getSettings()
      if (cfg?.signalwire_backend) {
        try {
          const smsBody = stripePayUrl
            ? `${firmName()}: Step 1 – Sign Addendum: ${url}  |  Step 2 – Pay ${feeDisplay}: ${stripePayUrl}`
            : `${firmName()}: please review and sign your Service Addendum here: ${url}`
          await fetch(cfg.signalwire_backend + '/sms/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: l.phone, body: smsBody })
          })
          smsSent = true
        } catch (_) {}
      }
    }

    const feeText = `$${Number(addForm.resolutionFee).toLocaleString()}`
    const channels = [emailSent&&'email', smsSent&&'sms'].filter(Boolean).join(' + ')
    const noteContent = `📋 Service Addendum sent for e-signature — Resolution Fee ${feeText}${channels?` (${channels})`:''}`
    await supabase.from('lead_notes').insert({ lead_id: l.id, lead_name: l.name, text: noteContent, type: 'System', author: actor, created_at: new Date().toISOString() })
    await advanceLeadStatus(supabase, l.name, 'Addendum Sent')

    setAddendumSending(false)
    setAddModal(false)
    loadLeadNotes(l.id)
    showToast(emailSent||smsSent ? '✅ Addendum sent for signature!' : '⚠️ Link copied — configure email/SMS to send automatically')
  }

  async function sendLeadSms(l) {
    if (!leadSmsBody.trim()) { showToast('Message required'); return }
    if (!l.phone) { showToast('No phone number on file for this lead'); return }
    setLeadSmsSending(true)

    const toNum = '+1' + l.phone.replace(/\D/g,'').slice(-10)
    const settings = await getSettings()
    let status = 'Sent', swId = null, errMsg = null

    if (settings?.sw_space_url || myTenantId === 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae') {
      try {
        const { data: resData, error: invokeErr } = await supabase.functions.invoke('send-sms', {
          body: { to: toNum, body: leadSmsBody, lead_id: l.id || null, user_id: user?.id || null }
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
        clientName: l.name, phone: toNum, body: leadSmsBody, status,
        signalwire_sms_id: swId, sent_by: actor, error_msg: errMsg,
        created_at: new Date().toISOString(),
      }]))
    }
    setLeadSmsSending(false)
    if (error) { showToast('Error: '+error.message); return }

    if (status === 'Sent') { showToast('✅ Text sent!'); await triggerWorkflow('lead_sms_sent', 'lead', l?.name || '', actor).catch(()=>{}) }
    else if (status === 'Failed') showToast('SignalWire error: ' + (errMsg||'send failed'))
    else showToast('Logged — add SignalWire credentials in Settings to actually send')

    const noteContent = `💬 Text sent: "${leadSmsBody.length > 120 ? leadSmsBody.slice(0,120)+'…' : leadSmsBody}"`
    await supabase.from('lead_notes').insert({ lead_id: l.id, lead_name: l.name, text: noteContent, type: 'System', author: actor, created_at: new Date().toISOString() })

    setLeadSmsBody('')
    loadLeadSms(l.name)
  }

  async function addLeadNote() {
    if (!newLeadNote.trim() || !detail) return
    setAddingLeadNote(true)
    const { error } = await supabase.from('lead_notes').insert([{
      lead_id: detail.id,
      lead_name: detail.name,
      text: newLeadNote.trim(),
      type: noteType,
      author: resolveActorName(user, employees),
      created_at: new Date().toISOString()
    }])
    setAddingLeadNote(false)
    if (error) { showToast('Error: ' + error.message); return }
    setNewLeadNote('')
    loadLeadNotes(detail.id)
    showToast('Note added!')
  }

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(''),3000) }
  function fld(k,v) { setForm(f=>({...f,[k]:v})) }

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
  // Tab buttons swap content of different heights, which lets the browser
  // naturally clamp .page-content's scroll position toward the top. Capture
  // it before the switch and lock it back using a MutationObserver, which
  // reapplies on every DOM change rather than guessing fixed delays --
  // a fixed-timing reapply schedule wasn't reliably catching whatever
  // resets scroll (browser scroll anchoring, async content settling, or
  // both), so this reacts to actual content changes instead.
  function switchLeadTab(tab) {
    const el = document.querySelector('.page-content')
    const y = el ? el.scrollTop : 0
    setLeadDetailTab(tab)
    if (!el) return
    let active = true
    const reapply = () => { if (active) el.scrollTop = y }
    reapply()
    const observer = new MutationObserver(reapply)
    observer.observe(el, { childList: true, subtree: true, attributes: true })
    setTimeout(() => { active = false; observer.disconnect() }, 1000)
  }
  function composeName(first,mi,last) { return [first, mi?mi+'.':'', last].filter(Boolean).join(' ').replace(/\s+/g,' ').trim() }
  // `name` is the record's identity key — notes, documents, e-signs and
  // compliance records are all matched on it as text. So whenever the lead has
  // a human behind it, `name` is that PERSON and the entity lives in its own
  // business_name column. Only a pure Business lead mirrors the entity into
  // `name`, because there is no person to name.
  function resolveLeadName(f) {
    const personal = composeName(f.first, f.mi, f.last)
    if (f.clientType === 'Business') return f.business_name || personal
    return personal || f.business_name || ''
  }
  function fldClientType(v) { setForm(f=>{ const n={...f, clientType:v}; return {...n, name: resolveLeadName(n)} }) }
  function fldFirst(v) { setForm(f=>{ const n={...f, first:v}; return {...n, name: resolveLeadName(n)} }) }
  function fldMi(v)    { setForm(f=>{ const n={...f, mi:v};    return {...n, name: resolveLeadName(n)} }) }
  function fldLast(v)  { setForm(f=>{ const n={...f, last:v};  return {...n, name: resolveLeadName(n)} }) }
  function fldBizName(v){ setForm(f=>{ const n={...f, business_name:v}; return {...n, name: resolveLeadName(n)} }) }
  function toggleYear(y) { setForm(f=>({...f, taxYears: f.taxYears.includes(y)?f.taxYears.filter(x=>x!==y):[...f.taxYears,y]})) }

  const pipelineOptions = ['All', ...Array.from(new Set(leads.map(l => l.pipelineStage).filter(Boolean))).sort()]
  const filtered = leads
    .filter(l => showArchived ? !!l.archived : !l.archived)
    // A converted lead now lives in Clients — it stays out of the working pool
    // unless you deliberately filter for that status.
    .filter(l => filter === 'Converted to Client' || l.status !== 'Converted to Client')
    .filter(l => filter === 'All' || l.status === filter)
    .filter(l => repFilter === 'All' || (repFilter === 'Unassigned' ? !l.assignedTo : l.assignedTo === repFilter))
    .filter(l => filterPipeline === 'All' || (l.pipelineStage||'') === filterPipeline)
    .filter(l => {
      if (!leadSearch.trim()) return true
      const q = leadSearch.toLowerCase()
      return (
        (l.name||'').toLowerCase().includes(q) ||
        (l.email||'').toLowerCase().includes(q) ||
        (l.phone||'').replace(/\D/g,'').includes(q.replace(/\D/g,'')) ||
        (l.business_name||'').toLowerCase().includes(q) ||
        (l.spouseName||'').toLowerCase().includes(q) ||
        (l.city||'').toLowerCase().includes(q) ||
        (l.assignedTo||'').toLowerCase().includes(q) ||
        (l.taxAssociate||'').toLowerCase().includes(q) ||
        (l.ssn||'').replace(/-/g,'').includes(q.replace(/-/g,''))
      )
    })

  const sortedFiltered = [...filtered].sort((a, b) => {
    let av, bv
    if (sortCol === 'name')         { av = a.name||''; bv = b.name||'' }
    else if (sortCol === 'type')    { av = a.clientType||''; bv = b.clientType||'' }
    else if (sortCol === 'issue')   { av = a.issueType||''; bv = b.issueType||'' }
    else if (sortCol === 'balance') { av = a.irsBalance||''; bv = b.irsBalance||'' }
    else if (sortCol === 'source')  { av = a.source||''; bv = b.source||'' }
    else if (sortCol === 'status')  { av = a.status||''; bv = b.status||'' }
    else if (sortCol === 'assigned'){ av = a.assignedTo||''; bv = b.assignedTo||'' }
    else                            { av = a.name||''; bv = b.name||'' }
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  })

  async function save() {
    if (form.clientType !== 'Business' && !composeName(form.first,form.mi,form.last)) {
      showToast('First and last name are required'); return
    }
    if (form.clientType !== 'Individual' && !(form.business_name||'').trim()) {
      showToast('Business name is required'); return
    }
    if (!form.name.trim()) { showToast('Name is required'); return }
    // Never let the generic lead editor manufacture a "converted" status.
    // Conversion must go through convertToClient(), which creates the client.
    if (modal === 'edit' && form.status === 'Converted to Client') {
      const original = leads.find(l=>l.id===form.id)
      if (original?.status !== 'Converted to Client') {
        showToast('Use Convert to Client so the client record is created.')
        return
      }
    }
    setSaving(true)
    const actor = resolveActorName(user, employees)
    const beforeEdit = modal === 'edit' ? leads.find(l=>l.id===form.id) : null
    let payload = { ...form, taxYears: JSON.stringify(form.taxYears), filingRequirements: JSON.stringify(form.filingRequirements||[]), services: JSON.stringify(form.services||[]) }
    // Empty-string values blow up non-text columns (date, numeric) with
    // "invalid input syntax" — Postgres wants null for "no value", not ''.
    Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })
    let error
    let oldName = null
    if (modal === 'edit') {
      const { id, created_at, ...rest } = payload
      payload = rest
      oldName = detail?.name
    } else {
      payload.created_at = new Date().toISOString()
    }
    // Self-healing save: if Postgres/PostgREST reports an unknown column,
    // strip it and retry so one missing field doesn't block the whole save.
    const skipped = []
    for (let attempt = 0; attempt < 12; attempt++) {
      if (modal === 'edit') {
        ;({ error } = await supabase.from('leads').update(payload).eq('id', form.id))
      } else {
        ;({ error } = await supabase.from('leads').insert([payload]))
      }
      if (!error) break
      const match = error.message?.match(/column ['"]?(\w+)['"]? (of relation .* )?does not exist/i)
        || error.message?.match(/Could not find the '(\w+)' column/i)
      if (match && match[1] in payload) {
        const { [match[1]]: _, ...rest } = payload
        payload = rest
        skipped.push(match[1])
        continue
      }
      break
    }
    setSaving(false)
    if (error) { showToast('Error: '+error.message); return }
    if (skipped.length) showToast(`✅ Saved — but these fields aren't set up in the database yet and were skipped: ${skipped.join(', ')}`)
    // If the name changed, repoint any compliance records gathered under the old name
    // so they don't get orphaned (compliance is stored keyed by client_name text).
    if (oldName && oldName !== form.name) {
      await supabase.from('client_compliance_records').update({ client_name: form.name }).eq('client_name', oldName)
    }
    if (!skipped.length) { showToast(modal==='edit' ? '✅ Lead updated!' : '✅ Lead added!'); if (modal !== 'edit') { await triggerWorkflow('lead_created', 'lead', form.name, actor); const _a=getActor(user); await logActivity(supabase,{employeeName:_a.name,employeeEmail:_a.email,action:'lead_created',category:'lead',description:`Added lead: ${form.name}`,entityName:form.name,meta:{status:form.status||'New Lead'}}) } else { const _a=getActor(user); await logActivity(supabase,{employeeName:_a.name,employeeEmail:_a.email,action:'lead_updated',category:'lead',description:`Updated lead: ${form.name}`,entityName:form.name}) } }
    setModal(false); setForm(BLANK)
    if (modal === 'edit' && detail) {
      const { data } = await supabase.from('leads').select('*').eq('id', form.id).single()
      if (data) setDetail(data)
      load()
      if (data && beforeEdit) {
        const changes = summarizeLeadFieldChanges(beforeEdit, data)
        if (changes.length) await logAction(data.id, data.name, `✏️ Updated: ${changes.join(', ')}`)
      }
    } else {
      // New lead — reload then navigate straight into the detail view
      const { data: allLeads } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
      if (allLeads) setLeads(allLeads)
      const newest = allLeads?.find(l => l.name === form.name)
      if (newest) {
        const bizSuffix = newest.business_name && newest.business_name !== newest.name
          ? ` — ${newest.business_name}` : ''
        await logAction(newest.id, newest.name, `🆕 Lead created${bizSuffix} (${newest.clientType||'Individual'})`)
        setDetail(newest); loadLeadNotes(newest.id); navigate('/leads/' + newest.id, { replace: false })
      }
    }
  }

  // Leads are archived, never permanently deleted — this hides them from the
  // active list but keeps every field, note, and document intact.
  async function archiveLead(l) { setConfirmArchive(l) }
  async function confirmArchiveLead() {
    const l = confirmArchive; setConfirmArchive(null)
    const actor = resolveActorName(user, employees)
    const { error } = await supabase.from('leads').update({ archived: true, deleted_at: new Date().toISOString() }).eq('id', l.id)
    if (error) { showToast('Error: ' + error.message); return }
    await logAction(l.id, l.name, '🗄️ Lead archived')
    // Update local state immediately — no refresh needed
    setLeads(prev => prev.map(lead => lead.id === l.id ? { ...lead, archived: true } : lead))
    setDetail(null)
    navigate('/leads', { replace: true })
    showToast('Lead archived')
    await triggerWorkflow('lead_archived', 'lead', l.name || '', actor)
    await logActivity(supabase,{employeeName:actor,action:'lead_archived',category:'lead',description:`Archived lead: ${l.name}`,entityName:l.name})
  }

  async function restoreLead(l) {
    const { error } = await supabase.from('leads').update({ archived: false, deleted_at: null }).eq('id', l.id)
    if (error) { showToast('Error: ' + error.message); return }
    await logAction(l.id, l.name, '📤 Lead restored from archive')
    showToast('Lead restored'); load()
  }

  async function updateStatus(l, status) {
    if (status === l.status) return
    // "Converted to Client" is not an ordinary lead status. It must create the
    // client row and complete the conversion workflow atomically through the
    // dedicated conversion path. Allowing a plain status update here creates
    // orphaned "converted" leads with no client record.
    if (status === 'Converted to Client') {
      await convertToClient(l)
      return
    }
    const prevStatus = l.status || 'New Lead'
    const willArchive = AUTO_ARCHIVE_STATUSES.includes(status) && !l.archived
    const willRestore = !AUTO_ARCHIVE_STATUSES.includes(status) && AUTO_ARCHIVE_STATUSES.includes(prevStatus) && l.archived
    const payload = { status }
    if (willArchive) payload.archived = true
    if (willRestore) payload.archived = false
    const { error } = await supabase.from('leads').update(payload).eq('id', l.id)
    if (error) { showToast('Error: ' + error.message); return }
    const actor = resolveActorName(user, employees)
    const noteText = willArchive
      ? `📊 Status changed: ${prevStatus} → ${status} (auto-archived)`
      : willRestore
        ? `📊 Status changed: ${prevStatus} → ${status} (auto-restored from archive)`
        : `📊 Status changed: ${prevStatus} → ${status}`
    const { error: noteErr } = await supabase.from('lead_notes').insert([{
      lead_id: l.id, lead_name: l.name,
      text: noteText,
      type: 'System', author: actor, created_at: new Date().toISOString()
    }])
    if (noteErr) showToast('Status updated, but failed to log note: ' + noteErr.message)

    // Pipeline trigger tasks
    // Moving to "Tax Investigation Active" creates nothing here: the whole
    // investigation task set lives in the Tax Investigation workflow templates,
    // editable from the Workflows page. This used to insert its own "Call IRS"
    // and "Review financial intake" pair, which duplicated template steps and
    // meant the same checklist was maintained in two places.
    // "IRS Facts Received" still notifies the original tax advisor.
    if (status === 'IRS Facts Received') {
      // Notify the original tax advisor who sold this lead
      const advisor = l.assignedTo || actor
      const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 1)
      const dueDateStr = dueDate.toISOString().slice(0, 10)
      await supabase.from('tasks').insert([{
        title: `📋 Review IRS results with ${l.name} — go over findings`,
        clientName: l.name,
        priority: 'High',
        dueDate: dueDateStr,
        done: false,
        assignedTo: advisor,
        notes: 'IRS/State investigation is complete. Review the Compliance tab for the results and call the client to go over what the IRS has on file and the proposed resolution.',
        created_at: new Date().toISOString(),
      }])
      showToast(`Status updated — task created for ${advisor} to review IRS results`)
    } else {
      showToast(willArchive ? 'Status updated — lead archived' : willRestore ? 'Status updated — lead restored' : 'Status updated!')
    }

    // ── Workflow engine — fires alongside hardcoded triggers ──
    await triggerWorkflow('lead_status_changed', 'lead', l.name, actor, status)

    load()
    if (detail?.id === l.id) loadLeadNotes(l.id)
  }

  async function backfillFromIntake(l) {
    setBackfillingIntake(true)
    try {
      const { data: rec, error } = await supabase
        .from('financial_intake_responses')
        .select('answers')
        .eq('client_name', l.name)
        .eq('status', 'Submitted')
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !rec) { showToast('No submitted intake found for this lead'); return }
      const a = rec.answers
      const n = v => parseFloat(v) || 0
      // Intake collects display labels; the profile's Assets & Equity tab
      // keys off specific internal type strings.
      const assetTypeToProfile = label => ({
        'Bank Account': 'bank_account',
        'Retirement Account (401k/IRA)': 'retirement',
        'Life Insurance (cash value)': 'life_insurance',
        'Business Asset': 'business_asset',
        'Other': 'additional_asset',
      }[label] || 'additional_asset')
      const jobs = a.jobs_list || []
      const myJobs = jobs.filter(j => j.whose_job !== "My Spouse's")
      const spouseJobs = jobs.filter(j => j.whose_job === "My Spouse's")
      function mapJob(j) {
        if (!j) return {}
        return { employer: j.employer||'', position: j.position||'', length_employed: j.length_employed||'',
          pay_frequency: j.pay_frequency||'', gross_monthly_salary: n(j.gross_monthly),
          fed_withheld: n(j.fed_withheld), ss_med_withheld: n(j.ss_med_withheld), state_withheld: n(j.state_withheld) }
      }
      const businesses = a.business_list || []
      function mapBiz(b) {
        if (!b) return {}
        return { name: b.business_name||'', ein: b.ein||'', structure: b.structure||'',
          pct_ownership: b.pct_ownership||'', num_employees: b.num_employees||'',
          net_income: n(b.net_income_monthly), notes: b.notes||'' }
      }
      const otherIncome = (a.other_income_list||[]).map(r => ({ source: r.source||'', amount: n(r.monthly_amount) }))
      const realEstate = (a.real_estate_list||[]).map(r => ({
        address: r.address||'', property_type: r.property_type||'',
        zillow_value: n(r.estimated_value), mortgage_balance: n(r.mortgage_balance),
        mortgage_1: n(r.monthly_payment), rental_income: n(r.rental_income)
      }))
      const vehicles = (a.vehicles_list||[]).map(v => ({
        make_model: v.make_model||'', kbb_value: n(v.estimated_value),
        remaining_balance: n(v.remaining_balance), monthly_payment: n(v.monthly_payment)
      }))
      const assets = (a.assets_list||[]).map(asset => ({
        type: assetTypeToProfile(asset.asset_type), description: asset.description||'',
        value: n(asset.value), loan_against: n(asset.loan_against)
      }))
      const creditCards = (a.credit_cards_list||[]).map(c => ({
        name: c.card_name||'', balance: n(c.balance),
        limit: n(c.credit_limit), min_payment: n(c.min_payment)
      }))
      // Per-loan entries roll up into the profile's single Other Secured Debt
      // block, but the type breakdown is kept so the associate can see what the
      // debt actually is. Falls back to the old flat fields for intakes that
      // were filled in before the per-loan split.
      const debtRows = (a.other_debt_list || []).filter(r => r && (r.monthly_payment || r.remaining_balance || r.loan_type))
      const otherSecuredDebt = a.has_other_debt === 'Yes'
        ? (debtRows.length
            ? {
                monthly_payment: debtRows.reduce((t, r) => t + n(r.monthly_payment), 0),
                remaining_balance: debtRows.reduce((t, r) => t + n(r.remaining_balance), 0),
                breakdown: debtRows.map(r => ({
                  loan_type: r.loan_type || 'Other',
                  lender: r.lender || '',
                  monthly_payment: n(r.monthly_payment),
                  remaining_balance: n(r.remaining_balance),
                })),
              }
            : { monthly_payment: n(a.other_debt_payment), remaining_balance: n(a.other_debt_balance) })
        : {}
      const expenses = {
        food_clothing: n(a.food_clothing), housing: n(a.housing_payment),
        homeowners_insurance: n(a.homeowners_renters_insurance), property_taxes: n(a.property_taxes),
        hoa_dues: n(a.hoa_dues), electricity: n(a.electricity), water_sewer_trash: n(a.water_sewer_trash),
        cell_phone: n(a.cell_phone), internet: n(a.internet), cable: n(a.cable),
        maintenance: n(a.maintenance), public_transportation: n(a.public_transportation),
        car_misc: n(a.car_misc), health_major_medical: n(a.health_insurance),
        health_dental: n(a.health_dental_vision), health_oop: n(a.health_oop),
        child_care: n(a.child_care), child_support: n(a.child_support),
        court_judgment: n(a.court_judgment), life_term: n(a.life_insurance),
        irs_installment: n(a.irs_installment), state_installment: n(a.state_installment),
      }
      const profileData = {
        client_name: l.name,
        dob: a.dob || null, county: a.county||'', filing_status: a.filing_status||'',
        household_under_65: n(a.household_under_65), household_over_65: n(a.household_over_65),
        tax_years_not_filed: a.tax_years_not_filed||'', has_lived_other_states: a.lived_other_states||'',
        other_states_notes: a.other_states_notes||'',
        employment_taxpayer_1: myJobs[0] ? mapJob(myJobs[0]) : undefined,
        employment_taxpayer_2: myJobs[1] ? mapJob(myJobs[1]) : undefined,
        employment_spouse_1: spouseJobs[0] ? mapJob(spouseJobs[0]) : undefined,
        employment_spouse_2: spouseJobs[1] ? mapJob(spouseJobs[1]) : undefined,
        business_1: businesses[0] ? mapBiz(businesses[0]) : undefined,
        business_2: businesses[1] ? mapBiz(businesses[1]) : undefined,
        other_income: otherIncome.length ? otherIncome : undefined,
        real_estate: realEstate.length ? realEstate : undefined,
        vehicles: vehicles.length ? vehicles : undefined,
        assets: assets.length ? assets : undefined,
        cash_on_hand: n(a.cash_on_hand),
        credit_cards: creditCards.length ? creditCards : undefined,
        other_secured_debt: Object.keys(otherSecuredDebt).length ? otherSecuredDebt : undefined,
        expenses,
        updated_at: new Date().toISOString(),
      }
      const cleanProfile = Object.fromEntries(Object.entries(profileData).filter(([,v]) => v !== undefined))
      const { error: upsertErr } = await supabase.from('client_financial_profiles').upsert(cleanProfile, {
        onConflict: 'client_name', ignoreDuplicates: false
      })
      if (upsertErr) { showToast('Error syncing profile: ' + upsertErr.message) }
      else { showToast('✅ Financial Profile populated from intake!') }
    } catch (e) { showToast('Error: ' + e.message) }
    finally { setBackfillingIntake(false) }
  }

  async function sendFinancialIntake(l) {
    if (!l.email) { showToast('No email on file for this lead'); return }
    setIntakeSending(true)
    let intakeId
    const { data: existing } = await supabase.from('financial_intake_responses')
      .select('id').eq('client_name', l.name).order('created_at',{ascending:false}).limit(1).maybeSingle()
    if (existing) {
      intakeId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase.from('financial_intake_responses').insert([{
        client_name: l.name, client_email: l.email || '', status: 'Sent',
        answers: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }]).select().single()
      if (createErr) { setIntakeSending(false); showToast('Error: '+createErr.message); return }
      intakeId = created.id
    }
    const intakeUrl = window.location.origin + '/financial-intake/' + intakeId
    const { error: emailErr } = await supabase.functions.invoke('send-email', {
      body: { tenant_id: FIRM.tenantId || undefined,
        to: l.email,
        subject: `Your Financial Intake Form — ${firmName()}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><div style="text-align:center;margin-bottom:20px"><img src=\"${FIRM.logoUrl}\" alt=\"${FIRM.name}\" style=\"max-height:56px;max-width:190px;object-fit:contain;display:block;margin:0 auto 8px\" onerror=\"this.style.display='none'\"/><div style="font-size:12px;font-weight:800;color:#1d4ed8;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">${FIRM.name}</div></div><p>Dear <strong>${l.name}</strong>,</p><p>Here's your link to fill out (or finish) your financial intake form — it takes about 10-15 minutes and your progress saves automatically.</p><p style="text-align:center;margin:24px 0"><a href="${intakeUrl}" style="background:#1d4ed8;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Start My Financial Intake</a></p><p style="font-size:12px;color:#64748b">Link: ${intakeUrl}</p><p style="font-size:11px;color:#94a3b8;margin-top:24px">${firmName()} · ${FIRM.address}</p></div>`
      }
    })
    setIntakeSending(false)
    // The intake record + link are already created regardless of email —
    // if the office hasn't connected Gmail yet (or the send fails for any
    // other reason), don't dead-end on an error: copy the link so the rep
    // can still hand it to the client, and say plainly why the email didn't
    // go out. This surfaced because a real tenant-isolation fix made the
    // demo's own (unconnected) Gmail state visible instead of silently
    // routing through TCR's — correct behavior, just needs to degrade
    // gracefully instead of erroring.
    if (emailErr) {
      try { await navigator.clipboard.writeText(intakeUrl) } catch (_) {}
      showToast(`Link copied — email not sent (Gmail isn't connected for this office yet). Share it manually: ${intakeUrl}`)
      await logAction(l.id, l.name, `📊 Financial Intake link created (email not sent — Gmail not connected)`)
      return
    }
    showToast('✅ Financial Intake link sent to '+l.email)
    await logAction(l.id, l.name, `📊 Financial Intake link sent to ${l.email}`)
  }

  async function handleSendFullPackage(l) {
    if (!l.email && !l.phone) { showToast('Lead needs an email or phone to send the package.'); return }
    const taxFeeAmt = parseFloat(l.taxFee)
    if (!taxFeeAmt || taxFeeAmt <= 0) {
      showToast('Set the Tax Investigation Fee on this lead before sending the package.')
      return
    }
    setPkgSending(true)
    const res = await sendFullPackage({...l, address:l.street, business_name:l.business_name||l.name}, supabase)
    if (res.error) { setPkgSending(false)
      const _pa=getActor(user); await logActivity(supabase,{employeeName:_pa.name,employeeEmail:_pa.email,action:'package_sent',category:'esign',description:`Sent Tax Inv Package to: ${l.name}`,entityName:l.name}).catch(()=>{}); showToast('Error: '+res.error); return }

    const url = res.url
    await navigator.clipboard.writeText(url).catch(()=>{})

    // Find or create the financial intake record and use its real ID
    let intakeId = null
    try {
      const { data: existingIntake } = await supabase.from('financial_intake_responses')
        .select('id').eq('client_name', l.name).order('created_at',{ascending:false}).limit(1).maybeSingle()
      if (existingIntake) {
        intakeId = existingIntake.id
      } else {
        const { data: newIntake } = await supabase.from('financial_intake_responses').insert([{
          client_name: l.name, client_email: l.email || '', status: 'Sent',
          answers: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }]).select().single()
        if (newIntake) intakeId = newIntake.id
      }
    } catch(e) { console.error('Intake record lookup error:', e) }
    const intakeUrl = intakeId
      ? `${window.location.origin}/financial-intake/${intakeId}`
      : `${window.location.origin}/financial-intake/${l.id}`

    // Generate Stripe Checkout link for the 1st Trade investigation fee
    let stripePayUrl = null
    try {
      const { data: stripeData, error: stripeErr } = await supabase.functions.invoke('stripe-create-checkout-session', {
        body: {
          recordType: 'lead',
          recordId: l.id,
          name: l.name,
          email: l.email,
          amount: String(taxFeeAmt),
          description: 'Tax Investigation Fee — 1st Trade',
          purpose: 'investigation_fee',
        }
      })
      if (!stripeErr && stripeData?.url) stripePayUrl = stripeData.url
    } catch(e) { console.error('Stripe link error:', e) }
    let smsSent=false,emailSent=false
    const cfg = await getSettings()

    if(l.email){
      try{
        const paymentSection = stripePayUrl ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.06em">💳 Step 2 — Pay Your Investigation Fee</p>
      <p style="margin:0 0 14px;font-size:14px;color:#15803d;line-height:1.6">Your Tax Investigation Fee of <strong>$${Number(taxFeeAmt).toLocaleString()}</strong> is due to begin your case. Pay securely below — your card will be saved on file for future billing.</p>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
        <a href="${stripePayUrl}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:-.01em;box-shadow:0 4px 14px rgba(14,165,233,.35)">Pay $${Number(taxFeeAmt).toLocaleString()} Now →</a>
      </td></tr></table>
    </div>` : ''
        const{error:eErr}=await supabase.functions.invoke('send-email',{body:{ tenant_id: FIRM.tenantId || undefined,
          to:l.email,
          subject:`Action Required: Sign & Pay — ${firmName()} Investigation Package`,
          html:`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%);padding:32px 40px;text-align:center">
    <img src="${FIRM.logoUrl}" alt="${FIRM.name}" style="max-height:60px;max-width:240px;object-fit:contain" onerror="this.style.display='none'"/>
    <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:12px;letter-spacing:-.02em">${FIRM.name}</div>
    <div style="font-size:12px;color:#93c5fd;margin-top:4px;letter-spacing:.08em;text-transform:uppercase">IRS Resolution Services</div>
  </td></tr>
  <tr><td style="padding:40px 40px 32px">
    <p style="margin:0 0 16px;font-size:16px;color:#0f172a">Dear <strong>${l.name}</strong>,</p>
    <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7">Your <strong>Tax Investigation Package</strong> is ready. Please complete both steps below to get started — it only takes a few minutes.</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:20px 24px;margin:0 0 20px">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.06em">📋 Step 1 — Review &amp; Sign Your Documents</p>
      <p style="margin:0 0 10px;font-size:14px;color:#334155;line-height:1.6">This package includes:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px">
        <tr><td style="padding:5px 0;border-bottom:1px solid #dbeafe;font-size:14px;color:#334155">📋 &nbsp;<strong>Tax Service Agreement</strong> — outlines the scope of our representation</td></tr>
        <tr><td style="padding:5px 0;border-bottom:1px solid #dbeafe;font-size:14px;color:#334155">📄 &nbsp;<strong>Form 2848 — Power of Attorney</strong> — authorizes us to speak with the IRS on your behalf</td></tr>
        <tr><td style="padding:5px 0;font-size:14px;color:#334155">📄 &nbsp;<strong>Form 8821 — Tax Information Authorization</strong> — allows us to access your IRS transcripts</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
        <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:-.01em;box-shadow:0 4px 14px rgba(22,163,74,.35)">Review &amp; Sign Package →</a>
      </td></tr></table>
    </div>
    ${paymentSection}
    <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-align:center">Sign link: <a href="${url}" style="color:#3b82f6">${url}</a></p>
    ${stripePayUrl?`<p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-align:center">Can't click the button above? <a href="${stripePayUrl}" style="color:#0ea5e9">Click here to pay</a></p>`:''}
    <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:10px;padding:20px 24px;margin:0 0 24px">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#7e22ce;text-transform:uppercase;letter-spacing:.06em">📋 Step 3 — Complete Your Financial Intake</p>
      <p style="margin:0 0 14px;font-size:14px;color:#6b21a8;line-height:1.6">To build your resolution strategy, your advisor needs a picture of your current finances. This takes about 10 minutes and your progress saves automatically.</p>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
        <a href="${intakeUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:-.01em;box-shadow:0 4px 14px rgba(124,58,237,.35)">Start Financial Intake →</a>
      </td></tr></table>
      <p style="margin:12px 0 0;font-size:11px;color:#94a3b8;text-align:center">Financial Intake link: <a href="${intakeUrl}" style="color:#7c3aed">${intakeUrl}</a></p>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;border-left:4px solid #3b82f6;margin-bottom:8px">
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.6">💬 <strong>Questions?</strong> Don't hesitate to reach out. We're here every step of the way.<br>📞 <strong>${FIRM.phone}</strong> &nbsp;·&nbsp; ✉️ <strong>${firmEmail()}</strong></p>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.8">${firmName()} &nbsp;·&nbsp; ${FIRM.address}<br>This email was sent regarding your active tax resolution case.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
        }})
        if(!eErr)emailSent=true
      }catch(e){console.error('Email error:',e)}
    }
    if(l.phone&&cfg?.signalwire_backend){
      try{
        const smsBody = stripePayUrl
          ? `Hi ${l.name}, ${firmName()} sent your Investigation Package. Step 1 – Sign: ${url}  |  Step 2 – Pay $${Number(taxFeeAmt).toLocaleString()}: ${stripePayUrl}  |  Step 3 – Financial Intake: ${intakeUrl}`
          : `Hi ${l.name}, ${firmName()} sent you a Tax Investigation Package to review and sign: ${url}  |  Financial Intake: ${intakeUrl}`
        const r=await fetch(cfg.signalwire_backend+'/sms/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:l.phone,body:smsBody})})
        const d=await r.json();if(d.success)smsSent=true
      }catch(e){console.error('SMS error:',e)}
    }

    setPkgSending(false)
    const sent=[emailSent&&`email to ${l.email}`,smsSent&&`SMS to ${l.phone}`].filter(Boolean)
    showToast(sent.length?`Package sent via ${sent.join(' & ')}!`:'Package created — link copied (configure email/SMS in Settings to auto-send).')
    await logAction(l.id, l.name, `📦 Full Package sent for e-signature — Form 2848/8821 + Service Agreement + $${Number(taxFeeAmt).toLocaleString()} investigation fee${sent.length?` (${sent.join(' & ')})`:' (link copied)'}`)
    const _fa=getActor(user); await logActivity(supabase,{employeeName:_fa.name,employeeEmail:_fa.email,action:'package_sent',category:'esign',description:`Sent Full Package to: ${l.name}`,entityName:l.name,entityId:l.id}).catch(()=>{})
    await advanceLeadStatus(supabase, l.name, 'Tax Inv Agreement Sent')
    load()
  }

  async function convertToClient(l, skipConfirm) {
    if (converting) return
    const clientName = (l.name || '').trim()
    if (!clientName) { showToast('Lead name is required before conversion.'); return }
    if (!skipConfirm && !confirm(`Convert "${clientName}" to a full client?`)) return
    setConverting(true)
    // A second conversion of the same lead (double-click, or the resolution-fee
    // path firing alongside the button) used to insert a duplicate client.
    // Clients are keyed by name everywhere, so a duplicate splits the file.
    const candidateNames = Array.from(new Set([l.name, clientName].filter(Boolean)))
    const { data: dupe } = await supabase.from('clients').select('id,name').in('name', candidateNames).limit(1)
    if (dupe?.length) {
      setConverting(false)
      showToast(`${l.name} is already a client — opening their file`)
      await supabase.from('leads').update({ status: 'Converted to Client' }).eq('id', l.id)
      navigate('/clients/' + dupe[0].id)
      return
    }
    const taxYearsStr = l.taxYearsCustom || (()=>{try{return JSON.parse(l.taxYears||'[]').join(', ')}catch{return l.taxYears||''}})()
    const { data: newClient, error } = await supabase.from('clients').insert([{
      name: clientName, clientType: l.clientType || 'Individual',
      business_name: (l.business_name || '').trim() || null,
      first: l.first, mi: l.mi, last: l.last,
      phone: l.phone, phone2: l.phone2, email: l.email,
      smsConsent: l.smsConsent || false, smsConsentDate: l.smsConsentDate || null,
      ssn: l.ssn, ein: l.ein, dob: l.dob,
      spouseName: l.spouseName, spouseSsn: l.spouseSsn, spouseDob: l.spouseDob, filingStatus: l.filingStatus,
      stripe_customer_id: l.stripe_customer_id,
      default_payment_method_id: l.default_payment_method_id,
      payment_method_type: l.payment_method_type,
      payment_method_brand: l.payment_method_brand,
      payment_method_last4: l.payment_method_last4,
      street: l.street, city: l.city, state: l.state, zip: l.zip, county: l.county,
      // Conversion follows a completed investigation and transcript pull —
      // that's what the whole signed-package flow was — so the case pipeline
      // opens at Analysis rather than restarting at Investigation.
      pipelineStage: 'analysis',
      biz_street: l.biz_street || null, biz_city: l.biz_city || null,
      biz_state: l.biz_state || null, biz_zip: l.biz_zip || null,
      source: l.source, assignedTo: l.assignedTo, taxAssociate: l.taxAssociate || null,
      irsBalance: l.irsBalance, stateBalance: l.stateBalance, issueType: l.issueType, irsOrState: l.irsOrState,
      irsStatus: l.irsStatus, irsStatusOther: l.irsStatusOther, irsDeadline: l.irsDeadline || null,
      stateStatus: l.stateStatus, stateStatusOther: l.stateStatusOther, stateDeadline: l.stateDeadline || null,
    
      filingRequirements: l.filingRequirements,
      taxYears: taxYearsStr,
      services: (() => {
        if (Array.isArray(l.services)) return l.services
        try { return JSON.parse(l.services || '[]') } catch { return [] }
      })(),
      salesRep: l.salesRep || null,
      contractFee: l.contractFee || null,
      trade1Amount: l.trade1Amount || null, trade1Date: l.trade1Date || null,
      trade2Amount: l.trade2Amount || null, trade2Date: l.trade2Date || null,
      trade3Amount: l.trade3Amount || null, trade3Date: l.trade3Date || null,
      notes: l.notes, status: 'Active',
      clientSince: new Date().toISOString().slice(0,10),
      created_at: new Date().toISOString()
    }]).select().single()
    if (error) { showToast('Error: '+error.message); setConverting(false); return }
    // Everything from here is follow-up work on an already-committed client
    // row. It runs inside a try so a failure in any one step can't strand the
    // UI on the lead page with the client invisible until a manual refresh.
    try {
    // Re-point every saved card on the lead to the new client record — the
    // multi-card list (and split payment) would otherwise show empty for a
    // client that arrived with cards already on file as a lead.
    await supabase.from('payment_methods').update({
      record_type: 'client', record_id: newClient.id,
    }).eq('record_type', 'lead').eq('record_id', l.id)
    // Update lead status
    await supabase.from('leads').update({ status: 'Converted to Client' }).eq('id', l.id)
    // Carry lead notes over to the new client record so case history isn't lost
    const { data: oldNotes } = await supabase.from('lead_notes').select('*').eq('lead_id', l.id)
    if (oldNotes && oldNotes.length) {
      await supabase.from('client_notes').insert(
        oldNotes.map(n => ({ clientname: l.name, text: n.text, author: n.author || 'Staff', created_at: n.created_at }))
      )
    }
    // Auto-create the 3 onboarding tasks now that contracts are signed
    const today = new Date()
    const addDays = n => { const d = new Date(today); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10) }
    await supabase.from('tasks').insert([
      { title: `Email IRS POA — ${l.name}`,        clientName: l.name, priority: 'High', dueDate: addDays(0), done: false, created_at: new Date().toISOString() },
      { title: `Call IRS — ${l.name}`,             clientName: l.name, priority: 'High', dueDate: addDays(1), done: false, created_at: new Date().toISOString() },
      { title: `Schedule ${FIRM.name || 'CRM'} call — ${l.name}`, clientName: l.name, priority: 'Normal', dueDate: addDays(3), done: false, created_at: new Date().toISOString() },
    ])
    // Auto-create a case for the new client with Associate + Para assigned
    await supabase.from('cases').insert([{
      id: 'case-' + newClient.id,
      clientName: l.name,
      clientid: newClient.id,
      caseType: l.issueType || 'Tax Resolution',
      irsBalance: l.irsBalance || null,
      assignedTo: l.assignedTo || null,
      taxAssociate: l.taxAssociate || null,
      status: 'Active',
      taxYears: taxYearsStr || null,
      notes: 'Case opened on conversion from lead.',
      created_at: new Date().toISOString(),
    }]).then(({ error: cErr }) => {
      if (cErr) console.warn('Case create failed:', cErr.message)
    })

    // Carry over the lead's financial intake instead of always creating a
    // fresh blank one. The client page shows whichever row is most recent
    // for this name -- inserting a new empty row here unconditionally was
    // burying any answers the lead had already submitted while still a
    // lead, since the new blank row would always be "more recent" than
    // their real submission. Now: if one already exists for this lead
    // (sent or submitted), leave it alone and skip the email if they've
    // already submitted it. Only create + send a fresh one if they never
    // had one at all.
    let intakeSent = false
    let intakeAlreadySubmitted = false
    try {
      const { data: existingIntake } = await supabase.from('financial_intake_responses')
        .select('id, status, answers, submitted_at').eq('client_name', l.name).order('created_at', { ascending: false }).limit(1).maybeSingle()

      if (existingIntake) {
        // Already has one (sent or submitted while a lead) -- leave it as
        // the carried-over record. Don't re-send the email if they've
        // already submitted; that would be a confusing "fill this out"
        // nudge for something they already finished.
        if (existingIntake.status === 'Submitted') {
          intakeAlreadySubmitted = true
          // Snapshot the submitted answers into a PDF and file it under the
          // new client's Financial Statements folder — this is the resolution-
          // case data captured at the lead stage; once they're a client the
          // live wizard answers aren't needed anymore, just this record.
          try {
            const pdfBytes = await generateFinancialIntakePdf(l.name, existingIntake.answers || {}, existingIntake.submitted_at)
            const safeName = l.name.replace(/[^a-zA-Z0-9]+/g, '-')
            const path = `docs/${safeName}/financial-intake/financial-intake-${Date.now()}.pdf`
            const { error: upErr } = await supabase.storage.from('documents')
              .upload(path, new Blob([pdfBytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' })
            if (!upErr) {
              const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
              await supabase.from('documents').insert([{
                client: l.name, name: 'Financial Intake', docType: 'Financial Statements',
                file_url: urlData?.signedUrl || '', file_name: 'Financial Intake.pdf',
                notes: `Submitted ${existingIntake.submitted_at ? new Date(existingIntake.submitted_at).toLocaleDateString() : ''}`,
                created_at: new Date().toISOString(),
              }])
            }
          } catch (e) { console.error('Financial intake PDF snapshot error:', e) }
        } else if (l.email) {
          const intakeUrl = window.location.origin + '/financial-intake/' + existingIntake.id
          const { error: emailErr } = await supabase.functions.invoke('send-email', {
            body: { tenant_id: FIRM.tenantId || undefined,
              to: l.email,
              subject: `Your Financial Intake Form — ${firmName()}`,
              html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><div style="text-align:center;margin-bottom:20px"><img src=\"${FIRM.logoUrl}\" alt=\"${FIRM.name}\" style=\"max-height:56px;max-width:190px;object-fit:contain;display:block;margin:0 auto 8px\" onerror=\"this.style.display='none'\"/><div style="font-size:12px;font-weight:800;color:#1d4ed8;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">${FIRM.name}</div></div><p>Dear <strong>${l.name}</strong>,</p><p>Welcome aboard! To get your case moving, please finish your financial intake form — it gives your advisor the full picture needed to put together your resolution plan. Your progress is saved.</p><p style="text-align:center;margin:24px 0"><a href="${intakeUrl}" style="background:#1d4ed8;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Finish My Financial Intake</a></p><p style="font-size:12px;color:#64748b">Link: ${intakeUrl}</p><p style="font-size:11px;color:#94a3b8;margin-top:24px">${firmName()} · ${FIRM.address}</p></div>`
            }
          })
          if (!emailErr) intakeSent = true
        }
      } else {
        const { data: intakeRec, error: intakeErr } = await supabase.from('financial_intake_responses').insert([{
          client_name: l.name, client_email: l.email || '', status: 'Sent',
          answers: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }]).select().single()
        if (!intakeErr && intakeRec) {
          const intakeUrl = window.location.origin + '/financial-intake/' + intakeRec.id
          if (l.email) {
            const { error: emailErr } = await supabase.functions.invoke('send-email', {
              body: { tenant_id: FIRM.tenantId || undefined,
                to: l.email,
                subject: `Your Financial Intake Form — ${firmName()}`,
                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><div style="text-align:center;margin-bottom:20px"><img src=\"${FIRM.logoUrl}\" alt=\"${FIRM.name}\" style=\"max-height:56px;max-width:190px;object-fit:contain;display:block;margin:0 auto 8px\" onerror=\"this.style.display='none'\"/><div style="font-size:12px;font-weight:800;color:#1d4ed8;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">${FIRM.name}</div></div><p>Dear <strong>${l.name}</strong>,</p><p>Welcome aboard! To get your case moving, please fill out this short financial intake form — it gives your advisor the full picture needed to put together your resolution plan. It takes about 10-15 minutes and your progress saves automatically.</p><p style="text-align:center;margin:24px 0"><a href="${intakeUrl}" style="background:#1d4ed8;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Start My Financial Intake</a></p><p style="font-size:12px;color:#64748b">Link: ${intakeUrl}</p><p style="font-size:11px;color:#94a3b8;margin-top:24px">${firmName()} · ${FIRM.address}</p></div>`
              }
            })
            if (!emailErr) intakeSent = true
          }
        }
      }
    } catch (e) { console.error('Financial intake carry-over/auto-send error:', e) }

    // ── Write a conversion note on the new client record ──────────────────
    try {
      const actor = resolveActorName(user, employees)
      await supabase.from('client_notes').insert({
        clientname: l.name,
        text: `🔄 Converted from lead to client by ${actor}.`,
        author: actor, visible_to_client: false, created_at: new Date().toISOString()
      })
    } catch (e) { console.error('Conversion note failed:', e) }

    // ── Transfer signed documents from lead to client file ─────────────────
    // Copies all document rows (signed agreements, e-sign certs, etc.) that
    // were saved under this lead's name so they appear in the client file.
    try {
      const { data: leadDocs } = await supabase.from('documents').select('*').eq('client', l.name)
      if (leadDocs && leadDocs.length) {
        // Documents are already keyed by client name — they'll show up automatically
        // in the client file since both lead and client use the same name.
        // Just log a note confirming the transfer.
        await supabase.from('client_notes').insert({
          clientname: l.name,
          text: `📁 ${leadDocs.length} document(s) from lead file carried over to client record.`,
          author: 'System', visible_to_client: false, created_at: new Date().toISOString()
        })
      }
    } catch (e) { console.error('Document transfer error:', e) }

    } catch (e) {
      console.error('Post-conversion step failed (client was created):', e)
    }

    setConverting(false)
    const { count } = await supabase.from('client_compliance_records').select('*', { count: 'exact', head: true }).eq('client_name', l.name).catch(() => ({ count: null }))
    const intakeMsg = intakeAlreadySubmitted ? ', financial intake already on file'
      : intakeSent ? ', financial intake form emailed'
      : (l.email ? '' : ', financial intake created but no email on file to send it to')
    showToast(count ? `✅ ${l.name} converted to Client! 3 onboarding tasks created${intakeMsg}, compliance data (${count} records) carried over.` : `✅ ${l.name} converted to Client! 3 onboarding tasks created${intakeMsg}.`)
    // ── Workflow engine — lead converted trigger ──
    try {
      const convActor = resolveActorName(user, employees)
      await triggerWorkflow('lead_converted', 'lead', l.name, convActor)
      const _ca=getActor(user); await logActivity(supabase,{employeeName:_ca.name,employeeEmail:_ca.email,action:'lead_converted',category:'lead',description:`Converted to client: ${l.name}`,entityName:l.name})
    } catch (e) { console.error('Conversion workflow/activity log failed:', e) }
    setDetail(null)
    load()
    // Go straight into the new client file. This used to just clear the lead
    // detail and reload the lead list, so the client existed but nothing on
    // screen showed it until a manual refresh.
    navigate('/clients/' + newClient.id)
  }

  // ── Detail View ──
  const editLeadModal = modal && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="modal" style={{width:showScript&&modal!=='edit'?1080:640,maxWidth:'98vw',maxHeight:'90vh',display:'flex',flexDirection:'row',gap:0,padding:0,overflow:'hidden'}}>
            <div style={{flex:1,minWidth:0,padding:20,display:'flex',flexDirection:'column',overflowY:'auto',maxHeight:'90vh'}}>
            <div className="mh" style={{display:'flex',alignItems:'center',gap:8}}>
              <span className="mt">{modal==='edit'?'Edit Lead':'Add Lead'}</span>
              {modal!=='edit'&&(
                <button
                  onClick={()=>setShowScript(s=>!s)}
                  style={{marginLeft:'auto',marginRight:8,padding:'4px 10px',fontSize:11,fontWeight:700,
                    background:showScript?'#1e3a5f':'var(--s3)',color:showScript?'#60a5fa':'var(--t2)',
                    border:'1px solid '+(showScript?'#3b82f6':'var(--br)'),borderRadius:6,cursor:'pointer'}}>
                  📞 {showScript?'Hide Script':'Call Script'}
                </button>
              )}
              <button className="xbtn" onClick={()=>{setModal(false);setShowScript(false)}}>&times;</button>
            </div>

            <div className="fg2">
              <div className="field"><label>Client Type</label>
                <select value={form.clientType} onChange={e=>fldClientType(e.target.value)}>
                  <option>Individual</option><option>Business</option><option>Individual &amp; Biz</option>
                </select>
              </div>
              {form.clientType !== 'Individual' && (
                <div className="field"><label>Business Name *</label>
                  <input value={form.business_name||''} onChange={e=>fldBizName(e.target.value)} placeholder="Business Name"/>
                </div>
              )}
            </div>
            <div className="fg3">
              <div className="field"><label>First Name{form.clientType!=='Business'?' *':''}</label><input value={form.first} onChange={e=>fldFirst(e.target.value)}/></div>
              <div className="field"><label>MI</label><input value={form.mi} onChange={e=>fldMi(e.target.value)} maxLength={1}/></div>
              <div className="field"><label>Last Name{form.clientType!=='Business'?' *':''}</label><input value={form.last} onChange={e=>fldLast(e.target.value)}/></div>
            </div>
            <div className="fg2">
              <div className="field"><label>Phone</label><input value={form.phone} onChange={e=>fld('phone',fmtPhone(e.target.value))} placeholder="(305) 555-0000" maxLength={14}/></div>
              <div className="field"><label>Phone 2 <span style={{color:'var(--t3)',fontWeight:400}}>(optional)</span></label><input value={form.phone2||''} onChange={e=>fld('phone2',fmtPhone(e.target.value))} placeholder="(305) 555-0000" maxLength={14}/></div>
              <div className="field"><label>Email</label><input value={form.email} onChange={e=>fld('email',e.target.value)}/></div>
            </div>
            <div className="field" style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0' }}>
              <input
                type="checkbox"
                id="smsConsentCheck"
                checked={!!form.smsConsent}
                onChange={e=>{
                  const checked = e.target.checked
                  fld('smsConsent', checked)
                  fld('smsConsentDate', checked ? new Date().toISOString() : null)
                }}
                style={{ width:16, height:16 }}
              />
              <label htmlFor="smsConsentCheck" style={{ fontSize:13, fontWeight:400, color:'var(--t2)' }}>
                Client has verbally or in writing consented to receive text message updates about their case (required before sending SMS — TCR compliance)
              </label>
            </div>
            <div className="fg3">
              <div className="field"><label>SSN</label><input value={form.ssn} onChange={e=>fld('ssn',fmtSsn(e.target.value))} placeholder="XXX-XX-XXXX" maxLength={11}/></div>
              <div className="field"><label>EIN (if business)</label><input value={form.ein||''} onChange={e=>fld('ein',fmtEin(e.target.value))} placeholder="XX-XXXXXXX" maxLength={10}/></div>
              <div className="field"><label>Date of Birth</label><input type="date" value={form.dob} onChange={e=>fld('dob',e.target.value)}/></div>
            </div>

            {/* Spouse */}
            <div style={{background:'var(--s3)',borderRadius:8,padding:12,marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>👥 Spouse / Partner</div>
              <div className="fg2">
                <div className="field"><label>Spouse Full Name</label><input value={form.spouseName||''} onChange={e=>fld('spouseName',e.target.value)}/></div>
                <div className="field"><label>Spouse SSN</label><input value={form.spouseSsn||''} onChange={e=>fld('spouseSsn',fmtSsn(e.target.value))} placeholder="XXX-XX-XXXX" maxLength={11}/></div>
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

            <div style={{fontSize:11,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',margin:'6px 0 4px'}}>
              {form.clientType === 'Business' ? 'Address' : 'Personal Address'}
            </div>
            <div className="field"><label>Street Address</label><input value={form.street} onChange={e=>fld('street',e.target.value)}/></div>
            <div className="fg3">
              <div className="field"><label>City</label><input value={form.city} onChange={e=>fld('city',e.target.value)}/></div>
              <div className="field"><label>State</label>
                <select value={form.state} onChange={e=>fld('state',e.target.value)}>
                  <option value="">Select...</option>{STATES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field"><label>ZIP</label><input value={form.zip} onChange={e=>handleZip(e.target.value)} maxLength={5} placeholder="33408"/></div>
            </div>
            {form.clientType !== 'Individual' && (
              <>
                <div style={{display:'flex',alignItems:'center',gap:10,margin:'14px 0 4px'}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Business Address</div>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--t3)',cursor:'pointer'}}>
                    <input type="checkbox" checked={!!form.biz_same_as_personal}
                      onChange={e=>setForm(f=>({...f, biz_same_as_personal:e.target.checked,
                        ...(e.target.checked ? { biz_street:f.street, biz_city:f.city, biz_state:f.state, biz_zip:f.zip } : {})}))}/>
                    Same as personal
                  </label>
                </div>
                <div className="field"><label>Business Street Address</label>
                  <input value={form.biz_street||''} disabled={!!form.biz_same_as_personal}
                    onChange={e=>fld('biz_street',e.target.value)}/>
                </div>
                <div className="fg3">
                  <div className="field"><label>City</label>
                    <input value={form.biz_city||''} disabled={!!form.biz_same_as_personal}
                      onChange={e=>fld('biz_city',e.target.value)}/>
                  </div>
                  <div className="field"><label>State</label>
                    <select value={form.biz_state||''} disabled={!!form.biz_same_as_personal}
                      onChange={e=>fld('biz_state',e.target.value)}>
                      <option value="">Select...</option>{STATES.map(s=><option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>ZIP</label>
                    <input value={form.biz_zip||''} disabled={!!form.biz_same_as_personal}
                      onChange={e=>fld('biz_zip',e.target.value)} maxLength={5}/>
                  </div>
                </div>
              </>
            )}
            <div className="fg2">
              <div className="field"><label>Source</label>
                <select value={form.source} onChange={e=>fld('source',e.target.value)}>
                  {['Referral','Web Form','Google Ad','Social Media','Phone Call','Walk-In','Other'].map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field"><label>Est. IRS Balance</label>
                <select value={form.irsBalance} onChange={e=>fld('irsBalance',e.target.value)}>
                  <option value="">Unknown</option>
                  {['Under $10,000','$10,000 - $20,000','$20,000 - $30,000','$30,000 - $50,000','$50,000 - $100,000','$100,000 - $250,000','Over $250,000'].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            {(form.irsOrState||'IRS Federal')!=='IRS Federal' && (
              <div className="fg2">
              <div className="field"><label>Est. State Balance</label>
                <select value={form.stateBalance||''} onChange={e=>fld('stateBalance',e.target.value)}>
                  <option value="">Unknown</option>
                  {['Under $10,000','$10,000 - $20,000','$20,000 - $30,000','$30,000 - $50,000','$50,000 - $100,000','$100,000 - $250,000','Over $250,000'].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              </div>
            )}
            <div className="fg2">
              <div className="field"><label>Issue Type</label>
                <select value={form.issueType} onChange={e=>fld('issueType',e.target.value)}>
                  {['OIC','Installment Agreement','CNC','Penalty Abatement','Lien Withdrawal','TFRP','Payroll Tax','Unfiled Returns','Appeals','Audit','Liens/Levies','Tax Investigation','ACS','Notice Status','Other'].map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              <div className="field"><label>IRS or State?</label>
                <select value={form.irsOrState} onChange={e=>fld('irsOrState',e.target.value)}>
                  <option>IRS Federal</option><option>State</option><option>Both IRS + State</option>
                </select>
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
            <div className="field"><label>Tax Years</label>
              <div style={{background:'var(--s2)',border:'1px solid var(--b2c)',borderRadius:7,padding:'8px 10px',maxHeight:80,overflowY:'auto',display:'flex',flexWrap:'wrap',gap:'2px 12px'}}>
                {YEARS.map(y=>(
                  <label key={y} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                    <input type="checkbox" checked={form.taxYears.includes(String(y))} onChange={()=>toggleYear(String(y))} style={{width:'auto'}}/>
                    {y}
                  </label>
                ))}
              </div>
              <input value={form.taxYearsCustom} onChange={e=>fld('taxYearsCustom',e.target.value)} placeholder="Or type custom years: 2019, 2020" style={{marginTop:5}}/>
            </div>
            <div className="field">
              <label>Filing Requirements</label>
              <div style={{display:'flex',gap:14,flexWrap:'wrap',padding:'6px 0'}}>
                {['1040','1120','1065','1120S','940','941','State'].map(ft=>(
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
            <div className="field"><label>Notes</label><textarea value={form.notes} onChange={e=>fld('notes',e.target.value)}/></div>

            {/* ── Sales Contract ─────────────────────────────────────── */}
            <div style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,padding:'14px 16px',marginTop:4}}>
              <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',letterSpacing:.5,marginBottom:10,textTransform:'uppercase'}}>📋 Service Agreement</div>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:10}}>Services selected for this client</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'6px 20px',marginBottom:14}}>
                {RESOLUTION_SERVICES.map(s=>(
                  <label key={s.key} style={{display:'inline-flex',alignItems:'flex-start',gap:6,fontSize:12.5,cursor:'pointer',width:'calc(50% - 10px)'}}>
                    <input type="checkbox" style={{width:'auto',marginTop:2,flexShrink:0}}
                      checked={(form.services||[]).includes(s.key)}
                      onChange={()=>fld('services',(form.services||[]).includes(s.key)
                        ? (form.services||[]).filter(x=>x!==s.key)
                        : [...(form.services||[]),s.key])}/>
                    {s.label}
                  </label>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div className="field" style={{margin:0}}>
                  <label>Sales Rep</label>
                  <select value={form.salesRep||''} onChange={e=>fld('salesRep',e.target.value)}>
                    <option value="">— Select —</option>
                    {employees.map(e=><option key={e.name}>{e.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{margin:0}}>
                  <label>Total Contract Fee ($)</label>
                  <input type="number" value={form.contractFee||''} onChange={e=>fld('contractFee',e.target.value)} placeholder="e.g. 3950"/>
                </div>
              </div>
              <div style={{fontSize:12,fontWeight:600,color:'var(--t2)',marginBottom:8}}>Payment Schedule</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:6}}>
                <div className="field" style={{margin:0}}><label>1st Trade Amount</label><input type="number" value={form.trade1Amount||''} onChange={e=>fld('trade1Amount',e.target.value)} placeholder="e.g. 1000"/></div>
                <div className="field" style={{margin:0}}><label>1st Trade Date</label><input type="date" value={form.trade1Date||''} onChange={e=>fld('trade1Date',e.target.value)}/></div>
                <div className="field" style={{margin:0}}><label>&nbsp;</label></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:6}}>
                <div className="field" style={{margin:0}}><label>2nd Trade Amount</label><input type="number" value={form.trade2Amount||''} onChange={e=>fld('trade2Amount',e.target.value)} placeholder="e.g. 1000"/></div>
                <div className="field" style={{margin:0}}><label>2nd Trade Date</label><input type="date" value={form.trade2Date||''} onChange={e=>fld('trade2Date',e.target.value)}/></div>
                <div className="field" style={{margin:0}}><label>&nbsp;</label></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                <div className="field" style={{margin:0}}><label>3rd Trade Amount</label><input type="number" value={form.trade3Amount||''} onChange={e=>fld('trade3Amount',e.target.value)} placeholder="e.g. 1950"/></div>
                <div className="field" style={{margin:0}}><label>3rd Trade Date</label><input type="date" value={form.trade3Date||''} onChange={e=>fld('trade3Date',e.target.value)}/></div>
                <div className="field" style={{margin:0}}><label>&nbsp;</label></div>
              </div>
            </div>

            <div className="fg2">
              <div className="field"><label>{label("assignedTo","Tax Advisor")}</label>
                <select value={form.assignedTo} onChange={e=>fld('assignedTo',e.target.value)}>
                  <option value="">Unassigned</option>
                  {(employees.length>0?employees.map(e=>e.name):['Romy Cruz','Dana Richard','Yesenia Gonzalez']).map(n=><option key={n}>{n}</option>)}
                </select>
              </div>
              {/* The associate who works the case day to day. Workflow steps
                  marked ASSOCIATE go here when set; otherwise they fall back to
                  the round-robin pick, which is why this can stay blank. */}
              <div className="field"><label>{label("taxAssociate","Tax Associate")}</label>
                <select value={form.taxAssociate||''} onChange={e=>fld('taxAssociate',e.target.value)}>
                  <option value="">Auto (round-robin)</option>
                  {(employees.length>0?employees.map(e=>e.name):['Romy Cruz','Dana Richard','Yesenia Gonzalez']).map(n=><option key={n}>{n}</option>)}
                </select>
              </div>
              <div className="field"><label>Lead Status</label>
                <select value={form.status} onChange={e=>fld('status',e.target.value)}>
                  {STATUSES.filter(s=>s!=='Converted to Client').map(s=><option key={s}>{s}</option>)}
                  {form.status==='Converted to Client' && <option>Converted to Client</option>}
                </select>
              </div>
            </div>
            <div style={{background:'var(--s3)',borderRadius:7,padding:10,marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--ok)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>💰 Tax Investigation Fee</div>
              <div className="fg2">
                <div className="field"><label>Fee Amount ($399–$599)</label>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(form.taxFee)} onChange={e=>fld('taxFee',parseMoney(e.target.value))} min={399} max={599} placeholder="399"/>
                </div>
                <div className="field"><label>Manager Override?</label>
                  <select value={form.taxFeeOverride} onChange={e=>fld('taxFeeOverride',e.target.value)}>
                    <option value="">No Override</option><option>Manager Approved</option>
                  </select>
                </div>
              </div>
            </div>
            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={save} disabled={saving}>
              {saving ? 'Saving...' : modal==='edit' ? 'Save Changes' : 'Add Lead'}
            </button>
            </div>{/* end form column */}

            {/* ── Inbound Call Script Panel ───────────────────── */}
            {showScript&&modal!=='edit'&&(
              <div style={{width:440,flexShrink:0,background:'#071120',borderLeft:'2px solid #1e40af',
                overflowY:'auto',padding:'20px',display:'flex',flexDirection:'column',gap:14}}>
                <div style={{fontSize:17,fontWeight:900,color:'#60a5fa',letterSpacing:'.05em',
                  borderBottom:'1px solid #1e3a5f',paddingBottom:10,marginBottom:2}}>
                  📞 INBOUND CALL SCRIPT
                </div>
                {[
                  {step:'1',color:'#3b82f6',title:'Greeting',lines:[
                    `"Thank you for calling ${FIRM.name || 'our firm'}, this is [Name] — how can I help you today?"`,
                    'Be warm and confident. Let them speak first. Do not rush.',
                  ]},
                  {step:'2',color:'#8b5cf6',title:'Get the Story',lines:[
                    '"Can you tell me a little about your situation? How many tax years are we looking at?"',
                    '"Have you received any IRS letters or notices?"',
                    'Listen fully — do not interrupt. Write down years, IRS vs State.',
                  ]},
                  {step:'3',color:'#f59e0b',title:'Qualify the Balance',lines:[
                    '"Do you have a rough idea of what you owe?"',
                    'Under $10K → may not qualify for major programs.',
                    '$10K–$50K → strong candidate. $50K+ → high priority.',
                  ]},
                  {step:'4',color:'#ef4444',title:'Create Urgency',lines:[
                    '"The IRS does not wait. Every day this goes unresolved, interest and penalties are stacking up."',
                    '"They can file a lien, levy your bank, or garnish your wages — often with very little warning."',
                    'State facts calmly. Real urgency, not scare tactics.',
                  ]},
                  {step:'5',color:'#10b981',title:'Introduce Tax Investigation',lines:[
                    '"The first thing we do is a Tax Investigation — we pull your IRS transcripts and give you the full picture: what you owe, what years, and exactly what your options are."',
                    '"Our Tax Investigation fee starts at $399 and goes up to $599 depending on complexity. That gets you a complete analysis and a clear resolution plan."',
                    'Frame it as the only logical next step — not a sales pitch.',
                  ]},
                  {step:'6',color:'#f97316',title:'Handle Objections',lines:[
                    'PRICE: "I understand — starting at $399 is a fraction of what the IRS can take. Without knowing your real position, you are flying blind."',
                    'NEED TO THINK: "Totally fair. What specific questions can I answer for you right now?"',
                    'HAVE SOMEONE: "Great — are they pulling your IRS transcripts? That is the only way to truly know what you are dealing with."',
                    'DOING IT MYSELF: "You can — but the IRS has deadlines and rules most people do not know about. One missed step can permanently close your options."',
                  ]},
                  {step:'7',color:'#6366f1',title:'Collect Their Info',lines:[
                    '"Let me get your information so we can get this started right away."',
                    'Full name · phone · email · address · years owed · IRS or State · rough balance.',
                    'Fill the form on the LEFT as you talk — do not wait until the end.',
                  ]},
                  {step:'8',color:'#22c55e',title:'Close & Confirm',lines:[
                    '"Perfect — I have everything I need. Our team will review this and reach out within 24 hours."',
                    '"We are going to get this taken care of for you."',
                    'End with confidence and a clear commitment. No vague language.',
                  ]},
                ].map(s=>(
                  <div key={s.step} style={{background:'#0c1e35',border:`1px solid ${s.color}55`,
                    borderLeft:`4px solid ${s.color}`,borderRadius:8,padding:'14px 16px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                      <div style={{width:28,height:28,borderRadius:'50%',background:s.color,color:'#fff',
                        display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:900,flexShrink:0}}>
                        {s.step}
                      </div>
                      <div style={{fontSize:15,fontWeight:800,color:s.color}}>{s.title}</div>
                    </div>
                    {s.lines.map((line,i)=>(
                      <div key={i} style={{
                        fontSize:13.5,lineHeight:1.7,
                        marginBottom: i<s.lines.length-1 ? 6 : 0,
                        color: line.startsWith('"') ? '#e2e8f0' : '#7dd3fc',
                        fontStyle: line.startsWith('"') ? 'normal' : 'italic',
                      }}>{line}</div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>{/* end modal flex row */}
        </div>
      )

  if (detail) {
    const l = detail
    const taxYearsList = (() => { try { return JSON.parse(l.taxYears||'[]').join(', ') } catch { return l.taxYearsCustom||'—' } })()

    return (
      <div style={{maxWidth:960,margin:'0 auto'}}>
        {toast && <div className="toast show">{toast}</div>}

        {/* Top bar — matches clients page */}
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,flexWrap:'wrap'}}>
          <button className="btn" style={{padding:'8px 16px',fontSize:13,fontWeight:600}} onClick={()=>{ setDetail(null); navigate('/leads',{replace:true}); document.querySelector('.page-content')?.scrollTo(0,0) }}>← Back</button>
          {(l.status !== 'Converted to Client' || user?.role === 'Admin' || user?.role === 'Manager') ? (
            <button className="btn pri" style={{marginLeft:'auto',padding:'8px 18px',fontSize:13,fontWeight:700}} onClick={()=>{setForm({...BLANK,...l,business_name: l.business_name || (l.clientType && l.clientType!=='Individual' ? l.name : ''),taxYears:(() => {try{return JSON.parse(l.taxYears||'[]')}catch{return []}})(),filingRequirements:(() => {try{return JSON.parse(l.filingRequirements||'[]')}catch{return []}})()
                ,services:(() => {try{return JSON.parse(l.services||'[]')}catch{return []}})()});setModal('edit')}}>✏️ Edit</button>
          ) : (
            <span style={{marginLeft:'auto',fontSize:11,color:'var(--t3)',padding:'8px 12px',background:'var(--s2)',borderRadius:6}}>🔒 Admin Only</span>
          )}
          <button className="btn ok" style={{padding:'8px 18px',fontSize:13,fontWeight:700}} onClick={()=>convertToClient(l)} disabled={converting}>{converting?'Converting…':'✓ Convert to Client'}</button>
          {l.archived ? (
            <button className="btn" style={{padding:'8px 18px',fontSize:13,fontWeight:700}} onClick={()=>restoreLead(l)}>↩ Restore</button>
          ) : (
            <button className="btn del" style={{padding:'8px 18px',fontSize:13,fontWeight:700}} onClick={()=>archiveLead(l)}>🗑 Archive</button>
          )}
        </div>

        {/* Header card — matches clients */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',gap:16,padding:'4px 0 8px',flexWrap:'wrap'}}>
            <div style={{width:56,height:56,borderRadius:'50%',background:'var(--blue)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900,fontSize:22,color:'#fff',flexShrink:0}}>
              {(l.name||'?')[0].toUpperCase()}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:22,fontWeight:800}}>{l.name}</div>
              {l.business_name && l.business_name !== l.name && (
                <div style={{fontSize:14,fontWeight:600,color:'var(--t2)',marginTop:2}}>🏢 {l.business_name}</div>
              )}
              <div style={{display:'flex',gap:6,marginTop:5,flexWrap:'wrap'}}>
                <span className="bdg bb" style={{fontSize:13,padding:'4px 10px'}}>{l.clientType||'Individual'}</span>
                <Bdg s={l.status||'New Lead'} style={{fontSize:13,padding:'4px 10px'}}/>
                {l.irsOrState && <span className="bdg ba" style={{fontSize:13,padding:'4px 10px'}}>{l.irsOrState}</span>}
                {l.issueType  && <TypeBdg t={l.issueType} style={{fontSize:13,padding:'4px 10px'}}/>}
                {l.taxFee     && <span className="bdg bg" style={{fontSize:13,padding:'4px 10px'}}>Tax Inv Fee: ${l.taxFee}</span>}
              </div>
            </div>
          </div>

          {/* Pipeline — compact current-status display (matches client look; flow/stages unchanged) */}
          <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--br)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Pipeline</div>
              <button className="btn sec" style={{padding:'2px 8px',fontSize:10}} onClick={()=>setShowFlow(true)}>📊 View Flow</button>
            </div>
            {(() => {
              const fwdIdx = STATUS_FLOW.findIndex(x=>x.s===l.status)
              const cur = fwdIdx>=0 ? STATUS_FLOW[fwdIdx] : EXIT_FLOW.find(x=>x.s===l.status)
              const isExit = fwdIdx<0 && !!cur
              const curColor = cur?.c || '#64748b'
              const pct = fwdIdx>=0 ? Math.round(((fwdIdx+1)/STATUS_FLOW.length)*100) : 100
              return (<>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                  <span style={{background:curColor,color:'#fff',fontSize:14,fontWeight:700,padding:'6px 14px',borderRadius:24,whiteSpace:'nowrap'}}>
                    📊 {l.status||'New Lead'}
                  </span>
                  <span style={{fontSize:12,color:'var(--t3)',fontWeight:600}}>
                    {isExit ? 'Exit status' : `Stage ${fwdIdx>=0?fwdIdx+1:1} of ${STATUS_FLOW.length}`}
                  </span>
                  <select
                    value={l.status||'New Lead'}
                    onChange={e=>updateStatus(l, e.target.value)}
                    style={{fontSize:13,padding:'6px 10px',borderRadius:8,background:'var(--s2)',color:'var(--tx)',border:'1px solid var(--br)',cursor:'pointer'}}
                  >
                    <optgroup label="Pipeline">
                      {STATUS_FLOW.map(x=><option key={x.s} value={x.s}>{x.s}</option>)}
                    </optgroup>
                    <optgroup label="Exit">
                      {EXIT_FLOW.map(x=><option key={x.s} value={x.s}>{x.s}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div style={{marginTop:8,height:6,background:'var(--s3)',borderRadius:4,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${pct}%`,background:isExit?'#E84B5A':curColor,borderRadius:4,transition:'width .3s'}}/>
                </div>
              </>)
            })()}
          </div>
        </div>

        {/* Quick Actions — matches clients ActionBtn style */}
        <div className="card" style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>Quick Actions</div>
          <div className="ovx">
          <div className="quick-actions-row" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <ActionBtn color="#0891b2" icon="📅" label="Schedule" sub="Book Appointment" onClick={()=>setBookingLead(l)}/>
            <ActionBtn color="#16a34a" icon="📦" label={pkgSending?'Building…':'Full Package'} sub="2848/8821 + Agreement" onClick={()=>!pkgSending&&handleSendFullPackage(l)}/>
            <ActionBtn color="#22863a" icon="📄" label="Tax Engagement" sub="Service Agreement" onClick={async ()=>{ await generateClientPackage(l); await logAction(l.id, l.name, '📄 Service Agreement (Tax Engagement) generated'); }}/>
            <ActionBtn color="#0369a1" icon="🖋️" label="Pre-Fill 8821/2848" sub="IRS PDF Forms" onClick={()=>{
              try {
                if (!l) { showToast('Error: no lead data found'); return }
                setFillerLead({...l, address:l.street, business_name:l.business_name||l.name})
              } catch (err) { showToast('Error opening form: ' + err.message) }
            }}/>
            <ActionBtn color="#0f766e" icon="🏛️" label="Pre-Fill State POA" sub={l.state ? l.state+' Form' : 'State Form'} onClick={()=>{ setPoaLead(l); setPoaModal(true) }}/>
            <ActionBtn color="#1d4ed8" icon="📊" label={intakeSending?'Sending…':'Financial Intake'} sub="Send / Resend Link" onClick={()=>!intakeSending&&sendFinancialIntake(l)}/>
            <ActionBtn color="#0d9488" icon="💵" label="Charge Investigation Fee" sub={l.taxFee?`Quoted: $${l.taxFee}`:'Send Payment Link'} onClick={()=>{
                if (FIRM.paymentProvider === 'intuit') {
                  showToast('📋 Intuit Payments — send client the QuickBooks invoice link or process via your QB Payments dashboard. Payment will sync back automatically once connected.')
                } else {
                  setPaymentLinkModal({purpose:'investigation_fee', defaultAmount:l.taxFee||'', defaultDescription:'Tax Investigation Fee'})
                }
              }}/>
            <ActionBtn color="#d97706" icon="📝" label="Addendum" sub="After IRS facts" onClick={()=>{setAddForm({resolutionFee:String(l.contractFee||''),paymentPlan:'',startDate:'',notes:'',services:(()=>{try{return JSON.parse(l.services||'[]')}catch{return []}})(),sendVia:'email',trade1Amount:l.trade1Amount||'',trade1Date:l.trade1Date||'',trade2Amount:l.trade2Amount||'',trade2Date:l.trade2Date||'',trade3Amount:l.trade3Amount||'',trade3Date:l.trade3Date||''});setAddModal(true)}}/>
            {l.status==='Addendum Signed' && (
              <ActionBtn color="#059669" icon="💰" label="Charge Resolution Fee" sub={FIRM.paymentProvider==='intuit'?'via Intuit Payments':'& Convert to Client'} onClick={()=>{ if(FIRM.paymentProvider==='intuit'){showToast('📋 Charge resolution fee via QuickBooks Payments dashboard. Once paid, convert this lead to a client manually.')}else{setResolutionFeeLead(l)} }}/>
            )}

            <ActionBtn color="#dc2626" icon="📠" label="Send Fax" sub="SignalWire Fax" onClick={()=>{setInlineFaxLead(l);setShowFaxModal(true)}}/>
            <ActionBtn color="#7c3aed" icon="✍️" label="E-Signature" sub="Request Sign" onClick={()=>{setInlineEsignLead(l);setShowEsignModal(true)}}/>
          </div>
          </div>
        </div>

        {/* Overview / Notes / Documents — tabbed, matching the Clients detail page style */}
        <div className="card" style={{padding:0,overflow:'hidden',marginBottom:12}}>
          <div className="detail-tabs" style={{display:'flex',flexWrap:'nowrap',overflowX:'auto',borderBottom:'1px solid var(--br)',background:'var(--s2)',scrollbarWidth:'none'}}>
            {[
              {key:'overview', icon:'📋', text:'Overview'},
              {key:'notes', icon:'📝', text:`Notes & Activity (${leadNotes.length})`},
              {key:'tasks', icon:'✅', text:`Tasks (${leadTasks.length})`},
              {key:'sms', icon:'💬', text:'SMS'},
              {key:'activity', icon:'📋', text:'Activity Report'},
              {key:'payments', icon:'💳', text:'Payments'},
              {key:'finintake', icon:'💰', text:'Financial Intake'},
              {key:'finprofile', icon:'🧮', text:'Financial Profile'},
              {key:'docs',  icon:'📁', text:'Docs'},
            ].filter(Boolean).map(t=>(
              <button key={t.key} onClick={()=>switchLeadTab(t.key)}
                style={{display:'inline-flex',alignItems:'center',gap:5,padding:'12px 7px',border:'none',borderBottom:leadDetailTab===t.key?'2px solid var(--blue)':'2px solid transparent',
                  background:'none',cursor:'pointer',fontWeight:leadDetailTab===t.key?700:500,
                  color:leadDetailTab===t.key?'var(--blue)':'var(--t2)',whiteSpace:'nowrap',transition:'all .15s',flexShrink:0}}>
                <span style={{fontSize:22,lineHeight:1}}>{t.icon}</span>
                <span style={{fontSize:11}}>{t.text}</span>
              </button>
            ))}
          </div>

          {leadDetailTab==='sms' && (
            <div style={{padding:16}}>
              {l.phone && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                  {SMS_TEMPLATES.map(t=>(
                    <button key={t.label} className="btn sec" style={{fontSize:11,padding:'4px 10px'}}
                      onClick={()=>setLeadSmsBody(applySmsTemplate(t,l.name))}>{t.label}</button>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:8,marginBottom:14}}>
                <textarea
                  value={leadSmsBody} onChange={e=>setLeadSmsBody(e.target.value)}
                  placeholder={l.phone ? `Text ${l.name}…` : 'No phone number on file for this lead'}
                  disabled={!l.phone}
                  style={{flex:1,padding:'8px 10px',borderRadius:8,border:'1px solid var(--br)',resize:'vertical',minHeight:60,fontSize:13,fontFamily:'inherit',background:'var(--s2)',color:'var(--tx)'}}
                />
                <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end',justifyContent:'space-between'}}>
                  <span style={{fontSize:10,color:leadSmsBody.length>160?'var(--warn)':'var(--t3)',whiteSpace:'nowrap'}}>{leadSmsBody.length} chars</span>
                  <button className="btn pri" style={{padding:'8px 14px',fontSize:12,whiteSpace:'nowrap'}}
                    disabled={!leadSmsBody.trim()||!l.phone||leadSmsSending}
                    onClick={()=>sendLeadSms(l)}>
                    {leadSmsSending?'…':'Send'}
                  </button>
                </div>
              </div>
              {!l.phone && (
                <div style={{fontSize:12,color:'var(--warn)',marginBottom:12}}>Add a phone number to this lead to send texts.</div>
              )}
              {leadSms.length===0&&<div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No texts yet.</div>}
              {leadSms.map(s=>(
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

          {leadDetailTab==='activity' && (
            <ClientActivityReport entityId={l.id} entityName={l.name} entityType="lead" />
          )}

          {leadDetailTab==='overview' && (
            <div style={{padding:16}}>
              {(leadNotes.length>0||l.notes) && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:6}}>Case Notes</div>
                  {leadNotes.length>0?(
                    <>
                      <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{leadNotes[0].text}</div>
                      <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>{leadNotes[0].author||'Staff'} · {leadNotes[0].created_at?new Date(leadNotes[0].created_at).toLocaleString():''}</div>
                    </>
                  ):(
                    <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{l.notes}</div>
                  )}
                </div>
              )}
              <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Documents</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--blue)'}}>{leadDocCount}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Notes</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--blue)'}}>{leadNotes.length}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>Tasks</div>
                  <div style={{fontSize:22,fontWeight:800,color:'var(--ok)'}}>{leadTasks.filter(t=>t.done).length}/{leadTasks.length}</div>
                </div>
              </div>
            </div>
          )}

          {leadDetailTab==='notes' && (
            <div style={{padding:16}}>
              <div style={{display:'flex',gap:8,marginBottom:14}}>
                <textarea
                  value={newLeadNote} onChange={e=>setNewLeadNote(e.target.value)}
                  placeholder="Log a call, email, or note about this lead…"
                  style={{flex:1,padding:'8px 10px',borderRadius:8,border:'1px solid var(--br)',resize:'vertical',minHeight:60,fontSize:13,fontFamily:'inherit',background:'var(--s2)',color:'var(--tx)'}}
                />
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {/* Templates fill the box for the rep to finish — they never
                      post on their own. Blanks are ____ so an unedited note is
                      obvious to whoever reads the file next. */}
                  <select value="" style={{fontSize:11,padding:'5px 8px',borderRadius:6}}
                    onChange={e=>{
                      const t = NOTE_TEMPLATES.flatMap(g=>g.items).find(i=>i.label===e.target.value)
                      if (!t) return
                      setNewLeadNote(prev => prev.trim() ? prev.trim()+'\n\n'+t.text : t.text)
                      if (t.type) setNoteType(t.type)
                    }}>
                    <option value="">📝 Template…</option>
                    {NOTE_TEMPLATES.map(g=>(
                      <optgroup key={g.group} label={g.group}>
                        {g.items.map(i=><option key={i.label} value={i.label}>{i.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <select value={noteType} onChange={e=>setNoteType(e.target.value)} style={{fontSize:11,padding:'5px 8px',borderRadius:6}}>
                    {['Call','Email','Text','Voicemail','Meeting','Note'].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  <button className="btn pri" style={{padding:'8px 14px',fontSize:12}} disabled={!newLeadNote.trim()||addingLeadNote} onClick={addLeadNote}>
                    {addingLeadNote?'…':'+ Add'}
                  </button>
                </div>
              </div>
              {leadNotes.length===0&&<div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No notes yet.</div>}
              {leadNotes.length>0 && (() => {
                const AVATAR_PALETTE = ['#e8590c','#2563eb','#16a34a','#9333ea','#d97706','#0891b2','#dc2626','#4f46e5']
                function avatarColor(name){
                  const s = name || '?'
                  let hash = 0
                  for (let i=0;i<s.length;i++) hash = s.charCodeAt(i) + ((hash<<5)-hash)
                  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
                }
                function initials(name){ return (name||'?').trim().split(/\s+/).filter(Boolean).map(p=>p[0]).join('').slice(0,2).toUpperCase() || '?' }

                const now = new Date()
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7)
                const todayNotes = [], weekNotes = [], monthMap = new Map()
                leadNotes.forEach(n => {
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
                        // Strip org suffix e.g. "Romy Cruz (TaxRes CRM)" → "romy cruz"
                        const authorLower = (n.author||'').replace(/\s*\(.*?\)\s*$/,'').toLowerCase().trim()
                        const emp = employees.find(e => e.name && e.name.toLowerCase()===authorLower)
                          || employees.find(e => e.name && e.name.toLowerCase().split(' ')[0]===authorLower)
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
                                {n.type && n.type!=='System' && <Bdg s={n.type} c="bn"/>}
                                <span style={{fontSize:11,color:'var(--t3)'}}>{n.created_at ? new Date(n.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : ''}</span>
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

          {leadDetailTab==='tasks' && (
            <div style={{padding:16}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>
                  ✅ Tasks ({leadTasks.length})
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <select value={leadTaskFilter} onChange={e=>setLeadTaskFilter(e.target.value)}
                    style={{fontSize:11,padding:'5px 8px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)'}}>
                    <option value="all" style={{color:'#000',background:'#fff'}}>Show: All</option>
                    <option value="active" style={{color:'#000',background:'#fff'}}>Show: Active</option>
                    <option value="completed" style={{color:'#000',background:'#fff'}}>Show: Completed</option>
                  </select>
                  <button className="btn sec" style={{fontSize:11,padding:'5px 12px'}} onClick={openTemplatePicker}>📋 Apply Work Template</button>
                </div>
              </div>
              {leadTasks.length===0&&(
                <div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>No tasks yet for this lead.</div>
              )}
              {(() => {
                const groups = []
                const byKey = new Map()
                leadTasks.forEach(t => {
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
                      onClick={()=>toggleLeadTask(t)}
                      style={{width:18,height:18,borderRadius:4,border:'1.5px solid var(--b2c)',background:t.done?'var(--ok)':'var(--s2)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,color:'#fff',fontSize:11}}
                    >{t.done?'✓':''}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:t.done?400:600,textDecoration:t.done?'line-through':'none',color:t.done?'var(--t3)':'var(--tx)'}}>{t.title}</div>
                      {t.priority&&<div style={{marginTop:2}}><span className={`bdg ${t.priority==='High'?'br':t.priority==='Low'?'bn':'ba'}`} style={{fontSize:9}}>{t.priority}</span></div>}
                    </div>
                    <div style={{width:110,flexShrink:0,position:'relative'}}>
                      <select
                        value={t.status_category && t.status_label ? `${t.status_category}|||${t.status_label}` : ''}
                        onChange={e=>updateLeadTaskStatus(t, e.target.value)}
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
                    <button className="btn sec" style={{fontSize:10,padding:'3px 8px',flexShrink:0}} onClick={()=>addLeadSubtask(t)}>+ Sub</button>
                  </div>
                )}
                return groups.map(g => {
                  const allDone = g.tasks.length > 0 && g.tasks.every(t => t.done)
                  const visibleTasks = g.tasks.filter(t =>
                    leadTaskFilter === 'all' || (leadTaskFilter === 'active' ? !t.done : t.done)
                  )
                  if (g.section_title) {
                    const isExpanded = leadSectionOverride[g.key] !== undefined ? leadSectionOverride[g.key] : !allDone
                    return (
                      <div key={g.key} style={{marginBottom:10,borderRadius:8,overflow:'hidden',border:'1px solid var(--br)'}}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:'var(--s2)'}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',flex:1}}
                            onClick={()=>setLeadSectionOverride(prev=>({...prev,[g.key]:!isExpanded}))}>
                            <span style={{fontSize:10,color:'var(--t3)',transform:isExpanded?'rotate(90deg)':'none',transition:'transform .15s',display:'inline-block'}}>▶</span>
                            <div style={{fontSize:12,fontWeight:700,color:'var(--tx)'}}>
                              📋 {g.section_title} {allDone && <span style={{color:'var(--ok)',fontWeight:600}}>· All done ✓</span>}
                            </div>
                          </div>
                          <button className="btn pri" style={{fontSize:10,padding:'3px 10px',fontWeight:600}} onClick={()=>setPendingLeadSection(g.section_title)}>+ Add Task</button>
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
              {pendingLeadSection && (
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:11,color:'var(--t3)',marginTop:10}}>
                  <span>Adding to section: <strong style={{color:'var(--tx)'}}>{pendingLeadSection}</strong></span>
                  <button onClick={()=>setPendingLeadSection('')} style={{background:'none',border:'none',color:'var(--bad)',cursor:'pointer',fontSize:11}}>Cancel</button>
                </div>
              )}
              <div style={{display:'flex',gap:6,marginTop:pendingLeadSection?4:12}}>
                <input
                  value={leadQuickTask}
                  onChange={e=>setLeadQuickTask(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&addQuickLeadTask()}
                  placeholder={pendingLeadSection ? 'Add a sub-task…' : 'Add a task…'}
                  style={{flex:1,padding:'8px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}
                />
                <button className="btn pri" style={{fontSize:11,padding:'7px 14px'}} onClick={addQuickLeadTask} disabled={addingLeadTask}>
                  {addingLeadTask?'…':'+ Add'}
                </button>
              </div>
            </div>
          )}

          {leadDetailTab==='docs' && (
            <div style={{padding:0}}>
              <ClientDocs clientName={l.name} supabase={supabase} showToast={showToast}/>
            </div>
          )}
          {leadDetailTab==='finprofile' && (
            <ErrorBoundary>
              <FinancialProfile clientName={l.name} client={l} isLead={true}/>
            </ErrorBoundary>
          )}
          {leadDetailTab==='compliance' && (
            <div style={{padding:16}}>
              <div style={{fontSize:11,color:'var(--t3)',marginBottom:10,lineHeight:1.6}}>
                Enter what the tax investigation finds (filed status, balances, liens, assessment dates) for each year/form. This is the data you use to convert the lead — and it automatically stays attached once they become a client.
              </div>
              <ComplianceGrids clientName={l.name}/>
            </div>
          )}
          {leadDetailTab==='finintake' && (
            <ErrorBoundary>
              {/* No manual import button: the wizard's submit() already runs the
                  full mapping into client_financial_profiles server-side, so a
                  second button here only invited a redundant double-import.
                  backfillFromIntake is kept for repairing older intakes. */}
              <FinancialIntakeView clientName={l.name}/>
            </ErrorBoundary>
          )}
          {leadDetailTab==='payments' && (
            <div style={{padding:16}}>
              <div style={{fontSize:11,color:'var(--t3)',marginBottom:14,lineHeight:1.6}}>
                Capture the client's card here during the call — it goes straight into Stripe's secure form, never our database, and carries over automatically when this lead converts to a client.
              </div>

              <SavedCardsPanel
                record={l} recordType="lead" showToast={showToast}
                onChanged={async()=>{ const {data}=await supabase.from('leads').select('*').eq('id',l.id).single(); if (data) setDetail(data) }}
              />

              <div className="card" style={{marginTop:12}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:4}}>💸 Split Payment</div>
                    <div style={{fontSize:11,color:'var(--t3)'}}>Charge part on one saved card, the rest on another.</div>
                  </div>
                  <button className="btn pri" style={{padding:'4px 10px',fontSize:11}} onClick={()=>setSplitPaymentModal(true)}>Split Payment</button>
                </div>
              </div>

              <div className="card" style={{marginTop:12}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                  <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)'}}>🔗 Send Payment Link</div>
                  <button className="btn pri" style={{padding:'4px 10px',fontSize:11}} onClick={()=>setPaymentLinkModal({})}>Send Link</button>
                </div>
                <div style={{fontSize:11,color:'var(--t3)'}}>
                  {l.stripe_checkout_sent_at ? `Last link sent ${new Date(l.stripe_checkout_sent_at).toLocaleString()}` : 'No link sent yet — use this if they\'d rather enter their own card.'}
                </div>
              </div>

              <div className="card" style={{marginTop:12}}>
                <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>📄 Signed Authorization (Paper Trail)</div>
                <div style={{fontSize:11,color:'var(--t3)',marginBottom:10}}>This is now included automatically in the "Full Package" e-sign bundle (Quick Actions above) — no card number on it, just the signed consent to charge whatever's on file above. Use the print button only if you need a standalone paper copy.</div>
                <div style={{display:'flex'}}>
                  <ActionBtn color="#16a34a" icon="💳" label="Credit Card Auth" sub="Print" onClick={()=>generateCreditCardAuthForm(l)}/>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Info grid — side by side like clients, shown only on the Overview tab */}
        {leadDetailTab==='overview' && (
        <div className="detail-2col" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div className="card">
            <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>Contact Info</div>
            {[['Phone',l.phone],['Phone 2',l.phone2],['Email',l.email],['SSN',l.ssn?'***-**-'+l.ssn.replace(/-/g,'').slice(-4):null],['EIN',l.ein],['Date of Birth',l.dob],['Filing Status',l.filingStatus],['Spouse Name',l.spouseName],['Spouse DOB',l.spouseDob],['Spouse SSN',l.spouseSsn?'***-**-'+l.spouseSsn.replace(/-/g,'').slice(-4):null],[l.business_name ? 'Personal Address' : 'Address',[l.street,l.city,l.state,l.zip].filter(Boolean).join(', ')],['Business Address',[l.biz_street,l.biz_city,l.biz_state,l.biz_zip].filter(Boolean).join(', ')],['County',l.county],['Source',l.source]].map(([label,val])=>(
              <div key={label} className="dr"><span className="dl">{label}</span><span className="dv">
                {(label==='Phone'||label==='Phone 2') && val
                  ? <InPlaceCaller phone={val} name={l.name} entityType="lead" entityId={l.id} supabase={supabase} showToast={showToast} onLogged={()=>loadLeadNotes(l.id)}/>
                  : label==='Email' && val
                  ? <span style={{color:'var(--blue)',cursor:'pointer',textDecoration:'underline'}} title="Send email" onClick={()=>setQuickEmail({ name:l.name, email:val, kind:'lead', id:l.id })}>{val} ✉️</span>
                  : label.endsWith('Address') && val
                  ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(val)}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)'}}>{val} ↗</a>
                  : (val||'—')}
              </span></div>
            ))}
          </div>
          <div className="card">
            <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>IRS / Case Info</div>
            {[
              ['Est. Balance', l.irsBalance ? <span style={{fontWeight:700,color:'var(--bad)'}}>~{l.irsBalance}</span> : '—'],
              ...((l.irsOrState||'IRS Federal')!=='IRS Federal' ? [
                ['Est. State Balance', l.stateBalance ? <span style={{fontWeight:700,color:'var(--bad)'}}>~{l.stateBalance}</span> : '—'],
              ] : []),
              ['Issue Type',   <TypeBdg t={l.issueType||'—'} style={{fontSize:13,padding:'3px 10px'}}/>],
              ['IRS or State', l.irsOrState],
              ['Tax Years',    taxYearsList],
              ['Filing Reqs',  (()=>{try{return JSON.parse(l.filingRequirements||'[]').join(', ')}catch{return ''}})()],
              ...((l.irsOrState||'IRS Federal')!=='State' ? [
                ['IRS Status',   l.irsStatus==='Other'?l.irsStatusOther:l.irsStatus],
                ['IRS Deadline', l.irsDeadline],
              ] : []),
              ...((l.irsOrState||'IRS Federal')!=='IRS Federal' ? [
                ['State Status',   l.stateStatus==='Other'?l.stateStatusOther:l.stateStatus],
                ['State Deadline', l.stateDeadline],
              ] : []),
              [label('assignedTo','Tax Advisor'),  l.assignedTo||<span style={{color:'var(--warn)'}}>Unassigned</span>],
              [label('taxAssociate','Tax Associate'), l.taxAssociate||'—'],
              ['Tax Inv Fee',  l.taxFee?<span style={{fontWeight:700,color:'var(--ok)'}}>${l.taxFee}</span>:'Not set'],
            ].map(([label,val])=>(
              <div key={label} className="dr"><span className="dl">{label}</span><span className="dv">{val||'—'}</span></div>
            ))}
          </div>
        </div>
        )}

        {/* Initial Notes */}
        {l.notes && (
          <div className="card" style={{marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:12,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--t3)',marginBottom:10}}>Initial Notes</div>
            <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{l.notes}</div>
          </div>
        )}
        {/* Status Flow Modal */}
        {showFlow && (
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setShowFlow(false)}>
            <div className="modal" style={{maxWidth:820,width:'95vw'}}>
              <div className="mh">
                <span className="mt">📊 Lead Status Flow</span>
                <button className="xbtn" onClick={()=>setShowFlow(false)}>&times;</button>
              </div>
              <div style={{overflowX:'auto',padding:'8px 0'}}>
                <div style={{display:'flex',alignItems:'center',gap:0,minWidth:620,flexWrap:'wrap',rowGap:12}}>
                  {STATUS_FLOW.map((item,i,arr) => (
                    <div key={item.s} style={{display:'flex',alignItems:'center',gap:0}}>
                      <div onClick={()=>{updateStatus(detail, item.s);setShowFlow(false)}} style={{background:item.c,color:'#fff',borderRadius:6,padding:'7px 9px',fontSize:11,fontWeight:700,textAlign:'center',width:112,lineHeight:1.2,cursor:'pointer',outline:detail?.status===item.s?'2px solid #fff':'none',outlineOffset:-2}}>{item.s}</div>
                      {i < arr.length-1 && <div style={{color:'var(--t3)',fontSize:13,margin:'0 3px'}}>→</div>}
                    </div>
                  ))}
                </div>
                <div style={{marginTop:16,paddingTop:12,borderTop:'1px solid var(--br)'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Exit statuses — can be set from any stage above</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    {EXIT_FLOW.map(item => (
                      <div key={item.s} onClick={()=>{updateStatus(detail, item.s);setShowFlow(false)}} style={{background:item.c,color:'#fff',borderRadius:6,padding:'7px 9px',fontSize:11,fontWeight:700,textAlign:'center',width:112,lineHeight:1.2,cursor:'pointer',outline:detail?.status===item.s?'2px solid #fff':'none',outlineOffset:-2}}>{item.s}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Inline Fax Modal */}
        {showFaxModal && inlineFaxLead && (
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setShowFaxModal(false)}>
            <div className="modal" style={{width:520}}>
              <div className="mh"><span className="mt">📠 Send Fax — {inlineFaxLead.name}</span><button className="xbtn" onClick={()=>setShowFaxModal(false)}>&times;</button></div>
              <LeadInlineFax lead={inlineFaxLead} onClose={()=>setShowFaxModal(false)} onLogged={()=>loadLeadNotes(inlineFaxLead.id)}/>
            </div>
          </div>
        )}

        {/* Inline E-Sign Modal */}
        {showEsignModal && inlineEsignLead && (
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setShowEsignModal(false)}>
            <div className="modal" style={{width:520}}>
              <div className="mh"><span className="mt">✍️ E-Signature — {inlineEsignLead.name}</span><button className="xbtn" onClick={()=>setShowEsignModal(false)}>&times;</button></div>
              <LeadInlineEsign lead={inlineEsignLead} onClose={()=>{setShowEsignModal(false);loadLeadNotes(inlineEsignLead.id)}}/>
            </div>
          </div>
        )}

        {/* Apply Work Template Modal */}
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
                  <div style={{color:'var(--t3)',fontSize:12,textAlign:'center',padding:'20px 0'}}>No active workflow templates for leads yet. Build one in Workflows first.</div>
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

        {editLeadModal}

        {addModal && detail && (
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setAddModal(false)}>
            <div className="modal" style={{width:620,maxHeight:'90vh',overflowY:'auto'}}>
              <div className="mh">
                <span className="mt">📋 Addendum & 2nd Trade — {detail.name}</span>
                <button className="xbtn" onClick={()=>setAddModal(false)}>&times;</button>
              </div>

              {/* ── Addendum Section ── */}
              <div style={{fontSize:11,fontWeight:700,color:'var(--blue)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>📋 Service Addendum</div>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:14}}>
                Fill in the resolution fee and scope details, check off the services that apply based on the investigation results, then print or send for e-signature.
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
                  generateAddendum(detail, addForm)
                }}>🖨️ Print</button>
                <button className="btn pri" style={{flex:2,justifyContent:'center',padding:11}} disabled={addendumSending} onClick={()=>sendAddendum(detail)}>
                  {addendumSending ? 'Sending…' : '✍️ Send for E-Signature'}
                </button>
              </div>

              {/* ── Charge Trades Section ── */}
              <div style={{borderTop:'1px solid var(--br)',paddingTop:18}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--ok)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>
                  💳 Charge Trades {FIRM.paymentProvider==='intuit'&&<span style={{fontSize:9,fontWeight:400,color:'var(--t3)',textTransform:'none',marginLeft:6}}>via Intuit / QuickBooks Payments</span>}
                </div>
                <div style={{fontSize:12,color:'var(--t3)',marginBottom:12,lineHeight:1.6}}>
                  {FIRM.paymentProvider==='intuit' ? 'Charge through your QuickBooks Payments account — payments sync back to the CRM automatically once connected.' : 'Charge the resolution fee directly to the card on file.'}
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 14px',border:'1px solid var(--br)',marginBottom:12,fontSize:13}}>
                  <div style={{fontWeight:700}}>{detail.name}</div>
                  {detail.email&&<div style={{fontSize:12,color:'var(--t3)',marginTop:2}}>{detail.email}</div>}
                  {addForm.trade2Amount&&<div style={{fontSize:12,color:'var(--ok)',marginTop:4,fontWeight:600}}>2nd Trade: ${Number(addForm.trade2Amount).toLocaleString()}{addForm.trade2Date?` — due ${addForm.trade2Date}`:''}</div>}
                  {addForm.trade3Amount&&<div style={{fontSize:12,color:'var(--blue)',marginTop:2,fontWeight:600}}>3rd Trade: ${Number(addForm.trade3Amount).toLocaleString()}{addForm.trade3Date?` — due ${addForm.trade3Date}`:''}</div>}
                  {!addForm.trade2Amount&&addForm.resolutionFee&&<div style={{fontSize:12,color:'var(--ok)',marginTop:4,fontWeight:600}}>Resolution fee: ${Number(addForm.resolutionFee).toLocaleString()}</div>}
                </div>
                <div style={{display:'flex',gap:8}}>
                  {(addForm.trade2Amount||addForm.resolutionFee) && (
                    <button className="btn pri" style={{flex:1,padding:11,fontWeight:700,justifyContent:'center'}}
                      onClick={()=>{setAddModal(false); FIRM.paymentProvider==='intuit' ? showToast('📋 Charge 2nd Trade ($'+Number(addForm.trade2Amount||addForm.resolutionFee||0).toLocaleString()+') via your QuickBooks Payments dashboard. It will sync back automatically.') : setResolutionFeeLead(detail)}}>
                      {FIRM.paymentProvider==='intuit' ? `📋 Charge 2nd Trade via Intuit` : `💳 Charge 2nd Trade ($${Number(addForm.trade2Amount||addForm.resolutionFee||0).toLocaleString()})`}
                    </button>
                  )}
                  {addForm.trade3Amount && (
                    <button className="btn sec" style={{flex:1,padding:11,fontWeight:700,justifyContent:'center'}}
                      onClick={()=>{setAddModal(false); FIRM.paymentProvider==='intuit' ? showToast('📋 Charge 3rd Trade ($'+Number(addForm.trade3Amount||0).toLocaleString()+') via your QuickBooks Payments dashboard. It will sync back automatically.') : setPaymentLinkModal({purpose:'resolution_fee',defaultAmount:addForm.trade3Amount,defaultDescription:'3rd Trade — Resolution Fee Balance'})}}>
                      {FIRM.paymentProvider==='intuit' ? `📋 Charge 3rd Trade via Intuit` : `💳 Charge 3rd Trade ($${Number(addForm.trade3Amount||0).toLocaleString()})`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {bookingLead && (
          <BookingWidget mode="lead" contact={{id:bookingLead.id, name:bookingLead.name, email:bookingLead.email, phone:bookingLead.phone}} onClose={()=>setBookingLead(null)}/>
        )}
        {quickEmail && <QuickEmail contact={{ name: quickEmail.name, email: quickEmail.email }} kind="lead" leadId={quickEmail.id} onSent={() => loadLeadNotes(quickEmail.id)} onClose={() => setQuickEmail(null)} />}
        {resolutionFeeLead && (
          <ChargeResolutionFeeModal
            lead={resolutionFeeLead}
            showToast={showToast}
            onClose={()=>setResolutionFeeLead(null)}
            onPaid={async ()=>{ setResolutionFeeLead(null); await advanceLeadStatus(supabase, l.name, 'Resolution Fee Paid'); convertToClient(l, true) }}
          />
        )}
        {fillerLead && (
          <ErrorBoundary onClose={()=>setFillerLead(null)}>
            <IRSFormFiller client={fillerLead} onClose={()=>setFillerLead(null)}/>
          </ErrorBoundary>
        )}
        {paymentLinkModal && (
          <SendPaymentLinkModal
            record={l}
            recordType="lead"
            showToast={showToast}
            purpose={paymentLinkModal.purpose}
            defaultAmount={paymentLinkModal.defaultAmount}
            defaultDescription={paymentLinkModal.defaultDescription}
            onClose={async()=>{ setPaymentLinkModal(null); const {data}=await supabase.from('leads').select('*').eq('id',l.id).single(); if (data) setDetail(data) }}
          />
        )}
        {splitPaymentModal && (
          <SplitPaymentModal
            record={l}
            recordType="lead"
            showToast={showToast}
            onClose={()=>setSplitPaymentModal(false)}
            onCharged={async()=>{ const {data}=await supabase.from('leads').select('*').eq('id',l.id).single(); if (data) setDetail(data) }}
          />
        )}

        {poaModal && poaLead && (() => {
          const matchedForms = STATE_POA_FORMS.filter(f => f.state === poaLead.state)
          const hasMatch = matchedForms.length > 0
          return (
            <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setPoaModal(false)}>
              <div className="modal" style={{width:560,maxHeight:'88vh',overflowY:'auto'}}>
                <div className="mh">
                  <span className="mt">🏛️ State POA — {poaLead.name}</span>
                  <button className="xbtn" onClick={()=>setPoaModal(false)}>&times;</button>
                </div>
                <div style={{fontSize:12,color:'var(--t3)',marginBottom:16,lineHeight:1.6}}>
                  Send the {poaLead.state||'state'} Power of Attorney for e-signature. Client gets an email/text with a signing link.
                </div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13}}>
                  <div style={{fontWeight:700}}>{poaLead.name}</div>
                  <div style={{color:'var(--t3)',marginTop:2}}>{poaLead.email} {poaLead.phone ? '· '+poaLead.phone : ''}</div>
                  {poaLead.state && <div style={{color:'var(--blue)',marginTop:2,fontWeight:600}}>State: {poaLead.state}</div>}
                </div>
                {!poaLead.state ? (
                  <div style={{color:'var(--warn)',fontSize:13,marginBottom:16}}>⚠️ No state on file. Edit the lead profile to add their state first.</div>
                ) : !hasMatch ? (
                  <div style={{color:'var(--t3)',fontSize:13,marginBottom:16}}>No POA form on file for {poaLead.state}. Available: FL, NC, TX, OH, NY, PA, CA, GA, IL, MA, MO, OR, TN, WA, WY, AZ, ID.</div>
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
                {hasMatch && poaLead.state && (<>
                  <div className="field"><label>Send Via</label>
                    <select value={poaSendVia} onChange={e=>setPoaSendVia(e.target.value)}>
                      <option value="email">Email</option>
                      <option value="sms">Text Message</option>
                      <option value="both">Email + Text</option>
                    </select>
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:6}}>
                    <button className="btn sec" style={{flex:1,justifyContent:'center',padding:11}}
                      onClick={()=>window.open(`${import.meta.env.BASE_URL.replace(/\/$/,'')}/state-forms/${matchedForms[0].file}`,'_blank')}>
                      ⬇ Download Blank
                    </button>
                    <button className="btn pri" style={{flex:2,justifyContent:'center',padding:11}}
                      disabled={poaSending} onClick={()=>sendLeadStatePOA(poaLead, matchedForms[0], poaSendVia)}>
                      {poaSending ? 'Sending…' : '✍️ Send for E-Signature'}
                    </button>
                  </div>
                </>)}
              </div>
            </div>
          )
        })()}
      </div>
    )
  }

  return (
    <div>
      {toast && <div className="toast show">{toast}</div>}

      {/* Stat cards */}
      {!showArchived && (() => {
        const active = leads.filter(l=>!l.archived&&!['Dead','Do Not Contact','Converted to Client'].includes(l.status)).length
        const newL   = leads.filter(l=>!l.archived&&l.status==='New Lead').length
        const conv   = leads.filter(l=>!l.archived&&l.status==='Converted to Client').length
        const dead   = leads.filter(l=>!l.archived&&['Dead','Do Not Contact'].includes(l.status)).length
        return (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:14}}>
            {[
              {label:'Total Leads', val:leads.filter(l=>!l.archived).length, color:'var(--tx)'},
              {label:'New',         val:newL,   color:'var(--blue)'},
              {label:'In Progress', val:active, color:'var(--warn)'},
              {label:'Converted',   val:conv,   color:'var(--green)'},
            ].map(({label,val,color})=>(
              <div key={label} className="card" style={{padding:'12px 16px',textAlign:'center'}}>
                <div style={{fontSize:26,fontWeight:900,color,lineHeight:1}}>{val}</div>
                <div style={{fontSize:10,color:'var(--t3)',marginTop:4,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</div>
              </div>
            ))}
          </div>
        )
      })()}

      <div style={{marginBottom:8}}>
        <input
          type="search"
          placeholder="Search leads by name, spouse, phone, email, city…"
          value={leadSearch}
          onChange={e=>setLeadSearch(e.target.value)}
          style={{width:'100%',maxWidth:380,padding:'6px 12px',borderRadius:6,border:'1px solid var(--br)',background:'var(--bg2)',color:'var(--tx)',fontSize:13,outline:'none'}}
        />
      </div>
      <div className="pipeline-chips" style={{marginBottom:10,display:'flex',flexWrap:'wrap',gap:4,alignItems:'center'}}>
        {['All',...STATUSES].map(s => (
          <span key={s} className={`chip${filter===s?' on':''}`} onClick={()=>setFilter(s)}>{s}</span>
        ))}
        <span className={`chip${showArchived?' on':''}`} style={{marginLeft:8}} onClick={()=>setShowArchived(a=>!a)}>🗄 Archived</span>
        {isTaxAdvisor ? (
          <span className="chip on" style={{marginLeft:8}}>🎯 My Leads</span>
        ) : (
          <select value={repFilter} onChange={e=>setRepFilter(e.target.value)}
            style={{marginLeft:8,padding:'6px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}>
            <option value="All">All Reps</option>
            <option value="Unassigned">Unassigned</option>
            {employees.map(e=><option key={e.id} value={e.name}>{e.name}</option>)}
          </select>
        )}
        <select value={filterPipeline} onChange={e=>setFilterPipeline(e.target.value)}
          style={{padding:'6px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12,maxWidth:160}}>
          {pipelineOptions.map(p=><option key={p} value={p}>{p==='All'?'All Stages':p}</option>)}
        </select>
      </div>

      <div className="card">
        <div className="ch">
          <span className="ct">{showArchived ? 'Archived Leads' : 'All Leads'} <span style={{fontSize:12,fontWeight:500,color:'var(--t3)',marginLeft:6}}>({filtered.length})</span>{showArchived && <span style={{fontSize:11,fontWeight:500,color:'var(--t3)',marginLeft:8}}>· permanently deleted 30 days after archiving · Restore to keep</span>}</span>
          <button className="btn pri" onClick={()=>{ setForm(isTaxAdvisor && employeeName ? { ...BLANK, assignedTo: employeeName } : BLANK); setModal(true) }}>+ Add Lead</button>
        </div>
        <div className="ovx">
          <table>
            <thead>
              <tr>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('name')}>Name{sortCol==='name'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('type')}>Type{sortCol==='type'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th>Phone</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('issue')}>Issue{sortCol==='issue'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('balance')}>Balance{sortCol==='balance'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('source')}>Source{sortCol==='source'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('status')}>Status{sortCol==='status'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('assigned')}>Assigned{sortCol==='assigned'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9}>
                  <div style={{textAlign:'center',padding:'48px 20px',color:'var(--t3)'}}>
                    <div style={{fontSize:36,marginBottom:10}}>📋</div>
                    <div style={{fontWeight:700,fontSize:15,color:'var(--tx)',marginBottom:4}}>
                      {showArchived ? 'No archived leads' : filter !== 'All' ? `No leads with status "${filter}"` : 'No leads yet'}
                    </div>
                    {!showArchived && filter === 'All' && <div style={{fontSize:13}}>Add your first lead to get started.</div>}
                  </div>
                </td></tr>
              ) : sortedFiltered.map(l => (
                <tr key={l.id} onClick={()=>{ setDetail(l); loadLeadNotes(l.id); navigate('/leads/'+l.id, {replace:false}) }} style={{cursor:'pointer'}}>
                  <td style={{fontWeight:700,color:'var(--tx)',fontSize:13}}>
                    {l.name}
                    {l.business_name && l.business_name !== l.name && (
                      <div style={{fontWeight:500,color:'var(--t3)',fontSize:11,marginTop:1}}>🏢 {l.business_name}</div>
                    )}
                  </td>
                  <td><span className="bdg bb">{l.clientType||'Individual'}</span></td>
                  <td onClick={e=>e.stopPropagation()}><PhoneLink val={l.phone} name={l.name}/></td>
                  <td><TypeBdg t={l.issueType||'—'} style={{fontSize:12,padding:'3px 9px'}}/></td>
                  <td style={{color:l.irsBalance&&l.irsBalance!=='—'?'var(--bad)':'var(--t3)',fontWeight:l.irsBalance&&l.irsBalance!=='—'?600:400}}>{l.irsBalance||'—'}</td>
                  <td style={{color:'var(--t2)',fontSize:12.5}}>{l.source||'—'}</td>
                  <td><Bdg s={l.status||'New Lead'} style={{fontSize:12,padding:'3px 9px'}}/></td>
                  <td style={{color:'var(--t2)',fontSize:12.5}}>{l.assignedTo||<span style={{color:'var(--warn)'}}>Unassigned</span>}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    {l.archived
                      ? <button className="btn" style={{padding:'3px 8px',fontSize:12}} onClick={()=>restoreLead(l)}>↩ Restore</button>
                      : <button className="btn del" style={{padding:'3px 8px',fontSize:13}} onClick={()=>archiveLead(l)}>🗑</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {editLeadModal}

      <DeleteConfirmModal
        open={!!confirmArchive}
        label={`lead "${confirmArchive?.name}"`}
        onConfirm={confirmArchiveLead}
        onCancel={() => setConfirmArchive(null)}
      />
    </div>
  )
}



