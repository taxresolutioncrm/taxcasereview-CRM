import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { logActivity, getActor } from '../lib/activityLog'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { triggerWorkflow } from '../lib/triggerWorkflow'
import { useLocation } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import ClientLink from '../components/ClientLink'
import { FIRM } from '../lib/firmBranding'

const NASHVILLE_TENANT_ID = '489ace07-1a6b-4864-833a-4f8420568b40'

const DOC_TYPES = [
  'Tax Service Agreement',
  'Form 2848 — Power of Attorney',
  'Form 8821 — Tax Info Auth',
  '9465 Installment Agreement Consent',
  'OIC Application (656)',
  'Form 433-A Collection Info',
  'Form 433-B Business Collection Info',
  'CDP Hearing Request',
  'Fee Agreement Addendum',
  'Custom Document'
]

const BLANK = {
  docType: 'Tax Service Agreement',
  clientName: '', clientEmail: '', clientPhone: '',
  investigationFee: '',
  taxYears: '',
  repName: '',
  message: '',
  sendVia: 'both',
  priority: 'Normal', dueDate: ''
}

function signingUrl(id, token) {
  if (!id || !/^[0-9a-f]{64}$/i.test(String(token || ''))) return ''
  return `${window.location.origin}/sign/${id}?token=${encodeURIComponent(token)}`
}

export default function Esign() {
  const { showToast, user } = useApp()
  const [items, setItems] = useState([])
  const [clients, setClients] = useState([])
  const location = useLocation()
  const [modal, setModal] = useState(false)
  const qp2 = new URLSearchParams(location.search)
  const [form, setForm] = useState({
    ...BLANK,
    clientName: qp2.get('client') || '',
    clientEmail: qp2.get('email') || '',
    clientPhone: qp2.get('phone') || '',
    investigationFee: qp2.get('fee') || '',
    taxYears: qp2.get('years') || '',
    repName: qp2.get('rep') || ''
  })
  useEffect(() => { if (qp2.get('client') || qp2.get('new') === '1') setModal(true) }, [])
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [suggestions, setSug] = useState([])
  const [showSug, setShowSug] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [viewCert, setViewCert] = useState(null)
  const [expandedRow, setExpandedRow] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: e }, { data: c }] = await Promise.all([
      supabase.from('esigns').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('id,name,email,phone'),
    ])
    if (e) setItems(e)
    if (c) setClients(c)
  }

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function searchClient(val) {
    fld('clientName', val)
    if (val.length < 2) { setSug([]); setShowSug(false); return }
    const matches = clients.filter(c => c.name.toLowerCase().includes(val.toLowerCase())).slice(0, 6)
    setSug(matches); setShowSug(matches.length > 0)
  }

  function selectClient(c) {
    setForm(f => ({
      ...f,
      clientName: c.name,
      clientEmail: c.email || f.clientEmail,
      clientPhone: c.phone || f.clientPhone
    }))
    setSug([]); setShowSug(false)
  }

  async function sendLink(url, item, esignId, kind = 'esign_request') {
    const { sendVia, clientEmail, clientPhone, clientName } = item || form
    const docType = item?.docType || item?.doc_type || form.docType || 'Tax Service Agreement'
    const msg = `Hi ${clientName}, ${FIRM.name || 'Tax Case Review'} sent you a ${docType} to sign. Please review and sign here: ${url}`
    let smsSent = false, emailSent = false
    if ((sendVia === 'sms' || sendVia === 'both') && clientPhone) {
      try {
        const { error } = await supabase.functions.invoke('send-sms', {
          body: { to: clientPhone, body: msg }
        })
        if (!error) smsSent = true
      } catch (e) { console.error('SMS error:', e) }
    }
    if ((sendVia === 'email' || sendVia === 'both') && clientEmail) {
      try {
        const subject = kind === 'esign_reminder'
          ? `Reminder: ${docType} — Please Sign`
          : `${docType} — Please Sign`
        const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden"><tr><td style="background:linear-gradient(135deg,#1e3a8a,#1d4ed8);padding:28px 40px;text-align:center"><img src="${FIRM.logoUrl}" alt="${FIRM.name}" style="max-height:56px;max-width:190px;object-fit:contain;display:block;margin:0 auto 8px" onerror="this.style.display='none'"/><div style="font-size:13px;font-weight:800;color:#93c5fd;letter-spacing:.12em;text-transform:uppercase">${FIRM.name}</div></td></tr><tr><td style="padding:36px 40px"><p style="margin:0 0 16px;font-size:15px;color:#0f172a">Dear <strong>${clientName}</strong>,</p><p style="margin:0 0 24px;font-size:14px;color:#334155;line-height:1.7">Please review and sign your <strong>${docType}</strong>. This link is unique to you.</p><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 20px"><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px">Sign Document →</a></td></tr></table><p style="margin:0;font-size:11px;color:#94a3b8;text-align:center">Can't click? <a href="${url}" style="color:#3b82f6">Click here to sign</a></p></td></tr><tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center"><p style="margin:0;font-size:11px;color:#94a3b8">${FIRM.name || 'Tax Case Review'} &nbsp;·&nbsp; ${FIRM.address} &nbsp;·&nbsp; ${FIRM.phone}</p></td></tr></table></td></tr></table></body></html>`
        const isNashville = String(FIRM.tenantId || '') === NASHVILLE_TENANT_ID
        const { data, error } = await supabase.functions.invoke(isNashville ? 'nashville-esign-mail' : 'send-email', {
          body: isNashville
            ? { kind, esign_id:esignId, to:clientEmail, subject, html }
            : { tenant_id:FIRM.tenantId || undefined, to:clientEmail, subject, html }
        })
        if (!error && (!isNashville || data?.success)) emailSent = true
        else if (error) console.error('Email delivery error:', error)
      } catch (e) { console.error('Email error:', e) }
    }
    return { smsSent, emailSent }
  }

  async function save() {
    if (!form.clientName) { showToast('Client name required'); return }
    setSaving(true)
    const { data, error } = await supabase.from('esigns').insert([{
      doc_type: form.docType,
      client_name: form.clientName,
      client_email: form.clientEmail,
      client_phone: form.clientPhone,
      investigation_fee: form.investigationFee || null,
      tax_years: form.taxYears || null,
      rep_name: form.repName || null,
      send_via: form.sendVia,
      message: form.message,
      priority: form.priority,
      due_date: form.dueDate || null,
      status: 'Awaiting',
      sent_at: new Date().toISOString(),
      sent_by: user?.email || null,
      signing_origin: window.location.origin,
      reminder_count: 0,
      created_at: new Date().toISOString()
    }]).select().single()
    setSaving(false)
    if (error) { showToast('Error: ' + error.message); return }
    const url = signingUrl(data.id, data.signer_token)
    if (!url) { showToast('Signing token is missing — create a new signing request.'); return }
    await navigator.clipboard.writeText(url).catch(() => {})
    const { smsSent, emailSent } = await sendLink(url, { ...form, sendVia: form.sendVia }, data.id, 'esign_request')
    const sent = [smsSent && 'SMS', emailSent && 'Email'].filter(Boolean)
    showToast(sent.length ? `✅ Agreement sent via ${sent.join(' & ')}!` : '✅ Created — signing link copied to clipboard.')
    const actorE = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    await triggerWorkflow('esign_sent', form.entityType || 'lead', form.clientName || '', actorE).catch(()=>{})
    await logActivity(supabase,{employeeName:actorE,action:'esign_sent',category:'esign',description:`Sent e-sign: ${form.docType} → ${form.clientName}`,entityName:form.clientName,meta:{docType:form.docType}}).catch(()=>{})
    setModal(false); setForm(BLANK); load()
  }

  async function resendLink(item) {
    const url = signingUrl(item.id, item.signer_token)
    await navigator.clipboard.writeText(url).catch(() => {})
    const { error: updErr } = await supabase.from('esigns').update({ status: 'Awaiting', sent_at: new Date().toISOString() }).eq('id', item.id)
    if (updErr) { showToast('Error: ' + updErr.message); return }
    // esigns rows come back snake_case (client_email/client_phone/client_name) —
    // sendLink expects camelCase, same shape as the New Signing Request form.
    const { smsSent, emailSent } = await sendLink(url, {
      sendVia: item.send_via || 'both',
      clientEmail: item.client_email,
      clientPhone: item.client_phone,
      clientName: item.client_name,
      docType: item.doc_type,
    }, item.id, 'esign_reminder')
    const sent = [smsSent && 'SMS', emailSent && 'Email'].filter(Boolean)
    showToast(sent.length ? `✅ Resent via ${sent.join(' & ')}` : '⚠️ No email/phone on file to resend to — link copied to clipboard')
    load()
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('esigns').update({ status }).eq('id', id)
    if (error) { showToast('Error: ' + error.message); return }
    showToast(`✅ Marked as ${status}`); load()
  }

  async function del(id) {
    const { error } = await supabase.from('esigns').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setItems(prev => prev.filter(i => i.id !== id)); setConfirmDel(null); showToast('Deleted')
  }

  function openSigningPage(item) { const url=signingUrl(item.id,item.signer_token); if(url) window.open(url, '_blank'); else showToast('Signing token is missing — regenerate the request.') }

  function daysPending(item) {
    if (!item.sent_at) return 0
    return Math.floor((Date.now() - new Date(item.sent_at)) / (1000 * 60 * 60 * 24))
  }

  const filtered = items.filter(i => {
    const q = search.toLowerCase()
    const ms = !q || i.client_name?.toLowerCase().includes(q) || i.doc_type?.toLowerCase().includes(q)
    const mst = filterStatus === 'All' || i.status === filterStatus
    return ms && mst
  })

  const awaiting = items.filter(i => i.status === 'Awaiting').length
  const signed   = items.filter(i => i.status === 'Signed').length

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>✍️ E-Signatures</h2>
        <button className="btn pri" style={{ fontSize: 14, padding: '9px 20px', fontWeight: 700 }} onClick={() => { setForm(BLANK); setModal(true) }}>+ New Signing Request</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10, marginBottom: 20 }}>
        {[
          ['Total Sent',  items.length,                                              'var(--tx)'],
          ['Awaiting',    awaiting,                                                  'var(--warn)'],
          ['Signed',      signed,                                                    'var(--ok)'],
          ['Declined',    items.filter(i => i.status === 'Declined').length,         'var(--bad)'],
          ['Sign Rate',   items.length ? Math.round((signed/items.length)*100)+'%' : '—', 'var(--b2)'],
        ].map(([label, val, color]) => (
          <div key={label} className="card" style={{ padding: '16px 18px', textAlign: 'center' }}>
            <div style={{ fontWeight: 900, fontSize: 28, color, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Reminder callout */}
      {items.some(i => i.status === 'Awaiting' && daysPending(i) >= 1) && (
        <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--warn)' }}>
          ⏰ <strong>Reminder needed:</strong> {items.filter(i => i.status === 'Awaiting' && daysPending(i) >= 1).length} agreement(s) unsigned for 1+ days — use <strong>Resend</strong> to follow up.
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client or document…"
          style={{ flex: 1, minWidth: 200, padding: '9px 14px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 8, color: 'var(--tx)', fontSize: 14 }} />
        {['All', 'Awaiting', 'Signed', 'Declined', 'Expired'].map(s => (
          <button key={s} className={`btn ${filterStatus === s ? 'pri' : 'sec'}`} style={{ fontSize: 12, padding: '6px 14px', fontWeight: 600 }} onClick={() => setFilterStatus(s)}>{s}</button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--t3)', fontSize: 15 }}>
            {items.length === 0 ? 'No e-signature requests yet. Create one to send a signing link to a client.' : 'No requests match your filters.'}
          </div>
        ) : (
          <div className="ovx">
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--s2)' }}>
                  {['Client','Document','Sent','Status','Actions'].map(h => <th key={h} style={{ textAlign:'left', padding:'10px 14px', fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid var(--br)' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => {
                  const pending = daysPending(item)
                  const isExpanded = expandedRow === item.id
                  return <>
                    <tr key={item.id} style={{ borderBottom:'1px solid var(--br)', background: idx%2===0?'transparent':'rgba(255,255,255,.01)' }}>
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ fontWeight:700, fontSize:13 }}><ClientLink name={item.client_name}/></div>
                        {item.client_email && <div style={{ fontSize:11, color:'var(--t3)', marginTop:2 }}>{item.client_email}</div>}
                      </td>
                      <td style={{ padding:'12px 14px', fontSize:12, color:'var(--t2)' }}>{item.doc_type}</td>
                      <td style={{ padding:'12px 14px', fontSize:11, color:'var(--t3)' }}>
                        {item.sent_at ? new Date(item.sent_at).toLocaleDateString() : '—'}
                        {item.status === 'Awaiting' && pending > 0 && <div style={{ color:pending>=3?'var(--bad)':'var(--warn)', fontSize:10, marginTop:2 }}>{pending}d pending</div>}
                      </td>
                      <td style={{ padding:'12px 14px' }}>
                        <span className={`badge ${item.status==='Signed'?'green':item.status==='Awaiting'?'amber':item.status==='Declined'?'red':'gray'}`} style={{ fontSize:10 }}>{item.status}</span>
                      </td>
                      <td style={{ padding:'10px 14px' }}>
                        <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                          {item.status !== 'Signed' && <>
                            <button className="btn sec" style={{ fontSize:10, padding:'4px 8px' }} onClick={() => openSigningPage(item)}>Open</button>
                            <button className="btn sec" style={{ fontSize:10, padding:'4px 8px' }} onClick={() => resendLink(item)}>Resend</button>
                          </>}
                          {item.status === 'Signed' && <button className="btn sec" style={{ fontSize:10, padding:'4px 8px' }} onClick={() => setExpandedRow(isExpanded ? null : item.id)}>{isExpanded?'Hide':'View'} Details</button>}
                          {item.status === 'Awaiting' && <button className="btn sec" style={{ fontSize:10, padding:'4px 8px', color:'var(--bad)' }} onClick={() => updateStatus(item.id,'Declined')}>Decline</button>}
                          <button className="btn sec" style={{ fontSize:10, padding:'4px 8px', color:'var(--bad)' }} onClick={() => setConfirmDel(item)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && <tr key={item.id+'-detail'}><td colSpan={5} style={{ padding:'16px 20px', background:'rgba(34,197,94,.03)', borderBottom:'1px solid var(--br)' }}>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:14, fontSize:12 }}>
                        <div><span style={{color:'var(--t3)'}}>Signed by</span><br/><strong>{item.signer_full_name || item.signed_name || '—'}</strong></div>
                        <div><span style={{color:'var(--t3)'}}>Signed date</span><br/><strong>{item.signed_at ? new Date(item.signed_at).toLocaleString() : '—'}</strong></div>
                        <div><span style={{color:'var(--t3)'}}>IP Address</span><br/><strong>{item.signer_ip || '—'}</strong></div>
                        <div><span style={{color:'var(--t3)'}}>Certificate</span><br/><button className="btn sec" style={{fontSize:10,padding:'3px 8px',marginTop:3}} onClick={()=>setViewCert(item)}>View Certificate</button></div>
                      </div>
                    </td></tr>}
                  </>
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && <div className="modal-bg open" onMouseDown={e => { if (e.target===e.currentTarget) setModal(false) }}>
        <div className="modal" style={{ maxWidth:560 }}>
          <div className="modal-head"><span>New Signing Request</span><button className="x" onClick={() => setModal(false)}>×</button></div>
          <div className="modal-body" style={{ display:'grid', gap:12 }}>
            <label className="field"><span>Document Type</span><select value={form.docType} onChange={e=>fld('docType',e.target.value)}>{DOC_TYPES.map(d=><option key={d}>{d}</option>)}</select></label>
            <div style={{ position:'relative' }}>
              <label className="field"><span>Client Name *</span><input value={form.clientName} onChange={e=>searchClient(e.target.value)} autoComplete="off" /></label>
              {showSug && <div style={{position:'absolute',zIndex:20,top:'100%',left:0,right:0,background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,maxHeight:180,overflowY:'auto'}}>{suggestions.map(c=><div key={c.id} onClick={()=>selectClient(c)} style={{padding:'9px 12px',cursor:'pointer',borderBottom:'1px solid var(--br)',fontSize:12}}>{c.name}<span style={{color:'var(--t3)',marginLeft:8}}>{c.email}</span></div>)}</div>}
            </div>
            <div className="grid2"><label className="field"><span>Client Email</span><input value={form.clientEmail} onChange={e=>fld('clientEmail',e.target.value)} type="email" /></label><label className="field"><span>Client Phone</span><input value={form.clientPhone} onChange={e=>fld('clientPhone',e.target.value)} /></label></div>
            <div className="grid2"><label className="field"><span>Investigation Fee</span><input value={form.investigationFee} onChange={e=>fld('investigationFee',e.target.value)} placeholder="$0.00" /></label><label className="field"><span>Tax Years</span><input value={form.taxYears} onChange={e=>fld('taxYears',e.target.value)} placeholder="2020–2024" /></label></div>
            <label className="field"><span>Representative</span><input value={form.repName} onChange={e=>fld('repName',e.target.value)} /></label>
            <label className="field"><span>Message</span><textarea value={form.message} onChange={e=>fld('message',e.target.value)} rows={3} /></label>
            <div className="grid2"><label className="field"><span>Send Via</span><select value={form.sendVia} onChange={e=>fld('sendVia',e.target.value)}><option value="both">Email & SMS</option><option value="email">Email Only</option><option value="sms">SMS Only</option></select></label><label className="field"><span>Priority</span><select value={form.priority} onChange={e=>fld('priority',e.target.value)}><option>Normal</option><option>High</option><option>Urgent</option></select></label></div>
            <label className="field"><span>Due Date</span><input type="date" value={form.dueDate} onChange={e=>fld('dueDate',e.target.value)} /></label>
          </div>
          <div className="modal-foot"><button className="btn sec" onClick={()=>setModal(false)}>Cancel</button><button className="btn pri" onClick={save} disabled={saving}>{saving?'Sending…':'Create & Send'}</button></div>
        </div>
      </div>}

      {viewCert && <div className="modal-bg" onMouseDown={e=>{if(e.target===e.currentTarget)setViewCert(null)}}><div className="modal" style={{maxWidth:620}}><div className="modal-head"><span>Certificate of Completion</span><button className="x" onClick={()=>setViewCert(null)}>×</button></div><div className="modal-body"><div style={{border:'1px solid var(--br)',borderRadius:8,padding:22,fontSize:12,lineHeight:2}}><div style={{fontSize:16,fontWeight:800,marginBottom:12}}>CERTIFICATE OF COMPLETION</div><div>Document: <strong>{viewCert.doc_type}</strong></div><div>Client: <strong>{viewCert.client_name}</strong></div><div>Signed By: <strong>{viewCert.signer_full_name||viewCert.signed_name||'—'}</strong></div><div>Date: <strong>{viewCert.signed_at?new Date(viewCert.signed_at).toLocaleString():'—'}</strong></div><div>IP: <strong>{viewCert.signer_ip||'—'}</strong></div><div style={{marginTop:12,color:'var(--t3)'}}>This certificate is generated from the immutable signature audit record maintained by TaxRes CRM.</div></div></div></div></div>}

      {confirmDel && <DeleteConfirmModal itemName={confirmDel.client_name || 'this signing request'} onConfirm={()=>del(confirmDel.id)} onCancel={()=>setConfirmDel(null)} />}
    </div>
  )
}
