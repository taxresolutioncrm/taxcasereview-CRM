import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import ClientLink from '../components/ClientLink'
import { buildFlArticlesPdf, buildFlFaxPacket } from '../lib/flArticlesPdf'
import FormaCorpLifecycle from '../components/formacorp/FormaCorpLifecycle'

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
const FL_ONLINE_URL = 'https://efile.sunbiz.org/llc_file.html'

const FL_FIELDS = {
  principal_address:'', mailing_address:'', registered_agent_address:'',
  authorized_representative:'', authorized_representative_title:'AR',
  correspondence_email:'', effective_date:'', registered_agent_accepted:false,
  fl_registered_agent_signature:'', fl_authorized_representative_signature:'',
  fl_filing_authorized:false, fl_authorized_at:null,
  fl_certificate_of_status:false, fl_certified_copy:false,
  fl_filing_status:'Draft', fl_payment_status:'unpaid', fl_payment_reference:'',
  fl_submission_method:'sunbiz_online', fl_tracking_number:'', fl_pin:'',
  fl_submitted_at:null, fl_decision_at:null, fl_rejection_reason:'',
  fl_confirmation_url:'', fl_state_fee:125,
}

const BLANK = {
  client_name:'', entity_name:'', entity_type:'LLC', state:'FL',
  owners:'', registered_agent:'', business_purpose:'',
  ein:'', state_file_num:'', stage:'Consultation',
  notes:'', formation_date:'', fee:'', fee_paid:false,
  ...FL_FIELDS,
}

const WIZ_BLANK = {
  entity_type: '', state: '', client_name: '', entity_name: '',
  owners: '', registered_agent: 'Self (Owner)', business_purpose: '',
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
    items:['Everything in Formation','EIN workflow','Operating Agreement','Banking resolution & account setup','Compliance tracking'],
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

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim())
}

function floridaMissing(v = {}) {
  if (!isFloridaLlc(v)) return []
  const missing = []
  if (!String(v.entity_name || '').trim()) missing.push('Entity name')
  if (!String(v.principal_address || '').trim()) missing.push('Principal street address')
  if (!String(v.registered_agent || '').trim()) missing.push('Registered agent')
  if (!String(v.registered_agent_address || '').trim()) missing.push('Registered agent Florida street address')
  if (!String(v.authorized_representative || '').trim()) missing.push('Authorized representative / signer')
  if (!validEmail(v.correspondence_email)) missing.push('Valid correspondence email')
  if (!v.registered_agent_accepted) missing.push('Registered-agent acceptance confirmation')
  if (v.entity_type === 'Professional LLC (PLLC)' && !String(v.business_purpose || '').trim()) missing.push('Specific professional purpose')
  return missing
}

function floridaSubmissionMissing(v = {}) {
  if (!isFloridaLlc(v)) return []
  const missing = floridaMissing(v)
  if (!String(v.fl_registered_agent_signature || '').trim()) missing.push('Registered-agent typed signature')
  if (!String(v.fl_authorized_representative_signature || '').trim()) missing.push('Authorized-representative typed signature')
  if (!v.fl_filing_authorized) missing.push('Filing authorization')
  return missing
}

function floridaStateFee(v = {}) {
  return 125 + (v.fl_certificate_of_status ? 5 : 0) + (v.fl_certified_copy ? 30 : 0)
}

function flStatusIndex(v = {}) {
  const i = FL_FILING_STEPS.indexOf(v.fl_filing_status || 'Draft')
  return i < 0 ? 0 : i
}

function FloridaFilingFields({ value, onChange }) {
  if (!isFloridaLlc(value)) return null
  return (
    <div className="card" style={{padding:'12px 14px',margin:'10px 0',background:'var(--s2)'}}>
      <div className="stitle" style={{marginBottom:8}}>☀️ Florida Filing Details</div>
      <div style={{fontSize:11,color:'var(--t3)',lineHeight:1.5,marginBottom:10}}>
        Complete these once. FormaCorp uses them for the Florida filing packet, filing authorization, state submission tracking, and approval workflow.
      </div>
      <div className="field"><label>Principal Street Address *</label>
        <input value={value.principal_address || ''} onChange={e=>onChange('principal_address',e.target.value)} placeholder="Street, city, FL ZIP"/>
      </div>
      <div className="field"><label>Mailing Address</label>
        <input value={value.mailing_address || ''} onChange={e=>onChange('mailing_address',e.target.value)} placeholder="Leave blank if same as principal address"/>
      </div>
      <div className="field"><label>Registered Agent Florida Street Address *</label>
        <input value={value.registered_agent_address || ''} onChange={e=>onChange('registered_agent_address',e.target.value)} placeholder="Florida street address — no P.O. Box"/>
      </div>
      <div className="fg2">
        <div className="field"><label>Authorized Representative / Signer *</label>
          <input value={value.authorized_representative || ''} onChange={e=>onChange('authorized_representative',e.target.value)} placeholder="Person who will sign/file"/>
        </div>
        <div className="field"><label>Title</label>
          <select value={value.authorized_representative_title || 'AR'} onChange={e=>onChange('authorized_representative_title',e.target.value)}>
            <option value="AR">AR — Authorized Representative</option>
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
        <div className="field"><label>Authorized Representative Typed Signature *</label>
          <input value={value.fl_authorized_representative_signature || ''} onChange={e=>onChange('fl_authorized_representative_signature',e.target.value)} placeholder="Type authorized representative's legal name"/>
        </div>
      </div>
      <div className="fg2">
        <div className="field">
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type="checkbox" checked={!!value.fl_certificate_of_status} onChange={e=>onChange('fl_certificate_of_status',e.target.checked)} style={{width:'auto'}}/> Certificate of Status (+$5)</label>
        </div>
        <div className="field">
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type="checkbox" checked={!!value.fl_certified_copy} onChange={e=>onChange('fl_certified_copy',e.target.checked)} style={{width:'auto'}}/> Certified Copy (+$30)</label>
        </div>
      </div>
      <div className="field" style={{marginBottom:0}}>
        <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',lineHeight:1.4}}>
          <input type="checkbox" checked={!!value.fl_filing_authorized} onChange={e=>onChange('fl_filing_authorized',e.target.checked)} style={{width:'auto',marginTop:2}}/>
          <span>I authorize this office to prepare and submit the Florida LLC filing using the information above. I understand the filing becomes a public record and that typed signatures may be used only with the signer's permission.</span>
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
        <span style={{color:'var(--t3)'}}>ℹ️ Sunbiz unreachable — check manually at <a href="https://search.sunbiz.org" target="_blank" rel="noreferrer" style={{color:'var(--blue)'}}>search.sunbiz.org</a></span>
      )}
      {check.state === 'done' && check.result?.available && (
        <span style={{color:'var(--ok)'}}>✅ No exact match in FL — likely available (Sunbiz confirms at filing time)</span>
      )}
      {check.state === 'done' && check.result && !check.result.available && (
        <div>
          <div style={{color:'var(--warn)'}}>⚠️ Exact match already exists in FL:</div>
          {(check.result.exactMatches || []).slice(0,3).map(m => (
            <div key={m.documentNumber} style={{color:'var(--t2)',marginTop:2,fontSize:11}}>
              • {m.name} — {m.status} — <a href={m.detailUrl} target="_blank" rel="noreferrer" style={{color:'var(--blue)'}}>#{m.documentNumber}</a>
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
  const [wStep, setWStep] = useState(1)
  const [wForm, setWForm] = useState(WIZ_BLANK)
  const [wSugg, setWSugg] = useState([])
  const [wShowSug, setWShowSug] = useState(false)
  const [nameCheck, setNameCheck] = useState({ state:'idle', input:'', result:null })
  const nameCheckTimer = useRef(null)
  const [lookup, setLookup] = useState({ open:false, query:'', running:false, result:null })
  const [pdfBusy, setPdfBusy] = useState(false)
  const [flSubmit, setFlSubmit] = useState({ method:'sunbiz_online', faxNumber:'', coverSheet:null, signedArticles:null, busy:false })
  const [bizeeApi, setBizeeApi] = useState({ loading:true, configured:false, missing:[] })
  const [bizeeAccount, setBizeeAccount] = useState({ account_email:'', account_label:'', status:'not_configured' })
  const [bizeeAccountEdit, setBizeeAccountEdit] = useState({ account_email:'', account_label:'' })
  const [bizeeAccountSaving, setBizeeAccountSaving] = useState(false)

  async function loadBizeeAccount() {
    const { data, error } = await supabase.from('settings').select('labels').limit(1).maybeSingle()
    if (error) { console.warn('[FormaCorp] Bizee account config load failed', error.message); return }
    const cfg = data?.labels?.bizee_pro || {}
    const next = {
      account_email:String(cfg.account_email || '').trim(),
      account_label:String(cfg.account_label || '').trim(),
      status:String(cfg.status || (cfg.account_email ? 'configured' : 'not_configured')),
    }
    setBizeeAccount(next)
    setBizeeAccountEdit({ account_email:next.account_email, account_label:next.account_label })
  }

  async function saveBizeeAccount() {
    const email = String(bizeeAccountEdit.account_email || '').trim()
    if (email && !validEmail(email)) { showToast('Enter a valid Bizee account email', 'err'); return }
    setBizeeAccountSaving(true)
    try {
      const { data:row, error:loadErr } = await supabase.from('settings').select('id,labels').limit(1).maybeSingle()
      if (loadErr || !row?.id) throw loadErr || new Error('Office settings row not found')
      const labels = row.labels && typeof row.labels === 'object' ? { ...row.labels } : {}
      labels.bizee_pro = {
        account_email:email,
        account_label:String(bizeeAccountEdit.account_label || '').trim(),
        status:email ? 'configured' : 'not_configured',
        integration_mode:'partner_api',
        updated_at:new Date().toISOString(),
      }
      const { error:updateErr } = await supabase.from('settings').update({ labels }).eq('id', row.id)
      if (updateErr) throw updateErr
      await loadBizeeAccount()
      showToast(email ? '✅ Bizee Pro account linked to this CRM office' : 'Bizee Pro account link cleared')
    } catch (e) {
      showToast('Could not save Bizee Pro account: '+(e?.message || e), 'err')
    } finally {
      setBizeeAccountSaving(false)
    }
  }

  async function loadBizeeApi() {
    setBizeeApi(x=>({...x,loading:true}))
    try {
      const { data, error } = await supabase.functions.invoke('formacorp-bizee', { body:{ action:'capabilities' } })
      if (error) throw error
      setBizeeApi({
        loading:false,
        configured:!!data?.configured,
        missing:Array.isArray(data?.missing)?data.missing:[],
      })
    } catch (e) {
      setBizeeApi({loading:false,configured:false,missing:['Bizee partner API connection unavailable']})
    }
  }

  useEffect(() => { loadBizeeAccount(); loadBizeeApi() }, [])

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
      a.download = `Articles-of-Organization-${(c.entity_name || 'LLC').replace(/[^a-z0-9]+/gi,'-')}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) {
      showToast('Could not generate Articles PDF: ' + (e?.message || e), 'err')
    } finally {
      setPdfBusy(false)
    }
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
    const [{ data:c }, { data:cl }, { data:sr }] = await Promise.all([
      supabase.from('formacorp').select('*').order('created_at', { ascending:false }),
      supabase.from('clients').select('id,name,email,phone'),
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
    wFld('client_name', val)
    if (val.length < 2) { setWSugg([]); setWShowSug(false); return }
    const m = clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setWSugg(m); setWShowSug(m.length > 0)
  }

  function chooseWizardClient(c) {
    setWForm(f => ({ ...f, client_name:c.name, correspondence_email:f.correspondence_email || c.email || '' }))
    setWSugg([]); setWShowSug(false)
  }

  function openWizard() {
    setWForm(WIZ_BLANK)
    setWStep(1)
    setWizard(true)
  }

  async function createFromWizard() {
    if (!wForm.client_name || !wForm.entity_name || !wForm.entity_type || !wForm.state) {
      showToast('Please complete all required fields', 'err'); return
    }
    setSaving(true)
    const req = stateReqs[wForm.state]
    const fee = req?.llc_filing_fee ? parseFloat(req.llc_filing_fee.replace(/[^0-9.]/g, '')) : null
    const payload = {
      client_name:wForm.client_name, entity_name:wForm.entity_name, entity_type:wForm.entity_type, state:wForm.state,
      owners:wForm.owners, registered_agent:wForm.registered_agent, business_purpose:wForm.business_purpose,
      principal_address:wForm.principal_address || '', mailing_address:wForm.mailing_address || '',
      registered_agent_address:wForm.registered_agent_address || '',
      authorized_representative:wForm.authorized_representative || '',
      authorized_representative_title:wForm.authorized_representative_title || 'AR',
      correspondence_email:wForm.correspondence_email || '', effective_date:wForm.effective_date || '',
      registered_agent_accepted:!!wForm.registered_agent_accepted,
      fl_registered_agent_signature:wForm.fl_registered_agent_signature || '',
      fl_authorized_representative_signature:wForm.fl_authorized_representative_signature || '',
      fl_filing_authorized:!!wForm.fl_filing_authorized,
      fl_authorized_at:wForm.fl_filing_authorized ? new Date().toISOString() : null,
      fl_certificate_of_status:!!wForm.fl_certificate_of_status,
      fl_certified_copy:!!wForm.fl_certified_copy,
      fl_filing_status:'Draft', fl_payment_status:'unpaid', fl_submission_method:'sunbiz_online',
      fl_state_fee:floridaStateFee(wForm),
      stage:'Consultation', fee: isFloridaLlc(wForm) ? floridaStateFee(wForm) : fee, fee_paid:false, ein:'', state_file_num:'', notes:'', formation_date:'', created_at:new Date().toISOString()
    }
    const { data, error } = await supabase.from('formacorp').insert([payload]).select().single()
    if (error) { setSaving(false); showToast('Error: '+error.message, 'err'); return }
    const plan = wForm.service_plan || 'Launch'
    const selected = plan === 'Formation'
      ? ['State Filing','Formation Documents','Compliance']
      : plan === 'Full Service'
        ? ['State Filing','EIN','Operating Agreement','Banking','Compliance','S-Corp Election','Registered Agent','Company Changes']
        : ['State Filing','EIN','Operating Agreement','Banking','Compliance']
    const due = wForm.state==='FL' ? `${new Date().getFullYear()+1}-05-01` : null
    const { error:lifecycleErr } = await supabase.from('formacorp_lifecycle').insert([{
      case_id:data.id,
      service_plan:plan,
      selected_services:selected,
      ein_status:'Not Started',
      ein_responsible_party_name:wForm.authorized_representative || wForm.client_name || '',
      operating_agreement_status:'Not Started',
      banking_status:'Not Started',
      bank_account_type:'Business Checking',
      bank_signer:wForm.authorized_representative || wForm.client_name || '',
      annual_report_status:'Not Due',
      annual_report_due_date:due,
      good_standing_status:'Unknown',
      registered_agent_status:wForm.registered_agent==='Self (Owner)' ? 'Client / Self' : 'Third Party',
    }])
    setSaving(false)
    if (lifecycleErr) { showToast('Formation created, but lifecycle setup needs attention: '+lifecycleErr.message, 'err') }
    else showToast('🏢 Formation case + launch lifecycle created!')
    setWizard(false)
    await load()
    setDetail(data)
  }

  function searchClient(val) {
    fld('client_name', val)
    if (val.length < 2) { setSugg([]); setShowSug(false); return }
    const m = clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setSugg(m); setShowSug(m.length > 0)
  }

  function chooseClient(c) {
    setForm(f => ({ ...f, client_name:c.name, correspondence_email:f.correspondence_email || c.email || '' }))
    setSugg([]); setShowSug(false)
  }

  async function save() {
    if (!form.client_name || !form.entity_name || !form.entity_type) {
      showToast('Client, entity name and type required', 'err'); return
    }
    setSaving(true)
    const payload = { ...form, fee: form.fee ? parseFloat(form.fee) : null, created_at: form.created_at || new Date().toISOString() }
    if (isFloridaLlc(payload)) {
      payload.fl_state_fee = floridaStateFee(payload)
      if (payload.fl_filing_authorized && !payload.fl_authorized_at) payload.fl_authorized_at = new Date().toISOString()
      if (!payload.fl_filing_authorized) payload.fl_authorized_at = null
    }
    const { error } = modal === 'edit'
      ? await supabase.from('formacorp').update(payload).eq('id', form.id)
      : await supabase.from('formacorp').insert([payload])
    setSaving(false)
    if (error) { showToast('Error: '+error.message, 'err'); return }
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
    return updateFloridaCase(c, {
      fl_filing_status:'Filing Queue',
      fl_submission_method:method,
      fl_state_fee:floridaStateFee(c),
      stage:'State Filing',
    }, 'Florida filing moved to the filing queue', `Queued for Florida submission via ${method==='prepaid_fax'?'Prepaid Sunbiz E-File fax':'Sunbiz online'}`)
  }

  async function startBizeeFiling(c) {
    const missing = floridaSubmissionMissing(c)
    if (missing.length) { openFloridaEdit(c, missing); return }
    if (!bizeeAccount.account_email) {
      showToast('Link this CRM office to its Bizee Pro commercial account before starting a client filing.', 'err')
      return
    }

    // Never create a provider request or move the case forward until the
    // approved Bizee partner connection is actually configured.
    let api = bizeeApi
    if (!api.configured) {
      try {
        const { data, error } = await supabase.functions.invoke('formacorp-bizee', { body:{ action:'capabilities' } })
        if (error) throw error
        api = {
          loading:false,
          configured:!!data?.configured,
          missing:Array.isArray(data?.missing)?data.missing:[],
        }
        setBizeeApi(api)
      } catch (_e) {
        api = { loading:false, configured:false, missing:['Bizee partner API connection unavailable'] }
        setBizeeApi(api)
      }
    }
    if (!api.configured) {
      showToast('Bizee partner API access is not configured. No filing request was created and the case was not advanced.', 'err')
      return
    }

    const { data: existing, error:lookupErr } = await supabase
      .from('formacorp_service_requests')
      .select('*')
      .eq('case_id', c.id)
      .eq('service_type', 'Bizee Pro Formation')
      .order('requested_at', { ascending:false })
      .limit(1)
      .maybeSingle()
    if (lookupErr) { showToast('Could not check Bizee filing request: '+lookupErr.message, 'err'); return }

    let requestId = existing?.id || null
    if (!existing) {
      const { data:created, error:reqErr } = await supabase.from('formacorp_service_requests').insert([{
        case_id:c.id,
        service_type:'Bizee Pro Formation',
        status:'Requested',
        jurisdiction_state:c.state || null,
        agency:'Bizee Pro',
        provider:'bizee',
        provider_status:'ready_for_provider_mapping',
        state_fee:floridaStateFee(c),
        service_fee:null,
        payment_status:'Pending',
        notes:'Primary formation provider. Filing remains inside FormaCorp through the approved Bizee partner connection.',
      }]).select('id').single()
      if (reqErr || !created?.id) { showToast('Could not create Bizee filing request: '+(reqErr?.message || 'No request ID returned'), 'err'); return }
      requestId = created.id
    } else if (existing.provider !== 'bizee') {
      const { error:normalizeErr } = await supabase.from('formacorp_service_requests').update({
        provider:'bizee',
        provider_status:existing.provider_status || 'ready_for_provider_mapping',
        agency:'Bizee Pro',
        service_fee:null,
      }).eq('id',existing.id)
      if (normalizeErr) { showToast('Could not normalize the existing Bizee request: '+normalizeErr.message, 'err'); return }
    }

    const { data:submitData, error:submitErr } = await supabase.functions.invoke('formacorp-bizee', {
      body:{ action:'submit', case_id:c.id }
    })
    if (submitErr || !submitData?.ok) {
      if (requestId) {
        await supabase.from('formacorp_service_requests').update({
          provider_status:'submission_error',
          provider_error:submitData?.error || submitErr?.message || 'Unknown provider error',
        }).eq('id',requestId)
      }
      showToast('Bizee submission failed: '+(submitData?.error || submitErr?.message || 'Unknown provider error'), 'err')
      return
    }

    await supabase.from('formacorp_filing_events').insert([{
      case_id:c.id,
      event_type:'bizee_provider',
      status:'Submitted',
      note:'Formation order accepted by Bizee through the approved in-CRM partner connection',
      metadata:{ provider:'bizee', order_id:submitData.order_id || null, provider_status:submitData.status || null },
      created_at:new Date().toISOString(),
    }])

    await updateFloridaCase(c, {
      fl_filing_status:'Filing Queue',
      fl_state_fee:floridaStateFee(c),
      stage:'State Filing',
    }, '✅ Bizee order accepted from FormaCorp', 'Bizee provider order accepted; awaiting provider confirmation of state submission')
  }

  function openBizeeProSetup() {
    loadBizeeApi()
    showToast('Bizee Pro partner/API onboarding must be completed before in-CRM filing can be enabled.', 'err')
  }

  async function openFloridaOnlineStaff(c) {
    const ok = await queueFloridaFiling(c, 'sunbiz_online')
    if (!ok) return
    window.open(FL_ONLINE_URL, '_blank', 'noopener,noreferrer')
  }

  async function recordFloridaSubmission(c) {
    const tracking = window.prompt('Florida tracking number from the state receipt:', c.fl_tracking_number || '')
    if (!tracking?.trim()) { showToast('A Florida tracking number is required before marking the filing submitted.', 'err'); return }
    const paymentRef = window.prompt('State payment receipt/reference (optional):', c.fl_payment_reference || '')
    if (paymentRef === null) return
    const pin = window.prompt('Florida filing PIN (optional; usually supplied on rejection):', c.fl_pin || '')
    if (pin === null) return
    await updateFloridaCase(c, {
      fl_filing_status:'Submitted to Florida',
      fl_tracking_number:tracking.trim(),
      fl_payment_reference:String(paymentRef || '').trim(),
      fl_pin:String(pin || '').trim(),
      fl_submitted_at:new Date().toISOString(),
      fl_payment_status:'state_paid',
      fee_paid:true,
      stage:'State Filing',
    }, '✅ Recorded as submitted to Florida', 'State submission recorded')
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
    const digits = String(flSubmit.faxNumber || '').replace(/\D/g,'')
    if (digits.length !== 10) { showToast('Enter the 10-digit Florida fax number printed on the Sunbiz cover sheet.', 'err'); return }
    if (!flSubmit.coverSheet) { showToast('Attach the Electronic Filing Cover Sheet generated by the Prepaid Sunbiz E-File Account.', 'err'); return }
    if (!flSubmit.signedArticles) { showToast('Attach the signed Florida Articles PDF. FormaCorp will not fax an unsigned filing.', 'err'); return }
    setFlSubmit(x=>({...x,busy:true}))
    try {
      const packet = await buildFlFaxPacket(flSubmit.coverSheet, flSubmit.signedArticles)
      const filename = `FL-Filing-${(c.entity_name||'LLC').replace(/[^A-Za-z0-9]+/g,'-')}-${Date.now()}.pdf`
      const path = `formacorp/${c.id}/${filename}`
      const { error: uploadErr } = await supabase.storage.from('documents').upload(path, packet, {upsert:false,contentType:'application/pdf'})
      if (uploadErr) throw uploadErr
      const { data:u, error:signErr } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      if (signErr || !u?.signedUrl) throw signErr || new Error('Could not create secure filing packet URL')
      const { data:fax, error:faxErr } = await supabase.functions.invoke('send-fax', {
        body:{to:'+1'+digits,document_url:u.signedUrl}
      })
      if (faxErr) throw faxErr
      if (!fax?.success) throw new Error(fax?.error || 'Fax provider rejected the filing')
      await updateFloridaCase(c, {
        fl_filing_status:'Submitted to Florida',
        fl_submission_method:'prepaid_fax',
        fl_tracking_number:fax.sid || c.fl_tracking_number || '',
        fl_submitted_at:new Date().toISOString(),
        fl_payment_status:'state_account',
        fee_paid:true,
        stage:'State Filing',
      }, '📠 Florida filing fax submitted', `Submitted through Prepaid Sunbiz E-File fax via ${fax.provider || 'fax provider'}`)
    } catch (e) {
      console.error('[FormaCorp] Florida fax filing failed', e)
      showToast('Florida filing fax failed: '+(e?.message || e), 'err')
    } finally {
      setFlSubmit(x=>({...x,busy:false}))
    }
  }

  async function updateStage(id, stage) {
    const c = cases.find(x=>x.id===id) || detail
    const target = STAGES.indexOf(stage)
    if (c && isFloridaLlc(c) && target >= STAGES.indexOf('State Filing')) {
      const missing = floridaMissing(c)
      if (missing.length) {
        openFloridaEdit(c, missing)
        return
      }
    }
    if (c && target >= STAGES.indexOf('EIN Application')) {
      const stateAccepted = isFloridaLlc(c)
        ? (c.fl_filing_status === 'Approved / Active' && !!String(c.state_file_num || '').trim())
        : !!String(c.state_file_num || c.formation_date || '').trim()
      if (!stateAccepted) {
        showToast('State formation must be accepted before advancing to EIN Application.', 'err')
        return
      }
    }
    if (c && target >= STAGES.indexOf('Operating Agreement') && !String(c.ein || '').trim()) {
      showToast('Record the issued EIN before advancing to Operating Agreement.', 'err')
      return
    }
    if (c && target >= STAGES.indexOf('Bank Account Setup')) {
      const { data:lifecycle } = await supabase.from('formacorp_lifecycle')
        .select('operating_agreement_status,banking_status,annual_report_due_date')
        .eq('case_id', id).maybeSingle()
      if (!lifecycle || lifecycle.operating_agreement_status !== 'Signed') {
        showToast('The Operating Agreement must be signed before Bank Account Setup.', 'err')
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
                    <div style={{fontSize:8,marginTop:3,textAlign:'center',color:done?stageColor[c.stage]:'var(--t3)',whiteSpace:'nowrap',maxWidth:60,overflow:'hidden',textOverflow:'ellipsis'}}>{s}</div>
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
            {[['EIN',c.ein||'—'],['State File #',c.state_file_num||'—'],['Fee',c.fee?`$${c.fee}`:'—'],['Fee Paid',c.fee_paid?'✅ Yes':'⏳ Pending'],['Business Purpose',c.business_purpose||'—']].map(([l,v])=>(
              <div key={l} className="dr"><span className="dl">{l}</span><span className="dv">{v}</span></div>
            ))}
          </div>
        </div>

        {isFloridaLlc(c) && (
          <div className="card" style={{padding:'12px 16px',marginBottom:10,borderLeft:`3px solid ${c.fl_filing_status==='Approved / Active'?'var(--ok)':flSubmitMissing.length?'var(--warn)':'var(--blue)'}`}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:10}}>
              <div>
                <div className="stitle">☀️ Florida Formation Fulfillment</div>
                <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>One intake → authorization → state submission → approval → EIN/compliance.</div>
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
              <button className="btn sm" onClick={()=>downloadArticlesPdf(c)} disabled={pdfBusy}>{pdfBusy?'⏳ Building…':'📄 Preview Articles'}</button>
              {(c.fl_filing_status||'Draft')==='Draft' && <button className="btn pri sm" onClick={()=>prepareFloridaFiling(c)} disabled={flSubmitMissing.length>0}>✅ Ready to Submit</button>}
              {['Ready to Submit','Action Required'].includes(c.fl_filing_status) && <button className="btn pri sm" onClick={()=>startBizeeFiling(c)}>🟠 Start Bizee Filing</button>}
              {c.fl_filing_status==='Filing Queue' && <button className="btn pri sm" onClick={()=>startBizeeFiling(c)}>🟠 Continue Bizee Filing</button>}
              {c.fl_filing_status==='Filing Queue' && <button className="btn sm" onClick={loadBizeeApi}>↻ Check Bizee Connection</button>}
              {['Filing Queue','Action Required'].includes(c.fl_filing_status) && <button className="btn sm" onClick={()=>recordFloridaSubmission(c)}>🧾 Record State Submission</button>}
              {c.fl_filing_status==='Submitted to Florida' && <button className="btn sm" onClick={()=>markFloridaReview(c)}>⏳ Mark Under Review</button>}
              {['Submitted to Florida','Under State Review'].includes(c.fl_filing_status) && <button className="btn sm" onClick={()=>approveFlorida(c)}>✅ Record Approval</button>}
              {['Submitted to Florida','Under State Review'].includes(c.fl_filing_status) && <button className="btn sm" onClick={()=>rejectFlorida(c)}>⚠️ Record Rejection</button>}
            </div>

            <div style={{marginTop:10,padding:'10px 11px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,fontSize:10.5,lineHeight:1.55}}>
              <div style={{fontWeight:800,fontSize:11,marginBottom:4}}>🟠 Bizee Pro is the primary formation provider</div>
              <div>The Bizee workflow stays inside FormaCorp through the approved partner connection. FormaCorp keeps the client, filing request, provider status, documents, state status, and post-formation tracking in one CRM workflow.</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                <button className="btn sm" onClick={openBizeeProSetup}>＋ Check Bizee Pro Setup</button>
                <button className="btn sm" onClick={loadBizeeApi}>↻ Refresh Bizee API Status</button>
              </div>
            </div>

            <details style={{marginTop:12,paddingTop:10,borderTop:'1px solid var(--br)'}}>
              <summary style={{cursor:'pointer',fontSize:11,fontWeight:700}}>Legacy / fallback direct Florida filing tools</summary>
              <div style={{fontSize:10,color:'var(--t3)',lineHeight:1.5,margin:'6px 0 8px'}}>Use only if the office intentionally files outside Bizee. This is not the normal FormaCorp workflow.</div>
              <button className="btn sm" onClick={()=>openFloridaOnlineStaff(c)}>🏛️ Staff: Open Sunbiz Card Filing</button>
              <div style={{fontSize:11,fontWeight:700,margin:'10px 0 6px'}}>Prepaid Sunbiz E-File / Fax submission</div>
              <div style={{fontSize:10,color:'var(--t3)',lineHeight:1.5,marginBottom:8}}>For a frequent-filer Sunbiz account: generate the official Electronic Filing Cover Sheet in Sunbiz, attach it with the signed Articles, enter the fax number printed on that cover sheet, and FormaCorp will combine the PDFs and send the filing through the CRM fax service. Unsigned Articles are blocked from fax submission.</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <input value={flSubmit.faxNumber} onChange={e=>setFlSubmit(x=>({...x,faxNumber:e.target.value}))} placeholder="Florida fax # from cover sheet" style={{width:'100%'}}/>
                <label style={{fontSize:10,color:'var(--t3)'}}>Electronic Filing Cover Sheet<input type="file" accept="application/pdf" onChange={e=>setFlSubmit(x=>({...x,coverSheet:e.target.files?.[0]||null}))} style={{width:'100%',fontSize:11,marginTop:3}}/></label>
                <label style={{fontSize:10,color:'var(--t3)'}}>Signed Florida Articles PDF<input type="file" accept="application/pdf" onChange={e=>setFlSubmit(x=>({...x,signedArticles:e.target.files?.[0]||null}))} style={{width:'100%',fontSize:11,marginTop:3}}/></label>
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
            <a href="https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online" target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:7,background:'var(--s2)',border:'1px solid var(--br)',fontSize:12,fontWeight:600,color:'var(--blue)',textDecoration:'none'}}>🔢 Apply for EIN — IRS.gov</a>
            {!isFloridaLlc(c) && <a href={stateReqs[c.state]?.sos_url || `https://www.sos.${c.state?.toLowerCase()}.gov`} target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:7,background:'var(--s2)',border:'1px solid var(--br)',fontSize:12,fontWeight:600,color:'var(--blue)',textDecoration:'none'}}>🏛️ File with {c.state} Secretary of State</a>}
            {isFloridaLlc(c) && <button onClick={()=>downloadArticlesPdf(c)} disabled={pdfBusy} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:7,background:'var(--s2)',border:'1px solid var(--br)',fontSize:12,fontWeight:600,color:'var(--blue)',cursor:pdfBusy?'wait':'pointer'}}>{pdfBusy ? '⏳ Building…' : '📄 Generate FL Articles PDF'}</button>}
            {c.state === 'FL' && <button onClick={()=>setLookup({ open:true, query:c.entity_name || '', running:false, result:null })} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:7,background:'var(--s2)',border:'1px solid var(--br)',fontSize:12,fontWeight:600,color:'var(--blue)',cursor:'pointer'}}>🔍 Sunbiz Lookup</button>}
            <a href="https://www.irs.gov/businesses/small-businesses-self-employed/s-corporations" target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:7,background:'var(--s2)',border:'1px solid var(--br)',fontSize:12,fontWeight:600,color:'var(--blue)',textDecoration:'none'}}>📋 IRS S-Corp / LLC Info</a>
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
              {lookup.result?.ok && lookup.result.entities?.length > 0 && <div style={{maxHeight:340,overflowY:'auto'}}>{lookup.result.entities.map(m => <div key={m.documentNumber} style={{padding:'8px 10px',borderTop:'1px solid var(--br)',fontSize:12}}><div style={{fontWeight:700}}>{m.name}</div><div style={{color:'var(--t3)',marginTop:2}}>#{m.documentNumber} · {m.status}{m.detailUrl && <> · <a href={m.detailUrl} target="_blank" rel="noreferrer" style={{color:'var(--blue)'}}>View on Sunbiz</a></>}</div></div>)}</div>}
            </div>
          </div>
        )}

        {confirmDel && <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setCD(null)}><div className="modal" style={{maxWidth:380,textAlign:'center'}}><div style={{fontSize:36,marginBottom:12}}>🗑</div><div style={{fontWeight:700,fontSize:15,marginBottom:8}}>Delete this case?</div><div style={{fontSize:13,color:'var(--t3)',marginBottom:20}}>This cannot be undone.</div><div style={{display:'flex',gap:8}}><button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={()=>setCD(null)}>Cancel</button><button className="btn del" style={{flex:1,justifyContent:'center'}} onClick={()=>del(confirmDel)}>Delete</button></div></div></div>}
      </div>
    )
  }

  return (
    <div style={{maxWidth:1000}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <h2 style={{fontSize:15,fontWeight:700,margin:0}}>🏢 FormaCorp — Business Formation</h2>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="btn pri" onClick={loadBizeeApi} style={{display:'flex',alignItems:'center',gap:6}}>🟠 {bizeeApi.loading ? 'Checking Bizee…' : bizeeApi.configured ? 'Bizee API Connected' : 'Bizee API Not Connected'}</button>
          <button className="btn" onClick={openBizeeProSetup}>＋ Check Bizee Pro Setup</button>
          <button className="btn" onClick={()=>{setForm(BLANK);setModal('new')}}>＋ Track Bizee Filing</button>
        </div>
      </div>

      <div className="card" style={{padding:'10px 14px',marginBottom:14,borderLeft:'3px solid var(--blue)'}}>
        <div style={{fontSize:12,fontWeight:800,marginBottom:3}}>Bizee Pro partner integration</div>
        <div style={{fontSize:10.5,color:'var(--t3)',lineHeight:1.55,marginBottom:9}}>FormaCorp keeps the formation workflow inside the CRM. Bizee is connected server-side through its approved partner API; no iframe, popup, or external filing window is used.</div>
        <div style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) minmax(180px,1fr) auto',gap:8,alignItems:'end'}}>
          <div className="field" style={{margin:0}}><label>Bizee Pro Account Email</label><input type="email" value={bizeeAccountEdit.account_email} onChange={e=>setBizeeAccountEdit(x=>({...x,account_email:e.target.value}))} placeholder="office Bizee login email"/></div>
          <div className="field" style={{margin:0}}><label>Account Label</label><input value={bizeeAccountEdit.account_label} onChange={e=>setBizeeAccountEdit(x=>({...x,account_label:e.target.value}))} placeholder="e.g. TaxRes CRM / Nashville"/></div>
          <button className="btn sm" onClick={saveBizeeAccount} disabled={bizeeAccountSaving}>{bizeeAccountSaving?'Saving…':'💾 Save Office Account'}</button>
        </div>
        <div style={{fontSize:10,marginTop:7,color:bizeeApi.configured?'var(--ok)':'var(--warn)'}}>
          {bizeeApi.loading ? 'Checking Bizee partner API…' : bizeeApi.configured ? 'Bizee partner API is connected for in-CRM processing.' : `Bizee partner API is not connected yet${bizeeApi.missing?.length ? ': '+bizeeApi.missing.join(', ') : '.'}`}
        </div>
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
        <div className="card" style={{padding:32,textAlign:'center',color:'var(--t3)'}}><div style={{fontSize:36,marginBottom:10}}>🏢</div><div style={{fontWeight:700,fontSize:15,color:'var(--tx)',marginBottom:4}}>No formation cases yet</div><div style={{fontSize:13}}>Create the formation case here, then submit and track the Bizee filing through the in-CRM partner connection.</div></div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:10}}>
          {filtered.map(c=><div key={c.id} className="card" style={{padding:'14px 16px',cursor:'pointer',borderTop:`3px solid ${stageColor[c.stage]||'var(--br)'}`}} onClick={()=>setDetail(c)} onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow=`0 6px 20px ${stageColor[c.stage]}22`}} onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=''}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:8}}><div><div style={{fontSize:14,fontWeight:800,marginBottom:2}}>{c.entity_name}</div><div style={{fontSize:12,color:'var(--t3)'}}><ClientLink name={c.client_name} /></div></div><span style={{fontSize:10,padding:'2px 8px',borderRadius:20,background:stageColor[c.stage]+'22',color:stageColor[c.stage],border:`1px solid ${stageColor[c.stage]}44`,fontWeight:600,whiteSpace:'nowrap'}}>{c.stage}</span></div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}><span className="bdg bb" style={{fontSize:10}}>{c.entity_type}</span><span className="bdg bn" style={{fontSize:10}}>{c.state}</span>{c.ein && <span className="bdg bg" style={{fontSize:10}}>EIN ✓</span>}{c.fee_paid && <span className="bdg bg" style={{fontSize:10}}>Paid</span>}{isFloridaLlc(c) && floridaMissing(c).length===0 && <span className="bdg bg" style={{fontSize:10}}>FL Filing Ready</span>}</div>
            <div style={{display:'flex',gap:3,marginTop:10,alignItems:'center'}}>{STAGES.map((s,i)=><div key={s} style={{flex:1,height:4,borderRadius:2,background:i<=STAGES.indexOf(c.stage)?stageColor[c.stage]:'var(--s3)'}}/>)}</div>
            <div style={{fontSize:9,color:'var(--t3)',marginTop:3}}>Step {STAGES.indexOf(c.stage)+1} of {STAGES.length}: {c.stage}</div>
          </div>)}
        </div>
      )}

      {confirmDel && <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setCD(null)}><div className="modal" style={{maxWidth:380,textAlign:'center'}}><div style={{fontSize:36,marginBottom:12}}>🗑</div><div style={{fontWeight:700,fontSize:15,marginBottom:8}}>Delete this case?</div><div style={{fontSize:13,color:'var(--t3)',marginBottom:20}}>Cannot be undone.</div><div style={{display:'flex',gap:8}}><button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={()=>setCD(null)}>Cancel</button><button className="btn del" style={{flex:1,justifyContent:'center'}} onClick={()=>del(confirmDel)}>Delete</button></div></div></div>}

      {modal && (
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
      )}

      {wizard && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setWizard(false)}>
          <div className="modal" style={{width:560,maxHeight:'90vh',overflowY:'auto'}}>
            <div className="mh"><span className="mt">🚀 Start a Business</span><button className="xbtn" onClick={()=>setWizard(false)}>&times;</button></div>
            <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:20}}>{['Entity Type','State','Details','Services','Review'].map((label,i)=>{const step=i+1;const done=step<wStep;const active=step===wStep;return <div key={label} style={{display:'flex',alignItems:'center',flex:1}}><div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1}}><div style={{width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,background:done||active?'var(--blue)':'var(--s3)',color:done||active?'#fff':'var(--t3)',border:`2px solid ${done||active?'var(--blue)':'var(--br)'}`}}>{done?'✓':step}</div><div style={{fontSize:10,marginTop:4,color:done||active?'var(--tx)':'var(--t3)',whiteSpace:'nowrap'}}>{label}</div></div>{step<5&&<div style={{height:2,flex:1,background:done?'var(--blue)':'var(--br)',marginBottom:16}}/>}</div>})}</div>

            {wStep===1 && <div><div style={{fontSize:13,color:'var(--t3)',marginBottom:14}}>What type of business entity does your client want to form?</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>{ENTITY_TYPES.map(t=><div key={t} onClick={()=>wFld('entity_type',t)} style={{padding:'16px 14px',borderRadius:8,border:`2px solid ${wForm.entity_type===t?'var(--blue)':'var(--br)'}`,background:wForm.entity_type===t?'var(--blt)':'var(--s2)',cursor:'pointer',fontWeight:600,fontSize:13,display:'flex',alignItems:'center',gap:8,transition:'all .1s'}}><span style={{fontSize:18}}>{ENTITY_ICONS[t]||'🏢'}</span> {t}</div>)}</div></div>}

            {wStep===2 && <div><div style={{fontSize:13,color:'var(--t3)',marginBottom:14}}>Which state will {wForm.entity_type || 'the business'} be formed in?</div><select value={wForm.state} onChange={e=>{wFld('state',e.target.value);checkNameSoon(wForm.entity_name,e.target.value)}} style={{width:'100%',padding:'10px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,color:'var(--tx)',fontSize:14,marginBottom:14}}><option value="">— Select a state —</option>{STATES.map(s=><option key={s} value={s}>{stateReqs[s]?.state_name || s} ({s})</option>)}</select>{wForm.state&&stateReqs[wForm.state]&&<div className="card" style={{padding:'14px 16px',background:'var(--s2)'}}><div style={{fontWeight:700,fontSize:14,marginBottom:10}}>📍 {stateReqs[wForm.state].state_name}</div><div className="dr"><span className="dl">Filing Fee</span><span className="dv">{stateReqs[wForm.state].llc_filing_fee}</span></div><div className="dr"><span className="dl">Processing Time</span><span className="dv">{stateReqs[wForm.state].processing_time}</span></div><div className="dr"><span className="dl">Annual Report</span><span className="dv">{stateReqs[wForm.state].annual_report_fee}</span></div>{stateReqs[wForm.state].notes&&<div style={{fontSize:12,color:'var(--t3)',marginTop:8,paddingTop:8,borderTop:'1px solid var(--br)',lineHeight:1.5}}>ℹ️ {stateReqs[wForm.state].notes}</div>}</div>}</div>}

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

            {wStep===5 && <div><div style={{fontSize:13,color:'var(--t3)',marginBottom:14}}>Review the details below, then create the formation case and lifecycle.</div><div className="card" style={{padding:'14px 16px',background:'var(--s2)',marginBottom:10}}>{[['Service Plan',wForm.service_plan||'Launch'],['Entity Type',`${ENTITY_ICONS[wForm.entity_type]||'🏢'} ${wForm.entity_type}`],['State',`${stateReqs[wForm.state]?.state_name||wForm.state} (${wForm.state})`],['Client',wForm.client_name],['Entity Name',wForm.entity_name],['Owners/Members',wForm.owners||'—'],['Registered Agent',wForm.registered_agent||'—'],['Business Purpose',wForm.business_purpose||'—']].map(([l,v])=><div key={l} className="dr"><span className="dl">{l}</span><span className="dv">{v}</span></div>)}</div>{isFloridaLlc(wForm)&&<div className="card" style={{padding:'14px 16px',background:'var(--s2)',marginBottom:10}}><div style={{fontWeight:700,fontSize:13,marginBottom:8}}>☀️ Florida Filing Readiness</div>{floridaSubmissionMissing(wForm).length===0?<div style={{fontSize:12,color:'var(--ok)'}}>✅ Florida submission details and filing authorization are ready.</div>:<div style={{fontSize:12,color:'var(--warn)',lineHeight:1.5}}>Case can be created as a Consultation draft. Before state submission, complete: {floridaSubmissionMissing(wForm).join(', ')}.</div>}</div>}{stateReqs[wForm.state]&&<div className="card" style={{padding:'14px 16px',background:'var(--s2)'}}><div style={{fontWeight:700,fontSize:13,marginBottom:8}}>📍 {stateReqs[wForm.state].state_name} Filing Snapshot</div><div className="dr"><span className="dl">Filing Fee</span><span className="dv">{stateReqs[wForm.state].llc_filing_fee}</span></div><div className="dr"><span className="dl">Processing Time</span><span className="dv">{stateReqs[wForm.state].processing_time}</span></div><div className="dr"><span className="dl">Annual Report</span><span className="dv">{stateReqs[wForm.state].annual_report_fee}</span></div></div>}<div style={{fontSize:12,color:'var(--t3)',marginTop:10,lineHeight:1.6}}>This creates a formation case starting at the <strong>Consultation</strong> stage. You'll be taken to the case page where you can track progress through filing, EIN, operating agreement, and more.</div></div>}

            <div style={{display:'flex',justifyContent:'space-between',gap:10,marginTop:20,paddingTop:16,borderTop:'1px solid var(--br)'}}><button className="btn" onClick={()=>wStep===1?setWizard(false):setWStep(s=>s-1)}>{wStep===1?'Cancel':'← Back'}</button>{wStep<5?<button className="btn pri" disabled={(wStep===1&&!wForm.entity_type)||(wStep===2&&!wForm.state)||(wStep===3&&(!wForm.client_name||!wForm.entity_name))} onClick={()=>setWStep(s=>s+1)}>Continue →</button>:<button className="btn pri" onClick={createFromWizard} disabled={saving}>{saving?'Creating…':'🏢 Create Formation + Lifecycle'}</button>}</div>
          </div>
        </div>
      )}
    </div>
  )
}
