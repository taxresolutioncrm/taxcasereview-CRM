import { useState, useEffect, Fragment } from 'react'
import PhoneNumber from '../components/PhoneNumber'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useLocation } from 'react-router-dom'
import { DOC_FOLDERS } from './Clients'
import ClientLink from '../components/ClientLink'

const BLANK = { to_number:'', from_number:'', client_name:'', subject:'', notes:'' }

function fmtPhone(v) {
  const d = v.replace(/\D/g,'')
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
  if (d.length <= 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return `+${d.slice(0,1)} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,11)}`
}

export default function Fax() {
  const { user } = useApp()
  const [logs,     setLogs]     = useState([])
  const [clients,  setClients]  = useState([])
  const [leads,    setLeads]    = useState([])
  const [modal,    setModal]    = useState(false)
  const location = useLocation()
  const qp = new URLSearchParams(location.search)
  const [form, setForm] = useState({...BLANK,
    client_name: qp.get('client') || '',
    to_number:   (qp.get('phone') || '').replace(/\D/g,'')
  })
  const [file,     setFile]     = useState(null)
  const [sending,  setSending]  = useState(false)
  const [toast,    setToast]    = useState('')
  const [search,   setSearch]   = useState('')
  const [filterStatus, setFilter] = useState('Received')
  const [settings, setSettings]  = useState({})
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [showSug,  setShowSug]  = useState(false)
  const [sugg,     setSugg]     = useState([])
  const [attachPickerFor, setAttachPickerFor] = useState(null)
  const [attachSearch, setAttachSearch] = useState('')
  const [attachFolder, setAttachFolder] = useState('Correspondence')
  const [attaching, setAttaching] = useState(null)
  const [previewUrls, setPreviewUrls] = useState({})
  useEffect(() => {
    if (qp.get('new') === '1') {
      setForm(prev => ({ ...BLANK, from_number: prev.from_number || '', client_name: qp.get('client') || '', to_number: (qp.get('phone') || '').replace(/\D/g,'') }))
      setFile(null)
      setModal(true)
    }
  }, [location.search])


  useEffect(() => {
    load()
    const channel = supabase.channel('fax-log-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fax_logs' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function resolvePreviewBatch() {
      const targets = logs.filter(l => l.direction === 'inbound' && l.file_url && !previewUrls[l.id]).slice(0, 18)
      if (!targets.length) return
      const entries = await Promise.all(targets.map(async row => {
        try { return [row.id, await resolveFaxUrl(row)] } catch { return [row.id, ''] }
      }))
      if (!cancelled) setPreviewUrls(prev => ({ ...prev, ...Object.fromEntries(entries) }))
    }
    resolvePreviewBatch()
    return () => { cancelled = true }
  }, [logs])

  async function load() {
    const [{ data:f },{ data:c },{ data:l },{ data:s }] = await Promise.all([
      supabase.from('fax_logs').select('*').order('created_at',{ascending:false}),
      supabase.from('clients').select('id,name,phone'),
      supabase.from('leads').select('id,name,phone'),
      supabase.from('settings').select('sw_space_url,sw_inbound_did,firm_fax_number').limit(1).maybeSingle(),
    ])
    if (f) setLogs(f)
    if (c) setClients(c)
    if (l) setLeads(l)
    setSettingsLoaded(true)
    if (s) {
      setSettings(s)
      const defaultFrom = s.firm_fax_number || s.sw_inbound_did
      if (defaultFrom) setForm(prev => prev.from_number ? prev : { ...prev, from_number: defaultFrom.replace(/\D/g,'') })
    }
  }

  function showToast(msg,type='ok') { setToast({msg,type}); setTimeout(()=>setToast(''),4000) }
  function fld(k,v) { setForm(f=>({...f,[k]:v})) }

  // Match an inbound fax's from_number against known clients/leads by phone,
  // purely to suggest who it's probably from — attaching still always
  // requires a click, matched or not.
  function matchByPhone(number) {
    const last10 = (number || '').replace(/\D/g,'').slice(-10)
    if (!last10) return null
    const c = clients.find(c => c.phone && c.phone.replace(/\D/g,'').slice(-10) === last10)
    if (c) return { ...c, _type: 'Client' }
    const l = leads.find(l => l.phone && l.phone.replace(/\D/g,'').slice(-10) === last10)
    if (l) return { ...l, _type: 'Lead' }
    return null
  }

  // Copies a received fax straight into a lead/client's Docs tab. Stores the
  // SignalWire-hosted file URL directly (same approach as inbound SMS/MMS
  // attachments) rather than re-hosting the file ourselves.
  async function attachFaxToFile(faxRow, targetName, folder) {
    if (!targetName) { showToast('Pick who this belongs to first'); return }
    if (!faxRow.file_url) { showToast('This fax has no file attached', 'err'); return }
    setAttaching(faxRow.id)
    const { error } = await supabase.from('documents').insert([{
      name: `Fax — ${faxRow.from_number || 'Unknown number'}`,
      client: targetName,
      docType: folder || 'Correspondence',
      notes: `Received via fax on ${faxRow.created_at ? new Date(faxRow.created_at).toLocaleString() : 'unknown date'}`,
      file_url: faxRow.file_url,
      file_name: `fax_${faxRow.id}.pdf`,
      file_size: null,
      created_at: new Date().toISOString(),
    }])
    setAttaching(null)
    if (error) { showToast('Error attaching: ' + error.message, 'err'); return }
    showToast(`✅ Attached to ${targetName}'s ${folder} folder`)
    setAttachPickerFor(null); setAttachSearch(''); setAttachFolder('Correspondence')
  }

  async function resolveFaxUrl(faxRow) {
    const storagePath = faxRow.storage_path || (String(faxRow.file_url || '').startsWith('storage://documents/') ? String(faxRow.file_url).replace('storage://documents/','') : '')
    if (storagePath) {
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, 300)
      if (error || !data?.signedUrl) throw error || new Error('Could not open fax document')
      return data.signedUrl
    }
    return faxRow.file_url || ''
  }

  async function openFax(faxRow) {
    try {
      if (faxRow.direction === 'inbound' && faxRow.is_read === false) {
        await supabase.from('fax_logs').update({ is_read: true }).eq('id', faxRow.id)
        setLogs(prev => prev.map(r => r.id === faxRow.id ? { ...r, is_read: true } : r))
      }
      const url = await resolveFaxUrl(faxRow)
      if (!url) return showToast('This fax has no document attached', 'err')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      showToast('Could not open fax: ' + (e?.message || e), 'err')
    }
  }

  async function downloadFax(faxRow) {
    try {
      const url = await resolveFaxUrl(faxRow)
      if (!url) return showToast('This fax has no document attached', 'err')
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.download = faxRow.file_name || `fax-${faxRow.id}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      showToast('Could not download fax: ' + (e?.message || e), 'err')
    }
  }

  async function toggleUnread(faxRow) {
    const next = faxRow.is_read === false
    const { error } = await supabase.from('fax_logs').update({ is_read: next }).eq('id', faxRow.id)
    if (error) return showToast('Could not update read status: ' + error.message, 'err')
    setLogs(prev => prev.map(r => r.id === faxRow.id ? { ...r, is_read: next } : r))
  }

  function searchClient(val) {
    fld('client_name', val)
    if (val.length < 2) { setSugg([]); setShowSug(false); return }
    const m = clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setSugg(m); setShowSug(m.length>0)
  }

  function pickClient(c) {
    fld('client_name', c.name)
    if (c.phone) fld('to_number', c.phone.replace(/\D/g,''))
    setSugg([]); setShowSug(false)
  }

  async function sendFax() {
    if (!form.to_number) { showToast('Recipient fax number required','err'); return }
    if (!file && !form.notes) { showToast('Attach a PDF or enter a message','err'); return }
    setSending(true)

    try {
      let mediaUrl = null

      if (file) {
        const path = `fax/${Date.now()}_${file.name}`
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
        if (upErr) throw new Error('Upload failed: ' + upErr.message)
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
        mediaUrl = urlData?.signedUrl || ''
      }

      const toNum   = '+1' + form.to_number.replace(/\D/g,'').slice(-10)
      const fromNum = form.from_number
        ? '+1' + form.from_number.replace(/\D/g,'').slice(-10)
        : (settings.firm_fax_number || settings.sw_inbound_did || '')

      const { data: resData, error: invokeErr } = await supabase.functions.invoke('send-fax', {
        body: { to: toNum, from: fromNum, ...(mediaUrl ? { document_url: mediaUrl } : {}) }
      })

      const sw_id = resData?.sid || null
      const status = !invokeErr && resData?.success ? 'Pending' : 'Failed'

      const { error: logErr } = await supabase.from('fax_logs').insert([{
        to_number: toNum, from_number: fromNum,
        client_name: form.client_name, subject: form.subject,
        notes: form.notes, file_name: file?.name || null,
        file_url: mediaUrl, signalwire_fax_id: sw_id,
        status, sent_by: user?.email || 'Unknown',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        error_msg: status === 'Failed' ? JSON.stringify(resData?.error || invokeErr?.message || 'Send failed').slice(0,200) : null,
      }])

      if (logErr) console.error('Log error:', logErr)
      if (status === 'Pending') {
        showToast('📠 Fax accepted — waiting for delivery confirmation')
        setModal(false); setForm(BLANK); setFile(null); load()
      } else {
        showToast('Error: ' + (resData?.error || invokeErr?.message || 'Check SignalWire credentials in Settings'), 'err')
        load()
      }
    } catch(e) {
      showToast('Error: ' + e.message, 'err')
    } finally {
      setSending(false)
    }
  }

  async function del(id) {
    const { error } = await supabase.from('fax_logs').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setLogs(prev => prev.filter(f => f.id !== id)); setConfirmDel(null); showToast('Deleted')
  }

  const filtered = logs.filter(l => {
    const q = search.trim().toLowerCase()
    const number = l.direction === 'inbound' ? l.from_number : l.to_number
    const mq = !q ||
      l.client_name?.toLowerCase().includes(q) ||
      l.subject?.toLowerCase().includes(q) ||
      l.from_number?.includes(q) ||
      l.to_number?.includes(q) ||
      number?.replace(/\D/g,'').includes(q.replace(/\D/g,''))
    const ms =
      filterStatus === 'All' ||
      (filterStatus === 'Received' && l.direction === 'inbound') ||
      (filterStatus === 'Unread' && l.direction === 'inbound' && l.is_read === false) ||
      (filterStatus === 'Sent' && l.direction !== 'inbound' && ['Sent','Delivered'].includes(l.status)) ||
      (filterStatus === 'Failed' && l.status === 'Failed') ||
      (filterStatus === 'Pending' && l.status === 'Pending')
    return mq && ms
  })

  const outboundLogs = logs.filter(l=>l.direction!=='inbound')
  const inboundLogs  = logs.filter(l=>l.direction==='inbound')
  const sent     = outboundLogs.filter(l=>['Sent','Delivered'].includes(l.status)).length
  const failed   = outboundLogs.filter(l=>l.status==='Failed').length
  const received = inboundLogs.length
  const unread   = inboundLogs.filter(l=>l.is_read===false).length
  const thisMonth = logs.filter(l=>(l.sent_at||l.created_at)?.slice(0,7)===new Date().toISOString().slice(0,7)).length
  const showInboxCards = filterStatus === 'Received' || filterStatus === 'Unread'

  const statCards = [
    { label: 'Received',    value: received,            color: 'var(--blue)' },
    { label: 'Unread',      value: unread,              color: 'var(--warn)' },
    { label: 'Total Sent',  value: outboundLogs.length, color: 'var(--tx)' },
    { label: 'Delivered', value: sent,                color: 'var(--ok)' },
    { label: 'Failed',      value: failed,              color: 'var(--bad)' },
    { label: 'This Month',  value: thisMonth,           color: 'var(--b2)' },
  ]

  return (
    <div style={{padding:'20px 24px',maxWidth:1240,margin:'0 auto'}}>
      {toast && <div className={`toast show ${toast.type==='err'?'terr':''}`}>{toast.msg||toast}</div>}

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:18,flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:800,margin:0,letterSpacing:'-0.3px'}}>📠 Fax</h2>
          <div style={{fontSize:12,color:'var(--t3)',marginTop:4}}>Received fax inbox and outbound delivery history</div>
        </div>
        <button className="btn pri" style={{fontSize:14,padding:'9px 20px',fontWeight:700}} onClick={()=>{setForm(BLANK);setFile(null);setModal(true)}}>+ Send Fax</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:10,marginBottom:18}}>
        {statCards.map(({label,value,color})=>(
          <div key={label} className="card" style={{padding:'14px 16px',textAlign:'center'}}>
            <div style={{fontWeight:900,fontSize:26,color,lineHeight:1}}>{value}</div>
            <div style={{fontSize:10,color:'var(--t3)',marginTop:6,textTransform:'uppercase',letterSpacing:'.06em',fontWeight:700}}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search client, sender, recipient, subject…"
          style={{flex:1,minWidth:240,padding:'9px 14px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,color:'var(--tx)',fontSize:14}}/>
        {['Received','Unread','Sent','Pending','Failed','All'].map(s=>(
          <button key={s} className={`btn ${filterStatus===s?'pri':'sec'}`} style={{fontSize:12,padding:'6px 14px',fontWeight:600}} onClick={()=>setFilter(s)}>{s}</button>
        ))}
      </div>

      {showInboxCards ? (
        filtered.length === 0 ? (
          <div className="card" style={{padding:52,textAlign:'center',color:'var(--t3)',fontSize:15}}>
            {filterStatus==='Unread' ? '📭 No unread faxes.' : '📥 No received faxes yet.'}
          </div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(245px,1fr))',gap:14}}>
            {filtered.map(l=>{
              const match = !l.client_name ? matchByPhone(l.from_number) : null
              const pickerOpen = attachPickerFor === l.id
              const pickerResults = attachSearch.length >= 2
                ? [...clients.map(c=>({...c,_type:'Client'})), ...leads.map(ld=>({...ld,_type:'Lead'}))]
                    .filter(p=>p.name.toLowerCase().includes(attachSearch.toLowerCase())).slice(0,6)
                : []
              const date = l.created_at ? new Date(l.created_at) : null
              return (
                <div key={l.id} className="card" style={{padding:0,overflow:'hidden',position:'relative',border:l.is_read===false?'1px solid var(--blue)':'1px solid var(--br)'}}>
                  <div style={{padding:'11px 13px',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,borderBottom:'1px solid var(--br)'}}>
                    <div style={{minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:7,fontWeight:800,fontSize:13}}>
                        {l.is_read===false && <span title="Unread" style={{width:8,height:8,borderRadius:'50%',background:'var(--blue)',display:'inline-block',flex:'0 0 auto'}}/>}
                        <span>{date ? date.toLocaleDateString() : 'Received fax'}</span>
                        <span style={{color:'var(--t3)',fontWeight:500}}>{date ? date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : ''}</span>
                      </div>
                      <div style={{fontSize:12,color:'var(--t2)',marginTop:5,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                        From <strong style={{color:'var(--tx)'}}>{l.from_number ? fmtPhone(l.from_number) : 'Unknown'}</strong>
                      </div>
                    </div>
                    <span className="bdg bg" style={{fontSize:10,padding:'3px 8px'}}>Received</span>
                  </div>

                  <button onClick={()=>openFax(l)} disabled={!l.file_url}
                    style={{display:'block',width:'100%',height:230,padding:0,border:0,background:'var(--s2)',cursor:l.file_url?'pointer':'default',overflow:'hidden'}}>
                    {previewUrls[l.id] ? (
                      <iframe title={`Fax preview ${l.id}`} src={previewUrls[l.id]+'#toolbar=0&navpanes=0&scrollbar=0'} style={{width:'100%',height:'100%',border:0,pointerEvents:'none',background:'#fff'}} />
                    ) : (
                      <div style={{height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'var(--t3)'}}>
                        <div style={{fontSize:38}}>📄</div>
                        <div style={{fontSize:12}}>{l.file_url ? 'Preparing secure preview…' : 'No document available'}</div>
                      </div>
                    )}
                  </button>

                  <div style={{padding:'11px 13px'}}>
                    <div style={{fontSize:13,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {l.client_name ? <ClientLink name={l.client_name}/> : (match ? <span>{match.name} <span style={{color:'var(--t3)',fontWeight:500}}>suggested</span></span> : 'Unassigned fax')}
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:6,fontSize:11,color:'var(--t3)'}}>
                      <span>{l.pages ? `${l.pages} page${Number(l.pages)===1?'':'s'}` : 'Page count pending'}</span>
                      <span>{l.provider ? String(l.provider).replace(/^./,m=>m.toUpperCase()) : ''}</span>
                    </div>

                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:10}}>
                      <button className="btn sec" style={{fontSize:11,padding:'5px 9px'}} onClick={()=>openFax(l)}>👁 Open</button>
                      <button className="btn sec" style={{fontSize:11,padding:'5px 9px'}} onClick={()=>downloadFax(l)}>⬇ Download</button>
                      <button className="btn sec" style={{fontSize:11,padding:'5px 9px'}} onClick={()=>toggleUnread(l)}>{l.is_read===false?'✓ Mark read':'● Mark unread'}</button>
                      {l.file_url && <button className="btn sec" style={{fontSize:11,padding:'5px 9px'}}
                        onClick={()=>{setAttachPickerFor(pickerOpen?null:l.id);setAttachSearch('');setAttachFolder('Correspondence')}}>📎 Attach</button>}
                    </div>

                    {pickerOpen && (
                      <div style={{marginTop:10,padding:10,border:'1px solid var(--br)',borderRadius:8,background:'var(--s2)'}}>
                        {match ? (
                          <div style={{fontSize:12,fontWeight:700,marginBottom:7}}>Suggested: {match.name} <span style={{color:'var(--t3)',fontWeight:400}}>({match._type})</span></div>
                        ) : (
                          <>
                            <input autoFocus placeholder="Search client or lead…" value={attachSearch} onChange={e=>setAttachSearch(e.target.value)}
                              style={{width:'100%',fontSize:12,padding:'7px 9px',borderRadius:6,border:'1px solid var(--br)',background:'var(--bg)',color:'var(--tx)'}}/>
                            {pickerResults.map(p=>(
                              <div key={p._type+p.id} onClick={()=>setAttachSearch(p.name)}
                                style={{fontSize:12,padding:'6px 8px',cursor:'pointer',borderRadius:5}}>
                                {p.name} <span style={{color:'var(--t3)'}}>({p._type})</span>
                              </div>
                            ))}
                          </>
                        )}
                        <select value={attachFolder} onChange={e=>setAttachFolder(e.target.value)} style={{width:'100%',marginTop:7,fontSize:12,padding:'7px 9px'}}>
                          {DOC_FOLDERS.map(f=><option key={f}>{f}</option>)}
                        </select>
                        <div style={{display:'flex',gap:6,marginTop:8}}>
                          <button className="btn pri" style={{fontSize:11,padding:'5px 9px'}} disabled={attaching===l.id||(!match&&!attachSearch)}
                            onClick={()=>attachFaxToFile(l,match?match.name:attachSearch,attachFolder)}>Attach</button>
                          <button className="btn sec" style={{fontSize:11,padding:'5px 9px'}} onClick={()=>setAttachPickerFor(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          {filtered.length===0 ? (
            <div style={{padding:48,textAlign:'center',color:'var(--t3)',fontSize:15}}>No faxes match your filters.</div>
          ) : (
            <div className="ovx">
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
                <thead>
                  <tr style={{borderBottom:'1px solid var(--br)',background:'var(--s2)'}}>
                    {['Direction','Date & Time','Client','Number','Subject','Pages','Status','Sent By','Actions'].map(h=>(
                      <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(l=>{
                    const inbound=l.direction==='inbound'
                    const number=inbound?l.from_number:l.to_number
                    return (
                      <tr key={l.id} style={{borderBottom:'1px solid var(--br)'}}>
                        <td style={{padding:'12px 14px'}}>{inbound?'📥 Received':'📤 Sent'}</td>
                        <td style={{padding:'12px 14px',whiteSpace:'nowrap'}}>
                          <div style={{fontWeight:700,fontSize:13}}>{(l.sent_at||l.created_at)?new Date(l.sent_at||l.created_at).toLocaleDateString():'—'}</div>
                          <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>{(l.sent_at||l.created_at)?new Date(l.sent_at||l.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</div>
                        </td>
                        <td style={{padding:'12px 14px',fontWeight:600}}>{l.client_name?<ClientLink name={l.client_name}/>:inbound?(matchByPhone(l.from_number)?.name||'—'):'—'}</td>
                        <td style={{padding:'12px 14px',fontFamily:'monospace',fontSize:12}}>{number?fmtPhone(number):'—'}</td>
                        <td style={{padding:'12px 14px',maxWidth:190,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.subject||'—'}</td>
                        <td style={{padding:'12px 14px'}}>{l.pages||'—'}</td>
                        <td style={{padding:'12px 14px'}}><span className={`bdg ${['Sent','Delivered','Received'].includes(l.status)?'bg':l.status==='Failed'?'br':'ba'}`}>{l.status}</span></td>
                        <td style={{padding:'12px 14px',fontSize:12,color:'var(--t3)'}}>{l.sent_by?.split('@')[0]||'—'}</td>
                        <td style={{padding:'12px 14px'}}>
                          <div style={{display:'flex',gap:5}}>
                            {l.file_url&&<button className="btn sec" style={{fontSize:11,padding:'4px 8px'}} onClick={()=>openFax(l)}>Open</button>}
                            <button className="btn del" style={{fontSize:11,padding:'4px 8px'}} onClick={()=>setConfirmDel(l.id)}>Del</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setConfirmDel(null)}>
          <div className="modal" style={{maxWidth:360,textAlign:'center'}}>
            <div style={{fontSize:40,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:800,fontSize:17,marginBottom:8}}>Delete this fax log?</div>
            <div style={{fontSize:14,color:'var(--t3)',marginBottom:24}}>This cannot be undone.</div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={()=>setConfirmDel(null)}>Cancel</button>
              <button className="btn del" style={{flex:1,justifyContent:'center'}} onClick={()=>del(confirmDel)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Send Fax Modal */}
      {modal && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="modal" style={{width:560}}>
            <div className="mh">
              <span className="mt">📠 Send Fax</span>
              <button className="xbtn" onClick={()=>setModal(false)}>&times;</button>
            </div>

            <div style={{position:'relative'}} className="field"><label>Client (optional)</label>
              <input value={form.client_name} onChange={e=>searchClient(e.target.value)} placeholder="Search client…"/>
              {showSug && sugg.length>0 && (
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--sf)',border:'1px solid var(--br)',borderRadius:6,zIndex:50,maxHeight:160,overflowY:'auto'}}>
                  {sugg.map(c=>(
                    <div key={c.id} onClick={()=>pickClient(c)} style={{padding:'9px 14px',cursor:'pointer',fontSize:14,display:'flex',justifyContent:'space-between'}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <span>{c.name}</span>
                      {c.phone && <PhoneNumber val={c.phone} />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="fg2">
              <div className="field"><label>To Fax Number *</label>
                <input value={form.to_number} onChange={e=>fld('to_number',e.target.value.replace(/\D/g,''))} placeholder="8005551234" maxLength={11}/>
                <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>10 digits, no dashes</div>
              </div>
              <div className="field"><label>From Number (override)</label>
                <input value={form.from_number} onChange={e=>fld('from_number',e.target.value.replace(/\D/g,''))} placeholder={settings.firm_fax_number||settings.sw_inbound_did||'Uses SignalWire DID'}/>
              </div>
            </div>

            <div className="field"><label>Subject / Cover Note</label>
              <input value={form.subject} onChange={e=>fld('subject',e.target.value)} placeholder="e.g. Form 2848 — Power of Attorney"/>
            </div>

            <div className="field"><label>Attach PDF / Document</label>
              <div style={{border:'2px dashed var(--br)',borderRadius:8,padding:'20px',textAlign:'center',cursor:'pointer',background:file?'rgba(34,197,94,.06)':'var(--s2)'}}
                onClick={()=>document.getElementById('fax-file').click()}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='var(--blue)'}}
                onDragLeave={e=>e.currentTarget.style.borderColor='var(--br)'}
                onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)setFile(f);e.currentTarget.style.borderColor='var(--br)'}}>
                {file ? (
                  <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'center'}}>
                    <span style={{fontSize:22}}>📄</span>
                    <span style={{fontSize:14,fontWeight:700,color:'var(--ok)'}}>{file.name}</span>
                    <button onClick={e=>{e.stopPropagation();setFile(null)}} style={{background:'none',border:'none',color:'var(--bad)',cursor:'pointer',fontSize:18}}>×</button>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:28,marginBottom:6}}>📎</div>
                    <div style={{fontSize:14,color:'var(--t2)',fontWeight:500}}>Drop PDF here or click to browse</div>
                    <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>PDF, TIFF, or image files</div>
                  </div>
                )}
                <input id="fax-file" type="file" accept=".pdf,.tiff,.tif,.jpg,.png" style={{display:'none'}} onChange={e=>setFile(e.target.files[0])}/>
              </div>
            </div>

            <div className="field"><label>Additional Notes (logged internally)</label>
              <textarea value={form.notes} onChange={e=>fld('notes',e.target.value)} rows={2}
                style={{width:'100%',resize:'none',padding:'10px 14px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:14,fontFamily:'inherit'}}
                placeholder="Internal notes about this fax…"/>
            </div>

            <div style={{background:'var(--s2)',borderRadius:8,padding:'10px 16px',marginBottom:16,fontSize:12,color:'var(--t3)',lineHeight:1.6}}>
              🕐 Every fax is automatically <strong>timestamped</strong> with date, time, sender, recipient, and file — all saved in the client's fax history.
            </div>

            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:12,fontSize:15,fontWeight:700}} onClick={sendFax} disabled={sending}>
              {sending ? '📠 Sending…' : '📠 Send Fax'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
