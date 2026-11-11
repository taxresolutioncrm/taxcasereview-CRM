import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import ClientLink from '../components/ClientLink'
import { buildFlArticlesPdf, buildFlFaxPacket } from '../lib/flArticlesPdf'
import FormaCorpLifecycle from '../components/formacorp/FormaCorpLifecycle'
import FormaCorpStateFeeModal from '../components/formacorp/FormaCorpStateFeeModal'
import FloridaSunbizIntake from '../components/formacorp/FloridaSunbizIntake'
import SunbizFilingWorkspace from '../components/formacorp/SunbizFilingWorkspace'
import { parseFloridaSunbizPdf, planFloridaSunbizBusinessUpdate } from '../lib/flSunbizPdfImport'

// S-Corporation is a federal tax election, not a state-law formation entity.
// New formations choose the legal entity here; S-election lives in the lifecycle.
const ENTITY_TYPES = ['LLC','C-Corp','Sole Proprietorship','Partnership','Non-Profit 501(c)(3)','Professional LLC (PLLC)']
const ENTITY_ICONS = {
  'LLC':'🏢','S-Corp':'📈','C-Corp':'🏦','Sole Proprietorship':'👤','Partnership':'🤝',
  'Non-Profit 501(c)(3)':'❤️','Professional LLC (PLLC)':'⚖️'
}
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']
const STAGES = ['Consultation','Documents Prep','State Filing','EIN Application','Operating Agreement','Bank Account Setup','Compliance & Maintenance','Complete']
const FL_FILING_STEPS = ['Draft','Ready to Submit','Filing Queue','Submitted to Florida','Under State Review','Action Required','Approved / Active']

const FL_FIELDS = {
  principal_address:'', mailing_address:'', registered_agent_address:'',
  fl_correspondence_name:'', fl_optional_provisions:'', fl_llc_managers:[],
  authorized_representative:'', authorized_representative_title:'AR',
  correspondence_email:'', effective_date:'', registered_agent_accepted:false,
  fl_registered_agent_signature:'', fl_authorized_representative_signature:'',
  fl_filing_authorized:false, fl_authorized_at:null,
  fl_certificate_of_status:false, fl_certified_copy:false,
  fl_filing_status:'Draft', fl_payment_status:'unpaid', fl_payment_reference:'',
  fl_submission_method:'sunbiz_online', fl_tracking_number:'', fl_pin:'',
  fl_submitted_at:null, fl_decision_at:null, fl_rejection_reason:'',
  fl_confirmation_url:'', fl_state_fee:125,
  fl_authorized_shares:'1000', fl_officers_directors:'',
  fl_director_election_method:'As stated by the bylaws.',
  fl_incorporator:'', fl_incorporator_signature:'',
  state_fee_amount:null, state_fee_payment_status:'unpaid', state_fee_payment_reference:'',
  state_fee_collected_amount:null, state_fee_collected_at:null,
  state_fee_remitted_at:null, state_fee_remittance_reference:'', state_fee_refunded_at:null,
}

const BLANK = {
  client_name:'', client_id:null, entity_name:'', entity_type:'LLC', state:'FL',
  owners:'', registered_agent:'', business_purpose:'',
  ein:'', state_file_num:'', stage:'Consultation',
  notes:'', formation_date:'', fee:'', fee_paid:false,
  ...FL_FIELDS,
}

const WIZ_BLANK = {
  entity_type: '', state: '', client_name: '', client_id:null, entity_name: '',
  owners: '', registered_agent: '', business_purpose: '',
  service_plan:'Launch',
  ...FL_FIELDS,
}

const SERVICE_PLANS = {
  Formation: {
    title:'Formation',
    desc:'State filing + formation documents + compliance dashboard.',
    items:['State filing workflow','Formation documents','Compliance dashboard','Annual-report tracking'],
  },
  Launch: {
    title:'Launch',
    desc:'Formation plus the operational pieces needed to actually start using the company.',
    items:['Everything in Formation','EIN workflow','Governing document','Banking resolution & account setup','Compliance tracking'],
  },
  'Full Service': {
    title:'Full Service',
    desc:'Launch workflow plus ongoing company-maintenance services.',
    items:['Everything in Launch','S-Corp election workflow','Registered-agent management workflow','Amendments / DBA / foreign qualification','Good-standing / reinstatement / dissolution requests'],
  },
}

function isFloridaLlc(v = {}) {
  return v.state === 'FL' && (v.entity_type === 'LLC' || v.entity_type === 'Professional LLC (PLLC)')
}

function isFloridaCorporation(v = {}) {
  return v.state === 'FL' && (v.entity_type === 'C-Corp' || v.entity_type === 'Non-Profit 501(c)(3)')
}

function isFloridaFormable(v = {}) {
  return isFloridaLlc(v) || isFloridaCorporation(v)
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim())
}

function isPoBox(v) {
  return /\bP\.?\s*O\.?\s*Box\b/i.test(String(v || ''))
}

function looksLikeFloridaAddress(v) {
  return /(?:\bFL\b|\bFlorida\b)/i.test(String(v || ''))
}

function floridaEffectiveDateValid(v) {
  const raw=String(v.effective_date||'').trim()
  if (!raw) return true
  const effective=new Date(raw+'T12:00:00')
  if (Number.isNaN(effective.getTime())) return false
  const today=new Date()
  today.setHours(12,0,0,0)
  effective.setHours(12,0,0,0)
  if (effective >= today) return Math.round((effective-today)/86400000) <= 90
  let businessDays=0
  const cursor=new Date(effective)
  while (cursor < today) {
    cursor.setDate(cursor.getDate()+1)
    const day=cursor.getDay()
    if (day!==0 && day!==6) businessDays++
    if (businessDays>5) return false
  }
  return true
}

function floridaEntityNameValid(v = {}) {
  const name=String(v.entity_name||'').trim()
  if (!name) return false
  if (v.entity_type === 'LLC') return /(?:L\.?L\.?C\.?|Limited Liability Company)$/i.test(name)
  if (v.entity_type === 'Professional LLC (PLLC)') return /(?:P\.?L\.?L\.?C\.?|Professional Limited Liability Company|Chartered)$/i.test(name)
  if (v.entity_type === 'C-Corp') return /(?:Corporation|Company|Incorporated|Corp\.?|Inc\.?|Co\.?)$/i.test(name)
  if (v.entity_type === 'Non-Profit 501(c)(3)') return /(?:Corporation|Incorporated|Corp\.?|Inc\.?)$/i.test(name)
  return true
}

function listedNonprofitDirectors(v = {}) {
  return String(v.fl_officers_directors||'').split(/[;\n]+/).map(x=>x.trim()).filter(Boolean)
}

function floridaMissing(v = {}) {
  if (!isFloridaFormable(v)) return []
  const missing = []
  if (!String(v.entity_name || '').trim()) missing.push('Entity name')
  else if (!floridaEntityNameValid(v)) missing.push('Florida-compliant legal entity suffix')
  if (!String(v.principal_address || '').trim()) missing.push('Principal street address')
  else if (isPoBox(v.principal_address)) missing.push('Principal physical street address (not a P.O. Box)')
  if (!String(v.registered_agent || '').trim()) missing.push('Registered agent')
  else if (String(v.registered_agent||'').trim().toLowerCase() === String(v.entity_name||'').trim().toLowerCase()) missing.push('Registered agent cannot be the entity itself')
  if (!String(v.registered_agent_address || '').trim()) missing.push('Registered agent Florida street address')
  else if (isPoBox(v.registered_agent_address)) missing.push('Registered agent physical street address (not a P.O. Box)')
  else if (!looksLikeFloridaAddress(v.registered_agent_address)) missing.push('Registered agent address must identify Florida (FL)')
  if (!floridaEffectiveDateValid(v)) missing.push('Effective date must be within 5 business days before or 90 days after filing')
  if (!String(v.authorized_representative || '').trim()) missing.push('Authorized representative / filing contact')
  if (!validEmail(v.correspondence_email)) missing.push('Valid correspondence email')
  if (!v.registered_agent_accepted) missing.push('Registered-agent acceptance confirmation')
  if (v.entity_type === 'Professional LLC (PLLC)' && !String(v.business_purpose || '').trim()) missing.push('Specific professional purpose')
  if (isFloridaCorporation(v)) {
    if (!String(v.fl_incorporator || '').trim()) missing.push('Incorporator')
    if (v.entity_type === 'C-Corp' && !(Number(v.fl_authorized_shares) >= 1)) missing.push('Authorized shares (at least 1)')
    if (v.entity_type === 'Non-Profit 501(c)(3)') {
      if (!String(v.business_purpose || '').trim()) missing.push('Non-profit purpose')
      if (!String(v.fl_director_election_method || '').trim()) missing.push('Director election / appointment method')
      const directors=listedNonprofitDirectors(v)
      if (directors.length > 0 && directors.length < 3) missing.push('At least 3 directors when directors are listed')
    }
  }
  return missing
}

function floridaSubmissionMissing(v = {}) {
  if (!isFloridaFormable(v)) return []
  const missing = floridaMissing(v)
  if (!String(v.fl_registered_agent_signature || '').trim()) missing.push('Registered-agent typed signature')
  if (isFloridaLlc(v) && !String(v.fl_authorized_representative_signature || '').trim()) missing.push('Authorized-representative typed signature')
  if (isFloridaCorporation(v) && !String(v.fl_incorporator_signature || '').trim()) missing.push('Incorporator typed signature')
  if (!v.fl_filing_authorized) missing.push('Filing authorization')
  return missing
}

function floridaStateFee(v = {}) {
  if (isFloridaCorporation(v)) {
    return 70 + (v.fl_certificate_of_status ? 8.75 : 0) + (v.fl_certified_copy ? 8.75 : 0)
  }
  return 125 + (v.fl_certificate_of_status ? 5 : 0) + (v.fl_certified_copy ? 30 : 0)
}

function stateFilingAmount(c = {}, req = null) {
  if (isFloridaFormable(c)) return floridaStateFee(c)
  const raw = c.state_fee_amount ?? c.fee ?? req?.llc_filing_fee ?? null
  const n = typeof raw === 'string' ? Number(String(raw).replace(/[^0-9.]/g,'')) : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function hasStateFilingFunds(c = {}) {
  const paymentStatus = String(c.state_fee_payment_status || '')
  const floridaStatus = String(c.fl_payment_status || '')
  if (paymentStatus === 'remitted' || ['state_paid','state_account'].includes(floridaStatus)) return true
  if (paymentStatus !== 'received' && floridaStatus !== 'received') return false
  const required = stateFilingAmount(c)
  const collected = Number(c.state_fee_collected_amount)
  return Number.isFinite(required) && Number.isFinite(collected) && Math.abs(collected - required) < 0.009
}

function flStatusIndex(v = {}) {
  const i = FL_FILING_STEPS.indexOf(v.fl_filing_status || 'Draft')
  return i < 0 ? 0 : i
}

function FloridaFilingFields({ value, onChange }) {
  if (!isFloridaFormable(value)) return null
  return (
    <div className="card" style={{padding:'12px 14px',margin:'10px 0',background:'var(--s2)'}}>
      <div className="stitle" style={{marginBottom:8}}>☀️ Florida {isFloridaCorporation(value) ? 'Corporation' : 'LLC'} Filing Details</div>
      <div style={{fontSize:11,color:'var(--t3)',lineHeight:1.5,marginBottom:10}}>
        Complete these once. FormaCorp uses them for the Florida filing packet, filing authorization, state submission tracking, state-fee calculation, and approval workflow.
      </div>
      <div className="field"><label>Principal Street Address *</label>
        <input value={value.principal_address || ''} onChange={e=>onChange('principal_address',e.target.value)} placeholder="Street, city, FL ZIP"/>
      </div>
      <div className="field"><label>Mailing Address (leave empty when same as principal)</label>
        <input value={value.mailing_address || ''} onChange={e=>onChange('mailing_address',e.target.value)} placeholder="Leave blank if same as principal address"/>
      </div>
      <div className="field"><label>Registered Agent Florida Street Address *</label>
        <button type="button" className="btn sm" style={{marginBottom:6}} onClick={()=>onChange('registered_agent_address', value.principal_address || '')}>Use Principal Address for Registered Agent</button>
        <input value={value.registered_agent_address || ''} onChange={e=>onChange('registered_agent_address',e.target.value)} placeholder="Florida street address — no P.O. Box"/>
      </div>
      <div className="fg2">
        <div className="field"><label>Authorized Representative / Filing Contact *</label>
          <input value={value.authorized_representative || ''} onChange={e=>onChange('authorized_representative',e.target.value)} placeholder="Person who will sign/file"/>
        </div>
        <div className="field"><label>Title</label>
          <select value={value.authorized_representative_title || 'AR'} onChange={e=>onChange('authorized_representative_title',e.target.value)}>
            <option value="AR">AR — Authorized Representative</option>
            <option value="AMBR">AMBR — Authorized Member</option>
            <option value="MGR">MGR — Manager</option>
          </select>
        </div>
      </div>
      <div className="fg2">
        <div className="field"><label>Correspondence Email *</label>
          <input type="email" value={value.correspondence_email || ''} onChange={e=>onChange('correspondence_email',e.target.value)} placeholder="Filing confirmation email"/>
        </div>
        <div className="field"><label>Effective Date</label>
          <input type="date" value={value.effective_date || ''} onChange={e=>onChange('effective_date',e.target.value)}/>
        </div>
      </div>
      {isFloridaCorporation(value) && <>
        <div className="fg2">
          <div className="field"><label>Incorporator *</label>
            <input value={value.fl_incorporator || ''} onChange={e=>onChange('fl_incorporator',e.target.value)} placeholder="Person forming the corporation"/>
          </div>
          <div className="field"><label>{value.entity_type === 'C-Corp' ? 'Authorized Shares *' : 'Officers / Directors (optional)'}</label>
            {value.entity_type === 'C-Corp'
              ? <input type="number" min="1" step="1" value={value.fl_authorized_shares || '1000'} onChange={e=>onChange('fl_authorized_shares',e.target.value)} placeholder="1000"/>
              : <textarea rows={3} value={value.fl_officers_directors || ''} onChange={e=>onChange('fl_officers_directors',e.target.value)} placeholder={"If listing directors, enter at least 3; separate each director with a new line or semicolon and include street address."}/>
            }
          </div>
        </div>
        {value.entity_type === 'Non-Profit 501(c)(3)' && <div className="field"><label>Director Election / Appointment Method *</label>
          <input value={value.fl_director_election_method || 'As stated by the bylaws.'} onChange={e=>onChange('fl_director_election_method',e.target.value)} placeholder="As stated by the bylaws."/>
          <div style={{fontSize:10,color:'var(--t3)',marginTop:4}}>Florida requires the manner in which directors are elected or appointed. State formation does not itself grant federal 501(c)(3) tax-exempt status.</div>
        </div>}
        {value.entity_type === 'C-Corp' && <div className="field"><label>Officers / Directors (optional public listing)</label>
          <input value={value.fl_officers_directors || ''} onChange={e=>onChange('fl_officers_directors',e.target.value)} placeholder="e.g. P: Cruz, Rommel; D: Cruz, Rommel"/>
        </div>}
      </>}
      <div className="field">
        <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',lineHeight:1.4}}>
          <input type="checkbox" checked={!!value.registered_agent_accepted} onChange={e=>onChange('registered_agent_accepted',e.target.checked)} style={{width:'auto',marginTop:2}}/>
          <span>I confirm the named registered agent accepted the appointment and authorized this filing.</span>
        </label>
      </div>
      <div className="fg2">
        <div className="field"><label>Registered Agent Typed Signature *</label>
          <input value={value.fl_registered_agent_signature || ''} onChange={e=>onChange('fl_registered_agent_signature',e.target.value)} placeholder="Type registered agent's legal name"/>
        </div>
        <div className="field"><label>{isFloridaCorporation(value) ? 'Incorporator Typed Signature *' : 'Authorized Representative Typed Signature *'}</label>
          {isFloridaCorporation(value)
            ? <input value={value.fl_incorporator_signature || ''} onChange={e=>onChange('fl_incorporator_signature',e.target.value)} placeholder="Type incorporator's legal name"/>
            : <input value={value.fl_authorized_representative_signature || ''} onChange={e=>onChange('fl_authorized_representative_signature',e.target.value)} placeholder="Type authorized representative's legal name"/>
          }
        </div>
      </div>
      <div className="fg2">
        <div className="field">
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type="checkbox" checked={!!value.fl_certificate_of_status} onChange={e=>onChange('fl_certificate_of_status',e.target.checked)} style={{width:'auto'}}/> Certificate of Status (+${isFloridaCorporation(value) ? '8.75' : '5'})</label>
        </div>
        <div className="field">
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type="checkbox" checked={!!value.fl_certified_copy} onChange={e=>onChange('fl_certified_copy',e.target.checked)} style={{width:'auto'}}/> Certified Copy (+${isFloridaCorporation(value) ? '8.75' : '30'})</label>
        </div>
      </div>
      <div className="field" style={{marginBottom:0}}>
        <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',lineHeight:1.4}}>
          <input type="checkbox" checked={!!value.fl_filing_authorized} onChange={e=>onChange('fl_filing_authorized',e.target.checked)} style={{width:'auto',marginTop:2}}/>
          <span>I authorize this office to prepare and submit this Florida formation filing using the information above. I understand the filing becomes a public record and that typed signatures may be used only with the signer's permission.</span>
        </label>
      </div>
    </div>
  )
}

function NameCheckStatus({ state, name, check }) {
  if (state !== 'FL' || !name || name.length < 3) return null
  return (
    <div style={{marginTop:6,fontSize:12}}>
      {check.state === 'pending' && <span style={{color:'var(--t3)'}}>⏳ Checking with Sunbiz…</span>}
      {check.state === 'unavailable' && (
        <span style={{color:'var(--t3)'}}>ℹ️ Sunbiz lookup is temporarily unavailable. Keep the case in FormaCorp and retry the lookup here.</span>
      )}
      {check.state === 'done' && check.result?.available && (
        <span style={{color:'var(--ok)'}}>✅ No exact match in FL — likely available (Sunbiz confirms at filing time)</span>
      )}
      {check.state === 'done' && check.result && !check.result.available && (
        <div>
          <div style={{color:'var(--warn)'}}>⚠️ Exact match already exists in FL:</div>
          {(check.result.exactMatches || []).slice(0,3).map(m => (
            <div key={m.documentNumber} style={{color:'var(--t2)',marginTop:2,fontSize:11}}>
              • {m.name} — {m.status} — #{m.documentNumber}
            </div>
          ))}
        </div>
      )}
      {check.state === 'done' && check.result?.available && (check.result.nearMatches?.length > 0) && (
        <details style={{marginTop:4}}>
          <summary style={{cursor:'pointer',color:'var(--t3)',fontSize:11}}>Similar names on file ({check.result.nearMatches.length})</summary>
          {check.result.nearMatches.map(m => (
            <div key={m.documentNumber} style={{color:'var(--t3)',marginTop:2,fontSize:11}}>• {m.name} — {m.status}</div>
          ))}
        </details>
      )}
    </div>
  )
}

export default function FormaCorp() {
  const { showToast } = useApp()
  const location = useLocation()
  const [cases, setCases] = useState([])
  const [clients, setClients] = useState([])
  const [modal, setModal] = useState(false)
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [stageFilter, setSF] = useState('All')
  const [confirmDel, setCD] = useState(null)
  const [sugg, setSugg] = useState([])
  const [showSug, setShowSug] = useState(false)
  const [stateReqs, setStateReqs] = useState({})
  const [wizard, setWizard] = useState(false)
  const [floridaIntake, setFloridaIntake] = useState(false)
  const [floridaEditCase, setFloridaEditCase] = useState(null)
  const [officialSunbizCase, setOfficialSunbizCase] = useState(null)
  const [wStep, setWStep] = useState(1)
  const [wForm, setWForm] = useState(WIZ_BLANK)
  const [wSugg, setWSugg] = useState([])
  const [wShowSug, setWShowSug] = useState(false)
  const [nameCheck, setNameCheck] = useState({ state:'idle', input:'', result:null })
  const nameCheckTimer = useRef(null)
  const [lookup, setLookup] = useState({ open:false, query:'', running:false, result:null })
  const [pdfBusy, setPdfBusy] = useState(false)
  const [flSubmit, setFlSubmit] = useState({ method:'sunbiz_online', faxNumber:'', coverSheet:null, signedArticles:null, prepaidFundsConfirmed:false, busy:false })
  const [feePaymentCase, setFeePaymentCase] = useState(null)

  function checkNameSoon(name, state) {
    if (state !== 'FL' || !name || name.trim().length < 3) {
      setNameCheck({ state:'idle', input:name || '', result:null })
      return
    }
    setNameCheck(nc => ({ ...nc, state:'pending', input:name }))
    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current)
    nameCheckTimer.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('sunbiz-search', { body: { mode:'name-check', name } })
        if (error || !data?.ok) {
          setNameCheck({ state:'unavailable', input:name, result:null })
          return
        }
        setNameCheck({ state:'done', input:name, result:data })
      } catch (_e) {
        setNameCheck({ state:'unavailable', input:name, result:null })
      }
    }, 450)
  }

  async function runLookup() {
    if (!lookup.query || lookup.query.trim().length < 3) return
    setLookup(l => ({ ...l, running:true, result:null }))
    try {
      const { data, error } = await supabase.functions.invoke('sunbiz-search', { body: { mode:'lookup', query: lookup.query.trim() } })
      if (error || !data?.ok) {
        setLookup(l => ({ ...l, running:false, result:{ ok:false, reason: data?.reason || 'sunbiz_unavailable' } }))
        return
      }
      setLookup(l => ({ ...l, running:false, result:data }))
    } catch (_e) {
      setLookup(l => ({ ...l, running:false, result:{ ok:false, reason:'network_error' } }))
    }
  }

  function openFloridaEdit(c, missing = floridaMissing(c)) {
    setForm({ ...BLANK, ...c })
    setModal('edit')
    if (missing.length) showToast(`Florida filing details needed: ${missing.join(', ')}`, 'err')
  }

  async function downloadArticlesPdf(c) {
    if (pdfBusy) return
    const missing = floridaMissing(c)
    if (missing.length) {
      openFloridaEdit(c, missing)
      return
    }
    setPdfBusy(true)
    try {
      const blob = await buildFlArticlesPdf(c)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const articleType = isFloridaCorporation(c) ? 'Articles-of-Incorporation' : 'Articles-of-Organization'
      a.download = `${articleType}-${(c.entity_name || 'Entity').replace(/[^a-z0-9]+/gi,'-')}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) {
      showToast('Could not generate Articles PDF: ' + (e?.message || e), 'err')
    } finally {
      setPdfBusy(false)
    }
  }

  // Save a durable copy of the generated packet inside the existing FormaCorp vault.
  // The upload is explicit: Preview never writes files or charges the user.
  async function saveArticlesToVault(c) {
    if (pdfBusy) return
    const missing = floridaMissing(c)
    if (missing.length) { openFloridaEdit(c, missing); return }
    setPdfBusy(true)
    let storedPath = null
    let indexed = false
    try {
      const {data: tenantId, error: tenantError} = await supabase.rpc('current_tenant_id')
      if (tenantError || !tenantId) throw new Error('Cannot verify active office. ' + (tenantError?.message || 'Sign in again.'))
      if (String(tenantId) !== String(c.tenant_id)) {
        throw new Error('This case belongs to another office. Switch to the correct office before saving documents.')
      }
      const {data: existingCase,error:caseError} = await supabase.from('formacorp')
        .select('id,tenant_id').eq('id',c.id).eq('tenant_id',tenantId).single()
      if (caseError || !existingCase) throw new Error('Case is not accessible in this office: ' + (caseError?.message || 'Not found'))
      const blob = await buildFlArticlesPdf(c)
      const fileName = (isFloridaCorporation(c) ? 'Articles-of-Incorporation' : 'Articles-of-Organization') + '-' + Date.now() + '.pdf'
      const path = tenantId + '/formacorp/' + c.id + '/' + fileName
      const {error: uploadError} = await supabase.storage.from('documents').upload(path, blob, {upsert:false,contentType:'application/pdf'})
      if (uploadError) throw new Error('Storage upload denied: ' + uploadError.message)
      storedPath = path
      const {error:indexError} = await supabase.from('formacorp_documents').insert([{
        tenant_id:tenantId, case_id:c.id, document_type:'Florida Articles — Draft',
        file_name:fileName, storage_path:path, source:'FormaCorp',
      }])
      if (indexError) throw new Error('Document index denied: ' + indexError.message)
      indexed = true
      showToast('✅ Draft Articles saved in FormaCorp Documents. This is not a state submission.')
    } catch (error) {
      if (storedPath && !indexed) {
        const {error:cleanupError} = await supabase.storage.from('documents').remove([storedPath])
        if (cleanupError) console.error('[FormaCorp] Draft cleanup failed',cleanupError)
      }
      showToast('Articles not archived: '+(error?.message || error), 'err')
    } finally { setPdfBusy(false) }
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).get('new') === '1') {
      setDetail(null)
      setForm(BLANK)
      setModal('new')
    }
  }, [location.search])

  useEffect(() => { load() }, [])

  async function load() {
    const {data:tenantId,error:tenantError}=await supabase.rpc('current_tenant_id')
    if(tenantError||!tenantId) {showToast('Cannot load FormaCorp without a verified office','err');return}
    const [{ data:c }, { data:cl }, { data:sr }] = await Promise.all([
      supabase.from('formacorp').select('*').eq('tenant_id',tenantId).order('created_at', { ascending:false }),
      supabase.from('clients').select('id,name,email,phone,tenant_id').eq('tenant_id',tenantId),
      supabase.from('state_formation_requirements').select('*')
    ])
    setCases(c || [])
    setClients(cl || [])
    const map = {}
    for (const r of (sr || [])) map[r.state] = r
    setStateReqs(map)
  }

  function fld(k,v) { setForm(f=>({...f,[k]:v})) }
  function wFld(k,v) { setWForm(f=>({...f,[k]:v})) }

  function wSearchClient(val) {
    setWForm(f => ({...f,client_name:val,client_id:null}))
    if (val.length < 2) { setWSugg([]); setWShowSug(false); return }
    const m = clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setWSugg(m); setWShowSug(m.length > 0)
  }

  function chooseWizardClient(c) {
    setWForm(f => ({ ...f, client_name:c.name, client_id:c.id, correspondence_email:f.correspondence_email || c.email || '' }))
    setWSugg([]); setWShowSug(false)
  }

  function openWizard() {
    setWForm(WIZ_BLANK)
    setWStep(1)
    setWizard(true)
  }

  async function linkedFormationClient(source) {
    const {data:tenantId,error:tenantError} = await supabase.rpc('current_tenant_id')
    if (tenantError || !tenantId) throw new Error('Unable to verify the current office')
    let query = supabase.from('clients').select('id,name,tenant_id,business_name,businessType,ein,biz_street,biz_city,biz_state,biz_zip')
      .eq('tenant_id',tenantId)
    if (source.client_id) query=query.eq('id',source.client_id)
    else query=query.eq('name',String(source.client_name||'').trim())
    const {data,error} = await query.limit(2)
    if (error) throw error
    if (!data || data.length !== 1) throw new Error('Select one existing CRM client before saving this formation (unmatched or duplicate client name)')
    if (source.client_id && data[0].name !== source.client_name) throw new Error('The selected client changed; please choose the client again')
    return data[0]
  }

  async function syncFormationBusiness(caseRecord, linkedId) {
    if (!linkedId) throw new Error('Formation has no verified CRM client link')
    const client = await linkedFormationClient({client_id:linkedId,client_name:caseRecord.client_name})
    const patch={}
    // A client can own several companies: the one-business client summary cannot
    // absorb fields from a different company. Each FormaCorp case remains independent.
    if (client.business_name && client.business_name.trim().toUpperCase() !== String(caseRecord.entity_name||'').trim().toUpperCase()) return
    if (!client.business_name && caseRecord.entity_name?.trim()) patch.business_name=caseRecord.entity_name.trim()
    if (!client.businessType && caseRecord.entity_type?.trim()) patch.businessType=caseRecord.entity_type.trim()
    if (!client.ein && caseRecord.ein?.trim()) patch.ein=caseRecord.ein.trim()
    const address=String(caseRecord.principal_address||'').trim()
    // Only parse structured US addresses. Do not put an entire address into a street-only field.
    const match=address.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/i)
    if (match) {
      const [,street,city,state,zip]=match
      if (!client.biz_street) patch.biz_street=street.trim()
      if (!client.biz_city) patch.biz_city=city.trim()
      if (!client.biz_state) patch.biz_state=state.toUpperCase()
      if (!client.biz_zip) patch.biz_zip=zip
    }
    if (!Object.keys(patch).length) return
    const {data,error}=await supabase.from('clients').update(patch)
      .eq('id',client.id).eq('tenant_id',client.tenant_id).select('id').single()
    if (error || !data) throw error || new Error('Client Business Info update was not confirmed')
  }

  async function createFromWizard(source = wForm) {
    if (!source.client_name || !source.entity_name || !source.entity_type || !source.state) {
      showToast('Please complete all required fields', 'err'); return
    }
    let linkedClient
    try { linkedClient=await linkedFormationClient(source) }
    catch(error) {showToast('Client link required: '+error.message,'err');return}
    setSaving(true)
    const req = stateReqs[source.state]
    const fee = req?.llc_filing_fee ? parseFloat(req.llc_filing_fee.replace(/[^0-9.]/g, '')) : null
    const payload = {
      client_name:linkedClient.name, client_id:linkedClient.id, entity_name:source.entity_name, entity_type:source.entity_type, state:source.state,
      owners:source.owners, registered_agent:source.registered_agent, business_purpose:source.business_purpose,
      principal_address:source.principal_address || '', mailing_address:source.mailing_address || '',
      registered_agent_address:source.registered_agent_address || '',
      authorized_representative:source.authorized_representative || '',
      authorized_representative_title:source.authorized_representative_title || 'AR',
      correspondence_email:source.correspondence_email || '', effective_date:source.effective_date || '',
      fl_correspondence_name:source.fl_correspondence_name || source.authorized_representative || source.client_name || '',
      fl_optional_provisions:source.fl_optional_provisions || '',
      fl_llc_managers:Array.isArray(source.fl_llc_managers) ? source.fl_llc_managers : [],
      registered_agent_accepted:!!source.registered_agent_accepted,
      fl_registered_agent_signature:source.fl_registered_agent_signature || '',
      fl_authorized_representative_signature:source.fl_authorized_representative_signature || '',
      fl_filing_authorized:!!source.fl_filing_authorized,
      fl_authorized_at:source.fl_filing_authorized ? new Date().toISOString() : null,
      fl_certificate_of_status:!!source.fl_certificate_of_status,
      fl_certified_copy:!!source.fl_certified_copy,
      fl_filing_status:'Draft', fl_payment_status:'unpaid', fl_submission_method:'sunbiz_online',
      fl_state_fee:floridaStateFee(source),
      state_fee_amount:floridaStateFee(source),
      state_fee_payment_status:'unpaid',
      fl_authorized_shares:source.fl_authorized_shares || '1000',
      fl_officers_directors:source.fl_officers_directors || '',
      fl_director_election_method:source.fl_director_election_method || 'As stated by the bylaws.',
      fl_incorporator:source.fl_incorporator || '',
      fl_incorporator_signature:source.fl_incorporator_signature || '',
      stage:'Consultation', fee: isFloridaFormable(source) ? floridaStateFee(source) : fee, fee_paid:false, ein:'', state_file_num:'', notes:'', formation_date:'', created_at:new Date().toISOString()
    }
    const { data, error } = await supabase.from('formacorp').insert([payload]).select().single()
    if (error) { setSaving(false); showToast('Error: '+error.message, 'err'); return }
    const plan = source.service_plan || 'Launch'
    const selected = plan === 'Formation'
      ? ['State Filing','Formation Documents','Compliance']
      : plan === 'Full Service'
        ? ['State Filing','EIN','Operating Agreement','Banking','Compliance','S-Corp Election','Registered Agent','Company Changes']
        : ['State Filing','EIN','Operating Agreement','Banking','Compliance']
    const due = source.state==='FL' ? `${Number((source.effective_date || new Date().toISOString().slice(0,10)).slice(0,4))+1}-05-01` : null
    const { error:lifecycleErr } = await supabase.from('formacorp_lifecycle').insert([{
      case_id:data.id,
      service_plan:plan,
      selected_services:selected,
      ein_status:'Not Started',
      ein_responsible_party_name:source.authorized_representative || source.client_name || '',
      operating_agreement_status:'Not Started',
      banking_status:'Not Started',
      bank_account_type:'Business Checking',
      bank_signer:source.authorized_representative || source.client_name || '',
      annual_report_status:'Not Due',
      annual_report_due_date:due,
      good_standing_status:'Unknown',
      registered_agent_status:source.registered_agent==='Self (Owner)' ? 'Client / Self' : 'Third Party',
    }])
    try {await syncFormationBusiness(payload,linkedClient.id)}
    catch(error) {showToast('Formation created, but client Business Info sync failed: '+error.message,'err')}
    setSaving(false)
    if (lifecycleErr) { showToast('Formation created, but lifecycle setup needs attention: '+lifecycleErr.message, 'err') }
    else showToast('🏢 Formation case + launch lifecycle created!')
    setWizard(false)
    setFloridaIntake(false)
    await load()
    setDetail(data)
  }

  async function saveNativeFloridaIntake(source) {
    const prior=floridaEditCase
    if (!prior) return createFromWizard(source)
    if (!isFloridaLlc(prior) || ['Submitted to Florida','Under State Review','Approved / Active'].includes(prior.fl_filing_status)) {
      showToast('Filed or approved Florida submissions cannot be edited as draft intake.', 'err')
      return
    }
    const newFee=floridaStateFee(source)
    if (prior.state_fee_payment_intent_id || ['received','remitted'].includes(prior.state_fee_payment_status || '')) {
      if (Math.abs(newFee - Number(prior.state_fee_amount || floridaStateFee(prior))) > .009) {
        showToast('A payment attempt or collected state fee must be reconciled before changing filing options.', 'err')
        return
      }
    }
    setSaving(true)
    try {
      const { data:tenantId,error:tenantError }=await supabase.rpc('current_tenant_id')
      if (tenantError || !tenantId || String(tenantId)!==String(prior.tenant_id)) {
        throw new Error('Unable to verify the active office for this filing.')
      }
      const {data:latest,error:readError}=await supabase.from('formacorp')
        .select('id,fl_filing_status,state_fee_payment_intent_id,state_fee_payment_status,state_fee_amount,fl_state_fee')
        .eq('id',prior.id).eq('tenant_id',tenantId).single()
      if (readError || !latest) throw new Error('Could not recheck this filing in the active office.')
      if (['Submitted to Florida','Under State Review','Approved / Active'].includes(latest.fl_filing_status)) {
        throw new Error('This filing has already been recorded as submitted or approved; it cannot be rewritten as a draft.')
      }
      if ((latest.state_fee_payment_intent_id || ['received','remitted'].includes(latest.state_fee_payment_status || '')) &&
          Math.abs(newFee - Number(latest.state_fee_amount || latest.fl_state_fee || 125)) > .009) {
        throw new Error('Government filing funds must be reconciled before changing paid filing options.')
      }
      const keys=[
        'client_name','entity_name','owners','registered_agent','principal_address','mailing_address',
        'registered_agent_address','authorized_representative','authorized_representative_title',
        'correspondence_email','fl_correspondence_name','effective_date','business_purpose',
        'registered_agent_accepted','fl_registered_agent_signature','fl_authorized_representative_signature',
        'fl_filing_authorized','fl_certificate_of_status','fl_certified_copy','fl_optional_provisions','fl_llc_managers'
      ]
      const patch=Object.fromEntries(keys.map(k=>[k,source[k]]))
      patch.fl_state_fee=newFee
      patch.state_fee_amount=newFee
      patch.fl_authorized_at=source.fl_filing_authorized?(prior.fl_authorized_at || new Date().toISOString()):null
      const {data:updated,error}=await supabase.from('formacorp').update(patch)
        .eq('id',prior.id).eq('tenant_id',tenantId)
        .in('fl_filing_status',['Draft','Ready to Submit','Filing Queue','Action Required'])
        .select('id').single()
      if (error || !updated) throw error || new Error('No authorized draft was updated.')
      if (prior.client_id) {
        try {await syncFormationBusiness({...prior,...patch},prior.client_id)}
        catch(syncError) {showToast('Filing saved, but client Business Info sync failed: '+syncError.message,'err')}
      }
      setDetail(d=>d?.id===prior.id?({...d,...patch}):d)
      setFloridaEditCase(null)
      await load()
      showToast('✅ Florida LLC filing intake updated. This is not a state submission.')
    } catch(error) {
      showToast('Could not update Florida intake: '+(error?.message || error), 'err')
    } finally {setSaving(false)}
  }

  function searchClient(val) {
    setForm(f => ({...f,client_name:val,client_id:null}))
    if (val.length < 2) { setSugg([]); setShowSug(false); return }
    const m = clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setSugg(m); setShowSug(m.length > 0)
  }

  function chooseClient(c) {
    setForm(f => ({ ...f, client_name:c.name, client_id:c.id, correspondence_email:f.correspondence_email || c.email || '' }))
    setSugg([]); setShowSug(false)
  }

  async function save() {
    if (!form.client_name || !form.entity_name || !form.entity_type) {
      showToast('Client, entity name and type required', 'err'); return
    }
    let linkedClient
    try { linkedClient=await linkedFormationClient(form) }
    catch(error) {showToast('Client link required: '+error.message,'err');return}
    setSaving(true)
    const payload = { ...form, client_id:linkedClient.id, client_name:linkedClient.name, fee: form.fee ? parseFloat(form.fee) : null, created_at: form.created_at || new Date().toISOString() }
    if (isFloridaFormable(payload)) {
      payload.fl_state_fee = floridaStateFee(payload)
      payload.state_fee_amount = floridaStateFee(payload)
      if (modal === 'edit' && String(form.state_fee_payment_status || '') === 'received') {
        const collected = Number(form.state_fee_collected_amount)
        if (Number.isFinite(collected) && Math.abs(collected - payload.state_fee_amount) >= 0.009) {
          setSaving(false)
          showToast('Government filing funds were already collected for a different amount. Keep the paid filing options unchanged or refund/reconcile the payment before changing the state fee.', 'err')
          return
        }
      }
      if (payload.fl_filing_authorized && !payload.fl_authorized_at) payload.fl_authorized_at = new Date().toISOString()
      if (!payload.fl_filing_authorized) payload.fl_authorized_at = null
    }
    const { error } = modal === 'edit'
      ? await supabase.from('formacorp').update(payload).eq('id', form.id)
      : await supabase.from('formacorp').insert([payload])
    setSaving(false)
    if (error) { showToast('Error: '+error.message, 'err'); return }
    try {await syncFormationBusiness(payload,linkedClient.id)}
    catch(syncError) {showToast('Formation saved, but client Business Info sync failed: '+syncError.message,'err')}
    showToast(modal==='edit' ? '✅ Updated!' : '✅ Case created!')
    if (modal === 'edit' && detail?.id === form.id) setDetail(d => ({ ...d, ...payload }))
    setModal(false); setForm(BLANK); await load()
  }

  async function recordFloridaEvent(c, status, note, metadata = {}) {
    try {
      const { data:{ user } } = await supabase.auth.getUser()
      const safeMetadata = { ...metadata }
      delete safeMetadata.fl_pin
      await supabase.from('formacorp_filing_events').insert([{
        case_id:c.id, event_type:'florida_filing', status, note,
        metadata:safeMetadata, actor_email:user?.email || null, created_at:new Date().toISOString()
      }])
    } catch (e) {
      console.error('[FormaCorp] filing event log failed', e)
    }
  }

  async function updateFloridaCase(c, patch, toast, eventNote) {
    const { error } = await supabase.from('formacorp').update(patch).eq('id', c.id)
    if (error) { showToast('Florida filing update failed: '+error.message, 'err'); return false }
    if (c.client_id) {
      try {await syncFormationBusiness({...c,...patch},c.client_id)}
      catch(syncError) {showToast('Filing saved, but client Business Info sync failed: '+syncError.message,'err')}
    }
    if (eventNote) await recordFloridaEvent(c, patch.fl_filing_status || c.fl_filing_status || 'Draft', eventNote, patch)
    setDetail(d => d?.id===c.id ? ({...d,...patch}) : d)
    await load()
    if (toast) showToast(toast)
    return true
  }

  async function prepareFloridaFiling(c) {
    const missing = floridaSubmissionMissing(c)
    if (missing.length) { openFloridaEdit(c, missing); return }
    await updateFloridaCase(c, {
      fl_filing_status:'Ready to Submit',
      fl_state_fee:floridaStateFee(c),
      fl_authorized_at:c.fl_authorized_at || new Date().toISOString(),
      stage:'State Filing',
    }, '✅ Florida filing is ready to submit', 'Filing packet validated and authorized')
  }

  async function queueFloridaFiling(c, method) {
    const missing = floridaSubmissionMissing(c)
    if (missing.length) { openFloridaEdit(c, missing); return false }
    if (!hasStateFilingFunds(c)) { setFeePaymentCase(c); showToast('Collect the government filing amount before submitting to Florida.', 'err'); return false }
    return updateFloridaCase(c, {
      fl_filing_status:'Filing Queue',
      fl_submission_method:method,
      fl_state_fee:floridaStateFee(c),
      stage:'State Filing',
    }, 'Florida filing moved to the filing queue', `Queued for Florida submission via ${method==='prepaid_fax'?'Prepaid Sunbiz E-File fax':'Sunbiz online'}`)
  }

  async function startNativeFormation(c) {
    if (isFloridaFormable(c)) {
      const missing = floridaSubmissionMissing(c)
      if (missing.length) { openFloridaEdit(c, missing); return }
      // Standard Florida filings go to the official Sunbiz payment/filing flow.
      // Never collect funds with Stripe and then send the filer to pay Sunbiz again.
      if (['Submitted to Florida','Under State Review','Approved / Active'].includes(c.fl_filing_status)) {
        showToast('This case already has a state submission recorded. Check its receipt before filing again.', 'err')
        return
      }
      if (c.state_fee_payment_intent_id || ['received','remitted'].includes(c.state_fee_payment_status || '')) {
        showToast('FormaCorp already has a payment attempt or recorded funds. Reconcile this before making another state payment.', 'err')
        return
      }
      const ok = await updateFloridaCase(c, {
        fl_filing_status:'Filing Queue',
        fl_submission_method:'sunbiz_online',
        stage:'State Filing',
      }, 'Ready for official Sunbiz filing — no payment collected by FormaCorp', 'Standard Sunbiz online filing selected; state submission/payment is not yet confirmed')
      if (!ok) return
      // The office can finish preparation and preserve the case without leaving the CRM.
      // Final state submission stays a separate, explicit action to avoid accidental payments.
      showToast('✅ Filing preparation status saved. Preview the Articles before submitting through Sunbiz; record the state receipt afterward.')
      return
    }

    const { data:existing, error:lookupErr } = await supabase
      .from('formacorp_service_requests')
      .select('id,status')
      .eq('case_id', c.id)
      .eq('service_type', 'State Formation Filing')
      .order('requested_at', { ascending:false })
      .limit(1)
      .maybeSingle()
    if (lookupErr) { showToast('Could not check the formation filing request: '+lookupErr.message, 'err'); return }

    if (!existing) {
      const req = stateReqs[c.state]
      const stateFee = req?.llc_filing_fee ? parseFloat(String(req.llc_filing_fee).replace(/[^0-9.]/g,'')) : null
      const { error:reqErr } = await supabase.from('formacorp_service_requests').insert([{
        case_id:c.id,
        service_type:'State Formation Filing',
        status:'Requested',
        jurisdiction_state:c.state || null,
        agency:req?.state_name ? `${req.state_name} business filing office` : 'State business filing office',
        state_fee:Number.isFinite(stateFee) ? stateFee : null,
        service_fee:null,
        payment_status:'Pending',
        notes:'Native FormaCorp formation workflow. Intake, documents, filing status, payment tracking, and completion remain in the CRM.',
      }])
      if (reqErr) { showToast('Could not create the formation filing request: '+reqErr.message, 'err'); return }
    }

    const { error:updateErr } = await supabase.from('formacorp').update({ stage:'State Filing' }).eq('id',c.id)
    if (updateErr) { showToast('Could not move the company to State Filing: '+updateErr.message,'err'); return }
    setDetail(d=>d?.id===c.id?({...d,stage:'State Filing'}):d)
    await load()
    showToast('✅ Native FormaCorp filing workflow started')
  }

  async function recordFloridaSubmission(c) {
    const tracking = window.prompt('Florida tracking number from the state receipt:', c.fl_tracking_number || '')
    if (!tracking?.trim()) { showToast('A Florida tracking number is required before marking the filing submitted.', 'err'); return }
    const paymentRef = window.prompt('State payment receipt/reference:', c.fl_payment_reference || '')
    if (!paymentRef?.trim()) { showToast('A state payment receipt/reference is required before marking government funds remitted.', 'err'); return }
    const pin = window.prompt('Florida filing PIN (optional; usually supplied on rejection):', c.fl_pin || '')
    if (pin === null) return
    await updateFloridaCase(c, {
      fl_filing_status:'Submitted to Florida',
      fl_tracking_number:tracking.trim(),
      fl_payment_reference:paymentRef.trim(),
      fl_pin:String(pin || '').trim(),
      fl_submitted_at:new Date().toISOString(),
      fl_payment_status:'state_paid',
      state_fee_payment_status:'remitted',
      state_fee_remitted_at:new Date().toISOString(),
      state_fee_remittance_reference:paymentRef.trim(),
      fee_paid:true,
      stage:'State Filing',
    }, '✅ Recorded as submitted to Florida', 'State submission recorded')
  }

  async function importFreshFloridaPdf(file,kind,selectedClientId) {
    if(!selectedClientId) throw new Error('Choose the existing CRM client before saving the Sunbiz PDF')
    const preview=await parseFloridaSunbizPdf(file,'')
    if(!preview.companyName || !preview.floridaHeader) {
      throw new Error('The downloaded PDF must identify a Florida company and the Division of Corporations')
    }
    const parsed=await parseFloridaSunbizPdf(file,preview.companyName)
    if(!parsed.canVerify) throw new Error('Cannot verify the business name from this Sunbiz PDF')
    const entityType=parsed.entityType || (/\bP\.?L\.?L\.?C\.?$/i.test(parsed.companyName)?'Professional LLC (PLLC)':
      /\bL\.?L\.?C\.?$/i.test(parsed.companyName)?'LLC':
      /\b(?:INC\.?|CORP\.?|CORPORATION)$/i.test(parsed.companyName)?'C-Corp':'')
    if(!entityType) throw new Error('Business entity type is not recognizable. Create a FormaCorp case for the correct entity type before importing.')
    const {data:tenantId,error:tenantError}=await supabase.rpc('current_tenant_id')
    if(tenantError || !tenantId) throw new Error('Unable to verify your active office')
    const {data:client,error:clientError}=await supabase.from('clients')
      .select('id,name,tenant_id').eq('id',String(selectedClientId)).eq('tenant_id',tenantId).single()
    if(clientError || !client) throw new Error('The selected CRM client is not accessible in this office')
    // Fail before inserting a case if the separate folder migration is absent.
    const {error:folderError}=await supabase.from('client_document_folders')
      .select('id').eq('tenant_id',tenantId).eq('client_id',client.id).limit(1)
    if(folderError) throw new Error('Business folder permissions or migration are not ready: '+folderError.message)
    // Query the full current-office case list; a 500-row limit can miss an
    // existing matching company and silently create a duplicate.
    const {data:currentCases,error:caseSearchError}=await supabase.from('formacorp')
      .select('id,tenant_id,client_id,entity_name').eq('tenant_id',tenantId)
    if(caseSearchError) throw new Error('Could not verify existing office businesses: '+caseSearchError.message)
    const matchName=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'')
    const matching=(currentCases||[]).filter(c=>matchName(c.entity_name)===matchName(parsed.companyName))
    if(matching.some(c=>String(c.client_id)!==String(client.id))){
      throw new Error('A business with this legal name already belongs to a different client in this office. Review the client assignment.')
    }
    if(matching.length>1) throw new Error('Several FormaCorp cases match this company. Resolve duplicates before attaching the PDF.')
    let business=matching[0]
    if(!business){
      const {data:created,error:createError}=await supabase.from('formacorp').insert([{
        tenant_id:tenantId,client_id:client.id,client_name:client.name,
        entity_name:parsed.companyName,entity_type:entityType,state:'FL',
        principal_address:parsed.principalAddress||'',
        mailing_address:parsed.mailingAddress||'',
        registered_agent:parsed.registeredAgent||'',
        registered_agent_address:parsed.registeredAgentAddress||'',
        stage:'State Filing',fl_filing_status:'Draft',
        fl_submission_method:'sunbiz_online',
        notes:'Created from downloaded Florida Sunbiz PDF. State payment and approval must be confirmed separately.',
      }]).select('*').single()
      if(createError || !created) throw new Error('Could not create FormaCorp business: '+(createError?.message||'Insert not confirmed'))
      business=created
      // A newly imported company should appear in the lifecycle even if the staff
      // entered everything on the government website rather than in the intake.
      const {error:lifecycleError}=await supabase.from('formacorp_lifecycle').insert([{
        case_id:created.id,service_plan:'Formation',
        selected_services:['State Filing','Formation Documents','Compliance'],
        ein_status:'Not Started',operating_agreement_status:'Not Started',
        banking_status:'Not Started',annual_report_status:'Not Due',
        good_standing_status:'Unknown',registered_agent_status:'Unknown',
      }])
      if(lifecycleError) showToast('Business created but lifecycle setup needs attention: '+lifecycleError.message,'err')
    }
    await importOfficialSunbizPdf(business,file,kind)
    const {data:refreshed}=await supabase.from('formacorp').select('*')
      .eq('id',business.id).eq('tenant_id',tenantId).single()
    setDetail(refreshed||business)
    setOfficialSunbizCase(null)
  }

  async function importOfficialSunbizPdf(c, file, kind) {
    if (!c?.id || !c?.client_id || c.state !== 'FL') throw new Error('Select a saved Florida formation linked to an existing CRM client')
    const validKinds=['Filed Articles','Payment Receipt','Certificate of Status','Certified Copy']
    if (!validKinds.includes(kind)) throw new Error('Select a supported Florida document type')
    const parsed=await parseFloridaSunbizPdf(file,c.entity_name)
    if (!parsed.canVerify) throw new Error('The PDF name or Florida header did not match the selected formation; no document saved')
    const {data:tenantId,error:tenantError}=await supabase.rpc('current_tenant_id')
    if (tenantError || !tenantId || String(tenantId)!==String(c.tenant_id)) throw new Error('Cannot verify the current office')
    const client=await linkedFormationClient({client_id:c.client_id,client_name:c.client_name})
    const {data:caseRow,error:caseError}=await supabase.from('formacorp')
      .select('id,tenant_id,client_id,client_name,entity_name,entity_type,state,state_file_num,formation_date,principal_address,mailing_address,registered_agent,registered_agent_address,effective_date,ein')
      .eq('id',c.id).eq('tenant_id',tenantId).single()
    if (caseError || !caseRow || caseRow.client_id !== client.id || caseRow.entity_name !== c.entity_name) {
      throw new Error('The formation client or business changed; reload before importing')
    }
    // Reject incompatible entity types before creating folders or uploading anything.
    const updatePlan=planFloridaSunbizBusinessUpdate(parsed,caseRow,kind)
    // In the client document tree: Business / Legal company / Formation Documents.
    // All three folder rows are tenant/client scoped and guarded by the folder migration's RLS.
    async function folder(name,parentId) {
      let query=supabase.from('client_document_folders')
        .select('id').eq('tenant_id',tenantId).eq('client_id',client.id).eq('name',name)
      query=parentId?query.eq('parent_folder_id',parentId):query.is('parent_folder_id',null)
      const {data:existing,error:lookupError}=await query.limit(1).maybeSingle()
      if (lookupError) throw new Error('Business document folders unavailable: '+lookupError.message)
      if (existing) return existing.id
      const {data:created,error:createError}=await supabase.from('client_document_folders').insert([{
        tenant_id:tenantId,client_id:client.id,parent_folder_id:parentId,name,
      }]).select('id').single()
      if (created) return created.id
      if (createError?.code==='23505') {
        const {data:concurrent,error:retryError}=await query.limit(1).maybeSingle()
        if (!retryError && concurrent) return concurrent.id
      }
      throw new Error('Could not create business document folder: '+(createError?.message||'Unknown error'))
    }
    const rootId=await folder('Business',null)
    const companyId=await folder(caseRow.entity_name,rootId)
    const folderId=await folder('Formation Documents',companyId)
    const bytes=await file.arrayBuffer()
    const digest=await crypto.subtle.digest('SHA-256',bytes)
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
    const {data:existingDoc,error:duplicateError}=await supabase.from('documents')
      .select('id,storage_path').eq('tenant_id',tenantId).eq('client_id',client.id)
      .eq('file_hash',hash).limit(1).maybeSingle()
    if (duplicateError) throw duplicateError
    if (existingDoc) throw new Error('This PDF is already in the selected client document file')
    const safeName=String(file.name).replace(/[^a-z0-9_.-]/gi,'_').slice(0,110)
    const fileName=kind.replace(/ /g,'-')+'-'+Date.now()+'-'+safeName
    const storagePath=tenantId+'/formacorp/'+c.id+'/official/'+fileName
    const {error:uploadError}=await supabase.storage.from('documents')
      .upload(storagePath,new Blob([bytes],{type:'application/pdf'}),{upsert:false,contentType:'application/pdf'})
    if (uploadError) throw new Error('Sunbiz PDF storage failed: '+uploadError.message)
    // One database transaction indexes the file in BOTH authorized document
    // views. If either insert fails, neither row commits. The newly uploaded
    // storage object is removed on failure, avoiding a half-indexed client file.
    try {
      const {data:documentId,error:archiveError}=await supabase.rpc('archive_shared_sunbiz_document',{
        p_case_id:c.id,p_client_id:client.id,p_folder_id:folderId,
        p_file_name:fileName,p_original_file_name:file.name,
        p_storage_path:storagePath,p_file_hash:hash,p_file_size:file.size,
        p_kind:kind,
      })
      if(archiveError || !documentId) {
        throw new Error('Sunbiz document could not be indexed atomically: '+(archiveError?.message||'No document ID returned'))
      }
    } catch(error) {
      const {error:cleanupError}=await supabase.storage.from('documents').remove([storagePath])
      if(cleanupError) console.error('[FormaCorp] Could not clean unindexed Sunbiz PDF',cleanupError)
      throw error
    }
    // Labeled PDF data fills missing fields only. Never assume approval or payment
    // and never overwrite an employee's existing values without review.
    const {patch,conflicts}=updatePlan
    let syncWarning=''
    let caseSyncAllowed=true
    if (Object.keys(patch).length) {
      const {data:savedCase,error:metadataError}=await supabase.from('formacorp')
        .update(patch).eq('id',c.id).eq('tenant_id',tenantId).eq('client_id',client.id)
        .select('id').single()
      if (metadataError || !savedCase) {
        caseSyncAllowed=false
        syncWarning='Business details require review: '+(metadataError?.message||'Case update not confirmed')
      } else {
        setDetail(d=>d?.id===c.id?({...d,...patch}):d)
      }
    }
    // Run for existing and newly created cases even when their PDF details
    // were already present (the metadata patch can legitimately be empty).
    if(caseSyncAllowed) {
      try {await syncFormationBusiness({...caseRow,...patch},client.id)}
      catch(error) {syncWarning='Client Business Info requires review: '+error.message}
    }
    if (conflicts.length) syncWarning=[syncWarning,
      'Existing values differ from PDF: '+conflicts.map(c=>c.field).join(', ')+'; values were preserved.'].filter(Boolean).join(' ')
    if (syncWarning) showToast('PDF archived. '+syncWarning,'err')
    await load()
    if (!syncWarning) showToast('✅ Sunbiz PDF matched, business fields synchronized and file saved to Client → Business → '+caseRow.entity_name+' → Formation Documents and FormaCorp. Confirm approval separately.')
  }

  async function saveOfficialSunbizReceipt(c, receipt) {
    if (!c?.id) throw new Error('Select a saved formation case first')
    const tracking=String(receipt?.tracking||'').trim()
    const payment=String(receipt?.payment||'').trim()
    if (!tracking || !payment) {
      showToast('Florida tracking and state payment receipts are both required.', 'err')
      return
    }
    const {data:tenantId,error:tenantError}=await supabase.rpc('current_tenant_id')
    if(tenantError||!tenantId||String(tenantId)!==String(c.tenant_id)) {
      showToast('Cannot verify the currently authorized office.', 'err')
      return
    }
    const {data:latest,error:readError}=await supabase.from('formacorp')
      .select('id,fl_filing_status,fl_submission_method,fl_submitted_at')
      .eq('id',c.id).eq('tenant_id',tenantId).single()
    if(readError||!latest||latest.fl_submitted_at||['Submitted to Florida','Under State Review','Approved / Active'].includes(latest.fl_filing_status)){
      showToast('Cannot overwrite an already recorded Florida filing.', 'err')
      return
    }
    const confirmationUrl=String(receipt?.reference||'').trim()
    if(confirmationUrl){
      try {
        const url=new URL(confirmationUrl)
        if(url.protocol!=='https:'||!(['sunbiz.org','efile.sunbiz.org','dos.fl.gov'].includes(url.hostname)||url.hostname.endsWith('.sunbiz.org'))){
          throw new Error('Invalid state confirmation URL')
        }
      } catch { showToast('Use an official Florida state HTTPS confirmation URL.', 'err');return }
    }
    const patch={
      fl_filing_status:'Submitted to Florida',
      fl_submission_method:'sunbiz_online',
      fl_tracking_number:tracking,
      fl_payment_reference:payment,
      fl_confirmation_url:confirmationUrl,
      fl_submitted_at:new Date().toISOString(),
      fl_payment_status:'state_paid',
      stage:'State Filing',
    }
    const {data:updated,error:updateError}=await supabase.from('formacorp')
      .update(patch).eq('id',c.id).eq('tenant_id',tenantId)
      .is('fl_submitted_at',null).select('id').single()
    if(updateError||!updated) {
      showToast('Could not record the Florida submission: '+(updateError?.message||'no eligible case'), 'err')
      return
    }
    await recordFloridaEvent(c,'Submitted to Florida','User recorded official state tracking and state payment references; state approval not yet confirmed',{fl_submission_method:'sunbiz_online',fl_tracking_number:tracking,fl_payment_reference:payment})
    setDetail(d=>d?.id===c.id?({...d,...patch}):d)
    setOfficialSunbizCase(null)
    await load()
    showToast('Florida state receipt details recorded. Await official acceptance.')
  }

  async function markFloridaReview(c) {
    await updateFloridaCase(c, { fl_filing_status:'Under State Review' }, 'Florida filing marked under state review', 'State processing/review started')
  }

  async function approveFlorida(c) {
    const docNum = window.prompt('Florida document number:', c.state_file_num || '')
    if (!docNum?.trim()) return
    const filedDate = window.prompt('Filed / formation date (YYYY-MM-DD):', c.formation_date || new Date().toISOString().slice(0,10))
    if (!filedDate?.trim()) return
    await updateFloridaCase(c, {
      fl_filing_status:'Approved / Active',
      state_file_num:docNum.trim(),
      formation_date:filedDate.trim(),
      fl_decision_at:new Date().toISOString(),
      fl_rejection_reason:'',
      state_fee_payment_status:c.state_fee_payment_status,
      state_fee_remitted_at:c.state_fee_remitted_at,
      state_fee_remittance_reference:c.state_fee_remittance_reference,
      stage:'EIN Application',
    }, '✅ Florida approved — business marked active', 'Florida filing approved')
  }

  async function rejectFlorida(c) {
    const reason = window.prompt('Rejection / action-required reason:', c.fl_rejection_reason || '')
    if (!reason?.trim()) return
    await updateFloridaCase(c, {
      fl_filing_status:'Action Required',
      fl_rejection_reason:reason.trim(),
      fl_decision_at:new Date().toISOString(),
    }, 'Florida filing marked Action Required', 'Florida filing requires correction')
  }

  async function submitFloridaFax(c) {
    const missing = floridaSubmissionMissing(c)
    if (missing.length) { openFloridaEdit(c, missing); return }
    // Prepaid accounts are funded with Sunbiz separately. Stripe collection does not fund Sunbiz.
    if (c.state_fee_payment_intent_id || c.state_fee_payment_status === 'received') { showToast('Reconcile the separate FormaCorp charge before using a prepaid Sunbiz account.', 'err'); return }
    const digits = String(flSubmit.faxNumber || '').replace(/\D/g,'')
    if (digits.length !== 10) { showToast('Enter the 10-digit Florida fax number printed on the Sunbiz cover sheet.', 'err'); return }
    if (!flSubmit.coverSheet) { showToast('Attach the Electronic Filing Cover Sheet generated by the Prepaid Sunbiz E-File Account.', 'err'); return }
    if (!flSubmit.signedArticles) { showToast('Attach the signed Florida Articles PDF. FormaCorp will not fax an unsigned filing.', 'err'); return }
    if (!flSubmit.prepaidFundsConfirmed) { showToast('Confirm the Prepaid Sunbiz E-File Account has sufficient funds for this filing.', 'err'); return }
    setFlSubmit(x=>({...x,busy:true}))
    let packetPath = null
    let faxAccepted = false
    try {
      const packet = await buildFlFaxPacket(flSubmit.coverSheet, flSubmit.signedArticles)
      const filename = `FL-Filing-${(c.entity_name||'LLC').replace(/[^A-Za-z0-9]+/g,'-')}-${Date.now()}.pdf`
      const {data: tenantId, error: tenantError} = await supabase.rpc('current_tenant_id')
      if (tenantError || !tenantId || String(tenantId) !== String(c.tenant_id)) {
        throw new Error('This case is not in the currently authorized office.')
      }
      const {data: verified, error: caseError} = await supabase.from('formacorp')
        .select('id').eq('id', c.id).eq('tenant_id', tenantId).single()
      if (caseError || !verified) throw new Error('Cannot verify this formation case in the active office.')
      const path = `${tenantId}/formacorp/${c.id}/${filename}`
      const { error: uploadErr } = await supabase.storage.from('documents').upload(path, packet, {upsert:false,contentType:'application/pdf'})
      if (uploadErr) throw uploadErr
      packetPath = path
      const { data:u, error:signErr } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      if (signErr || !u?.signedUrl) throw signErr || new Error('Could not create secure filing packet URL')
      const { data:fax, error:faxErr } = await supabase.functions.invoke('send-fax', {
        body:{to:'+1'+digits,document_url:u.signedUrl}
      })
      if (faxErr) throw faxErr
      if (!fax?.success) throw new Error(fax?.error || 'Fax provider rejected the filing')
      faxAccepted = true
      await updateFloridaCase(c, {
        fl_filing_status:'Filing Queue',
        fl_submission_method:'prepaid_fax',
        stage:'State Filing',
      }, '📠 Fax accepted by provider. Confirm Sunbiz receipt and payment before recording state submission.', `Fax transport accepted by ${fax.provider || 'fax provider'} (fax reference ${fax.sid || 'not returned'}); state acceptance and government fee are not verified`)
    } catch (e) {
      console.error('[FormaCorp] Florida fax filing failed', e)
      if (packetPath && !faxAccepted) {
        const {error: cleanupError} = await supabase.storage.from('documents').remove([packetPath])
        if (cleanupError) console.error('[FormaCorp] Fax packet cleanup failed', cleanupError)
      }
      showToast('Florida filing fax failed: '+(e?.message || e), 'err')
    } finally {
      setFlSubmit(x=>({...x,busy:false}))
    }
  }

  async function updateStage(id, stage) {
    const c = cases.find(x=>x.id===id) || detail
    const target = STAGES.indexOf(stage)
    if (c && isFloridaFormable(c) && target >= STAGES.indexOf('State Filing')) {
      const missing = floridaMissing(c)
      if (missing.length) {
        openFloridaEdit(c, missing)
        return
      }
    }
    if (c && target >= STAGES.indexOf('EIN Application')) {
      const stateAccepted = isFloridaFormable(c)
        ? (c.fl_filing_status === 'Approved / Active' && !!String(c.state_file_num || '').trim())
        : !!String(c.state_file_num || c.formation_date || '').trim()
      if (!stateAccepted) {
        showToast('State formation must be accepted before advancing to EIN Application.', 'err')
        return
      }
    }
    if (c && target >= STAGES.indexOf('Operating Agreement') && !String(c.ein || '').trim()) {
      showToast(`Record the issued EIN before advancing to ${isFloridaCorporation(c)?'Corporate Bylaws':'Operating Agreement'}.`, 'err')
      return
    }
    if (c && target >= STAGES.indexOf('Bank Account Setup')) {
      const { data:lifecycle } = await supabase.from('formacorp_lifecycle')
        .select('operating_agreement_status,banking_status,annual_report_due_date')
        .eq('case_id', id).maybeSingle()
      if (!lifecycle || lifecycle.operating_agreement_status !== 'Signed') {
        showToast(`The ${isFloridaCorporation(c)?'Corporate Bylaws':'Operating Agreement'} must be signed before Bank Account Setup.`, 'err')
        return
      }
      if (target >= STAGES.indexOf('Compliance & Maintenance') && lifecycle.banking_status !== 'Opened') {
        showToast('Record the business bank account as opened before Compliance & Maintenance.', 'err')
        return
      }
      if (stage === 'Complete' && !lifecycle.annual_report_due_date) {
        showToast('Set the annual-report compliance deadline before closing the launch workflow.', 'err')
        return
      }
    }
    const { error } = await supabase.from('formacorp').update({ stage }).eq('id', id)
    if (error) { showToast('Error: '+error.message, 'err'); return }
    showToast(`Stage → ${stage}`)
    await load()
    if (detail?.id === id) setDetail(d => ({...d, stage}))
  }

  async function del(id) {
    const { error } = await supabase.from('formacorp').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message); setCD(null); return }
    setCases(prev => prev.filter(i => i.id !== id)); setCD(null); showToast('Deleted')
    if (detail?.id === id) setDetail(null)
  }

  const filtered = cases.filter(c => {
    const q = search.toLowerCase()
    const mq = !q || c.client_name?.toLowerCase().includes(q) || c.entity_name?.toLowerCase().includes(q)
    const ms = stageFilter === 'All' || c.stage === stageFilter
    return mq && ms
  })

  const stageColor = { 'Consultation':'#f59e0b','Documents Prep':'#3b82f6','State Filing':'#8b5cf6',
    'EIN Application':'#06b6d4','Operating Agreement':'#ec4899','Bank Account Setup':'#f97316',
    'Compliance & Maintenance':'#14b8a6','Complete':'#22c55e' }

  // Shared modal must render in both the case detail and list views.
  const editCaseModal = (modal && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="modal" style={{width:580,maxHeight:'90vh',overflowY:'auto'}}>
            <div className="mh"><span className="mt">🏢 {modal==='edit'?'Edit':'New'} Formation Case</span><button className="xbtn" onClick={()=>setModal(false)}>&times;</button></div>
            <div style={{position:'relative'}} className="field"><label>Client *</label><input value={form.client_name} onChange={e=>searchClient(e.target.value)} placeholder="Search client…"/>{showSug && sugg.length>0 && <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--sf)',border:'1px solid var(--br)',borderRadius:6,zIndex:50,maxHeight:160,overflowY:'auto'}}>{sugg.map(c=><div key={c.id} onClick={()=>chooseClient(c)} style={{padding:'8px 12px',cursor:'pointer',fontSize:13}} onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{c.name}</div>)}</div>}</div>
            <div className="fg2"><div className="field"><label>Entity Name *</label><input value={form.entity_name} onChange={e=>{fld('entity_name',e.target.value);checkNameSoon(e.target.value,form.state)}} placeholder="e.g. Smith Holdings LLC"/><NameCheckStatus state={form.state} name={form.entity_name} check={nameCheck}/></div><div className="field"><label>Entity Type *</label><select value={form.entity_type} onChange={e=>fld('entity_type',e.target.value)}>{ENTITY_TYPES.map(t=><option key={t}>{t}</option>)}</select></div></div>
            <div className="fg2"><div className="field"><label>State of Formation</label><select value={form.state} onChange={e=>{fld('state',e.target.value);checkNameSoon(form.entity_name,e.target.value)}}>{STATES.map(s=><option key={s}>{s}</option>)}</select></div><div className="field"><label>Formation Date</label><input type="date" value={form.formation_date || ''} onChange={e=>fld('formation_date',e.target.value)}/></div></div>
            <div className="field"><label>Owners / Members (names & %)</label><input value={form.owners || ''} onChange={e=>fld('owners',e.target.value)} placeholder="e.g. John Smith 60%, Jane Smith 40%"/></div>
            <div className="field"><label>Registered Agent</label><input value={form.registered_agent || ''} onChange={e=>fld('registered_agent',e.target.value)} placeholder="Name or company"/></div>
            <div className="field"><label>Business Purpose</label><input value={form.business_purpose || ''} onChange={e=>fld('business_purpose',e.target.value)} placeholder="e.g. Tax resolution consulting services"/></div>
            <FloridaFilingFields value={form} onChange={fld}/>
            <div className="fg2"><div className="field"><label>EIN (if obtained)</label><input value={form.ein || ''} onChange={e=>fld('ein',e.target.value)} placeholder="XX-XXXXXXX"/></div><div className="field"><label>State Filing Number</label><input value={form.state_file_num || ''} onChange={e=>fld('state_file_num',e.target.value)} placeholder="State-issued #"/></div></div>
            <div className="fg2"><div className="field"><label>Formation Fee</label><input type="text" inputMode="decimal" value={formatMoneyInput(form.fee)} onChange={e=>fld('fee',parseMoney(e.target.value))} placeholder="0.00"/></div><div className="field"><label>Stage</label><select value={form.stage} onChange={e=>fld('stage',e.target.value)}>{STAGES.map(s=><option key={s}>{s}</option>)}</select></div></div>
            <div className="field"><label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type="checkbox" checked={!!form.fee_paid} onChange={e=>fld('fee_paid',e.target.checked)} style={{width:'auto'}}/>Fee Paid</label></div>
            <div className="field"><label>Notes</label><textarea value={form.notes || ''} onChange={e=>fld('notes',e.target.value)} rows={3} style={{width:'100%',resize:'vertical',padding:'8px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:13,fontFamily:'inherit'}}/></div>
            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={save} disabled={saving}>{saving ? 'Saving…' : modal==='edit' ? '💾 Update Case' : '🏢 Create Formation Case'}</button>
          </div>
        </div>
      ))

  if (detail) {
    const c = cases.find(x=>x.id===detail.id) || detail
    const stageIdx = STAGES.indexOf(c.stage)
    const flSubmitMissing = floridaSubmissionMissing(c)
    const flStep = flStatusIndex(c)
    return (
      <div style={{maxWidth:900}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button className="btn sm" onClick={()=>setDetail(null)}>← Back</button>
            <span style={{color:'var(--t3)',fontSize:12}}>FormaCorp / {c.entity_name}</span>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button className="btn sm" onClick={()=>{setForm({ ...BLANK, ...c });setModal('edit')}}>✏️ Edit</button>
            <button className="btn del sm" onClick={()=>setCD(c.id)}>🗑 Delete</button>
          </div>
        </div>

        <div className="card" style={{padding:'14px 16px',marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:44,height:44,borderRadius:10,background:'var(--blt)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🏢</div>
            <div style={{flex:1}}>
              <div style={{fontSize:17,fontWeight:800}}>{c.entity_name}</div>
              <div style={{display:'flex',gap:6,marginTop:4,flexWrap:'wrap'}}>
                <span className="bdg bb" style={{fontSize:10}}>{c.entity_type}</span>
                <span className="bdg" style={{fontSize:10,background:stageColor[c.stage]+'22',color:stageColor[c.stage],border:`1px solid ${stageColor[c.stage]}44`}}>{c.stage}</span>
                <span className="bdg bn" style={{fontSize:10}}>{c.state}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{padding:'10px 16px',marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Formation Pipeline</div>
          <div style={{display:'flex',alignItems:'center',overflowX:'auto',gap:0}}>
            {STAGES.map((s,i)=>{
              const done = i <= stageIdx
              const active = i === stageIdx
              return (
                <div key={s} style={{display:'flex',alignItems:'center',flex:1,minWidth:70}}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1,cursor:'pointer'}} onClick={()=>updateStage(c.id,s)}>
                    <div style={{width:22,height:22,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,background:done?stageColor[c.stage]:'var(--s3)',color:done?'#fff':'var(--t3)',border:`2px solid ${done?stageColor[c.stage]:'var(--br)'}`,outline:active?`3px solid ${stageColor[c.stage]}44`:'none'}}>{done&&!active?'✓':i+1}</div>
                    <div style={{fontSize:8,marginTop:3,textAlign:'center',color:done?stageColor[c.stage]:'var(--t3)',whiteSpace:'nowrap',maxWidth:60,overflow:'hidden',textOverflow:'ellipsis'}}>{s==='Operating Agreement'&&isFloridaCorporation(c)?'Corporate Bylaws':s}</div>
                  </div>
                  {i < STAGES.length-1 && <div style={{height:2,flex:1,maxWidth:20,background:done&&i<stageIdx?stageColor[c.stage]:'var(--br)',marginBottom:14}}/>}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
          <div className="card" style={{padding:'12px 16px'}}>
            <div className="stitle" style={{marginBottom:8}}>Client & Entity</div>
            {[['Client',c.client_name],['Entity Name',c.entity_name],['Entity Type',c.entity_type],['State',c.state],['Formation Date',c.formation_date||'—'],['Owners/Members',c.owners||'—'],['Registered Agent',c.registered_agent||'—']].map(([l,v])=>(
              <div key={l} className="dr"><span className="dl">{l}</span><span className="dv">{v||'—'}</span></div>
            ))}
          </div>
          <div className="card" style={{padding:'12px 16px'}}>
            <div className="stitle" style={{marginBottom:8}}>Filing & Fee</div>
            {[['EIN',c.ein||'—'],['State File #',c.state_file_num||'—'],['Government Filing Amount',stateFilingAmount(c,stateReqs[c.state])?`${Number(stateFilingAmount(c,stateReqs[c.state])).toFixed(2)}`:'Set fee'],['Payment',isFloridaFormable(c)?(hasStateFilingFunds(c)?'✅ Recorded':'⏳ Pending'):(c.state_fee_payment_status==='received'||c.state_fee_payment_status==='remitted'||c.fee_paid?'✅ Recorded':'⏳ Pending')],['Business Purpose',c.business_purpose||'—']].map(([l,v])=>(
              <div key={l} className="dr"><span className="dl">{l}</span><span className="dv">{v}</span></div>
            ))}
            {!isFloridaFormable(c) && stateFilingAmount(c,stateReqs[c.state]) && !['received','remitted'].includes(c.state_fee_payment_status) && <button className="btn pri sm" style={{marginTop:8}} onClick={()=>setFeePaymentCase(c)}>💳 Pay Government Filing Amount</button>}
          </div>
        </div>

        {isFloridaFormable(c) && (
          <div className="card" style={{padding:'12px 16px',marginBottom:10,borderLeft:`3px solid ${c.fl_filing_status==='Approved / Active'?'var(--ok)':flSubmitMissing.length?'var(--warn)':'var(--blue)'}`}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:10}}>
              <div>
                <div className="stitle">☀️ Florida Formation Fulfillment</div>
                <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>One intake → authorization → official Sunbiz filing → verified state receipt → approval → EIN/compliance.</div>
              </div>
              <span className={`bdg ${c.fl_filing_status==='Approved / Active'?'bg':c.fl_filing_status==='Action Required'?'br':'bb'}`} style={{fontSize:10}}>{c.fl_filing_status || 'Draft'}</span>
            </div>

            <div style={{display:'flex',alignItems:'center',overflowX:'auto',gap:0,margin:'4px 0 12px'}}>
              {FL_FILING_STEPS.map((step,i)=>(
                <div key={step} style={{display:'flex',alignItems:'center',minWidth:105,flex:1}}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',minWidth:85}}>
                    <div style={{width:22,height:22,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,background:i<=flStep?'var(--blue)':'var(--s3)',color:i<=flStep?'#fff':'var(--t3)',border:`2px solid ${i<=flStep?'var(--blue)':'var(--br)'}`}}>{i<flStep?'✓':i+1}</div>
                    <div style={{fontSize:8,marginTop:3,textAlign:'center',color:i<=flStep?'var(--tx)':'var(--t3)',whiteSpace:'nowrap'}}>{step}</div>
                  </div>
                  {i<FL_FILING_STEPS.length-1&&<div style={{height:2,flex:1,background:i<flStep?'var(--blue)':'var(--br)',marginBottom:14}}/>}
                </div>
              ))}
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:0}}>
              {[['Principal Address',c.principal_address||'—'],['Mailing Address',c.mailing_address||c.principal_address||'—'],['Registered Agent',c.registered_agent||'—'],['Registered Agent Address',c.registered_agent_address||'—'],['Authorized Representative',c.authorized_representative||'—'],['Correspondence Email',c.correspondence_email||'—'],['Effective Date',c.effective_date||'Upon filing'],['State Filing Fee',`${Number(c.fl_state_fee || floridaStateFee(c)).toFixed(2)}`],['Tracking #',c.fl_tracking_number||'—'],['Florida Document #',c.state_file_num||'—']].map(([l,v])=>(
                <div key={l} className="dr"><span className="dl">{l}</span><span className="dv">{v}</span></div>
              ))}
            </div>

            {flSubmitMissing.length>0 && <div style={{fontSize:11,color:'var(--warn)',marginTop:8}}>Needed before submission: {flSubmitMissing.join(', ')}</div>}
            {c.fl_rejection_reason && <div style={{fontSize:11,color:'var(--warn)',marginTop:8,padding:'8px 10px',background:'var(--s2)',borderRadius:6}}>Action required: {c.fl_rejection_reason}</div>}

            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:10}}>
              <button className="btn sm" onClick={()=>openFloridaEdit(c, [])}>✏️ Edit Filing Details</button>
              {isFloridaLlc(c) && !['Submitted to Florida','Under State Review','Approved / Active'].includes(c.fl_filing_status) && <button className="btn pri sm" onClick={()=>setFloridaEditCase(c)}>📝 Edit Florida LLC Articles Intake</button>}
              {!hasStateFilingFunds(c) && <span style={{fontSize:11,color:'var(--warn)',padding:'7px 10px',border:'1px solid var(--br)',borderRadius:7}}>State fee unpaid — pay directly through official Sunbiz filing; no FormaCorp Stripe charge</span>}
              {hasStateFilingFunds(c) && <span className="bdg bg" style={{alignSelf:'center'}}>Government funds recorded</span>}
              <button className="btn sm" onClick={()=>downloadArticlesPdf(c)} disabled={pdfBusy}>{pdfBusy?'⏳ Building…':'📄 Preview Articles'}</button>
              <button className="btn sm" onClick={()=>saveArticlesToVault(c)} disabled={pdfBusy}>{pdfBusy?'⏳ Saving…':'💾 Save Draft Articles to Documents'}</button>
              {(c.fl_filing_status||'Draft')==='Draft' && <button className="btn pri sm" onClick={()=>prepareFloridaFiling(c)} disabled={flSubmitMissing.length>0}>✅ Ready to Submit</button>}
              {['Ready to Submit','Action Required'].includes(c.fl_filing_status) && <button className="btn pri sm" onClick={()=>startNativeFormation(c)}>📋 Prepare Filing Packet</button>}
              {c.fl_filing_status==='Filing Queue' && c.fl_submission_method !== 'prepaid_fax' && <button className="btn pri sm" onClick={()=>startNativeFormation(c)}>📋 Continue Filing Preparation</button>}
              {c.fl_filing_status==='Filing Queue' && c.fl_submission_method === 'prepaid_fax' && <span className="bdg bn" style={{alignSelf:'center'}}>Fax sent — state receipt not yet verified</span>}
              {['Filing Queue','Action Required'].includes(c.fl_filing_status) && <>
                <a className="btn sm" href={c.entity_type === 'Non-Profit 501(c)(3)' ? 'https://efile.sunbiz.org/np_file.html' : isFloridaCorporation(c) ? 'https://efile.sunbiz.org/profit_file.html' : 'https://efile.sunbiz.org/llc_file.html'} target="_self" style={{textDecoration:'none'}}>🏛 Open Official {isFloridaCorporation(c) ? 'Corporation' : 'LLC'} Filing</a>
                <button className="btn sm" onClick={()=>recordFloridaSubmission(c)}>🧾 Record State Submission</button>
              </>}
              {c.fl_filing_status==='Submitted to Florida' && <button className="btn sm" onClick={()=>markFloridaReview(c)}>⏳ Mark Under Review</button>}
              {['Submitted to Florida','Under State Review'].includes(c.fl_filing_status) && <button className="btn sm" onClick={()=>approveFlorida(c)}>✅ Record Approval</button>}
              {['Submitted to Florida','Under State Review'].includes(c.fl_filing_status) && <button className="btn sm" onClick={()=>rejectFlorida(c)}>⚠️ Record Rejection</button>}
            </div>

            <div style={{marginTop:10,padding:'10px 11px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,fontSize:10.5,lineHeight:1.55}}>
              <div style={{fontWeight:800,fontSize:11,marginBottom:4}}>🏢 FormaCorp filing preparation and state receipt tracking</div>
              <div>FormaCorp prepares and tracks the filing. Standard Florida submissions and government payment are completed on the official Sunbiz site. FormaCorp does not charge the same state filing fee again. After submission, enter the state's actual receipt and tracking details here.</div>
            </div>

            <details open style={{marginTop:12,paddingTop:10,borderTop:'1px solid var(--br)'}}>
              <summary style={{cursor:'pointer',fontSize:11,fontWeight:700}}>Florida submission inside FormaCorp</summary>
              <button className="btn pri sm" style={{marginTop:10,marginBottom:8}} onClick={()=>setOfficialSunbizCase(c)}>🏛️ Open Official Sunbiz Filing Workspace</button>
              <div style={{fontSize:10,color:'var(--t3)',lineHeight:1.5,margin:'6px 0 8px'}}>Prepare and save all details inside FormaCorp. The final standard state filing and government payment take place on official Sunbiz; record the official state receipt after payment. A fax-provider delivery reference is not proof that Florida accepted or paid for a filing.</div>
              <div style={{fontSize:11,fontWeight:700,margin:'10px 0 6px'}}>Prepaid Sunbiz E-File / Fax submission</div>
              <div style={{fontSize:10,color:'var(--t3)',lineHeight:1.5,marginBottom:8}}>For a frequent-filer Sunbiz account: generate the official Electronic Filing Cover Sheet in Sunbiz, attach it with the signed Articles, enter the fax number printed on that cover sheet, and FormaCorp will combine the PDFs and send the filing through the CRM fax service. Unsigned Articles are blocked. The prepaid Sunbiz account must already have enough funds for the state to process the filing.</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <input value={flSubmit.faxNumber} onChange={e=>setFlSubmit(x=>({...x,faxNumber:e.target.value}))} placeholder="Florida fax # from cover sheet" style={{width:'100%'}}/>
                <label style={{fontSize:10,color:'var(--t3)'}}>Electronic Filing Cover Sheet<input type="file" accept="application/pdf" onChange={e=>setFlSubmit(x=>({...x,coverSheet:e.target.files?.[0]||null}))} style={{width:'100%',fontSize:11,marginTop:3}}/></label>
                <label style={{fontSize:10,color:'var(--t3)'}}>Signed Florida Articles PDF<input type="file" accept="application/pdf" onChange={e=>setFlSubmit(x=>({...x,signedArticles:e.target.files?.[0]||null}))} style={{width:'100%',fontSize:11,marginTop:3}}/></label>
                <label style={{fontSize:10,color:'var(--t3)',display:'flex',alignItems:'center',gap:7,gridColumn:'1 / -1'}}><input type="checkbox" checked={!!flSubmit.prepaidFundsConfirmed} onChange={e=>setFlSubmit(x=>({...x,prepaidFundsConfirmed:e.target.checked}))} style={{width:'auto'}}/>I confirmed the Prepaid Sunbiz E-File Account has sufficient funds for this government filing.</label>
              </div>
              <button className="btn sm" style={{marginTop:8}} onClick={()=>submitFloridaFax(c)} disabled={flSubmit.busy || flSubmitMissing.length>0}>{flSubmit.busy?'⏳ Sending…':'📠 Staff: Submit via Prepaid Sunbiz Fax'}</button>
            </details>
          </div>
        )}

        {stateReqs[c.state] && (
          <div className="card" style={{padding:'12px 16px',marginBottom:10}}>
            <div className="stitle" style={{marginBottom:8}}>📍 {stateReqs[c.state].state_name} Filing Requirements</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:0}}>
              <div className="dr"><span className="dl">LLC Filing Fee</span><span className="dv">{stateReqs[c.state].llc_filing_fee||'—'}</span></div>
              <div className="dr"><span className="dl">Processing Time</span><span className="dv">{stateReqs[c.state].processing_time||'—'}</span></div>
              <div className="dr"><span className="dl">Annual Report</span><span className="dv">{stateReqs[c.state].annual_report_fee||'—'}</span></div>
            </div>
            {stateReqs[c.state].notes && <div style={{fontSize:12,color:'var(--t3)',marginTop:8,lineHeight:1.5,paddingTop:8,borderTop:'1px solid var(--br)'}}>ℹ️ {stateReqs[c.state].notes}</div>}
          </div>
        )}

        <FormaCorpLifecycle
          caseRecord={c}
          showToast={showToast}
          onCasePatch={(patch)=>{ setDetail(d=>d?.id===c.id?({...d,...patch}):d); load() }}
        />

        <div className="card" style={{padding:'12px 16px',marginBottom:10}}>
          <div className="stitle" style={{marginBottom:10}}>Quick Links & Resources</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button className="btn sm" onClick={()=>setDetail(c)}>🔢 Continue EIN in FormaCorp</button>
            {!isFloridaFormable(c) && <button className="btn sm" onClick={()=>startNativeFormation(c)}>🏛️ Continue {c.state} Filing in FormaCorp</button>}
            {isFloridaFormable(c) && <button onClick={()=>downloadArticlesPdf(c)} disabled={pdfBusy} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:7,background:'var(--s2)',border:'1px solid var(--br)',fontSize:12,fontWeight:600,color:'var(--blue)',cursor:pdfBusy?'wait':'pointer'}}>{pdfBusy ? '⏳ Building…' : '📄 Generate FL Articles PDF'}</button>}
            {c.state === 'FL' && <button onClick={()=>setLookup({ open:true, query:c.entity_name || '', running:false, result:null })} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:7,background:'var(--s2)',border:'1px solid var(--br)',fontSize:12,fontWeight:600,color:'var(--blue)',cursor:'pointer'}}>🔍 Sunbiz Lookup</button>}
            <button className="btn sm" onClick={()=>setDetail(c)}>📋 Continue Entity Workflow</button>
          </div>
        </div>

        {c.notes && <div className="card" style={{padding:'10px 16px',marginBottom:10}}><div className="stitle" style={{marginBottom:4}}>Notes</div><div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{c.notes}</div></div>}

        {lookup.open && (
          <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setLookup({ open:false, query:'', running:false, result:null })}>
            <div className="modal" style={{maxWidth:520}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><div style={{fontWeight:800,fontSize:15}}>🔍 Sunbiz Entity Lookup</div><button className="btn sm" onClick={()=>setLookup({ open:false, query:'', running:false, result:null })}>✕</button></div>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:10}}>Search the FL Division of Corporations for an existing entity by name or document number.</div>
              <div style={{display:'flex',gap:6,marginBottom:10}}>
                <input value={lookup.query} onChange={e=>setLookup(l=>({ ...l, query:e.target.value }))} onKeyDown={e=>e.key==='Enter'&&runLookup()} placeholder="e.g. Smith Holdings LLC or L23000012345" style={{flex:1,padding:'8px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:13}}/>
                <button className="btn pri" onClick={runLookup} disabled={lookup.running || !lookup.query || lookup.query.length < 3}>{lookup.running ? '…' : 'Search'}</button>
              </div>
              {lookup.result && !lookup.result.ok && <div style={{fontSize:12,color:'var(--warn)',padding:'8px 10px',background:'var(--s2)',borderRadius:6}}>Sunbiz couldn't be reached — try again in a moment, or check manually at search.sunbiz.org</div>}
              {lookup.result?.ok && lookup.result.entities?.length === 0 && <div style={{fontSize:12,color:'var(--t3)',padding:'8px 10px',background:'var(--s2)',borderRadius:6}}>No entities matched "{lookup.query}".</div>}
              {lookup.result?.ok && lookup.result.entities?.length > 0 && <div style={{maxHeight:340,overflowY:'auto'}}>{lookup.result.entities.map(m => <div key={m.documentNumber} style={{padding:'8px 10px',borderTop:'1px solid var(--br)',fontSize:12}}><div style={{fontWeight:700}}>{m.name}</div><div style={{color:'var(--t3)',marginTop:2}}>#{m.documentNumber} · {m.status}</div></div>)}</div>}
            </div>
          </div>
        )}

        {feePaymentCase && <FormaCorpStateFeeModal caseRecord={feePaymentCase} amount={Number(stateFilingAmount(feePaymentCase,stateReqs[feePaymentCase.state]) || 0)} onClose={()=>setFeePaymentCase(null)} onPaid={async(data)=>{ const paid=Number(data?.amount || stateFilingAmount(feePaymentCase,stateReqs[feePaymentCase.state]) || 0); const wasFlorida=isFloridaFormable(feePaymentCase); setFeePaymentCase(null); showToast('✅ Government filing funds collected'); await load(); setDetail(d=>d?({...d,state_fee_payment_status:'received',fee_paid:true,state_fee_collected_amount:paid,...(wasFlorida?{fl_payment_status:'received'}:{})}):d) }}/>}
        {editCaseModal}
        {floridaEditCase && <FloridaSunbizIntake key={floridaEditCase.id} initialRecord={floridaEditCase} saving={saving} onClose={()=>setFloridaEditCase(null)} onSave={saveNativeFloridaIntake}/>}
        {confirmDel && <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setCD(null)}><div className="modal" style={{maxWidth:380,textAlign:'center'}}><div style={{fontSize:36,marginBottom:12}}>🗑</div><div style={{fontWeight:700,fontSize:15,marginBottom:8}}>Delete this case?</div><div style={{fontSize:13,color:'var(--t3)',marginBottom:20}}>This cannot be undone.</div><div style={{display:'flex',gap:8}}><button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={()=>setCD(null)}>Cancel</button><button className="btn del" style={{flex:1,justifyContent:'center'}} onClick={()=>del(confirmDel)}>Delete</button></div></div></div>}
      </div>
    )
  }

  return (
    <div style={{maxWidth:1000}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <h2 style={{fontSize:15,fontWeight:700,margin:0}}>🏢 FormaCorp — Business Formation</h2>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="btn pri" onClick={()=>setOfficialSunbizCase({entity_type:'LLC'})}>🏛️ Start Official Sunbiz Filing</button>
          <button className="btn" onClick={()=>setFloridaIntake(true)}>Prepare Florida LLC in CRM</button>
          <button className="btn" onClick={openWizard}>Other Formations</button>
          <button className="btn" onClick={()=>{setForm(BLANK);setModal('new')}}>＋ New Formation Case</button>
        </div>
      </div>

      <div className="card" style={{padding:'10px 14px',marginBottom:14,borderLeft:'3px solid var(--blue)'}}>
        <div style={{fontSize:12,fontWeight:800,marginBottom:3}}>FormaCorp runs the business-formation workflow inside the CRM</div>
        <div style={{fontSize:10.5,color:'var(--t3)',lineHeight:1.55}}>Create the company record, collect filing authorization, prepare documents, track state fees and submission, record state approval, obtain the EIN, execute the operating agreement, prepare banking documents, and manage compliance without handing the case to another formation platform.</div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:8,marginBottom:14}}>
        {[
          ['Total Cases', cases.length, 'var(--tx)'], ['In Progress', cases.filter(c=>c.stage!=='Complete').length, 'var(--warn)'],
          ['Complete', cases.filter(c=>c.stage==='Complete').length, 'var(--ok)'], ['EIN Filed', cases.filter(c=>c.ein).length, 'var(--b2)'],
        ].map(([l,v,color])=><div key={l} className="card" style={{padding:'10px 14px',textAlign:'center'}}><div style={{fontWeight:800,fontSize:20,color}}>{v}</div><div style={{fontSize:10,color:'var(--t3)',marginTop:2,textTransform:'uppercase',letterSpacing:'.05em'}}>{l}</div></div>)}
      </div>

      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search client or entity…" style={{flex:1,minWidth:180,padding:'7px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}/>
        <select value={stageFilter} onChange={e=>setSF(e.target.value)} style={{padding:'7px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}><option value="All">All Stages</option>{STAGES.map(s=><option key={s}>{s}</option>)}</select>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{padding:32,textAlign:'center',color:'var(--t3)'}}><div style={{fontSize:36,marginBottom:10}}>🏢</div><div style={{fontWeight:700,fontSize:15,color:'var(--tx)',marginBottom:4}}>No formation cases yet</div><div style={{fontSize:13}}>Start a formation case here and move it through documents, state filing, approval, EIN, banking, and compliance.</div></div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:10}}>
          {filtered.map(c=><div key={c.id} className="card" style={{padding:'14px 16px',cursor:'pointer',borderTop:`3px solid ${stageColor[c.stage]||'var(--br)'}`}} onClick={()=>setDetail(c)} onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow=`0 6px 20px ${stageColor[c.stage]}22`}} onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=''}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:8}}><div><div style={{fontSize:14,fontWeight:800,marginBottom:2}}>{c.entity_name}</div><div style={{fontSize:12,color:'var(--t3)'}}><ClientLink name={c.client_name} /></div></div><span style={{fontSize:10,padding:'2px 8px',borderRadius:20,background:stageColor[c.stage]+'22',color:stageColor[c.stage],border:`1px solid ${stageColor[c.stage]}44`,fontWeight:600,whiteSpace:'nowrap'}}>{c.stage}</span></div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><span className="bdg bb" style={{fontSize:10}}>{c.entity_type}</span><span className="bdg bn" style={{fontSize:10}}>{c.state}</span>{c.ein && <span className="bdg bg" style={{fontSize:10}}>EIN ✓</span>}{c.fee_paid && <span className="bdg bg" style={{fontSize:10}}>Paid</span>}{isFloridaFormable(c) && floridaSubmissionMissing(c).length===0 && <span className="bdg bg" style={{fontSize:10}}>FL Packet Ready (not filed)</span>}</div>
            <div style={{display:'flex',gap:3,marginTop:10,alignItems:'center'}}>{STAGES.map((s,i)=><div key={s} style={{flex:1,height:4,borderRadius:2,background:i<=STAGES.indexOf(c.stage)?stageColor[c.stage]:'var(--s3)'}}/>)}</div>
            <div style={{fontSize:9,color:'var(--t3)',marginTop:3}}>Step {STAGES.indexOf(c.stage)+1} of {STAGES.length}: {c.stage}</div>
          </div>)}
        </div>
      )}

      {confirmDel && <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setCD(null)}><div className="modal" style={{maxWidth:380,textAlign:'center'}}><div style={{fontSize:36,marginBottom:12}}>🗑</div><div style={{fontWeight:700,fontSize:15,marginBottom:8}}>Delete this case?</div><div style={{fontSize:13,color:'var(--t3)',marginBottom:20}}>Cannot be undone.</div><div style={{display:'flex',gap:8}}><button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={()=>setCD(null)}>Cancel</button><button className="btn del" style={{flex:1,justifyContent:'center'}} onClick={()=>del(confirmDel)}>Delete</button></div></div></div>}

      {editCaseModal}

      {floridaIntake && <FloridaSunbizIntake saving={saving} onClose={()=>setFloridaIntake(false)} onSave={createFromWizard}/>}
      {officialSunbizCase && <SunbizFilingWorkspace caseRecord={officialSunbizCase} onClose={()=>setOfficialSunbizCase(null)} onRecordReceipt={data=>saveOfficialSunbizReceipt(officialSunbizCase,data)} onImportPdf={(file,kind,selectedClientId)=>officialSunbizCase?.id ? importOfficialSunbizPdf(officialSunbizCase,file,kind) : importFreshFloridaPdf(file,kind,selectedClientId)} clients={clients}/>}

      {wizard && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setWizard(false)}>
          <div className="modal" style={{width:560,maxHeight:'90vh',overflowY:'auto'}}>
            <div className="mh"><span className="mt">🚀 Start a Business</span><button className="xbtn" onClick={()=>setWizard(false)}>&times;</button></div>
            <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:20}}>{['Entity Type','State','Details','Services','Review'].map((label,i)=>{const step=i+1;const done=step<wStep;const active=step===wStep;return <div key={label} style={{display:'flex',alignItems:'center',flex:1}}><div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1}}><div style={{width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,background:done||active?'var(--blue)':'var(--s3)',color:done||active?'#fff':'var(--t3)',border:`2px solid ${done||active?'var(--blue)':'var(--br)'}`}}>{done?'✓':step}</div><div style={{fontSize:10,marginTop:4,color:done||active?'var(--tx)':'var(--t3)',whiteSpace:'nowrap'}}>{label}</div></div>{step<5&&<div style={{height:2,flex:1,background:done?'var(--blue)':'var(--br)',marginBottom:16}}/>}</div>})}</div>

            {wStep===1 && <div><div style={{fontSize:13,color:'var(--t3)',marginBottom:14}}>What type of business entity does your client want to form?</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>{ENTITY_TYPES.map(t=><div key={t} onClick={()=>wFld('entity_type',t)} style={{padding:'16px 14px',borderRadius:8,border:`2px solid ${wForm.entity_type===t?'var(--blue)':'var(--br)'}`,background:wForm.entity_type===t?'var(--blt)':'var(--s2)',cursor:'pointer',fontWeight:600,fontSize:13,display:'flex',alignItems:'center',gap:8,transition:'all .1s'}}><span style={{fontSize:18}}>{ENTITY_ICONS[t]||'🏢'}</span> {t}</div>)}</div></div>}

            {wStep===2 && <div><div style={{fontSize:13,color:'var(--t3)',marginBottom:14}}>Which state will {wForm.entity_type || 'the business'} be formed in?</div><select value={wForm.state} onChange={e=>{if(e.target.value==='FL' && wForm.entity_type==='LLC'){setWizard(false);setFloridaIntake(true);return}wFld('state',e.target.value);checkNameSoon(wForm.entity_name,e.target.value)}} style={{width:'100%',padding:'10px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,color:'var(--tx)',fontSize:14,marginBottom:14}}><option value="">— Select a state —</option>{STATES.map(s=><option key={s} value={s}>{stateReqs[s]?.state_name || s} ({s})</option>)}</select>{wForm.state&&stateReqs[wForm.state]&&<div className="card" style={{padding:'14px 16px',background:'var(--s2)'}}><div style={{fontWeight:700,fontSize:14,marginBottom:10}}>📍 {stateReqs[wForm.state].state_name}</div><div className="dr"><span className="dl">Filing Fee</span><span className="dv">{isFloridaFormable(wForm)?`${floridaStateFee(wForm).toFixed(2)}`:stateReqs[wForm.state].llc_filing_fee}</span></div><div className="dr"><span className="dl">Processing Time</span><span className="dv">{stateReqs[wForm.state].processing_time}</span></div><div className="dr"><span className="dl">Annual Report</span><span className="dv">{stateReqs[wForm.state].annual_report_fee}</span></div>{stateReqs[wForm.state].notes&&<div style={{fontSize:12,color:'var(--t3)',marginTop:8,paddingTop:8,borderTop:'1px solid var(--br)',lineHeight:1.5}}>ℹ️ {stateReqs[wForm.state].notes}</div>}</div>}</div>}

            {wStep===3 && <div><div style={{fontSize:13,color:'var(--t3)',marginBottom:14}}>Tell us about the business.</div><div style={{position:'relative'}} className="field"><label>Client *</label><input value={wForm.client_name} onChange={e=>wSearchClient(e.target.value)} placeholder="Search or type client name…"/>{wShowSug&&wSugg.length>0&&<div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--sf)',border:'1px solid var(--br)',borderRadius:6,zIndex:50,maxHeight:160,overflowY:'auto'}}>{wSugg.map(c=><div key={c.id} onClick={()=>chooseWizardClient(c)} style={{padding:'8px 12px',cursor:'pointer',fontSize:13}} onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{c.name}</div>)}</div>}</div><div className="field"><label>Entity Name *</label><input value={wForm.entity_name} onChange={e=>{wFld('entity_name',e.target.value);checkNameSoon(e.target.value,wForm.state)}} placeholder="e.g. Smith Holdings LLC"/><NameCheckStatus state={wForm.state} name={wForm.entity_name} check={nameCheck}/></div><div className="field"><label>Owners / Members (names & %)</label><input value={wForm.owners} onChange={e=>wFld('owners',e.target.value)} placeholder="e.g. John Smith 60%, Jane Smith 40%"/></div><div className="field"><label>Registered Agent</label><input value={wForm.registered_agent} onChange={e=>wFld('registered_agent',e.target.value)} placeholder="Self (Owner), or agency name"/></div><div className="field"><label>Business Purpose</label><input value={wForm.business_purpose} onChange={e=>wFld('business_purpose',e.target.value)} placeholder="e.g. Tax resolution consulting services"/></div><FloridaFilingFields value={wForm} onChange={wFld}/></div>}

            {wStep===4 && <div>
              <div style={{fontSize:13,color:'var(--t3)',marginBottom:14}}>Choose how far FormaCorp should carry this company after the state filing.</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr',gap:10}}>
                {Object.entries(SERVICE_PLANS).map(([id,p])=><div key={id} onClick={()=>wFld('service_plan',id)} style={{padding:'14px 16px',borderRadius:9,border:`2px solid ${wForm.service_plan===id?'var(--blue)':'var(--br)'}`,background:wForm.service_plan===id?'var(--blt)':'var(--s2)',cursor:'pointer'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}><div style={{fontWeight:800,fontSize:14}}>{p.title}</div>{wForm.service_plan===id&&<span className="bdg bb">Selected</span>}</div>
                  <div style={{fontSize:11,color:'var(--t3)',margin:'4px 0 8px',lineHeight:1.5}}>{p.desc}</div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{p.items.map(x=><span key={x} className="bdg bn" style={{fontSize:9}}>{x}</span>)}</div>
                </div>)}
              </div>
            </div>}

            {wStep===5 && <div><div style={{fontSize:13,color:'var(--t3)',marginBottom:14}}>Review the details below, then create the formation case and lifecycle.</div><div className="card" style={{padding:'14px 16px',background:'var(--s2)',marginBottom:10}}>{[['Service Plan',wForm.service_plan||'Launch'],['Entity Type',`${ENTITY_ICONS[wForm.entity_type]||'🏢'} ${wForm.entity_type}`],['State',`${stateReqs[wForm.state]?.state_name||wForm.state} (${wForm.state})`],['Client',wForm.client_name],['Entity Name',wForm.entity_name],['Owners/Members',wForm.owners||'—'],['Registered Agent',wForm.registered_agent||'—'],['Business Purpose',wForm.business_purpose||'—']].map(([l,v])=><div key={l} className="dr"><span className="dl">{l}</span><span className="dv">{v}</span></div>)}</div>{isFloridaFormable(wForm)&&<div className="card" style={{padding:'14px 16px',background:'var(--s2)',marginBottom:10}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Florida Filing Details — Final Review</div>
              {[
                ['Principal Street Address',wForm.principal_address],
                ['Mailing Address',wForm.mailing_address || wForm.principal_address || 'Same as principal'],
                ['Registered Agent',wForm.registered_agent],
                ['Registered Agent Street Address',wForm.registered_agent_address],
                ['Authorized Person',wForm.authorized_representative],
                ['Authorized Person Title',wForm.authorized_representative_title],
                ['Correspondence Email',wForm.correspondence_email],
                ['Effective Date',wForm.effective_date || 'Upon filing'],
                ['Registered Agent Signature',wForm.fl_registered_agent_signature],
                [isFloridaCorporation(wForm)?'Incorporator Signature':'Authorized Representative Signature',isFloridaCorporation(wForm)?wForm.fl_incorporator_signature:wForm.fl_authorized_representative_signature],
                ['Certificate of Status',wForm.fl_certificate_of_status?'Yes':'No'],
                ['Certified Copy',wForm.fl_certified_copy?'Yes':'No'],
                ['Filing Authorization',wForm.fl_filing_authorized?'Confirmed':'Missing'],
              ].map(([label,value])=><div className="dr" key={label}><span className="dl">{label}</span><span className="dv" style={{overflowWrap:'anywhere'}}>{value || '—'}</span></div>)}
              <div style={{fontSize:11,color:'var(--t3)',marginTop:8}}>Review every field before the official Sunbiz submission. Case creation does not file with Florida or charge its government fee.</div>
            </div>}
            {isFloridaFormable(wForm)&&<div className="card" style={{padding:'14px 16px',background:'var(--s2)',marginBottom:10}}><div style={{fontWeight:700,fontSize:13,marginBottom:8}}>☀️ Florida Filing Readiness</div>{floridaSubmissionMissing(wForm).length===0?<div style={{fontSize:12,color:'var(--ok)'}}>✅ Florida submission details and filing authorization are ready.</div>:<div style={{fontSize:12,color:'var(--warn)',lineHeight:1.5}}>Case can be created as a Consultation draft. Before state submission, complete: {floridaSubmissionMissing(wForm).join(', ')}.</div>}</div>}{stateReqs[wForm.state]&&<div className="card" style={{padding:'14px 16px',background:'var(--s2)'}}><div style={{fontWeight:700,fontSize:13,marginBottom:8}}>📍 {stateReqs[wForm.state].state_name} Filing Snapshot</div><div className="dr"><span className="dl">Filing Fee</span><span className="dv">{isFloridaFormable(wForm)?`${floridaStateFee(wForm).toFixed(2)}`:stateReqs[wForm.state].llc_filing_fee}</span></div><div className="dr"><span className="dl">Processing Time</span><span className="dv">{stateReqs[wForm.state].processing_time}</span></div><div className="dr"><span className="dl">Annual Report</span><span className="dv">{stateReqs[wForm.state].annual_report_fee}</span></div></div>}<div style={{fontSize:12,color:'var(--t3)',marginTop:10,lineHeight:1.6}}>This creates a formation case starting at the <strong>Consultation</strong> stage. You'll be taken to the case page where you can track progress through filing, EIN, governing documents, banking, and compliance.</div></div>}

            <div style={{display:'flex',justifyContent:'space-between',gap:10,marginTop:20,paddingTop:16,borderTop:'1px solid var(--br)'}}><button className="btn" onClick={()=>wStep===1?setWizard(false):setWStep(s=>s-1)}>{wStep===1?'Cancel':'← Back'}</button>{wStep<5?<button className="btn pri" disabled={(wStep===1&&!wForm.entity_type)||(wStep===2&&!wForm.state)||(wStep===3&&(!wForm.client_name||!wForm.entity_name))} onClick={()=>setWStep(s=>s+1)}>Continue →</button>:<button className="btn pri" onClick={createFromWizard} disabled={saving}>{saving?'Creating…':'🏢 Create Formation + Lifecycle'}</button>}</div>
          </div>
        </div>
      )}
    </div>
  )
}
