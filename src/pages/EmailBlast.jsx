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

  const selectedRecipients = rows.filter(row => selected.has(row.id))
  const recipientCount = selectedRecipients.length
  const visibleSelectedCount = filtered.filter(row => selected.has(row.id)).length

  return <div style={{padding:'24px clamp(16px,2vw,28px)',maxWidth:1240,margin:'0 auto'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:18,alignItems:'flex-start',marginBottom:20,flexWrap:'wrap'}}>
      <div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <h1 style={{margin:0,fontSize:30,lineHeight:1.15}}>Email Blast</h1>
          <span style={{fontSize:10,fontWeight:900,letterSpacing:'.06em',padding:'5px 8px',borderRadius:999,border:'1px solid var(--bdr)',color:'var(--t3)'}}>OFFICE-SCOPED</span>
        </div>
        <p style={{color:'var(--t2)',margin:'7px 0 0',maxWidth:760,lineHeight:1.55}}>
          Send one message to selected eligible clients. Email opt-outs and suppressed addresses are excluded automatically.
        </p>
      </div>
      <div style={{minWidth:116,textAlign:'right'}}>
        <div style={{fontSize:26,fontWeight:900,color:recipientCount?'var(--tx)':'var(--t3)'}}>{recipientCount}</div>
        <div style={{fontSize:11,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.05em'}}>selected</div>
      </div>
    </div>

    {error && <div className="form-error" style={{marginBottom:14,padding:'11px 13px',borderRadius:9}}>{error}</div>}
    {notice && <div className="form-notice" style={{marginBottom:14,padding:'11px 13px',borderRadius:9}}>{notice}</div>}

    <div style={{display:'grid',gridTemplateColumns:'minmax(320px,.9fr) minmax(420px,1.1fr)',gap:18,alignItems:'stretch'}}>
      <section className="card" style={{padding:0,overflow:'hidden',minHeight:620}}>
        <div style={{padding:'17px 18px 15px',borderBottom:'1px solid var(--bdr)'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',marginBottom:12}}>
            <div>
              <div style={{fontWeight:900,fontSize:16}}>Recipients</div>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>{rows.length.toLocaleString()} eligible client{rows.length===1?'':'s'} in this office</div>
            </div>
            {recipientCount>0 && <button className="btn sm" onClick={()=>setSelected(new Set())}>Clear selection</button>}
          </div>

          <div style={{display:'flex',gap:8}}>
            <div style={{position:'relative',flex:1}}>
              <input
                className="input"
                style={{width:'100%',height:38,paddingLeft:12}}
                value={search}
                onChange={e=>setSearch(e.target.value)}
                placeholder="Search clients by name or email…"
              />
            </div>
            <button className="btn" onClick={toggleAll} disabled={!filtered.length} style={{whiteSpace:'nowrap'}}>
              {allVisibleSelected?'Clear visible':'Select visible'}
            </button>
          </div>

          <div style={{display:'flex',justifyContent:'space-between',gap:10,marginTop:9,fontSize:10,color:'var(--t3)'}}>
            <span>{filtered.length.toLocaleString()} visible</span>
            <span>{visibleSelectedCount.toLocaleString()} visible selected</span>
          </div>
        </div>

        <div style={{maxHeight:520,overflowY:'auto'}}>
          {filtered.map(row => {
            const isSelected = selected.has(row.id)
            const rowStatus = status[row.id] || ''
            return <label
              key={row.id}
              style={{
                display:'flex',alignItems:'center',gap:11,padding:'12px 14px',
                borderBottom:'1px solid var(--bdr)',cursor:'pointer',
                background:isSelected?'rgba(59,130,246,.10)':'transparent',
                transition:'background .12s ease'
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={()=>setSelected(current=>{const next=new Set(current);next.has(row.id)?next.delete(row.id):next.add(row.id);return next})}
                style={{width:16,height:16,accentColor:'var(--pri,#6957ff)',flex:'0 0 auto'}}
              />
              <div style={{minWidth:0,flex:1}}>
                <strong style={{display:'block',fontSize:13,color:'var(--tx)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{displayName(row)}</strong>
                <span style={{fontSize:11,color:'var(--t2)',display:'block',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.email}</span>
              </div>
              {rowStatus && <span style={{
                fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:'.04em',
                color:rowStatus==='failed'?'var(--bad)':rowStatus==='sent'?'var(--ok)':'var(--t3)'
              }}>{rowStatus}</span>}
            </label>
          })}
          {!filtered.length && <div style={{padding:'46px 24px',color:'var(--t3)',textAlign:'center'}}>
            <div style={{fontWeight:800,color:'var(--t2)',marginBottom:4}}>No eligible recipients found</div>
            <div style={{fontSize:11}}>Try a different search. Opted-out and suppressed clients are hidden automatically.</div>
          </div>}
        </div>
      </section>

      <section className="card" style={{padding:0,overflow:'hidden',minHeight:620}}>
        <div style={{padding:'17px 18px 15px',borderBottom:'1px solid var(--bdr)'}}>
          <div style={{fontWeight:900,fontSize:16}}>Compose message</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Personalize the message with merge fields, then send yourself a test before the blast.</div>
        </div>

        <div style={{padding:18}}>
          <label style={{display:'grid',gap:7,marginBottom:15}}>
            <span style={{fontWeight:800,fontSize:12}}>Subject</span>
            <input
              className="input"
              style={{width:'100%',height:40}}
              value={subject}
              onChange={e=>setSubject(e.target.value)}
              placeholder="Example: Important tax update for {{first_name}}"
            />
          </label>

          <label style={{display:'grid',gap:7,marginBottom:12}}>
            <span style={{fontWeight:800,fontSize:12}}>Message</span>
            <textarea
              className="input"
              rows={12}
              style={{width:'100%',resize:'vertical',minHeight:250,lineHeight:1.55,padding:12}}
              value={body}
              onChange={e=>setBody(e.target.value)}
              placeholder={'Hi {{first_name}},\n\nYour message here…'}
            />
          </label>

          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,fontWeight:800,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:7}}>Available merge fields</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {['{{first_name}}','{{last_name}}','{{name}}','{{email}}'].map(token=>
                <span key={token} style={{fontFamily:'monospace',fontSize:10,padding:'5px 8px',border:'1px solid var(--bdr)',borderRadius:7,color:'var(--t2)',background:'rgba(255,255,255,.02)'}}>{token}</span>
              )}
            </div>
          </div>

          <div style={{border:'1px solid var(--bdr)',borderRadius:11,padding:13,marginBottom:16,background:'rgba(255,255,255,.018)'}}>
            <div style={{fontWeight:800,fontSize:12}}>Send a test first</div>
            <div style={{fontSize:10,color:'var(--t3)',margin:'3px 0 9px'}}>Check the final subject, formatting, and merge-field output before sending to clients.</div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <input
                className="input"
                style={{flex:'1 1 260px',height:38}}
                value={testEmail}
                onChange={e=>setTestEmail(e.target.value)}
                placeholder="Test email address"
              />
              <button className="btn" disabled={sending} onClick={sendTest} style={{whiteSpace:'nowrap'}}>Send test</button>
            </div>
          </div>

          <div style={{borderTop:'1px solid var(--bdr)',paddingTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:10,flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:12,fontWeight:900,color:'var(--tx)'}}>
                  {recipientCount ? recipientCount.toLocaleString()+' client'+(recipientCount===1?'':'s')+' selected' : 'No recipients selected'}
                </div>
                <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>A final confirmation appears before anything is sent.</div>
              </div>
              <div style={{fontSize:10,color:'var(--t3)'}}>Opt-outs excluded automatically</div>
            </div>
            <button
              className="btn pri full"
              disabled={sending||!recipientCount||!subject.trim()||!body.trim()}
              onClick={sendBlast}
              style={{minHeight:42,fontWeight:900}}
            >
              {sending?'Sending…':recipientCount?('Send Email Blast · '+recipientCount):'Select recipients to send'}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
}
}
