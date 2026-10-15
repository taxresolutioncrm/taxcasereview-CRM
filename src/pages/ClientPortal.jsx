import { validateFile } from '../lib/uploadUtils'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import OrganizerWizard from '../components/OrganizerWizard'
import StripeInvoicePayModal from '../components/StripeInvoicePayModal'
import StripeAddCardModal from '../components/StripeAddCardModal'

const FORM_TABS = [
  { key: '1040',  label: 'Personal Federal (1040)', quarterly: false },
  { key: 'STATE', label: 'Personal State',           quarterly: false },
  { key: 'CP',    label: 'Business CP (Federal)',    quarterly: true  },
  { key: '940',   label: 'Business 940 (FUTA)',      quarterly: false },
  { key: '941',   label: 'Business 941 (Payroll)',   quarterly: true  },
  { key: '1120S', label: 'Business 1120-S',          quarterly: false },
]

const DOC_FOLDERS = ['IRS Docs','Tax Returns','Agreements','POA & Forms','Transcripts','Correspondence','Financial Statements','Other']

const SECTIONS = [
  { key: 'compliance', label: '📋 Compliance' },
  { key: 'organizer',  label: '🧾 Tax Organizer' },
  { key: 'docs',       label: '📁 Documents' },
  { key: 'pnl',        label: '📊 P&L' },
  { key: 'payments',   label: '💳 Payments' },
  { key: 'invoices',   label: '🧾 Invoices' },
  { key: 'ie',         label: '📊 Income & Expenses' },
  { key: 'emails',     label: '📧 Emails' },
  { key: 'messages',   label: '💬 Messages' },
  { key: 'notes',      label: '📝 Notes' },
]

const IE_FIELDS = [
  { section: 'Food & Clothing', fields: [
    { k: 'food_clothing', label: 'Food, Clothing & Misc.' },
  ]},
  { section: 'Housing & Utilities', fields: [
    { k: 'housing',                    label: 'Housing / Rent / Mortgage' },
    { k: 'homeowners_renters_insurance', label: "Homeowner's / Renter's Insurance" },
    { k: 'property_taxes',             label: 'Property Taxes' },
    { k: 'hoa_dues',                   label: 'HOA Dues' },
    { k: 'electricity',                label: 'Electricity' },
    { k: 'water_sewer_trash',          label: 'Water / Sewer / Trash' },
    { k: 'cell_phone',                 label: 'Cell Phone' },
    { k: 'internet',                   label: 'Internet' },
    { k: 'cable',                      label: 'Cable / Satellite TV' },
    { k: 'maintenance',                label: 'Maintenance & Repairs' },
  ]},
  { section: 'Transportation', fields: [
    { k: 'public_transportation', label: 'Public Transportation' },
    { k: 'car_misc',              label: 'Car Operating Expenses' },
  ]},
  { section: 'Health', fields: [
    { k: 'health_insurance',     label: 'Health Insurance Premium' },
    { k: 'health_dental_vision', label: 'Dental / Vision' },
    { k: 'health_oop',           label: 'Out-of-Pocket Medical' },
  ]},
  { section: 'Family', fields: [
    { k: 'child_care',    label: 'Child Care' },
    { k: 'child_support', label: 'Child Support' },
    { k: 'court_judgment', label: 'Court Judgment Payments' },
  ]},
  { section: 'Other', fields: [
    { k: 'life_insurance',   label: 'Life Insurance' },
    { k: 'irs_installment',  label: 'IRS Installment Agreement' },
    { k: 'state_installment', label: 'State Installment Agreement' },
  ]},
]

function fmt(v) {
  const n = parseFloat(v)
  if (isNaN(n)) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ClientPortal() {
  const { id } = useParams()
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [pin, setPin] = useState('')
  const [authError, setAuthError] = useState('')
  const [checkingAuth, setCheckingAuth] = useState(false)
  // Same email + last-4-of-SSN login clients already know. The check now
  // runs server-side inside a Postgres function (portal_login) instead of
  // in the browser, so the full SSN never has to be fetched into the page
  // to be compared — the browser only ever gets back an opaque session
  // token on success, stored for this tab only.
  const [portalToken, setPortalToken] = useState(() => sessionStorage.getItem('tcr_portal_token_' + id) || '')
  // Firm logo for this portal — pulled via the anon-safe public-meta RPC so a
  // logged-out client still sees THEIR firm's branding (not a shared file).
  const [firmLogo, setFirmLogo] = useState('')
  const [firmMeta, setFirmMeta] = useState({ name: '', phone: '' })
  useEffect(() => {
    // Pass the client id from the portal URL so the RPC resolves THIS client's
    // tenant branding; without it the RPC's legacy fallback is the first
    // settings row, which showed TCR's logo on every tenant's portal.
    // Defaults above are the legacy TCR values, so a blank field never blanks the UI.
    supabase.rpc('booking_get_public_meta', { p_client_id: id }).then(({ data }) => {
      if (data?.logo_url) setFirmLogo(data.logo_url)
      setFirmMeta(m => ({
        name: (data?.firm_name || '').trim() || m.name,
        phone: (data?.phone || '').trim() || m.phone,
      }))
    }).catch(() => {})
  }, [id])

  const [section, setSection] = useState(() => new URLSearchParams(window.location.search).get('section') || 'compliance')

  // Tax Organizer
  const [organizers, setOrganizers] = useState([])
  const [activeOrganizerId, setActiveOrganizerId] = useState(null)
  const [newOrgYear, setNewOrgYear] = useState('')
  const [creatingOrg, setCreatingOrg] = useState(false)

  // Compliance
  const [records, setRecords] = useState([])
  const [activeForm, setActiveForm] = useState(null)
  // Docs
  const [docs, setDocs] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadFolder, setUploadFolder] = useState('IRS Docs')
  const fileRef = useRef(null)
  // P&L
  const [bookEntries, setBookEntries] = useState([])
  // Payments
  const [payments, setPayments] = useState([])
  const [openInvoices, setOpenInvoices] = useState([])
  const [payModalInv, setPayModalInv] = useState(null)
  const [toast, setToast] = useState('')
  // Payment plan slider
  const [planMonths, setPlanMonths] = useState(4)
  const [planLocking, setPlanLocking] = useState(false)
  const [planEditing, setPlanEditing] = useState(false)
  const [addCardModal, setAddCardModal] = useState(false)
  // Notes
  const [notes, setNotes] = useState([])
  // SMS messages
  const [smsMessages, setSmsMessages] = useState([])
  // Emails
  const [clientEmails, setClientEmails] = useState([])
  // I&E
  const [financialProfile, setFinancialProfile] = useState(null)
  const [ieEdits, setIeEdits] = useState({})
  const [ieSaving, setIeSaving] = useState(false)

  // If a token from a previous login this tab is already stashed, try it
  // immediately instead of showing the login screen again.
  useEffect(() => {
    if (portalToken) loadAllData(portalToken)
  }, [id])

  async function checkAuth() {
    setCheckingAuth(true)
    setAuthError('')
    const { data, error } = await supabase.rpc('portal_login', { p_id: id, p_email: emailInput, p_pin: pin })
    setCheckingAuth(false)
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row?.token) {
      setAuthError(error?.message || "That information doesn't match what we have on file. Contact your representative if you need help accessing your portal.")
      return
    }
    sessionStorage.setItem('tcr_portal_token_' + id, row.token)
    setPortalToken(row.token)
    setUnlocked(true)
    loadAllData(row.token)
  }

  async function loadAllData(token) {
    setLoading(true)
    const { data, error } = await supabase.rpc('portal_get_data', { p_token: token })
    setLoading(false)
    if (error || !data) {
      // Token expired or invalid — clear it and fall back to the login screen
      sessionStorage.removeItem('tcr_portal_token_' + id)
      setPortalToken('')
      setUnlocked(false)
      if (error?.message && !error.message.includes('Session expired')) setAuthError(error.message)
      return
    }
    setClient({ ...data.client, isLead: data.isLead })
    setUnlocked(true)
    setRecords(data.compliance || [])
    setDocs(data.documents || [])
    setBookEntries(data.bookkeeping || [])
    setPayments(data.payments || [])
    setNotes(data.notes || [])
    setOrganizers(data.organizers || [])
    setOpenInvoices(data.invoices || [])
    setSmsMessages(data.sms || [])
    setClientEmails(data.emails || [])
    setFinancialProfile(data.financialProfile || null)
    setIeEdits(data.financialProfile?.expenses || {})
    const firstWithData = FORM_TABS.find(t => (data.compliance || []).some(r => r.form_type === t.key))
    setActiveForm(firstWithData?.key || '1040')
  }

  async function refreshPaymentsAndInvoices() {
    if (!portalToken) return
    const { data } = await supabase.rpc('portal_get_data', { p_token: portalToken })
    if (!data) return
    setPayments(data.payments || [])
    setNotes(data.notes || [])
    setOpenInvoices(data.invoices || [])
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  async function refreshClientAutopay() {
    if (!portalToken) return
    const { data } = await supabase.rpc('portal_get_data', { p_token: portalToken })
    if (data?.client) setClient(prev => ({ ...prev, ...data.client }))
  }

  async function lockInPlan() {
    if (!totalBalance || totalBalance <= 0) { showToast('No outstanding balance to set a plan for.'); return }
    const changes = client.payment_plan_changes || 0
    if (changes >= MAX_PLAN_CHANGES) { showToast(`You have reached the maximum of 3 plan changes. Please call us at ${firmMeta.phone}.`); return }
    setPlanLocking(true)
    const monthlyAmount = Math.ceil((totalBalance / planMonths) * 100) / 100
    const nextCharge = new Date(); nextCharge.setDate(nextCharge.getDate() + 1)
    const nextChargeStr = nextCharge.toISOString().split('T')[0]
    const { data, error } = await supabase.functions.invoke('stripe-set-autopay', {
      body: { clientId: client.id, enabled: true, amount: monthlyAmount, frequency: 'monthly', nextChargeDate: nextChargeStr }
    })
    if (error || data?.error) { showToast('❌ ' + (data?.error || error?.message || 'Error setting plan')); setPlanLocking(false); return }
    await supabase.rpc('portal_action_increment_plan', { p_token: portalToken })
    setPlanLocking(false)
    setPlanEditing(false)
    showToast(`✅ Payment plan set — ${fmt(monthlyAmount)}/month for ${planMonths} months`)
    refreshClientAutopay()
  }

  async function cancelAutopay() {
    if (!confirm('Turn off monthly payments?')) return
    const { data, error } = await supabase.functions.invoke('stripe-set-autopay', { body: { clientId: client.id, enabled: false } })
    if (error || data?.error) { showToast('❌ ' + (data?.error || error.message)); return }
    showToast('Monthly payments turned off')
    refreshClientAutopay()
  }

  async function saveIE() {
    setIeSaving(true)
    const { error } = await supabase.rpc('portal_action_save_financial_profile', { p_token: portalToken, p_expenses: ieEdits })
    setIeSaving(false)
    if (error) { showToast('❌ Error saving: ' + error.message); return }
    showToast('✅ Income & Expenses saved!')
    setFinancialProfile(prev => ({ ...(prev || {}), expenses: ieEdits }))
  }

  async function createOrganizer() {
    const year = newOrgYear.trim()
    if (!year || !/^\d{4}$/.test(year)) return
    if (organizers.some(o => String(o.tax_year) === year)) {
      setActiveOrganizerId(organizers.find(o => String(o.tax_year) === year).id)
      return
    }
    setCreatingOrg(true)
    const { data, error } = await supabase.rpc('portal_action_create_organizer', {
      p_token: portalToken, p_year: year, p_client_email: client.email || '',
    })
    setCreatingOrg(false)
    if (error || !data) return
    setOrganizers(prev => [data, ...prev])
    setActiveOrganizerId(data.id)
    setNewOrgYear('')
  }

  async function handleUpload() {
    // file size check injected by uploadUtils

    const file = fileRef.current?.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error || new Error('Could not read file'))
        reader.onload = () => resolve(String(reader.result || ''))
        reader.readAsDataURL(file)
      })
      const fileBase64 = String(dataUrl).split(',')[1] || ''
      const { data, error } = await supabase.functions.invoke('portal-action', {
        body: {
          type: 'upload_document', token: portalToken,
          fileName: file.name, fileType: file.type || 'application/octet-stream',
          fileBase64, docType: uploadFolder,
        },
      })
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Upload failed')
      setDocs(data.documents || [])
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      alert('Upload failed: ' + e.message)
    } finally {
      setUploading(false)
    }
  }

  async function downloadExcel() {
    const { exportComplianceToExcel } = await import('../lib/complianceExport')
    exportComplianceToExcel(client.name, records)
  }

  if (loading) return <div style={styles.page}><div style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</div></div>

  if (!unlocked) return (
    <div style={styles.page}>
      {/* Background effects */}
      <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:0}}>
        <div style={{position:'absolute',top:'-20%',left:'-10%',width:700,height:700,borderRadius:'50%',background:'radial-gradient(circle,rgba(29,78,216,.15) 0%,transparent 65%)'}}/>
        <div style={{position:'absolute',bottom:'-20%',right:'-10%',width:800,height:800,borderRadius:'50%',background:'radial-gradient(circle,rgba(14,165,233,.1) 0%,transparent 65%)'}}/>
        <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',width:1,height:'80%',background:'linear-gradient(180deg,transparent,rgba(59,130,246,.08),transparent)'}}/>
      </div>
      <div style={{...styles.card, position:'relative', zIndex:1}}>
        {/* Logo + branding */}
        <div style={{textAlign:'center',marginBottom:28}}>
          {firmLogo && <img src={firmLogo} alt="" style={{height:60,marginBottom:16,objectFit:'contain'}} onError={e=>{e.currentTarget.style.display="none"}}/>}
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginBottom:8}}>
            <div style={{flex:1,height:'1px',background:'linear-gradient(90deg,transparent,rgba(59,130,246,.4))'}}/>
            <div style={{fontSize:10,fontWeight:800,color:'#3b82f6',letterSpacing:'.15em',textTransform:'uppercase',whiteSpace:'nowrap'}}>Client Portal</div>
            <div style={{flex:1,height:'1px',background:'linear-gradient(90deg,rgba(59,130,246,.4),transparent)'}}/>
          </div>
        </div>
        {/* Welcome message */}
        <div style={{background:'rgba(59,130,246,.08)',border:'1px solid rgba(59,130,246,.2)',borderRadius:12,padding:'14px 16px',marginBottom:20,textAlign:'center'}}>
          <div style={{fontSize:15,fontWeight:700,color:'#f1f5f9',marginBottom:4}}>Welcome back</div>
          <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.5}}>Please verify your identity to securely access your account.</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={styles.label}>Email Address</label>
          <input value={emailInput} onChange={e => { setEmailInput(e.target.value); setAuthError('') }} placeholder="you@email.com" type="email" style={styles.textInput} />
        </div>
        <div style={{ marginBottom: 4 }}>
          <label style={styles.label}>Last 4 Digits of SSN</label>
          <input value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setAuthError('') }}
            onKeyDown={e => e.key === 'Enter' && !checkingAuth && checkAuth()} placeholder="••••" maxLength={4} inputMode="numeric"
            style={{ ...styles.textInput, fontSize: 20, letterSpacing: 6, textAlign: 'center' }} />
        </div>
        {authError && <div style={{ color: '#f87171', fontSize: 12, textAlign: 'center', marginTop: 10 }}>{authError}</div>}
        <button onClick={checkAuth} disabled={pin.length !== 4 || !emailInput.trim() || checkingAuth} style={{ ...styles.bigBtn, opacity: (pin.length === 4 && emailInput.trim() && !checkingAuth) ? 1 : 0.5 }}>
          {checkingAuth ? 'Verifying…' : 'View My Information'}
        </button>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center', marginTop: 16 }}>
          Your information is private and only visible with this verification.
        </div>
      </div>
    </div>
  )

  const recordsForTab = records.filter(r => r.form_type === activeForm)
  const tabsWithData = FORM_TABS.filter(t => records.some(r => r.form_type === t.key))
  const activeMeta = FORM_TABS.find(t => t.key === activeForm)
  const docsByFolder = {}
  DOC_FOLDERS.forEach(f => { docsByFolder[f] = [] })
  docs.forEach(d => { const f = d.docType || 'Other'; if (!docsByFolder[f]) docsByFolder[f] = []; docsByFolder[f].push(d) })
  const totalIn = bookEntries.filter(e => parseFloat(e.amount || 0) > 0).reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const totalOut = Math.abs(bookEntries.filter(e => parseFloat(e.amount || 0) < 0).reduce((s, e) => s + parseFloat(e.amount || 0), 0))
  const totalBalance = openInvoices.reduce((s, inv) => {
    const subtotal = parseFloat(inv.total || 0), tax = subtotal * (parseFloat(inv.taxRate || 0) / 100), paidAmt = parseFloat(inv.paid || 0)
    return s + ((subtotal + tax) - paidAmt)
  }, 0)
  const monthlyPayment = totalBalance > 0 ? Math.ceil((totalBalance / planMonths) * 100) / 100 : 0
  const planChanges = client.payment_plan_changes || 0
  const MAX_PLAN_CHANGES = 3
  const canEditPlan = planChanges < MAX_PLAN_CHANGES

  return (
    <div style={styles.page}>
      {/* Background effects */}
      <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:0}}>
        <div style={{position:'absolute',top:'-15%',left:'-8%',width:700,height:700,borderRadius:'50%',background:'radial-gradient(circle,rgba(29,78,216,.14) 0%,transparent 65%)'}}/>
        <div style={{position:'absolute',bottom:'-20%',right:'-10%',width:800,height:800,borderRadius:'50%',background:'radial-gradient(circle,rgba(14,165,233,.1) 0%,transparent 65%)'}}/>
        <div style={{position:'absolute',top:'30%',right:'25%',width:400,height:400,borderRadius:'50%',background:'radial-gradient(circle,rgba(99,102,241,.07) 0%,transparent 70%)'}}/>
        <div style={{position:'absolute',inset:0,backgroundImage:'radial-gradient(rgba(255,255,255,.015) 1px,transparent 1px)',backgroundSize:'40px 40px'}}/>
      </div>
      <div style={{position:'relative',zIndex:1,width:'100%',display:'flex',alignItems:'flex-start',justifyContent:'center',minHeight:'100vh',paddingTop:32,paddingBottom:32}}>
      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#0f172a', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '10px 18px', color: '#f1f5f9', fontSize: 13, fontWeight: 600, zIndex: 1100, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>{toast}</div>}
      <div style={{...styles.card,maxWidth:1060,background:'linear-gradient(145deg,rgba(15,25,50,.97) 0%,rgba(8,15,32,.99) 100%)',border:'1px solid rgba(255,255,255,.1)',boxShadow:'0 48px 120px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.07)'}}>
        {/* ── Premium Header ── */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,paddingBottom:20,borderBottom:'1px solid rgba(255,255,255,.08)',flexWrap:'wrap',gap:12}}>
          <div style={{display:'flex',alignItems:'center',gap:16}}>
            {firmLogo && <img src={firmLogo} alt=""
              style={{height:52,objectFit:'contain',filter:'drop-shadow(0 2px 8px rgba(59,130,246,.3))'}}
              onError={e=>{e.currentTarget.style.display="none"}}/>}
            <div>
              <div style={{fontSize:24,fontWeight:800,color:'#fff',letterSpacing:'-.03em',lineHeight:1.1}}>{client?.name}</div>
              <div style={{fontSize:11,color:'#60a5fa',marginTop:4,fontWeight:700,letterSpacing:'.1em',textTransform:'uppercase',display:'flex',alignItems:'center',gap:6}}>
                <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#22c55e'}}/>
                Secure Client Portal
              </div>
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:11,color:'#64748b',marginBottom:4}}>Need help? Call us anytime</div>
            <a href={`tel:${firmMeta.phone.replace(/\D/g, '') || '8883345052'}`} style={{
              display:'inline-block', padding:'10px 18px',
              background:'linear-gradient(135deg,rgba(59,130,246,.3),rgba(37,99,235,.2))',
              border:'1px solid rgba(59,130,246,.45)', borderRadius:10,
              fontSize:22, fontWeight:900, color:'#fff', textDecoration:'none', letterSpacing:'-.01em',
              boxShadow:'0 0 18px rgba(59,130,246,.2)'
            }}>{firmMeta.phone}</a>
            <div style={{fontSize:11,color:'#4ade80',marginTop:6,fontWeight:600}}>✓ Encrypted · Secure</div>
          </div>
        </div>

        <div style={{display:'flex',gap:4,marginBottom:24,flexWrap:'wrap',background:'rgba(0,0,0,.25)',borderRadius:12,padding:4,border:'1px solid rgba(255,255,255,.06)'}}>
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => setSection(s.key)} style={{
              padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: 'none',
              background: section === s.key ? 'linear-gradient(135deg,rgba(59,130,246,.4),rgba(37,99,235,.3))' : 'transparent',
              color: section === s.key ? '#e0effe' : '#4b5563',
              boxShadow: section === s.key ? '0 2px 16px rgba(59,130,246,.3), inset 0 1px 0 rgba(255,255,255,.1)' : 'none',
              transition: 'all .15s',
              whiteSpace: 'nowrap',
            }}>{s.label}</button>
          ))}
        </div>

        {/* ── COMPLIANCE ── */}
        {section === 'compliance' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={downloadExcel} disabled={records.length === 0} style={styles.downloadBtn}>⬇ Download as Excel</button>
            </div>
            {records.length === 0 ? (
              <Empty msg="No compliance information has been entered yet." />
            ) : (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                  {tabsWithData.map(t => (
                    <button key={t.key} onClick={() => setActiveForm(t.key)} style={{
                      padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: '1px solid ' + (activeForm === t.key ? '#3b82f6' : 'rgba(255,255,255,.15)'),
                      background: activeForm === t.key ? 'rgba(59,130,246,.2)' : 'rgba(255,255,255,.05)',
                      color: activeForm === t.key ? '#93c5fd' : '#94a3b8',
                    }}>{t.label}</button>
                  ))}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.tr}>
                        {['Tax Year', activeMeta?.quarterly ? 'Quarter' : null, 'Filed Status', 'Amount', 'Credits', activeMeta?.quarterly ? 'Deposits' : null, 'Lien', 'CSED'].filter(Boolean).map(h => (
                          <th key={h} style={styles.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...recordsForTab].sort((a, b) => (b.tax_year - a.tax_year) || ((b.quarter || 0) - (a.quarter || 0))).map(r => (
                        <tr key={r.id} style={styles.tr}>
                          <td style={{ ...styles.td, fontWeight: 700, color: '#f1f5f9' }}>{r.tax_year}</td>
                          {activeMeta?.quarterly && <td style={styles.td}>Q{r.quarter || '—'}</td>}
                          <td style={styles.td}>{r.filed_status || '—'}</td>
                          <td style={styles.td}>{fmt(r.amount)}</td>
                          <td style={styles.td}>{fmt(r.credits)}</td>
                          {activeMeta?.quarterly && <td style={styles.td}>{fmt(r.deposit)}</td>}
                          <td style={styles.td}>{r.lien === 'Yes' ? <span style={{ color: '#f87171', fontWeight: 700 }}>Yes</span> : <span style={{ color: '#64748b' }}>{r.lien || '—'}</span>}</td>
                          <td style={styles.td}>{r.csed || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAX ORGANIZER ── */}
        {section === 'organizer' && (
          <div>
            {activeOrganizerId ? (
              <div>
                <button onClick={()=>setActiveOrganizerId(null)} style={{...styles.downloadBtn, marginBottom:14}}>← Back to Organizer List</button>
                <OrganizerWizard organizerId={activeOrganizerId} embedded={true} onComplete={loadAllData}/>
              </div>
            ) : (
              <div>
                <div style={{ fontSize:12.5, color:'#94a3b8', marginBottom:16, lineHeight:1.6 }}>
                  Fill out your tax organizer for any year you need filed. Your progress is saved automatically as you go.
                </div>
                <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
                  <input type="text" placeholder="e.g. 2026" value={newOrgYear} onChange={e=>setNewOrgYear(e.target.value)}
                    style={{ width:120, padding:'9px 12px', background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.15)', borderRadius:8, color:'#fff', fontSize:13 }} maxLength={4}/>
                  <button onClick={createOrganizer} disabled={creatingOrg || !newOrgYear.trim()} style={styles.downloadBtn}>
                    {creatingOrg ? 'Starting…' : '+ Start New Tax Year'}
                  </button>
                </div>
                {organizers.length === 0 ? (
                  <Empty msg="You haven't started a tax organizer yet." />
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {organizers.map(o => (
                      <button key={o.id} onClick={()=>setActiveOrganizerId(o.id)} style={{
                        display:'flex', justifyContent:'space-between', alignItems:'center',
                        padding:'12px 16px', borderRadius:9, cursor:'pointer', textAlign:'left',
                        border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.04)', color:'#e2e8f0'
                      }}>
                        <span style={{ fontWeight:700, fontSize:13.5 }}>Tax Year {o.tax_year}</span>
                        <span style={{
                          fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20,
                          background: o.status === 'Submitted' ? 'rgba(34,197,94,.18)' : 'rgba(251,191,36,.18)',
                          color: o.status === 'Submitted' ? '#4ade80' : '#fbbf24'
                        }}>{o.status === 'Submitted' ? '✅ Submitted' : '🕓 In Progress'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {section === 'docs' && (
          <div>
            <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 14, marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f1f5f9', marginBottom: 10 }}>📤 Upload a Document</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={uploadFolder} onChange={e => setUploadFolder(e.target.value)} style={styles.select}>
                  {DOC_FOLDERS.map(f => <option key={f}>{f}</option>)}
                </select>
                <input ref={fileRef} type="file" style={{ fontSize: 12, color: '#cbd5e1' }} />
                <button onClick={handleUpload} disabled={uploading} style={styles.downloadBtn}>{uploading ? 'Uploading…' : '⬆ Upload'}</button>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Files you upload here go straight to your file with your representative.</div>
            </div>
            {docs.length === 0 ? <Empty msg="No documents yet." /> : (
              DOC_FOLDERS.filter(f => docsByFolder[f]?.length).map(folder => (
                <div key={folder} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{folder}</div>
                  {docsByFolder[folder].map(d => (
                    <a key={d.id} href={d.file_url} target="_blank" rel="noreferrer" style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', marginBottom: 6,
                      background: 'rgba(255,255,255,.04)', borderRadius: 8, textDecoration: 'none',
                      border: '1px solid rgba(255,255,255,.08)',
                    }}>
                      <span style={{ fontSize: 16 }}>📄</span>
                      <span style={{ fontSize: 13, color: '#f1f5f9', flex: 1 }}>{d.name || d.file_name}</span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>{d.created_at ? new Date(d.created_at).toLocaleDateString() : ''}</span>
                    </a>
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── P&L ── */}
        {section === 'pnl' && (
          <div>
            {bookEntries.length === 0 ? <Empty msg="No bookkeeping entries yet." /> : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 18 }}>
                  <StatBox label="Income" value={fmt(totalIn)} color="#4ade80" />
                  <StatBox label="Expenses" value={fmt(totalOut)} color="#f87171" />
                  <StatBox label="Net" value={fmt(totalIn - totalOut)} color={totalIn - totalOut >= 0 ? '#4ade80' : '#f87171'} />
                </div>
                <table style={styles.table}>
                  <thead><tr style={styles.tr}>{['Date', 'Description', 'Category', 'Amount'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {bookEntries.map(e => (
                      <tr key={e.id} style={styles.tr}>
                        <td style={{ ...styles.td, color: '#94a3b8', fontSize: 11.5 }}>{e.date || '—'}</td>
                        <td style={{ ...styles.td, fontWeight: 600, color: '#f1f5f9' }}>{e.description || '—'}</td>
                        <td style={styles.td}>{e.category || '—'}</td>
                        <td style={{ ...styles.td, fontWeight: 700, color: parseFloat(e.amount || 0) >= 0 ? '#4ade80' : '#f87171' }}>{fmt(Math.abs(parseFloat(e.amount || 0)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {/* ── PAYMENTS ── */}
        {section === 'payments' && (
          <div>
            {/* Total balance banner */}
            {totalBalance > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.25)', borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '.05em' }}>Total Balance Due</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              </div>
            )}

            {/* Payment plan slider */}
            {!client.isLead && totalBalance > 0 && (
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, padding: '18px 16px', marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 14 }}>📅 Monthly Payment Plan</div>

                {client.autopay_enabled && !planEditing ? (
                  // Active plan view
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: '#4ade80' }}>
                          ${parseFloat(client.autopay_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}<span style={{ fontSize: 13, fontWeight: 400, color: '#94a3b8' }}> / month</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
                          Next charge: {client.autopay_next_charge || '—'}
                          {client.payment_method_brand ? ` · ${client.payment_method_brand} ····${client.payment_method_last4 || ''}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {canEditPlan && (
                          <button onClick={() => setPlanEditing(true)} style={{ padding: '7px 14px', background: 'rgba(59,130,246,.2)', border: '1px solid rgba(59,130,246,.4)', borderRadius: 6, color: '#93c5fd', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                            ✏️ Change Plan ({MAX_PLAN_CHANGES - planChanges} change{MAX_PLAN_CHANGES - planChanges !== 1 ? 's' : ''} left)
                          </button>
                        )}
                        <button onClick={cancelAutopay} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(248,113,113,.4)', borderRadius: 6, color: '#f87171', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Turn Off</button>
                      </div>
                    </div>
                    {!canEditPlan && (
                      <div style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,.1)', borderRadius: 6, padding: '7px 10px' }}>
                        🔒 You've made the maximum of {MAX_PLAN_CHANGES} plan changes. Please call us at <strong>{firmMeta.phone}</strong> to make further changes.
                      </div>
                    )}
                  </div>
                ) : (
                  // Slider to pick 1–8 months
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>Drag to select your preferred payment term:</div>
                    <div style={{ textAlign: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 36, fontWeight: 900, color: '#fff', lineHeight: 1 }}>
                        ${monthlyPayment.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        <span style={{ fontSize: 14, fontWeight: 400, color: '#94a3b8' }}> / month</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                        {planMonths} month{planMonths !== 1 ? 's' : ''} · ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} total
                      </div>
                    </div>
                    <div style={{ padding: '0 8px', marginBottom: 18 }}>
                      <input
                        type="range" min={1} max={8} step={1}
                        value={planMonths}
                        onChange={e => setPlanMonths(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer', height: 6 }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                        {[1,2,3,4,5,6,7,8].map(m => (
                          <span key={m} style={{ fontSize: 10, color: planMonths === m ? '#60a5fa' : '#475569', fontWeight: planMonths === m ? 700 : 400 }}>{m}mo</span>
                        ))}
                      </div>
                    </div>

                    {/* Summary */}
                    <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
                      <span style={{ color: '#fff', fontWeight: 700 }}>{planMonths} × ${monthlyPayment.toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo</span>
                      {' '}toward your <span style={{ color: '#60a5fa' }}>${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> balance
                      {planChanges > 0 && (
                        <span style={{ marginLeft: 10, color: '#f59e0b' }}>
                          · {MAX_PLAN_CHANGES - planChanges} change{MAX_PLAN_CHANGES - planChanges !== 1 ? 's' : ''} remaining after this
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
                      {planEditing && (
                        <button onClick={() => setPlanEditing(false)} style={{ padding: '9px 16px', background: 'transparent', border: '1px solid rgba(255,255,255,.2)', borderRadius: 7, color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                      )}
                      {!client.default_payment_method_id ? (
                        <div style={{ width: '100%' }}>
                          <div style={{ fontSize: 12, color: '#fbbf24', background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                            ⚠️ <strong>No card on file.</strong> Add a payment method first to set up monthly payments.
                          </div>
                          <button onClick={() => setAddCardModal(true)} style={{ width: '100%', padding: '13px 28px', background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', borderRadius: 9, color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                            💳 Add Payment Method
                          </button>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, color: '#4ade80', marginRight: 'auto' }}>
                            ✓ Card on file: {client.payment_method_brand || 'Card'} ····{client.payment_method_last4 || ''}
                            <span onClick={() => setAddCardModal(true)} style={{ marginLeft: 10, color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline' }}>Change</span>
                          </div>
                          <button onClick={lockInPlan} disabled={planLocking} style={{ padding: '13px 28px', background: '#1A7FD4', border: 'none', borderRadius: 9, color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', opacity: planLocking ? 0.7 : 1 }}>
                            {planLocking ? 'Locking in…' : `Lock In — ${fmt(monthlyPayment)}/mo`}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Payment history */}
            {payments.length === 0 ? <Empty msg="No payments on file yet." /> : (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Payment History</div>
                <table style={styles.table}>
                  <thead><tr style={styles.tr}>{['Date', 'Amount', 'Method', 'Status'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} style={styles.tr}>
                        <td style={{ ...styles.td, color: '#94a3b8', fontSize: 11.5 }}>{p.date || '—'}</td>
                        <td style={{ ...styles.td, fontWeight: 700, color: '#4ade80' }}>{fmt(p.amount)}</td>
                        <td style={styles.td}>{p.method || '—'}</td>
                        <td style={styles.td}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: p.status === 'Cleared' ? 'rgba(74,222,128,.15)' : 'rgba(250,204,21,.15)', color: p.status === 'Cleared' ? '#4ade80' : '#facc15' }}>
                            {p.status || 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {payModalInv && (
              <StripeInvoicePayModal invoice={payModalInv} clientId={client?.id} onClose={() => setPayModalInv(null)} onPaid={() => refreshPaymentsAndInvoices()} />
            )}
            {addCardModal && (
              <StripeAddCardModal
                clientId={client.id}
                clientName={client.name}
                email={client.email}
                onClose={() => setAddCardModal(false)}
                onSaved={() => { setAddCardModal(false); refreshClientAutopay(); showToast('✅ Card saved! You can now lock in your payment plan.') }}
              />
            )}
          </div>
        )}

        {/* ── INVOICES ── */}
        {section === 'invoices' && (
          <div>
            {totalBalance > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.25)', borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '.05em' }}>Total Outstanding</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              </div>
            )}
            {openInvoices.length === 0 ? <Empty msg="No outstanding invoices — you're all caught up! 🎉" /> : (
              openInvoices.map(inv => {
                const subtotal = parseFloat(inv.total||0), tax = subtotal*(parseFloat(inv.taxRate||0)/100), paidAmt = parseFloat(inv.paid||0)
                const balance = (subtotal+tax) - paidAmt
                return (
                  <div key={inv.id} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '16px', marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>Invoice #{inv.invNum || '—'}</div>
                        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>Due: {inv.dueDate || 'Upon receipt'}</div>
                        {inv.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{inv.description}</div>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#f87171' }}>${balance.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Balance due</div>
                      </div>
                    </div>
                    {subtotal !== balance && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
                        Invoice total: ${(subtotal+tax).toLocaleString('en-US',{minimumFractionDigits:2})} · Paid: ${paidAmt.toLocaleString('en-US',{minimumFractionDigits:2})}
                      </div>
                    )}
                    <div style={{ marginTop: 12, textAlign: 'right' }}>
                      <button onClick={() => setPayModalInv(inv)} style={{ padding: '9px 20px', background: '#1A7FD4', border: 'none', borderRadius: 7, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Pay Now</button>
                    </div>
                  </div>
                )
              })
            )}
            {payModalInv && (
              <StripeInvoicePayModal invoice={payModalInv} clientId={client?.id} onClose={() => setPayModalInv(null)} onPaid={() => refreshPaymentsAndInvoices()} />
            )}
          </div>
        )}

        {/* ── INCOME & EXPENSES ── */}
        {section === 'ie' && (
          <div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16, lineHeight: 1.6 }}>
              Update your monthly income and expenses below. Your advisor uses this information to build the best resolution plan for your case. Changes sync directly to your file.
            </div>
            {IE_FIELDS.map(group => (
              <div key={group.section} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,.08)' }}>{group.section}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {group.fields.map(f => (
                    <div key={f.k}>
                      <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{f.label}</label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>$</span>
                        <input
                          type="text" inputMode="decimal"
                          value={formatMoneyInput(ieEdits[f.k])}
                          onChange={e => setIeEdits(prev => ({ ...prev, [f.k]: parseMoney(e.target.value) }))}
                          placeholder="0.00"
                          style={{ width: '100%', padding: '9px 10px 9px 22px', background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, color: '#f1f5f9', fontSize: 13, boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={saveIE} disabled={ieSaving} style={{ padding: '10px 24px', background: '#16a34a', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: ieSaving ? 0.7 : 1 }}>
                {ieSaving ? 'Saving…' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        )}

        {/* ── EMAILS ── */}
        {section === 'emails' && (
          <div>
            <div style={{fontSize:12,color:'#64748b',marginBottom:16}}>All email correspondence between you and your {firmMeta.name} team.</div>
            {clientEmails.length === 0 ? <Empty msg="No emails on file yet." /> : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {clientEmails.map(email => {
                  try { return <EmailCard key={email.id} email={email} firmName={firmMeta.name} /> }
                  catch(e) { return null }
                })}
              </div>
            )}
          </div>
        )}

        {/* ── MESSAGES ── */}
        {section === 'messages' && (
          <div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>All text messages between you and your {firmMeta.name} team.</div>
            {smsMessages.length === 0 ? <Empty msg="No text messages on file yet." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {smsMessages.map(msg => {
                  const isFromClient = msg.direction === 'inbound'
                  return (
                    <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isFromClient ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '80%', padding: '10px 14px', borderRadius: isFromClient ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        background: isFromClient ? 'rgba(59,130,246,.25)' : 'rgba(255,255,255,.07)',
                        border: '1px solid ' + (isFromClient ? 'rgba(59,130,246,.4)' : 'rgba(255,255,255,.1)'),
                      }}>
                        <div style={{ fontSize: 13, color: '#f1f5f9', lineHeight: 1.5 }}>{msg.body}</div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
                          {isFromClient ? 'You' : (msg.author || msg.from_name || 'Your Rep')} · {msg.created_at ? new Date(msg.created_at).toLocaleString() : ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── NOTES ── */}
        {section === 'notes' && (
          <div>
            {notes.length === 0 ? <Empty msg="No updates yet — your representative will post updates here." /> : (
              notes.map(n => (
                <div key={n.id} style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#f1f5f9', whiteSpace: 'pre-wrap' }}>{n.text}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>{n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}</div>
                </div>
              ))
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center', marginTop: 28 }}>
          Questions? Call us at {firmMeta.phone} or contact your {firmMeta.name} representative.
        </div>
      </div>
      </div>
    </div>
  )
}

function EmailCard({ email, firmName = 'Firm' }) {
  const [expanded, setExpanded] = useState(false)
  if (!email) return null
  const isInbound = email.triage === 'Inbox'
  const bodyText = (email.body || '').replace(/<[^>]*>/g, '').trim()
  const dateStr = email.created_at ? new Date(email.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''
  return (
    <div style={{background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.1)',borderRadius:10,overflow:'hidden'}}>
      <div onClick={()=>setExpanded(e=>!e)} style={{display:'flex',alignItems:'flex-start',gap:12,padding:'14px 16px',cursor:'pointer'}}>
        <div style={{width:36,height:36,borderRadius:'50%',background:isInbound?'rgba(16,185,129,.2)':'rgba(59,130,246,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>
          {isInbound ? '📩' : '📤'}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <div style={{fontWeight:700,fontSize:13.5,color:'#f1f5f9',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{email.subject || '(No subject)'}</div>
            <div style={{fontSize:11,color:'#64748b',flexShrink:0}}>{dateStr}</div>
          </div>
          <div style={{fontSize:12,color:'#64748b',marginTop:3}}>{isInbound ? 'From you' : `From ${firmName}`} · {email.status || 'Sent'}</div>
          {!expanded && <div style={{fontSize:12,color:'#94a3b8',marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{bodyText}</div>}
        </div>
        <div style={{color:'#64748b',fontSize:12,flexShrink:0}}>{expanded ? '▲' : '▼'}</div>
      </div>
      {expanded && (
        <div style={{padding:'0 16px 16px',borderTop:'1px solid rgba(255,255,255,.06)'}}>
          <div style={{fontSize:13,color:'#cbd5e1',lineHeight:1.7,marginTop:12,whiteSpace:'pre-wrap'}}>{bodyText || '(No content)'}</div>
        </div>
      )}
    </div>
  )
}

function Empty({ msg, icon='📂' }) {
  return (
    <div style={{ textAlign:'center', padding:'48px 20px', color:'#64748b' }}>
      <div style={{ fontSize:40, marginBottom:12, opacity:.5 }}>{icon}</div>
      <div style={{ fontSize:14, fontWeight:600, color:'#475569', marginBottom:6 }}>{msg}</div>
      <div style={{ fontSize:12, color:'#374151' }}>Contact your representative if you have questions.</div>
    </div>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#050d1a',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '32px 16px',
    fontFamily: '"DM Sans", system-ui, sans-serif',
    position: 'relative',
    overflow: 'hidden',
  },
  card: {
    background: 'linear-gradient(145deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,.03) 100%)',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 20,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 420,
    backdropFilter: 'blur(12px)',
    boxShadow: '0 32px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08)',
  },
  label: { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6, display: 'block' },
  textInput: {
    width: '100%', padding: '11px 14px', fontSize: 14,
    background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 10,
    color: '#f1f5f9', outline: 'none', boxSizing: 'border-box',
  },
  bigBtn: {
    marginTop: 16, width: '100%', padding: 14,
    background: 'linear-gradient(135deg,#1d4ed8,#2563eb)',
    border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(37,99,235,.4)',
  },
  downloadBtn: {
    padding: '7px 14px', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
    background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.3)', color: '#4ade80',
    whiteSpace: 'nowrap',
  },
  select: {
    padding: '7px 10px', fontSize: 12, borderRadius: 7, background: '#0a1628',
    border: '1px solid #1e3a5f', color: '#f1f5f9',
  },
  table: { width: '100%', fontSize: 12.5, borderCollapse: 'collapse' },
  tr: { borderBottom: '1px solid rgba(255,255,255,.08)' },
  th: { padding: '7px 8px', textAlign: 'left', color: '#64748b', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 },
  td: { padding: '8px 8px', color: '#cbd5e1' },
}


