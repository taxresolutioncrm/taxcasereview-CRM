import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())

function suppressed(row) {
  return Boolean(
    row?.email_opt_out || row?.marketing_opt_out || row?.do_not_email ||
    row?.unsubscribed || row?.unsubscribe || row?.email_suppressed
  )
}

function displayName(row) {
  return String(row?.name || [row?.first_name, row?.last_name].filter(Boolean).join(' ') || row?.company_name || row?.email || 'Contact')
}

function mergeText(value, row) {
  const name = displayName(row)
  const first = String(row?.first_name || name.split(/\s+/)[0] || '')
  const last = String(row?.last_name || '')
  return String(value || '')
    .replaceAll('{{name}}', name)
    .replaceAll('{{first_name}}', first)
    .replaceAll('{{last_name}}', last)
    .replaceAll('{{email}}', String(row?.email || ''))
}

export default function EmailBlast() {
  const { myTenantId } = useApp()
  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      setError('')
      const { data, error: loadError } = await supabase.from('clients').select('*').limit(5000)
      if (!active) return
      if (loadError) { setRows([]); setError(loadError.message || 'Could not load clients.'); return }
      const scoped = (data || []).filter(row => !row?.tenant_id || !myTenantId || row.tenant_id === myTenantId)
      setRows(scoped.filter(row => emailOk(row?.email) && !suppressed(row)))
    })()
    return () => { active = false }
  }, [myTenantId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(row => (displayName(row) + ' ' + String(row?.email || '') + ' ' + String(row?.status || '')).toLowerCase().includes(q))
  }, [rows, search])

  const allVisibleSelected = filtered.length > 0 && filtered.every(row => selected.has(row.id))
  const toggleAll = () => setSelected(current => {
    const next = new Set(current)
    if (allVisibleSelected) filtered.forEach(row => next.delete(row.id))
    else filtered.forEach(row => next.add(row.id))
    return next
  })

  async function sendOne(row, overrideEmail) {
    const to = overrideEmail || row.email
    const renderedSubject = mergeText(subject, row)
    const renderedBody = mergeText(body, row)
    const html = '<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;line-height:1.65;color:#172033">' +
      renderedBody.split('\n').map(line => '<p>' + line.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '</p>').join('') +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 14px"><p style="font-size:11px;color:#64748b">This message was sent from your tax office CRM. Reply to this email if you no longer wish to receive non-service announcements.</p></div>'
    const { data, error: sendError } = await supabase.functions.invoke('send-email', {
      body: { tenant_id: myTenantId || undefined, to, subject: renderedSubject, html }
    })
    if (sendError || data?.error || data?.success === false) throw new Error(sendError?.message || data?.error || 'Email send failed')
  }

  async function sendTest() {
    setError(''); setNotice('')
    if (!emailOk(testEmail)) return setError('Enter a valid test email address.')
    if (!subject.trim() || !body.trim()) return setError('Subject and message are required.')
    setSending(true)
    try { await sendOne({ email:testEmail, name:'Test Recipient', first_name:'Test', last_name:'Recipient' }, testEmail); setNotice('Test email sent.') }
    catch (e) { setError(e?.message || String(e)) }
    finally { setSending(false) }
  }

  async function sendBlast() {
    setError(''); setNotice('')
    const recipients = rows.filter(row => selected.has(row.id))
    if (!recipients.length) return setError('Select at least one recipient.')
    if (!subject.trim() || !body.trim()) return setError('Subject and message are required.')
    if (!window.confirm('Send this email blast to ' + recipients.length + ' recipient' + (recipients.length === 1 ? '' : 's') + '?')) return

    setSending(true)
    let sent = 0
    let failed = 0
    for (const row of recipients) {
      setStatus(current => ({ ...current, [row.id]:'sending' }))
      try {
        await sendOne(row)
        sent += 1
        setStatus(current => ({ ...current, [row.id]:'sent' }))
      } catch {
        failed += 1
        setStatus(current => ({ ...current, [row.id]:'failed' }))
      }
      await wait(350)
    }
    setSending(false)
    setNotice('Blast complete: ' + sent + ' sent' + (failed ? ', ' + failed + ' failed.' : '.'))
  }

  return <div style={{padding:24,maxWidth:1180,margin:'0 auto'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',marginBottom:18}}>
      <div><h1 style={{margin:0}}>Email Blast</h1><p style={{color:'var(--t2)',marginTop:6}}>Send one office-scoped email to selected clients. Existing email opt-out flags are excluded automatically.</p></div>
      <div style={{fontSize:13,color:'var(--t2)'}}>{selected.size} selected</div>
    </div>
    {error && <div className="form-error" style={{marginBottom:12}}>{error}</div>}
    {notice && <div className="form-notice" style={{marginBottom:12}}>{notice}</div>}
    <div style={{display:'grid',gridTemplateColumns:'minmax(320px,1fr) minmax(360px,1.15fr)',gap:18}}>
      <section className="card" style={{padding:16}}>
        <div style={{display:'flex',gap:8,marginBottom:12}}><input style={{flex:1}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search clients…"/><button className="btn" onClick={toggleAll}>{allVisibleSelected?'Clear visible':'Select visible'}</button></div>
        <div style={{maxHeight:560,overflow:'auto',border:'1px solid var(--bdr)',borderRadius:10}}>
          {filtered.map(row => <label key={row.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:'1px solid var(--bdr)',cursor:'pointer'}}>
            <input type="checkbox" checked={selected.has(row.id)} onChange={()=>setSelected(current=>{const next=new Set(current);next.has(row.id)?next.delete(row.id):next.add(row.id);return next})}/>
            <div style={{minWidth:0,flex:1}}><strong style={{display:'block'}}>{displayName(row)}</strong><span style={{fontSize:12,color:'var(--t2)'}}>{row.email}</span></div>
            <span style={{fontSize:11,color:status[row.id]==='failed'?'var(--bad)':status[row.id]==='sent'?'var(--ok)':'var(--t3)'}}>{status[row.id]||''}</span>
          </label>)}
          {!filtered.length && <div style={{padding:24,color:'var(--t3)',textAlign:'center'}}>No eligible email recipients.</div>}
        </div>
      </section>
      <section className="card" style={{padding:16}}>
        <label style={{display:'grid',gap:6,marginBottom:12}}><span style={{fontWeight:700}}>Subject</span><input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject — supports {{first_name}}"/></label>
        <label style={{display:'grid',gap:6,marginBottom:12}}><span style={{fontWeight:700}}>Message</span><textarea rows={14} value={body} onChange={e=>setBody(e.target.value)} placeholder={'Hi {{first_name}},\n\nYour message here…'}/></label>
        <div style={{fontSize:12,color:'var(--t3)',marginBottom:14}}>{'Merge fields: {{first_name}}, {{last_name}}, {{name}}, {{email}}'}</div>
        <div style={{display:'flex',gap:8,marginBottom:14}}><input style={{flex:1}} value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder="Test email address"/><button className="btn" disabled={sending} onClick={sendTest}>Send test</button></div>
        <button className="btn pri full" disabled={sending||!selected.size} onClick={sendBlast}>{sending?'Sending…':'Send Email Blast'}</button>
      </section>
    </div>
  </div>
}
