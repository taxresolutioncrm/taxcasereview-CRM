import { useState, useEffect, useRef } from 'react'
import { useFirm } from '../lib/useFirm'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { FIRM } from '../lib/firmBranding'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

const STATE_FORMS = [
  { num: 'AL-2848A',       state: 'AL', label: 'Power of Attorney and Declaration of Representative', url: 'https://www.revenue.alabama.gov/wp-content/uploads/2018/09/Form_2848A_rev918.pdf' },
  { num: 'AZ-285-I',       state: 'AZ', label: 'Individual Tax Disclosure / POA',                    url: `${BASE}/state-forms/AZ_POA.pdf` },
  { num: 'AR-POA',         state: 'AR', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/AR_POA.pdf` },
  { num: 'CA-3520-PIT',    state: 'CA', label: 'Individual or Fiduciary POA Declaration',            url: `${BASE}/state-forms/CA_POA.pdf` },
  { num: 'CA-3520-BE',     state: 'CA', label: 'Business Entity POA Declaration',                    url: `${BASE}/state-forms/CA_POA_Biz.pdf` },
  { num: 'CO-DR-0145',     state: 'CO', label: 'Tax Information Authorization or Power of Attorney', url: `${BASE}/state-forms/CO_POA.pdf` },
  { num: 'CT-LGL-001',     state: 'CT', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/CT_POA.pdf` },
  { num: 'DC-D-2848',      state: 'DC', label: 'Power of Attorney and Declaration of Representative',url: `${BASE}/state-forms/DC_POA.pdf` },
  { num: 'FL-DR-835',      state: 'FL', label: 'Power of Attorney and Declaration of Representative',url: `${BASE}/state-forms/FL_POA.pdf` },
  { num: 'GA-RD-1061',     state: 'GA', label: 'Power of Attorney and Declaration of Representative',url: `${BASE}/state-forms/GA_POA.pdf` },
  { num: 'HI-N-848',       state: 'HI', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/HI_POA.pdf` },
  { num: 'ID-POA',         state: 'ID', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/ID_POA.pdf` },
  { num: 'IL-2848',        state: 'IL', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/IL_POA.pdf` },
  { num: 'KS-DO-10',       state: 'KS', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/KS_POA.pdf` },
  { num: 'KY-20A100',      state: 'KY', label: 'Declaration of Representative',                      url: `${BASE}/state-forms/KY_POA.pdf` },
  { num: 'LA-R-7006',      state: 'LA', label: 'Power of Attorney and Declaration of Representative',url: `${BASE}/state-forms/LA_POA.pdf` },
  { num: 'MA-M-2848',      state: 'MA', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/MA_POA.pdf` },
  { num: 'MD-548',         state: 'MD', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/MD_POA.pdf` },
  { num: 'MI-151',         state: 'MI', label: 'Authorized Representative Declaration (Power of Attorney)', url: `${BASE}/state-forms/MI_POA.pdf` },
  { num: 'MN-REV184i',    state: 'MN', label: 'Individual or Sole Proprietor Power of Attorney',    url: `${BASE}/state-forms/MN_POA.pdf` },
  { num: 'MO-2827',        state: 'MO', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/MO_POA.pdf` },
  { num: 'MO-149',         state: 'MO', label: 'Sales and Use Tax Exemption Certificate',            url: `${BASE}/state-forms/Form_149_MO.pdf` },
  { num: 'MS-DOR-POA',    state: 'MS', label: 'Power of Attorney and Declaration of Representation',url: `${BASE}/state-forms/MS_POA.pdf` },
  { num: 'MT-POA',         state: 'MT', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/MT_POA.pdf` },
  { num: 'NE-POA',         state: 'NE', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/NE_POA.pdf` },
  { num: 'NM-POA',         state: 'NM', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/NM_POA.pdf` },
  { num: 'NJ-M-5008-R',   state: 'NJ', label: 'Appointment of Taxpayer Representative',             url: `${BASE}/state-forms/NJ_POA.pdf` },
  { num: 'NY-POA-1',       state: 'NY', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/NY_POA.pdf` },
  { num: 'NC-GEN-58',      state: 'NC', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/NC_POA.pdf` },
  { num: 'OH-SPOA',        state: 'OH', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/OH_POA.pdf` },
  { num: 'OK-BT-129',      state: 'OK', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/OK_POA.pdf` },
  { num: 'OR-150-800-005', state: 'OR', label: 'Tax Information Authorization and POA',              url: `${BASE}/state-forms/OR_POA.pdf` },
  { num: 'PA-PSRS-248',    state: 'PA', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/PA_POA.pdf` },
  { num: 'SC-SC2848',      state: 'SC', label: 'Power of Attorney and Declaration of Representative',url: `${BASE}/state-forms/SC_POA.pdf` },
  { num: 'TN-RV-F0103801', state: 'TN', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/TN_POA.pdf` },
  { num: 'TX-85-272',      state: 'TX', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/TX_POA.pdf` },
  { num: 'UT-TC-737',      state: 'UT', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/UT_POA.pdf` },
  { num: 'VA-POA',         state: 'VA', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/VA_POA.pdf` },
  { num: 'WA-42-2446',     state: 'WA', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/Washington_POA.pdf` },
  { num: 'WV-2848',        state: 'WV', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/WV_POA.pdf` },
  { num: 'WI-A-222',       state: 'WI', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/WI_POA.pdf` },
  { num: 'WY-POA',         state: 'WY', label: 'Power of Attorney',                                  url: `${BASE}/state-forms/Wyoming.pdf` },
]

// Tenant-resolved firm identity, mirroring src/lib/docUtils.js exactly.
// Previously these were hardcoded constants -- and `address` was written with
// SINGLE quotes around a template placeholder, so every State Forms letterhead
// and POA cover letter printed the literal text ${FIRM.address}.
const TCR_TENANT = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
const firmName  = () => FIRM.name || ((!FIRM.tenantId || FIRM.tenantId === TCR_TENANT) ? 'Tax Case Review' : 'Tax Resolution Office')
const firmEmail = () =>
  (FIRM.email || '').trim() ||
  'info@' + firmName().toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com'
const LOGO_URL = ''  // replaced by FIRM.logoUrl
function printHeader(title) { return `<div style="text-align:center;margin-bottom:24px;border-bottom:2px solid #1A7FD4;padding-bottom:16px"><img src="${FIRM.logoUrl}" style="height:48px;margin-bottom:8px" onerror="this.style.display='none'"/><div style="font-size:20px;font-weight:700;color:#1A7FD4">${firmName()}</div><div style="font-size:11px;color:#666">${FIRM.address} · ${firmEmail()}</div><div style="font-size:16px;font-weight:700;margin-top:10px;color:#111">${title}</div></div>` }
function sigBlock(l1='Client Signature',l2='Authorized Representative'){return `<div style="display:flex;gap:40px;margin-top:32px"><div style="flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555">${l1}<br/>Date: ___________________</div><div style="flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555">${l2} — ${firmName()}<br/>Date: ___________________</div></div>`}
function printBase(title,body){const w=window.open('','_blank','width=860,height=1000');w.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:40px 48px;max-width:800px;margin:0 auto}h3{color:#1A7FD4;margin:18px 0 6px}p{margin:6px 0;line-height:1.6}.fee-box{border:2px solid #1A7FD4;border-radius:6px;padding:12px 16px;margin:16px 0;background:#f0f7ff}</style></head><body>${printHeader(title)}${body}</body></html>`);w.document.close();setTimeout(()=>w.print(),400)}
function generateServiceAgreement(){printBase('Tax Investigation Service Agreement',`<p>This Tax Investigation Service Agreement is entered into between <b>${firmName()}</b> and the undersigned client.</p><h3>1. Scope of Services</h3><p>Initial tax investigation including transcript review, liability identification, evaluation of resolution programs, and written summary of findings.</p><h3>2. Investigation Fee</h3><div class="fee-box"><b>Investigation Fee: $___________</b></div><h3>3. Not a Law Firm</h3><p>${firmName()} is a tax resolution consulting firm, not a law firm.</p>${sigBlock()}`)}
function generateAddendum(){printBase('Service Addendum',`<p>This Addendum supplements the Tax Investigation Service Agreement between <b>${firmName()}</b> and the undersigned client.</p><h3>Additional Services</h3><ul><li>Full IRS/State representation</li><li>POA representation</li><li>Filing of delinquent returns</li></ul><div class="fee-box"><b>Additional Service Fee: $___________</b><br/>Payment plan: $___________ /month</div>${sigBlock()}`)}
function generateEngagementLetter(){printBase('Engagement Letter',`<p>Dear Client,</p><p>Thank you for choosing <b>${firmName()}</b>. We are pleased to confirm our engagement to assist you with your tax resolution matter.</p><h3>Services</h3><ul><li>Review tax transcripts</li><li>Identify outstanding liabilities</li><li>Represent you through resolution</li></ul>${sigBlock('Client Acknowledgment','Authorized Representative')}`)}
function generatePOALetter(){printBase('Power of Attorney Cover Letter',`<p><b>Internal Revenue Service</b></p><p><b>Re: Form 2848 — Taxpayer: _____________________________</b></p><p>Enclosed is a completed Form 2848 authorizing <b>${firmName()}</b> to represent the above-named taxpayer.</p><div style="border-left:3px solid #1A7FD4;padding-left:16px;margin:16px 0"><b>${firmName()}</b><br/>${FIRM.address}<br/>Email: ${firmEmail()}</div>${sigBlock('','Authorized Representative — ' + firmName())}`)}

export default function StateForms() {
  const [searchParams] = useSearchParams()
  const { user } = useApp()
  const [search, setSearch]               = useState('')
  const [stateItems, setStateItems]       = useState([])
  const [stateModal, setStateModal]       = useState(false)
  const [stateSaving, setStateSaving]     = useState(false)
  const SBLANK = { formNumber: '', state: '', client: '', filedDate: '', status: 'Not Filed', notes: '' }
  const [stateForm, setStateForm]         = useState(SBLANK)
  function sfld(k, v) { setStateForm(f => ({ ...f, [k]: v })) }
  const [clients, setClients]             = useState([])
  const [clientSearch, setClientSearch]   = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [sending, setSending]             = useState(false)
  const [sendVia, setSendVia]             = useState('email')
  const [toast, setToast]                 = useState('')
  const prefillRef = useRef(null)

  const [leads, setLeads] = useState([])
  async function saveStateItem() { setStateSaving(true); await supabase.from('state_form_tracker').insert([{...stateForm,created_at:new Date().toISOString()}]); const {data}=await supabase.from('state_form_tracker').select('*').order('created_at',{ascending:false}); setStateItems(data||[]); setStateForm(SBLANK); setStateModal(false); setStateSaving(false) }
  async function deleteStateItem(id) { const { error } = await supabase.from('state_form_tracker').delete().eq('id',id); if (error) { showToast('Error: ' + error.message); return } setStateItems(s=>s.filter(x=>x.id!==id)) }

  // Guard: don't load until auth confirmed — prevents wrong-tenant data on hard refresh
  useEffect(() => {
    if (!user) return
    supabase.from('state_form_tracker').select('*').order('created_at',{ascending:false}).then(({data})=>setStateItems(data||[]))
    supabase.from('clients').select('id,name,ssn,ein,street,city,state,zip,dob,phone,email,spouseName,spouseSsn,filingStatus')
      .then(({ data }) => setClients(data || []))
    supabase.from('leads').select('id,name,ssn,ein,street,city,state,zip,dob,phone,email')
      .then(({ data }) => setLeads(data || []))
  }, [user?.id])

  // Auto-select client or lead from URL param
  useEffect(() => {
    const clientId = searchParams.get('client')
    const leadId   = searchParams.get('lead')
    if (clientId && clients.length > 0) {
      const found = clients.find(c => String(c.id) === String(clientId))
      if (found) { setSelectedClient(found); setClientSearch(found.name); setTimeout(() => prefillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300) }
    }
    if (leadId && leads.length > 0) {
      const found = leads.find(l => String(l.id) === String(leadId))
      if (found) { setSelectedClient(found); setClientSearch(found.name); setTimeout(() => prefillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300) }
    }
  }, [clients, leads, searchParams])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 4000) }

  // Get the matching state form for the selected client
  const clientStateForms = selectedClient?.state
    ? STATE_FORMS.filter(f => f.state === selectedClient.state)
    : []
  const autoForm = clientStateForms[0] || null

  const [prefilling, setPrefilling] = useState(null)

  // Pre-fills the state POA cover page with the selected client's info and
  // downloads it (form + blank cover attached) — same generator used when
  // sending for e-signature, just without the email/SMS step. Mirrors the
  // "Pre-fill PDF" button on the IRS Forms tab.
  async function downloadPrefilledStatePOA(form) {
    if (!selectedClient) { showToast('Select a client first'); return }
    if (form.state !== 'FL') { showToast(`Autofill for ${form.state} is disabled until that exact state form mapping is verified. Open the official PDF instead.`); return }
    setPrefilling(form.num)
    try {
      const pdfRes = await fetch(form.url)
      if (!pdfRes.ok) throw new Error('Could not load state form PDF')
      const rawBytes = new Uint8Array(await pdfRes.arrayBuffer())
      const { generateStatePOAWithCover } = await import('../lib/irsFormUtils')
      const mergedBytes = await generateStatePOAWithCover(selectedClient, rawBytes)
      const blob = new Blob([mergedBytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${form.state}_POA_${(selectedClient.name || 'client').replace(/\s+/g, '_')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      showToast('Error: ' + e.message)
    }
    setPrefilling(null)
  }

  async function sendStatePOA(form) {
    if (!selectedClient) { showToast('Select a client first'); return }
    if (form.state !== 'FL') { showToast(`E-sign autofill for ${form.state} is disabled until that exact state form mapping is verified. This prevents sending client data in the wrong fields.`); return }
    if (!form) { showToast('No state form available for this client\'s state'); return }
    const via = sendVia
    if (via !== 'sms' && !selectedClient.email) { showToast('Client has no email on file'); return }
    if (via !== 'email' && !selectedClient.phone) { showToast('Client has no phone on file'); return }

    setSending(true)
    try {
      const actor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'

      // Fetch the PDF bytes from the state form URL
      const pdfRes = await fetch(form.url)
      if (!pdfRes.ok) throw new Error('Could not load state form PDF')
      const rawBytes = new Uint8Array(await pdfRes.arrayBuffer())
      const { generateStatePOAWithCover } = await import('../lib/irsFormUtils')
      const mergedBytes = await generateStatePOAWithCover(selectedClient, rawBytes)
      const pdfBlob = new Blob([mergedBytes], { type: 'application/pdf' })

      // Upload to Supabase storage
      const safeName = (selectedClient.name || 'client').replace(/[^a-zA-Z0-9]+/g, '-')
      const path = `docs/${safeName}/state-poa/${form.state}_POA_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('documents')
        .upload(path, pdfBlob, { upsert: true, contentType: 'application/pdf' })
      if (upErr) throw new Error(upErr.message)

      const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
      const pdfUrl = urlData?.signedUrl || ''

      // Create esign record
      const { data: esign, error: esignErr } = await supabase.from('esigns').insert([{
        doc_type: `State POA — ${form.state} (${form.num})`,
        client_name: selectedClient.name,
        client_email: selectedClient.email || '',
        client_phone: selectedClient.phone || '',
        message: `Please review and sign your ${form.state} Power of Attorney form. This authorizes ${firmName()} to represent you before the ${form.state} tax authority.`,
        pdf_attachments: [{ formType: 'state_poa', label: `${form.state} POA — ${form.label}`, url: pdfUrl }],
        priority: 'Normal',
        status: 'Awaiting',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        sent_by: actor,
      }]).select().single()
      if (esignErr) throw new Error(esignErr.message)

      const sigUrl = `${window.location.origin}/sign/${esign.id}`
      await navigator.clipboard.writeText(sigUrl).catch(() => {})

      let emailSent = false, smsSent = false

      // Send email
      if ((via === 'email' || via === 'both') && selectedClient.email) {
        const { error: eErr } = await supabase.functions.invoke('send-email', {
          body: {
            tenant_id: FIRM.tenantId || undefined,
            to: selectedClient.email,
            subject: `Action Required: Sign Your ${form.state} Power of Attorney — ${firmName()}`,
            html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#1e3a8a,#1d4ed8);padding:32px 40px;text-align:center">
    <img src="${FIRM.logoUrl}" alt="${FIRM.name}" style="max-height:60px;max-width:240px;object-fit:contain" onerror="this.style.display='none'"/>
    <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:12px">${firmName()}</div>
  </td></tr>
  <tr><td style="padding:40px 40px 32px">
    <p style="margin:0 0 16px;font-size:16px;color:#0f172a">Dear <strong>${selectedClient.name}</strong>,</p>
    <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7">Your <strong>${form.state} Power of Attorney (${form.num})</strong> is ready for your review and signature. This form authorizes ${firmName()} to represent you before the ${form.state} tax authority.</p>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 28px">
      <a href="${sigUrl}" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#ffffff;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:700;font-size:17px">Review &amp; Sign →</a>
    </td></tr></table>
    <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;border-left:4px solid #3b82f6">
      <p style="margin:0;font-size:13px;color:#475569">📞 <strong>${FIRM.phone}</strong> &nbsp;·&nbsp; ✉️ <strong>${firmEmail()}</strong></p>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8">${firmName()} · ${FIRM.address}</p>
  </td></tr>
</table></td></tr></table></body></html>`
          }
        })
        emailSent = !eErr
      }

      // Send SMS
      if ((via === 'sms' || via === 'both') && selectedClient.phone) {
        const { data: cfg } = await supabase.from('settings').select('signalwire_backend').limit(1).maybeSingle()
        if (cfg?.signalwire_backend) {
          try {
            await fetch(cfg.signalwire_backend + '/sms/send', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: selectedClient.phone, body: `${firmName()}: please review and sign your ${form.state} POA here: ${sigUrl}` })
            })
            smsSent = true
          } catch (_) {}
        }
      }

      // Log note on client
      await supabase.from('client_notes').insert({
        clientname: selectedClient.name,
        text: `🏛️ ${form.state} State POA sent for e-signature (${form.num})${emailSent ? ' via email' : ''}${smsSent ? ' via SMS' : ''}`,
        author: actor,
        visible_to_client: false,
      })

      showToast(emailSent || smsSent ? `✅ ${form.state} POA sent for signature!` : '✅ Created — signing link copied to clipboard')
    } catch (e) {
      showToast('Error: ' + e.message)
    }
    setSending(false)
  }

  const filtered = STATE_FORMS.filter(f => {
    const q = search.toLowerCase()
    return !q || f.state.toLowerCase().includes(q) || f.num.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
  })

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1000, margin: '0 auto' }}>
      {toast && <div className="toast show">{toast}</div>}

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>🏛️ State Forms & Documents</h2>
        <p style={{ fontSize: 12, color: 'var(--t3)', margin: '4px 0 0' }}>Official state POA forms — download blank, pre-fill, or send for e-signature.</p>
      </div>

      {/* ── Pre-fill & Send Section ── */}
      <div className="card" style={{ marginBottom: 20 }} ref={prefillRef}>
        <div className="ch">
          <span className="ct">✍️ Pre-fill &amp; Send State POA</span>
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>Select client → auto-matches their state → download pre-filled or send for e-signature</span>
        </div>

        {/* Client picker */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>Client</label>
            <input
              value={clientSearch}
              onChange={e => { setClientSearch(e.target.value); setSelectedClient(null); setShowClientDrop(true) }}
              onFocus={() => setShowClientDrop(true)}
              onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
              placeholder="Search client name…"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--bd)', fontSize: 13, background: 'var(--s2)', color: 'var(--tx)', boxSizing: 'border-box' }}
            />
            {showClientDrop && clientSearch && (() => {
              const q = clientSearch.toLowerCase()
              const matches = clients.filter(c => (c.name || '').toLowerCase().includes(q)).slice(0, 10)
              return matches.length > 0 ? (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8, zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,.25)', marginTop: 2 }}>
                  {matches.map(c => (
                    <div key={c.id}
                      onMouseDown={() => { setSelectedClient(c); setClientSearch(c.name); setShowClientDrop(false) }}
                      style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--tx)', borderBottom: '1px solid var(--br)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >{c.name} {c.state ? <span style={{ color: 'var(--t3)', fontSize: 11 }}>· {c.state}</span> : null}</div>
                  ))}
                </div>
              ) : (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8, zIndex: 50, padding: '10px 14px', fontSize: 13, color: 'var(--t3)', marginTop: 2 }}>No clients found</div>
              )
            })()}
          </div>

          {selectedClient && (
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 6 }}>Send Via</label>
              <select value={sendVia} onChange={e => setSendVia(e.target.value)}
                style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--bd)', fontSize: 13, background: 'var(--s2)', color: 'var(--tx)' }}>
                <option value="email">Email</option>
                <option value="sms">Text Message</option>
                <option value="both">Email + Text</option>
              </select>
            </div>
          )}
        </div>

        {/* Matched state forms */}
        {selectedClient && (
          <div>
            {!selectedClient.state ? (
              <div style={{ fontSize: 13, color: 'var(--warn)', padding: '10px 0' }}>
                ⚠️ No state on file for {selectedClient.name}. Edit the client to add their state.
              </div>
            ) : clientStateForms.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--t3)', padding: '10px 0' }}>
                No state POA form on file for {selectedClient.state}. Download the blank form below or contact support to add it.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 4 }}>
                  Found {clientStateForms.length} form{clientStateForms.length > 1 ? 's' : ''} for <strong style={{ color: 'var(--tx)' }}>{selectedClient.state}</strong>:
                </div>
                {clientStateForms.map(form => (
                  <div key={form.num} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--s2)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--br)' }}>
                    <div style={{ background: 'var(--blue)', color: '#fff', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{form.state}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{form.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{form.num}</div>
                    </div>
                    <a href={form.url} target="_blank" rel="noreferrer">
                      <button className="btn sec" style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}>⬇ Download</button>
                    </a>
                    <button
                      className="btn sec"
                      style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
                      disabled={prefilling === form.num}
                      onClick={() => downloadPrefilledStatePOA(form)}
                    >
                      {prefilling === form.num ? '⏳' : '✏️'} Pre-fill &amp; Download
                    </button>
                    <button
                      className="btn pri"
                      style={{ fontSize: 12, padding: '6px 16px', whiteSpace: 'nowrap' }}
                      disabled={sending}
                      onClick={() => sendStatePOA(form)}
                    >
                      {sending ? 'Sending…' : '✍️ Send for E-Signature'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedClient && (
          <div style={{ fontSize: 13, color: 'var(--t3)', padding: '8px 0' }}>
            Select a client above — we'll automatically match the right state POA form and let you send it for e-signature in one click.
          </div>
        )}
      </div>

      {/* ── State Form Downloads ── */}
      <div className="card">
        <div className="ch">
          <span className="ct">📥 All State Form Downloads</span>
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>Official state PDFs — opens in new tab</span>
        </div>
        <div style={{ marginBottom: 14 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search state, form number, or description…"
            style={{ width: '100%', maxWidth: 360, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {filtered.length === 0 ? (
            <div style={{ color: 'var(--t3)', fontSize: 13, padding: '12px 0' }}>No forms match your search.</div>
          ) : filtered.map(f => (
            <div key={f.num} style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ background: 'var(--blue)', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{f.state}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)', lineHeight: 1.3 }}>{f.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
                  <button className="btn sec" style={{ width: '100%', fontSize: 11, padding: '5px 8px', justifyContent: 'center' }}>
                    📄 Blank
                  </button>
                </a>
                <button
                  className="btn sec"
                  style={{ flex: 1, fontSize: 11, padding: '5px 8px', justifyContent: 'center', opacity: selectedClient ? 1 : 0.45 }}
                  disabled={!selectedClient || prefilling === f.num}
                  onClick={() => selectedClient && downloadPrefilledStatePOA(f)}
                >
                  {prefilling === f.num ? '⏳' : '✏️'} Pre-fill
                </button>
                <button
                  className="btn pri"
                  style={{ flex: 1, fontSize: 11, padding: '5px 8px', justifyContent: 'center', opacity: selectedClient ? 1 : 0.45 }}
                  disabled={!selectedClient || sending}
                  onClick={() => selectedClient && sendStatePOA(f)}
                >
                  ✍️ E-Sign
                </button>
              </div>
              {!selectedClient && (
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, textAlign: 'center' }}>Select a client above to pre-fill</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Document Templates */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="ch"><span className="ct">Document Templates</span><span style={{fontSize:12,color:'var(--t2)'}}>Opens print-ready PDF window</span></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:10,padding:'4px 0'}}>
          {[{icon:'📄',label:'Tax Investigation\nService Agreement',desc:'Full TCR agreement w/ fees & signatures',action:generateServiceAgreement,color:'var(--blue)'},
            {icon:'📋',label:'Service\nAddendum',desc:'Supplemental agreement for additional services',action:generateAddendum,color:'#25A25A'},
            {icon:'✉️',label:'Engagement\nLetter',desc:'Client engagement confirmation letter',action:generateEngagementLetter,color:'#7B5EA7'},
            {icon:'🔐',label:'POA Cover\nLetter',desc:'Form 2848 cover letter to IRS',action:generatePOALetter,color:'#D4930A'},
          ].map(t=>(
            <button key={t.label} className="btn sec" onClick={t.action} style={{display:'flex',flexDirection:'column',alignItems:'flex-start',padding:'12px 14px',gap:4,height:'auto',borderLeft:`3px solid ${t.color}`}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>{t.icon}</span><span style={{fontWeight:700,fontSize:12,lineHeight:1.3,whiteSpace:'pre-line',textAlign:'left'}}>{t.label}</span></div>
              <span style={{fontSize:11,color:'var(--t2)',textAlign:'left',lineHeight:1.4}}>{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* State Form Tracker */}
      <div className="card">
        <div className="ch"><span className="ct">State Form Tracker ({stateItems.length})</span><button className="btn pri" onClick={()=>setStateModal(true)}>+ Log State Form</button></div>
        <div className="ovx">
          <table><thead><tr><th>Form</th><th>State</th><th>Client</th><th>Filed Date</th><th>Status</th><th>Notes</th><th></th></tr></thead>
            <tbody>{stateItems.length===0?(<tr><td colSpan={7} style={{textAlign:'center',color:'var(--t3)',padding:20}}>No state forms logged yet</td></tr>):stateItems.map(f=>(
              <tr key={f.id}><td><span className="bdg bb" style={{fontWeight:700}}>{f.formNumber}</span></td><td><span className="bdg bn">{f.state||'—'}</span></td><td style={{fontWeight:600}}>{f.client||'—'}</td><td style={{color:'var(--t2)'}}>{f.filedDate||'—'}</td><td><span className="bdg bn">{f.status}</span></td><td style={{color:'var(--t2)',fontSize:12}}>{f.notes||'—'}</td><td><button className="btn del" onClick={()=>deleteStateItem(f.id)}>Del</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {stateModal&&(<div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setStateModal(false)}><div className="modal"><div className="mh"><span className="mt">Log State Form</span><button className="xbtn" onClick={()=>setStateModal(false)}>&times;</button></div>
        <div className="fg2"><div className="field"><label>Form / Type</label><input value={stateForm.formNumber} onChange={e=>sfld('formNumber',e.target.value)} placeholder="e.g. POA, M-2848"/></div><div className="field"><label>State</label><input value={stateForm.state} onChange={e=>sfld('state',e.target.value)} placeholder="e.g. FL, NY"/></div></div>
        <div className="fg2"><div className="field"><label>Client</label><input value={stateForm.client} onChange={e=>sfld('client',e.target.value)} placeholder="Client name"/></div><div className="field"><label>Status</label><select value={stateForm.status} onChange={e=>sfld('status',e.target.value)}>{['Not Filed','Draft','Sent','Filed','Pending','Approved','Missing'].map(s=><option key={s}>{s}</option>)}</select></div></div>
        <div className="fg2"><div className="field"><label>Filed Date</label><input type="date" value={stateForm.filedDate} onChange={e=>sfld('filedDate',e.target.value)}/></div><div className="field"><label>Notes</label><input value={stateForm.notes} onChange={e=>sfld('notes',e.target.value)} placeholder="Optional notes"/></div></div>
        <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={saveStateItem} disabled={stateSaving}>{stateSaving?'Saving...':'Log State Form'}</button>
      </div></div>)}
    </div>
  )
}
