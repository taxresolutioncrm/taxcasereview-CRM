import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useFirm } from '../lib/useFirm'
import { useApp } from '../context/AppContext'
import IRSFormFiller from '../components/IRSFormFiller'
import { FIRM } from '../lib/firmBranding'

const BLANK = { formNumber: '2848', status: 'Not Filed', client: '', caseNum: '', filedDate: '', notes: '' }

const IRS_FORMS = [
  { num: '1128',   label: 'Adopt, Change or Retain Tax Year', url: 'https://www.irs.gov/pub/irs-pdf/f1128.pdf',   formType: '1128'  },
  { num: '12153',  label: 'CDP Hearing Request',              url: 'https://www.irs.gov/pub/irs-pdf/f12153.pdf',  formType: '12153' },
  { num: '12661',  label: 'Disputed Issue Verification',      url: 'https://www.irs.gov/pub/irs-pdf/f12661.pdf',  formType: '12661' },
  { num: '2553',   label: 'S-Corp Election',                  url: 'https://www.irs.gov/pub/irs-pdf/f2553.pdf',   formType: '2553'  },
  { num: '2848',   label: 'Power of Attorney',                url: 'https://www.irs.gov/pub/irs-pdf/f2848.pdf',   formType: '2848'  },
  { num: '433-A',  label: 'Collection Info (Individual)',     url: 'https://www.irs.gov/pub/irs-pdf/f433a.pdf',   formType: '433a'  },
  { num: '433-B',  label: 'Collection Info (Business)',       url: 'https://www.irs.gov/pub/irs-pdf/f433b.pdf',   formType: '433b'  },
  { num: '433-D',  label: 'Installment Agreement',            url: 'https://www.irs.gov/pub/irs-pdf/f433d.pdf',   formType: '433d'  },
  { num: '433-F',  label: 'Collection Info (General)',        url: 'https://www.irs.gov/pub/irs-pdf/f433f.pdf',   formType: '433f'  },
  { num: '433-H',  label: 'Installment Agreement Request & CIS', url: 'https://www.irs.gov/pub/irs-pdf/f433h.pdf', formType: '433h' },
  { num: '4506-T', label: 'Request for Transcript',           url: 'https://www.irs.gov/pub/irs-pdf/f4506t.pdf',  formType: '4506t' },
  { num: '4549',   label: 'Exam Changes (Audit)',             url: 'https://www.irs.gov/pub/irs-pdf/f4549.pdf',   formType: '4549'  },
  { num: '656',    label: 'Offer in Compromise',              url: 'https://www.irs.gov/pub/irs-pdf/f656.pdf',    formType: '656'   },
  { num: '656-L',  label: 'OIC — Doubt as to Liability',     url: 'https://www.irs.gov/pub/irs-pdf/f656l.pdf',   formType: '656l'  },
  { num: '843',    label: 'Penalty Abatement',                url: 'https://www.irs.gov/pub/irs-pdf/f843.pdf',    formType: '843'   },
  { num: '8821',   label: 'Tax Info Authorization',           url: 'https://www.irs.gov/pub/irs-pdf/f8821.pdf',   formType: '8821'  },
  { num: '8822',   label: 'Change of Address (Individual)',   url: 'https://www.irs.gov/pub/irs-pdf/f8822.pdf',   formType: '8822'  },
  { num: '8822-B', label: 'Change of Address (Business)',     url: 'https://www.irs.gov/pub/irs-pdf/f8822b.pdf',  formType: '8822b' },
  { num: '8832',   label: 'Entity Classification',            url: 'https://www.irs.gov/pub/irs-pdf/f8832.pdf',   formType: '8832'  },
  { num: '911',    label: 'Taxpayer Advocate',                url: 'https://www.irs.gov/pub/irs-pdf/f911.pdf',    formType: '911'   },
  { num: '9465',   label: 'Installment Agreement',            url: 'https://www.irs.gov/pub/irs-pdf/f9465.pdf',   formType: '9465'  },
  { num: 'SS-4',   label: 'Apply for EIN',                   url: 'https://www.irs.gov/pub/irs-pdf/fss4.pdf',    formType: 'ss4'   },
]

const LOGO_URL = ''  // replaced by FIRM.logoUrl

// ─── Shared print header ──────────────────────────────────────────────────────
function printHeader(title) {
  return `
    <div style="text-align:center;margin-bottom:24px;border-bottom:2px solid #1A7FD4;padding-bottom:16px">
      <img src="${FIRM.logoUrl}" style="height:48px;margin-bottom:8px" onerror="this.style.display='none'"/>
      <div style="font-size:20px;font-weight:700;color:#1A7FD4">${FIRM.name}</div>
      <div style="font-size:11px;color:#666">${FIRM.address} · ${FIRM.email}</div>
      <div style="font-size:16px;font-weight:700;margin-top:10px;color:#111">${title}</div>
    </div>`
}

function sigBlock(label1 = 'Client Signature', label2 = 'Authorized Representative') {
  return `
    <div style="display:flex;gap:40px;margin-top:32px">
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555">
        ${label1}<br/>Date: ___________________
      </div>
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555">
        ${label2} — ${FIRM.name}<br/>Date: ___________________
      </div>
    </div>`
}

function printBase(title, body) {
  const w = window.open('', '_blank', 'width=860,height=1000')
  w.document.write(`<!DOCTYPE html><html><head>
    <title>${title}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:40px 48px;max-width:800px;margin:0 auto}
      h3{color:#1A7FD4;margin:18px 0 6px}
      p{margin:6px 0;line-height:1.6}
      ul{margin:6px 0;padding-left:20px;line-height:1.7}
      .fee-box{border:2px solid #1A7FD4;border-radius:6px;padding:12px 16px;margin:16px 0;background:#f0f7ff}
      .fee-box b{font-size:14px}
      @media print{body{padding:24px}}
    </style>
  </head><body>
    ${printHeader(title)}
    ${body}
  </body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 400)
}

// ─── Document generators ──────────────────────────────────────────────────────
function generateServiceAgreement() {
  printBase('Tax Investigation Service Agreement', `
    <p>This Tax Investigation Service Agreement ("Agreement") is entered into between <b>${FIRM.name}</b> ("Company") and the undersigned client ("Client") as of the date signed below.</p>

    <h3>1. Scope of Services</h3>
    <p>The Company agrees to perform an initial tax investigation, which includes review of tax transcripts, identification of IRS or state tax liabilities, evaluation of available resolution programs, and preparation of a written summary of findings and recommended resolution strategy.</p>

    <h3>2. Company Obligations</h3>
    <ul>
      <li>Obtain IRS transcripts via Form 2848 or 8821</li>
      <li>Analyze outstanding tax liabilities and compliance history</li>
      <li>Identify applicable IRS resolution programs (OIC, CNC, IA, Abatement, etc.)</li>
      <li>Deliver a written resolution recommendation within 21 business days of full access being granted</li>
      <li>Assign a dedicated case representative to the Client</li>
    </ul>

    <h3>3. Client Obligations</h3>
    <ul>
      <li>Provide accurate and complete personal, financial, and tax information</li>
      <li>Execute IRS authorization forms (2848 / 8821) promptly</li>
      <li>Respond to company requests for documents within 5 business days</li>
      <li>Pay the investigation fee in full prior to commencement of services</li>
    </ul>

    <h3>4. Tax Investigation Fee</h3>
    <div class="fee-box">
      <b>Investigation Fee: $___________</b><br/>
      <span style="font-size:11px;color:#555">(Standard fee: $499 – $699. Manager-approved rates may vary.)</span><br/>
      <span style="font-size:11px">This fee is non-refundable once transcript review has commenced.</span>
    </div>

    <h3>5. Not a Law Firm</h3>
    <p>${FIRM.name} is a tax resolution consulting firm and is <b>not a law firm</b>. No attorney-client relationship is created by this agreement. The Company does not provide legal advice. Enrolled Agents and/or licensed tax professionals perform all representation services.</p>

    <h3>6. No Guarantee of Outcome</h3>
    <p>The Company makes no guarantee as to the specific outcome of any IRS or state tax resolution matter. Acceptance into any IRS program (including Offer in Compromise) is solely at the discretion of the IRS.</p>

    <h3>7. Termination</h3>
    <p>Either party may terminate this Agreement with 5 business days written notice. Investigation fees already paid are non-refundable once services have commenced. The Company may terminate immediately for non-cooperation or material misrepresentation by the Client.</p>

    <h3>8. Dispute Resolution / Arbitration</h3>
    <p>Any dispute arising from this Agreement shall be resolved by binding arbitration under the rules of the American Arbitration Association in Palm Beach County, Florida. Both parties waive their right to a jury trial.</p>

    <h3>9. Governing Law</h3>
    <p>This Agreement is governed by the laws of the State of Florida.</p>

    ${sigBlock('Client Signature', 'Authorized Representative — ${FIRM.name}')}
    <p style="font-size:10px;color:#888;margin-top:20px;text-align:center">
      ${FIRM.name} · ${FIRM.address} · ${FIRM.email} · Not a law firm
    </p>
  `)
}

function generateAddendum() {
  printBase('Service Addendum — Additional Services Agreement', `
    <p>This Addendum ("Addendum") supplements the Tax Investigation Service Agreement previously executed between <b>${FIRM.name}</b> ("Company") and the undersigned client ("Client") and is incorporated therein by reference.</p>

    <h3>1. Additional Services Authorized</h3>
    <p>Client authorizes the Company to proceed with the following additional resolution services beyond the initial tax investigation:</p>
    <ul>
      <li>Full IRS / State representation and negotiation</li>
      <li>Preparation and submission of resolution application (as applicable)</li>
      <li>Power of Attorney representation before the IRS and/or state tax authorities</li>
      <li>Filing of any delinquent returns required for resolution eligibility</li>
      <li>Ongoing case management through resolution acceptance or closure</li>
    </ul>

    <h3>2. Additional Service Fee</h3>
    <div class="fee-box">
      <b>Additional Service Fee: $___________</b><br/>
      <span style="font-size:11px;color:#555">Payment plan: $___________ /month · Starting: ___________</span><br/>
      <span style="font-size:11px">Fees for additional services are separate from and in addition to the investigation fee.</span>
    </div>

    <h3>3. Conditions</h3>
    <p>Services under this Addendum are contingent upon: (a) Client remaining current on any required tax filings; (b) Client maintaining compliance with any IRS or state payment agreements during representation; (c) Timely payment of fees as agreed.</p>

    <h3>4. Incorporation</h3>
    <p>All terms of the original Tax Investigation Service Agreement remain in full force and effect and are incorporated herein. In the event of conflict, this Addendum controls.</p>

    ${sigBlock('Client Signature', 'Authorized Representative — ${FIRM.name}')}
    <p style="font-size:10px;color:#888;margin-top:20px;text-align:center">
      ${FIRM.name} · ${FIRM.address} · ${FIRM.email} · Not a law firm
    </p>
  `)
}

function generateEngagementLetter() {
  printBase('Engagement Letter', `
    <p>Dear Client,</p>
    <p>Thank you for choosing <b>${FIRM.name}</b>. We are pleased to confirm our engagement to assist you with your federal and/or state tax resolution matter. This letter outlines the terms of our engagement.</p>

    <h3>Services to Be Performed</h3>
    <ul>
      <li>Review your tax transcripts and compliance history with the IRS and/or applicable state taxing authority</li>
      <li>Identify all outstanding liabilities and unfiled returns</li>
      <li>Evaluate eligibility for IRS resolution programs including Installment Agreement, Currently Not Collectible status, Offer in Compromise, Penalty Abatement, and/or Innocent Spouse relief</li>
      <li>Represent you before the IRS and/or state tax authority through resolution</li>
    </ul>

    <h3>Your Responsibilities</h3>
    <ul>
      <li>Provide complete and accurate financial and tax information</li>
      <li>Execute all necessary authorization forms promptly</li>
      <li>Notify us immediately of any IRS or state contacts, notices, or levies received</li>
      <li>Fulfill all payment obligations under this engagement</li>
    </ul>

    <h3>Important Disclosures</h3>
    <p>${FIRM.name} is a tax resolution firm staffed by Enrolled Agents and licensed tax professionals. We are <b>not a law firm</b> and do not provide legal advice. Results in tax resolution matters cannot be guaranteed, as final decisions rest with the IRS or applicable state agency.</p>

    <p>We are committed to providing you with diligent, professional representation. Please do not hesitate to contact our office with any questions.</p>

    <p style="margin-top:16px">Sincerely,</p>
    <p><b>${FIRM.name}</b><br/>${FIRM.address}<br/>${FIRM.email}</p>

    ${sigBlock('Client Acknowledgment', 'Authorized Representative — ${FIRM.name}')}
    <p style="font-size:10px;color:#888;margin-top:20px;text-align:center">
      ${FIRM.name} · ${FIRM.address} · ${FIRM.email} · Not a law firm
    </p>
  `)
}

function generatePOALetter() {
  printBase('Power of Attorney Cover Letter', `
    <p style="text-align:right;color:#555;font-size:11px">Date: ___________________</p>

    <p><b>Internal Revenue Service</b><br/>
    [IRS Address / Compliance Center]</p>

    <p><b>Re: Power of Attorney — Form 2848<br/>
    Taxpayer: _____________________________ · SSN/EIN: _____________________________<br/>
    Tax Year(s): _____________________________________________________________</b></p>

    <p>Dear IRS Representative,</p>

    <p>Please find enclosed a completed and executed Form 2848, Power of Attorney and Declaration of Representative, authorizing <b>${FIRM.name}</b> to represent the above-named taxpayer before the Internal Revenue Service.</p>

    <p>Effective immediately, please direct all correspondence, notices, and communications regarding the above-referenced taxpayer and tax period(s) to our office:</p>

    <div style="border-left:3px solid #1A7FD4;padding-left:16px;margin:16px 0">
      <b>${FIRM.name}</b><br/>
      ${FIRM.address ? FIRM.address + '<br/>' : ''}
      ${FIRM.phone ? 'Phone: ' + FIRM.phone + '<br/>' : ''}
      ${FIRM.fax ? 'Fax: ' + FIRM.fax + '<br/>' : ''}
      ${FIRM.email ? 'Email: ' + FIRM.email : ''}
    </div>

    <p>Our authorized representative(s) are Enrolled Agents licensed to practice before the IRS. We respectfully request that all future contact regarding this matter be made through our office so that we may best serve our client's interests.</p>

    <p>If there are any questions regarding this authorization, please contact our office directly. We appreciate your cooperation.</p>

    <p style="margin-top:16px">Respectfully submitted,</p>

    <div style="margin-top:40px;border-top:1px solid #333;width:280px;padding-top:6px;font-size:11px;color:#555">
      Authorized Representative — ${FIRM.name}<br/>
      Enrolled Agent / Licensed Professional<br/>
      Date: ___________________
    </div>

    <p style="font-size:10px;color:#888;margin-top:24px;text-align:center">
      ${FIRM.name} · ${FIRM.address} · ${FIRM.email} · Not a law firm
    </p>
  `)
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function IrsForms() {
  const { user } = useApp()
  const [items, setItems]   = useState([])
  const [modal, setModal]   = useState(false)
  const [form, setForm]     = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [toast, setToast]   = useState('')
  const [clients, setClients]           = useState([])
  const [fillerClient, setFillerClient] = useState(null)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)

  // Guard: don't load until auth confirmed — prevents wrong-tenant clients on hard refresh
  useEffect(() => { if (user) { load(); loadClients() } }, [user?.id])

  async function load() {
    const { data } = await supabase.from('irsforms').select('*').order('created_at', { ascending: false })
    if (data) setItems(data)
  }

  async function loadClients() {
    const { data, error } = await supabase.from('clients').select('id, name, business_name, street, city, state, zip, phone, email, ssn, ein').order('name')
    if (error) { console.error('loadClients error:', error.message); return }
    if (data) setClients(data)
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }
  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.formNumber) { showToast('Form number required'); return }
    setSaving(true)
    const { error } = await supabase.from('irsforms').insert([{ ...form, created_at: new Date().toISOString() }])
    setSaving(false)
    if (error) { showToast('Error: ' + error.message); return }
    showToast('IRS Form logged!')
    setModal(false)
    setForm(BLANK)
    load()
  }

  async function deleteItem(id) {
    const { error } = await supabase.from('irsforms').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message); return }
    showToast('Deleted')
    load()
  }

  // Pre-fill for forms that aren't 2848/8821 — branded cover sheet + form window
  function prefillGenericForm(c, form) {
    const name = c.business_name || c.name || ''
    const addr = [c.street, c.city, c.state, c.zip].filter(Boolean).join(', ')
    const ssn  = c.ssn  ? `SSN: ${c.ssn}`  : ''
    const ein  = c.ein  ? `EIN: ${c.ein}`  : ''
    const tid  = [ssn, ein].filter(Boolean).join('  |  ')
    const now  = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const w = window.open('', '_blank', 'width=900,height=700')
    w.document.write(`<!DOCTYPE html><html><head>
      <title>Form ${form.num} — ${name}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:36px 48px;max-width:800px;margin:0 auto}
        .header{text-align:center;border-bottom:2px solid #1A7FD4;padding-bottom:16px;margin-bottom:24px}
        .firm{font-size:18px;font-weight:700;color:#1A7FD4}
        .meta{font-size:11px;color:#666;margin-top:4px}
        .box{border:1px solid #ddd;border-radius:6px;padding:14px 18px;margin-bottom:16px;background:#f8faff}
        .label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:3px}
        .val{font-size:13px;font-weight:600;color:#111}
        .form-link{display:inline-block;margin-top:20px;padding:10px 24px;background:#1A7FD4;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px}
        .notice{margin-top:24px;font-size:11px;color:#666;border-top:1px solid #ddd;padding-top:12px}
        @media print{.form-link{display:none}}
      </style>
    </head><body>
      <div class="header">
        <img src="${FIRM.logoUrl}" style="height:44px;margin-bottom:8px" onerror="this.style.display='none'"/>
        <div class="firm">${FIRM.name}</div>
        <div class="meta">${FIRM.address || ''} · ${FIRM.phone || ''} · ${FIRM.email || ''}</div>
      </div>

      <h2 style="font-size:15px;margin-bottom:16px">IRS Form ${form.num} — ${form.label}</h2>
      <p style="margin-bottom:16px;color:#444">Prepared for:</p>

      <div class="box">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><div class="label">Taxpayer Name</div><div class="val">${name}</div></div>
          <div><div class="label">Taxpayer ID</div><div class="val">${tid || '—'}</div></div>
          <div><div class="label">Address</div><div class="val">${addr || '—'}</div></div>
          <div><div class="label">Date Prepared</div><div class="val">${now}</div></div>
          ${c.phone ? `<div><div class="label">Phone</div><div class="val">${c.phone}</div></div>` : ''}
          ${c.email ? `<div><div class="label">Email</div><div class="val">${c.email}</div></div>` : ''}
        </div>
      </div>

      <a href="${form.url}" target="_blank" class="form-link">📄 Open Form ${form.num} (Official IRS PDF)</a>

      <div class="notice">
        This cover sheet was generated by ${FIRM.name} on ${now}. Complete and sign the attached IRS form. 
        Contact us at ${FIRM.phone || FIRM.email || ''} with any questions.
      </div>
    </body></html>`)
    w.document.close()
    // Also open the actual form in a second tab
    setTimeout(() => {
      window.open(form.url, '_blank')
    }, 300)
  }

  const STATUS_C = {
    'Not Filed': 'bn', Draft: 'ba', Sent: 'bb', Filed: 'bg',
    'Pending IRS': 'ba', 'In Review': 'ba', Approved: 'bg', Missing: 'br'
  }

  return (
    <div style={{padding:'20px 24px',maxWidth:1100,margin:'0 auto'}}>
      {toast && <div className="toast show">{toast}</div>}

      <div style={{marginBottom:20}}>
        <h2 style={{fontSize:17,fontWeight:700,margin:0}}>📋 IRS Forms & Documents</h2>
        <p style={{fontSize:12,color:'var(--t3)',margin:'4px 0 0'}}>Download official IRS forms, pre-fill with client data, and manage POA.</p>
      </div>

      {/* ── Client Picker (applies to all pre-fill actions) ─────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="ch">
          <span className="ct">📋 IRS Forms & Documents</span>
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>Select a client to pre-fill any form, or open blank</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
            <input
              value={clientSearch}
              onChange={e => { setClientSearch(e.target.value); setSelectedClientId(''); setShowClientDrop(true) }}
              onFocus={() => setShowClientDrop(true)}
              onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
              placeholder="Search client name to pre-fill…"
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--bd)', fontSize: 13, background: 'var(--s2)', color: 'var(--tx)', boxSizing: 'border-box' }}
            />
            {showClientDrop && clientSearch && (() => {
              const q = clientSearch.toLowerCase()
              const matches = clients.filter(c => (c.name||'').toLowerCase().includes(q) || (c.business_name||'').toLowerCase().includes(q)).slice(0, 10)
              return matches.length > 0 ? (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8, zIndex: 50, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,.25)' }}>
                  {matches.map(c => (
                    <div key={c.id}
                      onMouseDown={() => { setSelectedClientId(c.id); setClientSearch(c.business_name || c.name); setShowClientDrop(false) }}
                      style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--tx)', borderBottom: '1px solid var(--br)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      {c.business_name || c.name}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8, zIndex: 50, padding: '10px 14px', fontSize: 13, color: 'var(--t3)' }}>
                  No clients found
                </div>
              )
            })()}
          </div>
          {selectedClientId && (
            <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 700 }}>
              ✅ {clientSearch} selected — click ✏️ Pre-fill on any form below
            </span>
          )}
        </div>

        {/* Form grid — each card has Blank + Pre-fill buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, padding: '16px 0 4px' }}>
          {IRS_FORMS.map(f => (
            <div key={f.num} style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ background: 'var(--blue)', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {f.num}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)', lineHeight: 1.3 }}>{f.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
                  <button className="btn sec" style={{ width: '100%', fontSize: 11, padding: '5px 8px', justifyContent: 'center' }}>
                    📄 Blank
                  </button>
                </a>
                <button
                  className="btn pri"
                  style={{ flex: 1, fontSize: 11, padding: '5px 8px', justifyContent: 'center', opacity: selectedClientId ? 1 : 0.45 }}
                  disabled={!selectedClientId}
                  onClick={() => {
                    const c = clients.find(x => x.id === selectedClientId)
                    if (!c) return
                    // Forms with a formType key route to the IRSFormFiller (real pdf-lib pre-fill)
                    if (f.formType) {
                      setFillerClient({...c, address: c.street, business_name: c.business_name, _formType: f.formType})
                    } else {
                      // Forms without a formType key: open branded cover sheet + blank PDF
                      prefillGenericForm(c, f)
                    }
                  }}
                >
                  ✏️ Pre-fill
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 2: Document Templates ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="ch">
          <span className="ct">Document Templates</span>
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>Opens print-ready PDF window</span>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
          padding: '4px 0'
        }}>
          {[
            {
              icon: '📄',
              label: 'Tax Investigation\nService Agreement',
              desc: 'Full TCR agreement w/ fees & signatures',
              action: generateServiceAgreement,
              color: 'var(--blue)'
            },
            {
              icon: '📋',
              label: 'Service\nAddendum',
              desc: 'Supplemental agreement for additional services',
              action: generateAddendum,
              color: '#25A25A'
            },
            {
              icon: '✉️',
              label: 'Engagement\nLetter',
              desc: 'Client engagement confirmation letter',
              action: generateEngagementLetter,
              color: '#7B5EA7'
            },
            {
              icon: '🔐',
              label: 'POA Cover\nLetter',
              desc: 'Form 2848 cover letter to IRS',
              action: generatePOALetter,
              color: '#D4930A'
            },
          ].map(t => (
            <button
              key={t.label}
              className="btn sec"
              onClick={t.action}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '12px 14px',
                gap: 4,
                height: 'auto',
                borderLeft: `3px solid ${t.color}`
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.3, whiteSpace: 'pre-line', textAlign: 'left' }}>{t.label}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--t2)', textAlign: 'left', lineHeight: 1.4 }}>{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Section 3: IRS Form Tracker ───────────────────────────────── */}
      <div className="card">
        <div className="ch">
          <span className="ct">IRS Form Tracker ({items.length})</span>
          <button className="btn pri" onClick={() => setModal(true)}>+ Log IRS Form</button>
        </div>
        <div className="ovx">
          <table>
            <thead>
              <tr>
                <th>Form</th>
                <th>Client</th>
                <th>Case #</th>
                <th>Filed Date</th>
                <th>Status</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--t3)', padding: 20 }}>
                    No IRS forms logged yet
                  </td>
                </tr>
              ) : items.map(f => (
                <tr key={f.id}>
                  <td><span className="bdg bb" style={{ fontWeight: 700 }}>Form {f.formNumber}</span></td>
                  <td style={{ fontWeight: 600 }}>{f.client || '—'}</td>
                  <td style={{ color: 'var(--t2)' }}>{f.caseNum || '—'}</td>
                  <td style={{ color: 'var(--t2)' }}>{f.filedDate || '—'}</td>
                  <td><span className={`bdg ${STATUS_C[f.status] || 'bn'}`}>{f.status}</span></td>
                  <td style={{ color: 'var(--t2)', fontSize: 12 }}>{f.notes || '—'}</td>
                  <td><button className="btn del" onClick={() => deleteItem(f.id)}>Del</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Log IRS Form Modal ─────────────────────────────────────────── */}
      {modal && (
        <div className="modal-bg open" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal">
            <div className="mh">
              <span className="mt">Log IRS Form</span>
              <button className="xbtn" onClick={() => setModal(false)}>&times;</button>
            </div>
            <div className="fg2">
              <div className="field"><label>Form Number</label>
                <select value={form.formNumber} onChange={e => fld('formNumber', e.target.value)}>
                  {['2848', '8821', '433-A', '433-B', '433-F', '656', '9465', '843', '911', '4506-T'].map(f =>
                    <option key={f}>{f}</option>
                  )}
                </select>
              </div>
              <div className="field"><label>Status</label>
                <select value={form.status} onChange={e => fld('status', e.target.value)}>
                  {['Not Filed', 'Draft', 'Sent', 'Filed', 'Pending IRS', 'In Review', 'Approved', 'Missing'].map(s =>
                    <option key={s}>{s}</option>
                  )}
                </select>
              </div>
            </div>
            <div className="fg2">
              <div className="field"><label>Client</label>
                <input value={form.client} onChange={e => fld('client', e.target.value)} placeholder="Client name" />
              </div>
              <div className="field"><label>Case #</label>
                <input value={form.caseNum} onChange={e => fld('caseNum', e.target.value)} placeholder="Case number" />
              </div>
            </div>
            <div className="fg2">
              <div className="field"><label>Filed Date</label>
                <input type="date" value={form.filedDate} onChange={e => fld('filedDate', e.target.value)} />
              </div>
              <div className="field"><label>Notes</label>
                <input value={form.notes} onChange={e => fld('notes', e.target.value)} placeholder="Optional notes" />
              </div>
            </div>
            <button
              className="btn pri"
              style={{ width: '100%', justifyContent: 'center', padding: 10 }}
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Log IRS Form'}
            </button>
          </div>
        </div>
      )}
      {/* ── IRS Form Filler Modal ─────────────────────────────────────── */}
      {fillerClient && (
        <IRSFormFiller
          client={fillerClient}
          onClose={() => setFillerClient(null)}
        />
      )}
    </div>
  )
}
