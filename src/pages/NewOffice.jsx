import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import RomyLabsAgreementPanel from '../components/admin/RomyLabsAgreementPanel'
import { PLAN_OPTIONS, normalizePlanTier, planLabel } from '../lib/planTiers'

const PLATFORM_ADMIN_EMAILS = ['romy@taxcasereview.org', 'romy@taxrescrm.net', 'romy@romylabs.com', 'info@romylabs.com']
const TCR_TENANT = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
const BLANK = { firm_name:'', tenant_code:'', admin_name:'', admin_email:'', firm_phone:'', brand_color:'#2563eb', plan_tier:'starter' }
const STATUS_COLORS = { active:'#10b981', trial:'#f59e0b', past_due:'#f97316', cancelled:'#ef4444' }

function fmtBytes(n) {
  if (!n) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024*1024) return (n/1024).toFixed(0) + ' KB'
  return (n/1024/1024).toFixed(1) + ' MB'
}

// Platform-only tool: CRM Companies — every office running on this platform.
// List view for browsing/creating offices, detail view (click a row) for
// contract/contact info, phone numbers, staff, agreement files, and
// activate/deactivate. Gated on Romy specifically (not any Super Admin
// anywhere) — checked here for UI purposes, and re-checked independently by
// every RPC and edge function this page calls.


// ── Slack History Importer ──────────────────────────────────────────────────
// Reads a Slack workspace export (zip → channels/*.json) and bulk-inserts
// messages into the CRM's chat_messages table for this tenant.
function SlackImport({ tenantId, onBack, showToast }) {
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState(null)
  const [channelMap, setChannelMap] = useState('') // "slack-channel = crm-channel" per line
  const [messages, setMessages]   = useState([])
  const [fileNames, setFileNames] = useState([])

  async function handleFiles(e) {
    const files = Array.from(e.target.files)
    setFileNames(files.map(f => f.name))
    const allMsgs = []
    for (const file of files) {
      const channelName = file.name.replace('.json', '')
      try {
        const text = await file.text()
        const rows = JSON.parse(text)
        rows.forEach(m => { m._channel = channelName })
        allMsgs.push(...rows)
      } catch (_) { showToast('Could not parse ' + file.name, 'err') }
    }
    setMessages(allMsgs)
  }

  async function runImport() {
    if (!messages.length) { showToast('Load Slack JSON files first', 'err'); return }
    setImporting(true)
    // Parse channel map
    const map = {}
    channelMap.split('\n').forEach(line => {
      const [k, v] = line.split('=').map(s => s.trim())
      if (k && v) map[k] = v
    })

    const { data, error } = await import('../lib/supabase').then(m => m.supabase)
      .functions.invoke('slack-import', {
        body: { tenant_id: tenantId, channel_map: Object.keys(map).length ? map : null, messages }
      })
    setImporting(false)
    if (error) { showToast('Import failed: ' + error.message, 'err'); return }
    setResult(data)
    showToast(`✅ Imported ${data?.inserted} messages from Slack`)
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 20 }}>
      <button className="btn" onClick={onBack} style={{ marginBottom: 20 }}>← Back</button>
      <h2 style={{ fontWeight: 800, fontSize: 20, color: 'var(--tx)', marginBottom: 6 }}>💬 Import Slack History</h2>
      <p style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 20, lineHeight: 1.6 }}>
        Import message history from a Slack workspace export into CRM Team Chat. In Slack: <strong>Settings → Import &amp; Export → Export → All Messages</strong>. Unzip the export, then upload the <code>.json</code> files from individual channel folders below.
      </p>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>1. Upload Channel JSON Files</div>
        <input type="file" accept=".json" multiple onChange={handleFiles}
          style={{ fontSize: 13, color: 'var(--t2)' }} />
        {fileNames.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--t3)' }}>
            {fileNames.length} file{fileNames.length !== 1 ? 's' : ''} loaded — {messages.length} messages total
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>2. Map Slack Channels → CRM Channels (optional)</div>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>Leave blank to import each channel using its Slack name as the CRM channel name.</div>
        <textarea rows={4} value={channelMap} onChange={e => setChannelMap(e.target.value)}
          placeholder={"general = general\ntax-team = team-chat"}
          style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }} />
      </div>

      {result && (
        <div style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--ok)' }}>
          ✅ Import complete — {result.inserted} messages imported, {result.skipped} skipped (duplicates or system messages)
        </div>
      )}

      <button className="btn pri" onClick={runImport} disabled={importing || !messages.length} style={{ padding: '10px 28px', fontSize: 14, fontWeight: 700 }}>
        {importing ? 'Importing…' : `Import ${messages.length} Messages`}
      </button>
    </div>
  )
}

export default function NewOffice() {
  const { user, showToast } = useApp()
  const [searchParams] = useSearchParams()
  const allowed = PLATFORM_ADMIN_EMAILS.includes((user?.email || '').toLowerCase())
  const [saleHandoff, setSaleHandoff] = useState(null)
  const [offices, setOffices]   = useState(null) // null = not loaded yet
  const [view, setView]         = useState('list') // 'list' | 'form' | 'detail'
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (allowed) loadOffices()
  }, [allowed])

  useEffect(() => {
    if (!allowed) return
    const prospectId=searchParams.get('prospect_id')
    const agreementId=searchParams.get('agreement_id')
    if (!prospectId) return
    ;(async()=>{
      const {data:prospect,error:pe}=await supabase.from('prospects').select('*').eq('id',prospectId).maybeSingle()
      if (pe || !prospect) { showToast('❌ Could not load the sale'); return }
      if (prospect.tenant_id) { showToast('This sale is already linked to an office'); return }
      let agreement=null
      if (agreementId) {
        const {data:a,error:ae}=await supabase.from('romylabs_sales_agreements').select('*').eq('id',agreementId).eq('prospect_id',prospectId).maybeSingle()
        if (ae) { showToast('❌ Could not load agreement'); return }
        agreement=a
      }
      setSaleHandoff({prospect,agreement})
      setView('form')
    })()
  }, [allowed, searchParams])

  async function loadOffices() {
    const { data, error } = await supabase.rpc('list_tenants')
    if (error) { showToast('❌ ' + error.message); return }
    setOffices(data || [])
  }

  function openDetail(id) { setSelectedId(id); setView('detail') }
  function backToList() { setView('list'); setSelectedId(null); loadOffices() }

  if (!allowed) return (
    <div style={{padding:40,maxWidth:520}}>
      <div style={{fontSize:18,fontWeight:700,marginBottom:8,color:'var(--tx)'}}>Not available</div>
      <div style={{color:'var(--t3)',fontSize:13.5,lineHeight:1.6}}>This page is a platform-level tool and isn't available from this account.</div>
    </div>
  )

  if (view === 'form') return <NewOfficeForm onDone={backToList} onCancel={() => setView('list')} showToast={showToast} prefill={saleHandoff} />
  if (view === 'detail') return <OfficeDetail tenantId={selectedId} onBack={backToList} showToast={showToast} onImport={()=>setView('import')} onSlackImport={()=>setView('slack-import')} />
  if (view === 'import') return <DataImport tenantId={selectedId} onBack={()=>setView('detail')} showToast={showToast} />
  if (view === 'slack-import') return <SlackImport tenantId={selectedId} onBack={()=>setView('detail')} showToast={showToast} />
  return (
    <div style={{padding:'28px 32px',maxWidth:820}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
        <div style={{fontSize:20,fontWeight:800,color:'var(--tx)'}}>🏢 CRM Companies</div>
        <button className="btn pri" onClick={() => setView('form')}>+ New Office</button>
      </div>
      <div style={{color:'var(--t3)',fontSize:13,marginBottom:24}}>
        Every office running on this platform, each on its own isolated tenant. Click one for contract info, contacts, phone numbers, and agreement files.
      </div>

      <div style={{border:'1px solid var(--br)',borderRadius:10,overflow:'hidden'}}>
        {offices === null ? (
          <div style={{padding:24,color:'var(--t3)',fontSize:13}}>Loading offices…</div>
        ) : offices.length === 0 ? (
          <div style={{padding:24,color:'var(--t3)',fontSize:13}}>No offices yet.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'var(--s2)',textAlign:'left'}}>
                {['Firm','Code','Admin','Staff','Billing','Status'].map(h=>(
                  <th key={h} style={{padding:'10px 14px',fontSize:11,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.04em'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offices.map(o => (
                <tr key={o.id} onClick={()=>openDetail(o.id)}
                  style={{borderTop:'1px solid var(--br)',cursor:'pointer'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <td style={{padding:'10px 14px',color:'var(--tx)',fontWeight:600}}>
                    {o.brand_color && <span style={{display:'inline-block',width:9,height:9,borderRadius:'50%',background:o.brand_color,marginRight:8}}/>}
                    {o.firm_name}
                  </td>
                  <td style={{padding:'10px 14px',color:'var(--t2)',fontFamily:'monospace'}}>{o.tenant_code}</td>
                  <td style={{padding:'10px 14px',color:'var(--t2)'}}>{o.admin_email || '—'}</td>
                  <td style={{padding:'10px 14px',color:'var(--t2)'}}>{o.employee_count}</td>
                  <td style={{padding:'10px 14px',color:'var(--t2)'}}>{o.effective_monthly != null ? `$${Number(o.effective_monthly).toFixed(2)}/mo` : '—'}</td>
                  <td style={{padding:'10px 14px'}}>
                    <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,textTransform:'capitalize',
                      background:(STATUS_COLORS[o.status]||'#94a3b8')+'22',color:STATUS_COLORS[o.status]||'#94a3b8'}}>{o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Create-office form (unchanged behavior, extracted as its own component) ─
function NewOfficeForm({ onDone, onCancel, showToast, prefill }) {
  const saleName = prefill?.prospect?.firm_name || ''
  const initialForm = prefill ? {
    ...BLANK,
    firm_name:saleName,
    tenant_code:saleName.toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,12),
    admin_name:prefill.prospect?.contact_name || prefill.agreement?.signer_name || '',
    admin_email:prefill.prospect?.contact_email || prefill.agreement?.signer_email || '',
    firm_phone:prefill.prospect?.contact_phone || '',
  } : BLANK
  const [form, setForm]     = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function slugify(name) { return name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) }

  async function submit() {
    if (!form.firm_name.trim() || !form.tenant_code.trim() || !form.admin_email.trim()) {
      showToast('Firm name, office code, and admin email are required'); return
    }
    setSaving(true)
    const { data, error } = await supabase.functions.invoke('provision-tenant', {
      body: {
        firm_name: form.firm_name.trim(), tenant_code: form.tenant_code.trim(),
        admin_name: form.admin_name.trim(), admin_email: form.admin_email.trim().toLowerCase(),
        firm_phone: form.firm_phone.trim() || null, brand_color: form.brand_color || null,
        plan_tier: form.plan_tier,
      }
    })
    setSaving(false)
    if (error || data?.error) { showToast('❌ ' + (data?.error || error.message)); return }
    if (prefill?.prospect?.id && data?.tenant_id) {
      const {error:linkErr}=await supabase.rpc('admin_romylabs_link_prospect_office',{p_prospect_id:prefill.prospect.id,p_tenant_id:data.tenant_id})
      if (linkErr) showToast('⚠️ Office created, but sale linkage needs attention: ' + linkErr.message)
      else showToast('✅ Office created from sale — manage agreement from Office Documents')
    }
    if (prefill?.agreement?.id && prefill.agreement.status==='signed' && data?.tenant_id) {
      const {error:fileErr}=await supabase.rpc('admin_romylabs_attach_signed_agreement',{p_agreement_id:prefill.agreement.id,p_tenant_id:data.tenant_id})
      if (fileErr) showToast('⚠️ Office created, but signed agreement filing needs attention: ' + fileErr.message)
    }
    setResult(data)
  }

  function copyCreds() {
    const text = `TaxRes CRM login\nURL: https://taxrescrm.app\nEmail: ${result.admin_email}\nTemporary password: ${result.temp_password}\n\nPlease sign in and change your password.`
    navigator.clipboard.writeText(text)
    setCopied(true); setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div style={{padding:'28px 32px',maxWidth:640}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:4}}>
        <button className="btn sec" onClick={onCancel}>← Back</button>
        <div style={{fontSize:20,fontWeight:800,color:'var(--tx)'}}>New Office</div>
      </div>
      <div style={{color:'var(--t3)',fontSize:13,margin:'8px 0 24px'}}>Stand up a brand-new office on its own isolated tenant.</div>
      {prefill&&<div style={{margin:'0 0 18px',padding:'12px 14px',borderRadius:9,background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.28)',color:'#a7f3d0',fontSize:12,lineHeight:1.6}}><strong>Sale → Office handoff</strong><br/>{prefill.prospect?.firm_name} · {prefill.prospect?.seats||prefill.agreement?.seats||1} seats · ${Number(prefill.prospect?.mrr_potential||prefill.agreement?.monthly_amount||0).toLocaleString()}/mo. Create the office first; then send and manage the agreement from that office's Documents area.</div>}

      {result ? (
        <div style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:10,padding:20}}>
          <div style={{fontSize:15,fontWeight:700,color:'#10b981',marginBottom:12}}>✅ Office created</div>
          <div style={{fontSize:13,lineHeight:2,color:'var(--tx)'}}>
            <div><b>Office code:</b> {result.tenant_code}</div>
            <div><b>Admin email:</b> {result.admin_email}</div>
            <div><b>Temporary password:</b> <code style={{background:'var(--s3)',padding:'2px 8px',borderRadius:5}}>{result.temp_password}</code></div>
          </div>
          <div style={{fontSize:12,color:'var(--t3)',marginTop:10,lineHeight:1.6}}>
            This password is shown once and isn't stored anywhere retrievable — copy it now and send it to the new admin over a secure channel.
          </div>
          <div style={{display:'flex',gap:10,marginTop:16}}>
            <button className="btn pri" onClick={copyCreds}>{copied ? '✓ Copied' : '📋 Copy login details'}</button>
            <button className="btn sec" onClick={onDone}>Done → Back to list</button>
          </div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="field"><label>Firm Name *</label>
            <input value={form.firm_name} onChange={e=>{fld('firm_name',e.target.value); if(!form.tenant_code) fld('tenant_code', slugify(e.target.value))}} placeholder="e.g. Bennett Tax Resolution"/>
          </div>
          <div className="field"><label>Office Code *</label>
            <input value={form.tenant_code} onChange={e=>fld('tenant_code', slugify(e.target.value))} placeholder="e.g. BENNETT" style={{fontFamily:'monospace'}}/>
            <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>Short, unique identifier for this office.</div>
          </div>
          <div style={{display:'flex',gap:14}}>
            <div className="field" style={{flex:1}}><label>Admin Name</label>
              <input value={form.admin_name} onChange={e=>fld('admin_name',e.target.value)} placeholder="e.g. Chris Bennett"/>
            </div>
            <div className="field" style={{flex:1}}><label>Admin Email *</label>
              <input value={form.admin_email} onChange={e=>fld('admin_email',e.target.value)} placeholder="chris@theirfirm.com" type="email"/>
            </div>
          </div>
          <div style={{display:'flex',gap:14}}>
            <div className="field" style={{flex:1}}><label>Firm Phone</label>
              <input value={form.firm_phone} onChange={e=>fld('firm_phone',e.target.value)} placeholder="Optional"/>
            </div>
            <div className="field" style={{flex:1}}><label>Brand Color</label>
              <input type="color" value={form.brand_color} onChange={e=>fld('brand_color',e.target.value)} style={{height:38,padding:2,cursor:'pointer'}}/>
            </div>
          </div>
          <div className="field"><label>Plan</label>
            <select value={form.plan_tier} onChange={e=>fld('plan_tier',e.target.value)}>
              {PLAN_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label + ' — $' + p.price + '/user/mo'}</option>)}
            </select>
          </div>
          <button className="btn pri" disabled={saving} onClick={submit} style={{marginTop:8,alignSelf:'flex-start',padding:'10px 24px'}}>
            {saving ? 'Creating office…' : 'Create Office'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Office detail: contract/contact info, phone numbers, staff, agreements ──
function OfficeDetail({ tenantId, onBack, showToast, onImport, onSlackImport }) {
  const [detail, setDetail] = useState(null)
  const [edit, setEdit]     = useState(null) // draft patch while editing
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [officeProspect, setOfficeProspect] = useState(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [deactivateReason, setDeactivateReason] = useState('')

  useEffect(() => { load() }, [tenantId])

  async function load() {
    setDetail(null)
    const { data, error } = await supabase.rpc('get_office_detail', { p_tenant_id: tenantId })
    if (error) { showToast('❌ ' + error.message); return }
    setDetail(data)
    const {data:prospect,error:prospectError}=await supabase.rpc('admin_romylabs_prospect_for_tenant',{p_tenant_id:tenantId})
    if (prospectError) console.error('Could not load linked sales record:',prospectError)
    setOfficeProspect(prospect||null)
    setEdit(null)
  }

  function startEdit() {
    const t = detail.tenant
    setEdit({
      firm_name: t.firm_name || '', firm_phone: t.firm_phone || '', firm_address: t.firm_address || '',
      primary_contact_name: t.primary_contact_name || '', primary_contact_email: t.primary_contact_email || '',
      contract_start_date: t.contract_start_date || '', contract_end_date: t.contract_end_date || '',
      monthly_rate: t.monthly_rate ?? '', notes: t.notes || '',
      signalwire_phone_number: t.signalwire_phone_number || '', signalwire_project_id: t.signalwire_project_id || '',
      plan_tier: normalizePlanTier(t.plan_tier), brand_color: t.brand_color || '#2563eb',
      per_seat_rate: t.per_seat_rate ?? '',
    })
  }

  async function saveEdit() {
    setSaving(true)
    const { error } = await supabase.rpc('update_office', { p_tenant_id: tenantId, p_patch: edit })
    setSaving(false)
    if (error) { showToast('❌ ' + error.message); return }
    showToast('✅ Saved')
    load()
  }

  async function toggleStatus(newStatus) {
    const { error } = await supabase.rpc('set_office_status', {
      p_tenant_id: tenantId, p_status: newStatus,
      p_reason: newStatus === 'cancelled' ? (deactivateReason.trim() || null) : null,
    })
    if (error) { showToast('❌ ' + error.message); return }
    setConfirmDeactivate(false); setDeactivateReason('')
    showToast(newStatus === 'cancelled' ? '🚫 Office deactivated' : '✅ Office reactivated')
    load()
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1]
      const { data, error } = await supabase.functions.invoke('office-agreement-file', {
        body: { action: 'upload', tenant_id: tenantId, file_name: file.name, file_base64: base64, content_type: file.type, label: null }
      })
      setUploading(false)
      if (error || data?.error) { showToast('❌ ' + (data?.error || error.message)); return }
      showToast('✅ Agreement uploaded')
      load()
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function viewAgreement(filePath) {
    if (String(filePath||'').startsWith('sales-agreement:')) {
      const id=String(filePath).split(':')[1]
      const {data,error}=await supabase.rpc('admin_romylabs_signed_agreement_html',{p_agreement_id:id})
      if (error || !data?.html) { showToast('❌ ' + (error?.message || 'Could not open signed agreement')); return }
      const signed=`<div style="font-family:Arial,sans-serif;max-width:850px;margin:40px auto;color:#111">${data.html}<hr style="margin:36px 0"><h3>Electronic Signature Certificate</h3><p><strong>Signed by:</strong> ${data.signed_name||'—'}<br><strong>Email:</strong> ${data.signer_email||'—'}<br><strong>Signed:</strong> ${data.signed_at?new Date(data.signed_at).toLocaleString():'—'}</p></div>`
      const url=URL.createObjectURL(new Blob([signed],{type:'text/html'}))
      window.open(url,'_blank','noopener,noreferrer')
      setTimeout(()=>URL.revokeObjectURL(url),60000)
      return
    }
    const { data, error } = await supabase.functions.invoke('office-agreement-file', { body: { action: 'geturl', file_path: filePath } })
    if (error || data?.error) { showToast('❌ ' + (data?.error || error.message)); return }
    window.open(data.url, '_blank')
  }

  async function deleteAgreement(id) {
    const { data, error } = await supabase.functions.invoke('office-agreement-file', { body: { action: 'delete', agreement_id: id } })
    if (error || data?.error) { showToast('❌ ' + (data?.error || error.message)); return }
    showToast('Agreement removed')
    load()
  }

  if (!detail) return (
    <div style={{padding:'28px 32px'}}>
      <button className="btn sec" onClick={onBack}>← Back to offices</button>
      <div style={{marginTop:20,color:'var(--t3)'}}>Loading office…</div>
    </div>
  )

  const t = detail.tenant
  const isTCR = tenantId === TCR_TENANT

  return (
    <div style={{padding:'28px 32px',maxWidth:720}}>
      <button className="btn sec" onClick={onBack}>← Back to offices</button>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',margin:'18px 0 4px'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{fontSize:22,fontWeight:800,color:'var(--tx)'}}>{t.firm_name}</div>
          <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,textTransform:'capitalize',
            background:(STATUS_COLORS[t.status]||'#94a3b8')+'22',color:STATUS_COLORS[t.status]||'#94a3b8'}}>{t.status}</span>
        </div>
        {!edit && (
          <div style={{display:'flex',gap:8}}>
            <button className="btn sec" onClick={startEdit}>✏️ Edit</button>
            <button className="btn sec" onClick={onImport}>📥 Import Data</button>
            <button className="btn sec" onClick={onSlackImport}>💬 Import Slack History</button>
            {!isTCR && (t.status === 'cancelled'
              ? <button className="btn pri" onClick={()=>toggleStatus('active')}>Reactivate</button>
              : <button className="btn" style={{background:'#ef444422',color:'#ef4444',border:'1px solid #ef444455'}} onClick={()=>setConfirmDeactivate(true)}>Deactivate</button>)}
          </div>
        )}
      </div>
      <div style={{color:'var(--t3)',fontSize:12.5,fontFamily:'monospace',marginBottom:20}}>{t.tenant_code}</div>

      {confirmDeactivate && (
        <div style={{background:'#ef444411',border:'1px solid #ef444455',borderRadius:10,padding:16,marginBottom:20}}>
          <div style={{fontWeight:700,color:'#ef4444',marginBottom:8}}>Deactivate {t.firm_name}?</div>
          <div style={{fontSize:12.5,color:'var(--t2)',marginBottom:10}}>Staff at this office won't be able to log in until it's reactivated. Their data is kept, not deleted.</div>
          <input value={deactivateReason} onChange={e=>setDeactivateReason(e.target.value)} placeholder="Reason (optional)"
            style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',marginBottom:10,background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)'}}/>
          <div style={{display:'flex',gap:8}}>
            <button className="btn" style={{background:'#ef4444',color:'#fff'}} onClick={()=>toggleStatus('cancelled')}>Confirm Deactivate</button>
            <button className="btn sec" onClick={()=>setConfirmDeactivate(false)}>Cancel</button>
          </div>
        </div>
      )}

      <Section title="Contract & Contact">
        {edit ? (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Row label="Firm Name"><input value={edit.firm_name} onChange={e=>setEdit(f=>({...f,firm_name:e.target.value}))}/></Row>
            <Row label="Firm Address"><input value={edit.firm_address} onChange={e=>setEdit(f=>({...f,firm_address:e.target.value}))}/></Row>
            <Row label="Primary Contact"><input value={edit.primary_contact_name} onChange={e=>setEdit(f=>({...f,primary_contact_name:e.target.value}))} placeholder="Name"/></Row>
            <Row label="Contact Email"><input value={edit.primary_contact_email} onChange={e=>setEdit(f=>({...f,primary_contact_email:e.target.value}))} type="email"/></Row>
            <Row label="Contract Start"><input value={edit.contract_start_date} onChange={e=>setEdit(f=>({...f,contract_start_date:e.target.value}))} type="date"/></Row>
            <Row label="Contract End"><input value={edit.contract_end_date} onChange={e=>setEdit(f=>({...f,contract_end_date:e.target.value}))} type="date"/></Row>
            <Row label="Plan"><select value={edit.plan_tier} onChange={e=>setEdit(f=>({...f,plan_tier:e.target.value}))}>{PLAN_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label + ' — $' + p.price + '/user/mo'}</option>)}</select></Row>
            <Row label="Notes"><textarea value={edit.notes} onChange={e=>setEdit(f=>({...f,notes:e.target.value}))} rows={3} style={{width:'100%',boxSizing:'border-box'}}/></Row>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <button className="btn pri" disabled={saving} onClick={saveEdit}>{saving?'Saving…':'Save'}</button>
              <button className="btn sec" onClick={()=>setEdit(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:8,fontSize:13}}>
            <InfoRow label="Address" value={t.firm_address}/>
            <InfoRow label="Primary Contact" value={t.primary_contact_name}/>
            <InfoRow label="Contact Email" value={t.primary_contact_email}/>
            <InfoRow label="Contract" value={t.contract_start_date || t.contract_end_date ? `${t.contract_start_date||'—'} → ${t.contract_end_date||'—'}` : null}/>
            <InfoRow label="Plan" value={planLabel(t.plan_tier)}/>
            <InfoRow label="Notes" value={t.notes}/>
          </div>
        )}
      </Section>

      <Section title="Billing">
        {edit ? (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Row label="Per-Seat Rate ($/mo)">
              <input value={edit.per_seat_rate} onChange={e=>setEdit(f=>({...f,per_seat_rate:e.target.value}))} type="number" step="0.01" placeholder="e.g. 55.00"/>
            </Row>
            <div style={{fontSize:11.5,color:'var(--t3)'}}>
              {detail.employees.length} seat{detail.employees.length===1?'':'s'} × {edit.per_seat_rate ? `$${edit.per_seat_rate}` : '—'} = {edit.per_seat_rate ? `$${(detail.employees.length * parseFloat(edit.per_seat_rate||0)).toFixed(2)}/mo` : '—'} (recalculates automatically as staff are added or removed)
            </div>
            <Row label="Flat Rate Override ($/mo)">
              <input value={edit.monthly_rate} onChange={e=>setEdit(f=>({...f,monthly_rate:e.target.value}))} type="number" step="0.01" placeholder="Leave blank to bill per-seat"/>
            </Row>
            <div style={{fontSize:11.5,color:'var(--t3)'}}>If set, this flat amount is billed instead of the per-seat total — for a negotiated deal. Leave blank for standard per-seat billing.</div>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              <button className="btn pri" disabled={saving} onClick={saveEdit}>{saving?'Saving…':'Save'}</button>
              <button className="btn sec" onClick={()=>setEdit(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:8,fontSize:13}}>
            <InfoRow label="Per-Seat Rate" value={detail.billing.per_seat_rate ? `$${detail.billing.per_seat_rate}/seat/mo` : null}/>
            <InfoRow label="Seats" value={detail.billing.seats}/>
            {detail.billing.flat_override && (
              <InfoRow label="Flat Override" value={`$${detail.billing.flat_override}/mo (overrides per-seat)`}/>
            )}
            <div style={{display:'flex',justifyContent:'space-between',paddingTop:8,marginTop:4,borderTop:'1px solid var(--br)'}}>
              <span style={{color:'var(--tx)',fontWeight:700}}>Effective Monthly</span>
              <span style={{color:'var(--tx)',fontWeight:700}}>{detail.billing.effective_monthly != null ? `$${Number(detail.billing.effective_monthly).toFixed(2)}` : '— not set'}</span>
            </div>
          </div>
        )}
      </Section>

      <Section title="Phone Numbers">
        {edit ? (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <Row label="Office Phone"><input value={edit.firm_phone} onChange={e=>setEdit(f=>({...f,firm_phone:e.target.value}))}/></Row>
            <Row label="SignalWire Number"><input value={edit.signalwire_phone_number} onChange={e=>setEdit(f=>({...f,signalwire_phone_number:e.target.value}))} placeholder="+1..."/></Row>
            <Row label="SignalWire Project ID"><input value={edit.signalwire_project_id} onChange={e=>setEdit(f=>({...f,signalwire_project_id:e.target.value}))}/></Row>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:8,fontSize:13}}>
            <InfoRow label="Office Phone" value={t.firm_phone}/>
            <InfoRow label="SignalWire Number" value={t.signalwire_phone_number}/>
            <InfoRow label="SignalWire Project ID" value={t.signalwire_project_id}/>
          </div>
        )}
      </Section>

      <Section title={`Staff (${detail.employees.length})`}>
        {detail.employees.length === 0 ? <div style={{color:'var(--t3)',fontSize:13}}>No staff yet.</div> : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {detail.employees.map(e => (
              <div key={e.id} style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'6px 0',borderBottom:'1px solid var(--br)'}}>
                <span style={{color:'var(--tx)',fontWeight:600}}>{e.name}</span>
                <span style={{color:'var(--t3)'}}>{e.email} · {e.access}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Documents & E-Sign">
        {officeProspect ? (
          <div style={{margin:'-16px -16px 16px'}}>
            <RomyLabsAgreementPanel prospect={officeProspect} supabase={supabase} onChanged={load} />
          </div>
        ) : (
          <div style={{fontSize:12,color:'var(--t3)',marginBottom:14,lineHeight:1.5}}>No linked sales record for this office yet. Agreements created manually can still be uploaded below.</div>
        )}
        <div style={{marginBottom:12,paddingTop:12,borderTop:'1px solid var(--br)'}}>
          <label className="btn sec" style={{cursor:'pointer',display:'inline-block'}}>
            {uploading ? 'Uploading…' : '📎 Upload Document / Agreement'}
            <input type="file" onChange={handleUpload} disabled={uploading} style={{display:'none'}}/>
          </label>
        </div>
        {detail.agreements.length === 0 ? <div style={{color:'var(--t3)',fontSize:13}}>No office agreement documents yet.</div> : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {detail.agreements.map(a => (
              <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:13,padding:'8px 10px',background:'var(--s2)',borderRadius:6}}>
                <div>
                  <span style={{color:'var(--tx)',fontWeight:600,cursor:'pointer',textDecoration:'underline'}} onClick={()=>viewAgreement(a.file_path)}>{a.file_name}</span>
                  <span style={{color:'var(--t3)',marginLeft:8}}>{fmtBytes(a.file_size)} · {new Date(a.created_at).toLocaleDateString()}</span>
                </div>
                <button className="btn sec" style={{padding:'4px 10px',fontSize:12}} onClick={()=>deleteAgreement(a.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{marginBottom:22}}>
      <div style={{fontSize:12,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:10}}>{title}</div>
      <div style={{background:'var(--s1)',border:'1px solid var(--br)',borderRadius:10,padding:16}}>{children}</div>
    </div>
  )
}
function Row({ label, children }) {
  return <div><label style={{display:'block',fontSize:11.5,color:'var(--t3)',marginBottom:4}}>{label}</label>{children}</div>
}
function InfoRow({ label, value, capitalize }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between'}}>
      <span style={{color:'var(--t3)'}}>{label}</span>
      <span style={{color:'var(--tx)',textTransform:capitalize?'capitalize':'none'}}>{value || '—'}</span>
    </div>
  )
}

// ── Data Import: bring in clients/leads (and their documents) from any other
// CRM export — Canopy, Soraban, TaxDome, whatever. No universal cross-CRM API
// exists, so the reusable piece is this generic CSV → mapped-fields → preview
// → commit pipeline; each source platform is just "however you get a CSV out
// of it" feeding the same tool. Runs against ONE target office at a time.
const CLIENT_FIELDS = [
  { key: 'name', label: 'Full Name *', required: true },
  { key: 'first', label: 'First Name' },
  { key: 'last', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'phone2', label: 'Phone 2' },
  { key: 'street', label: 'Street Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP' },
  { key: 'ssn', label: 'SSN' },
  { key: 'ein', label: 'EIN' },
  { key: 'filingstatus', label: 'Filing Status' },
  { key: 'notes', label: 'Notes' },
]

function DataImport({ tenantId, onBack, showToast }) {
  const [step, setStep] = useState('upload') // upload | map | preview | done
  const [sourceName, setSourceName] = useState('')
  const [rawRows, setRawRows] = useState([])   // parsed CSV rows (array of objects, keyed by CSV header)
  const [csvHeaders, setCsvHeaders] = useState([])
  const [mapping, setMapping] = useState({})   // { csvHeader: tcrFieldKey }
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        if (!res.data.length) { showToast('That file has no rows'); return }
        setCsvHeaders(res.meta.fields || [])
        setRawRows(res.data)
        // Best-effort auto-map by header name similarity
        const auto = {}
        for (const h of res.meta.fields || []) {
          const norm = h.toLowerCase().replace(/[^a-z]/g, '')
          const match = CLIENT_FIELDS.find(f => norm === f.key || norm.includes(f.key))
          if (match) auto[h] = match.key
        }
        setMapping(auto)
        setStep('map')
      },
      error: (err) => showToast('❌ Could not read that file: ' + err.message),
    })
    e.target.value = ''
  }

  function buildMappedRecords() {
    return rawRows.map(row => {
      const rec = {}
      for (const [csvHeader, fieldKey] of Object.entries(mapping)) {
        if (!fieldKey) continue
        rec[fieldKey] = row[csvHeader]
      }
      return rec
    })
  }

  async function commitImport() {
    const nameHeader = Object.entries(mapping).find(([, v]) => v === 'name')
    if (!nameHeader) { showToast('Map a column to Full Name before importing'); return }
    setImporting(true)
    const records = buildMappedRecords()
    const { data, error } = await supabase.rpc('import_clients_bulk', { p_tenant_id: tenantId, p_records: records })
    setImporting(false)
    if (error) { showToast('❌ ' + error.message); return }
    setResult(data)
    setStep('done')
  }

  return (
    <div style={{padding:'28px 32px',maxWidth:760}}>
      <button className="btn sec" onClick={onBack}>← Back to office</button>
      <div style={{fontSize:20,fontWeight:800,color:'var(--tx)',margin:'18px 0 4px'}}>📥 Import Data</div>
      <div style={{color:'var(--t3)',fontSize:13,marginBottom:24}}>
        Bring in clients from an export out of any other CRM (Canopy, Soraban, TaxDome, a spreadsheet — anything that can export a CSV). Map its columns to TCR's fields, preview, then commit.
      </div>

      {step === 'upload' && (
        <div style={{border:'2px dashed var(--br)',borderRadius:10,padding:40,textAlign:'center'}}>
          <div style={{fontSize:13,color:'var(--t3)',marginBottom:16}}>
            Export your client list as a CSV from the other system, then upload it here.
          </div>
          <div className="field" style={{maxWidth:320,margin:'0 auto 14px'}}>
            <label>Source (optional, for your records)</label>
            <input value={sourceName} onChange={e=>setSourceName(e.target.value)} placeholder="e.g. Canopy"/>
          </div>
          <label className="btn pri" style={{cursor:'pointer',display:'inline-block'}}>
            Choose CSV File
            <input type="file" accept=".csv" onChange={handleFile} style={{display:'none'}}/>
          </label>
        </div>
      )}

      {step === 'map' && (
        <div>
          <div style={{fontSize:13,color:'var(--t2)',marginBottom:14}}>{rawRows.length} row{rawRows.length===1?'':'s'} found. Match each column from your file to a TCR field — leave a column unmapped to skip it.</div>
          <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:20}}>
            {csvHeaders.map(h => (
              <div key={h} style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{flex:1,fontSize:13,color:'var(--tx)',fontWeight:600,fontFamily:'monospace'}}>{h}</div>
                <div style={{color:'var(--t3)'}}>→</div>
                <select value={mapping[h]||''} onChange={e=>setMapping(m=>({...m,[h]:e.target.value}))} style={{flex:1}}>
                  <option value="">— Skip this column —</option>
                  {CLIENT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:10}}>
            <button className="btn pri" onClick={()=>setStep('preview')}>Preview →</button>
            <button className="btn sec" onClick={()=>{setStep('upload');setRawRows([]);setCsvHeaders([]);setMapping({})}}>Start Over</button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div>
          <div style={{fontSize:13,color:'var(--t2)',marginBottom:14}}>Preview of the first 5 rows as they'll be imported. {rawRows.length} total row{rawRows.length===1?'':'s'} will be processed.</div>
          <div style={{overflowX:'auto',border:'1px solid var(--br)',borderRadius:8,marginBottom:20}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{background:'var(--s2)'}}>
                {Object.values(mapping).filter(Boolean).map(k => (
                  <th key={k} style={{padding:'8px 10px',textAlign:'left',color:'var(--t3)',whiteSpace:'nowrap'}}>{CLIENT_FIELDS.find(f=>f.key===k)?.label || k}</th>
                ))}
              </tr></thead>
              <tbody>
                {buildMappedRecords().slice(0,5).map((rec,i) => (
                  <tr key={i} style={{borderTop:'1px solid var(--br)'}}>
                    {Object.values(mapping).filter(Boolean).map(k => (
                      <td key={k} style={{padding:'8px 10px',color:'var(--tx)',whiteSpace:'nowrap'}}>{rec[k] || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:'flex',gap:10}}>
            <button className="btn pri" disabled={importing} onClick={commitImport}>{importing?'Importing…':`Import ${rawRows.length} Client${rawRows.length===1?'':'s'}`}</button>
            <button className="btn sec" onClick={()=>setStep('map')}>← Back to Mapping</button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:10,padding:20}}>
          <div style={{fontSize:15,fontWeight:700,color:'#10b981',marginBottom:12}}>✅ Import complete</div>
          <div style={{fontSize:13,color:'var(--tx)',marginBottom:10}}>
            <b>{result.inserted}</b> client{result.inserted===1?'':'s'} imported, <b>{result.skipped}</b> skipped.
          </div>
          {result.errors?.length > 0 && (
            <div style={{fontSize:12,color:'var(--t3)',maxHeight:200,overflowY:'auto',background:'var(--s3)',borderRadius:6,padding:10}}>
              {result.errors.map((e,i) => (
                <div key={i} style={{marginBottom:4}}>{e.error} {e.record?.name ? `— "${e.record.name}"` : ''}</div>
              ))}
            </div>
          )}
          <div style={{fontSize:12,color:'var(--t3)',marginTop:14,lineHeight:1.6}}>
            To bring over each client's documents too, upload the files under that client's own file (Documents tab) — bulk document import from a source platform's file export is the next piece to wire up once you know how Canopy hands off files.
          </div>
          <div style={{display:'flex',gap:10,marginTop:16}}>
            <button className="btn sec" onClick={onBack}>← Back to office</button>
            <button className="btn pri" onClick={()=>{setStep('upload');setRawRows([]);setCsvHeaders([]);setMapping({});setResult(null)}}>Import Another File</button>
          </div>
        </div>
      )}
    </div>
  )
}
