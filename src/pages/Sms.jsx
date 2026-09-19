import { useState, useEffect, Fragment } from 'react'
import { useSearchParams } from 'react-router-dom'
import PhoneNumber from '../components/PhoneNumber'
import { supabase } from '../lib/supabase'
import { FIRM } from '../lib/firmBranding'
import { useApp } from '../context/AppContext'
import { DOC_FOLDERS } from './Clients'

const TEMPLATES = [
  {
    label: 'Appointment Reminder',
    icon: '📅',
    body: `Hi {name}, this is the {firm} team reaching out to remind you of your upcoming appointment with us. We're looking forward to speaking with you! If you need to reschedule or have any questions beforehand, please don't hesitate to call or text us back at {phone}. We're here to help. See you soon! — {firm}`
  },
  {
    label: 'Document Request',
    icon: '📋',
    body: `Hi {name}, hope you're doing well! This is {firm} following up on your case. In order to move forward, we need a few documents from you. Please give us a call at {phone} or reply to this message and we'll send you a list of what we need. We appreciate your cooperation and are working hard to get the best resolution for you!`
  },
  {
    label: 'Payment Due',
    icon: '💳',
    body: `Hi {name}, this is a friendly reminder from {firm} that a balance is currently due on your account. We have flexible payment options available and want to make this as easy as possible for you. Please give us a call at {phone} at your convenience so we can assist you. Thank you for trusting us with your case!`
  },
  {
    label: 'Resolution Update',
    icon: '📊',
    body: `Hi {name}, great news — we have an update on your IRS case and we'd love to go over the details with you! Please call us at your earliest convenience at {phone} or reply to this message to schedule a time to chat. We're committed to keeping you informed every step of the way. — {firm}`
  },
  {
    label: 'Welcome Text',
    icon: '👋',
    body: `Hi {name}, welcome to {firm}! We're so glad to have you as a client and we're already hard at work on your case. Your dedicated case rep will be reaching out to you shortly to introduce themselves and walk you through next steps. In the meantime, feel free to call or text us anytime at {phone}. We're in your corner!`
  },
  {
    label: 'Missing Information',
    icon: '⚠️',
    body: `Hi {name}, this is {firm} checking in. We noticed we may be missing some information needed to continue working on your case. Could you please give us a call at {phone} when you get a chance? We want to make sure we have everything we need to get you the best possible outcome. Thank you!`
  },
  {
    label: 'IRS Notice Received',
    icon: '📬',
    body: `Hi {name}, we received a notice from the IRS regarding your case and we want to make sure we address it right away. Please call us as soon as possible at {phone} so we can review the notice together and discuss next steps. Don't worry — we're on it! — {firm}`
  },
  {
    label: 'Case Resolved',
    icon: '✅',
    body: `Hi {name}, we have some wonderful news — your IRS case has been successfully resolved! It's been our pleasure working with you, and we're thrilled with the outcome. Please call us at {phone} so we can go over the final details together. Thank you for choosing {firm}!`
  },
]

const BLANK = { phone:'', clientName:'', body:'', status:'Sent' }

export default function Sms() {
  const { user, myTenantId } = useApp()
  const [searchParams] = useSearchParams()
  const [sent,    setSent]    = useState([])
  const [messagePage,setMessagePage] = useState(1)
  const [messageTotal,setMessageTotal] = useState(0)
  const MESSAGE_PAGE_SIZE = 250
  const [clients, setClients] = useState([])
  const [form,    setForm]    = useState(BLANK)
  const [sug,     setSug]     = useState([])
  const [saving,  setSaving]  = useState(false)
  const [toast,   setToast]   = useState('')
  const [view,    setView]    = useState('compose')
  const [settings, setSettings] = useState({})
  const [leads,   setLeads]   = useState([])
  const [attachPickerFor, setAttachPickerFor] = useState(null) // sms_messages.id currently showing the manual picker
  const [attachSearch, setAttachSearch] = useState('')
  const [attachFolder, setAttachFolder] = useState('Correspondence')
  useEffect(() => {
    if (searchParams.get('reply') !== '1') return
    const phone = (searchParams.get('phone') || '').replace(/\D/g,'')
    const clientName = searchParams.get('client') || ''
    setForm(prev => ({ ...prev, phone, clientName }))
    setView('compose')
  }, [searchParams])
  const [attaching, setAttaching] = useState(null) // id of the media item currently being attached (disables button)

  useEffect(()=>{
    load()
    // Auto-log inbound SMS to client activity when they arrive via SignalWire
    const ch = supabase.channel('sms-inbound-note-logger')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_messages' }, ({ new: msg }) => {
        if (msg.direction === 'inbound' && msg.clientName) {
          const preview = (msg.body || '').slice(0, 120).trim()
          supabase.from('client_notes').insert({
            clientname: msg.clientName,
            text: `💬 SMS Received — ${preview}${msg.body?.length > 120 ? '…' : ''}`,
            note_type: 'SMS',
            author: msg.clientName,
            created_at: msg.created_at || new Date().toISOString(),
          })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  },[messagePage] )

  async function load(){
    const from=(messagePage-1)*MESSAGE_PAGE_SIZE
    const to=from+MESSAGE_PAGE_SIZE-1
    const [{data:sms,count:smsCount},{data:cls},{data:lds},{data:s}]=await Promise.all([
      supabase.from('sms_messages').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(from,to),
      supabase.from('clients').select('id,name,phone,smsConsent').order('name'),
      supabase.from('leads').select('id,name,phone').order('name'),
      supabase.from('settings').select('sw_space_url,sw_inbound_did').limit(1).maybeSingle(),
    ])
    if(sms)setSent(sms)
    setMessageTotal(smsCount||0)
    if(cls)setClients(cls)
    if(lds)setLeads(lds)
    if(s)setSettings(s)
  }

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(''),3500)}
  function fld(k,v){setForm(f=>({...f,[k]:v}))}

  // Copies an inbound MMS attachment straight into a lead/client's Docs tab.
  // Stores the SignalWire-hosted media URL directly rather than re-hosting
  // it — same approach already used for inbound faxes. If SignalWire ever
  // expires these URLs this would need revisiting, but it matches the
  // existing pattern rather than introducing a second one.
  async function attachMediaToFile(msg, mediaItem, targetName, folder) {
    if (!targetName) { showToast('Pick who this belongs to first'); return }
    setAttaching(mediaItem.url)
    const ext = (mediaItem.content_type || '').split('/')[1] || 'jpg'
    const { error } = await supabase.from('documents').insert([{
      name: `SMS attachment — ${msg.phone}`,
      client: targetName,
      docType: folder || 'Correspondence',
      notes: `Received via SMS on ${msg.created_at ? new Date(msg.created_at).toLocaleString() : 'unknown date'}`,
      file_url: mediaItem.url,
      file_name: `sms_attachment.${ext}`,
      file_size: null,
      created_at: new Date().toISOString(),
    }])
    setAttaching(null)
    if (error) { showToast('Error attaching: ' + error.message); return }
    showToast(`✅ Attached to ${targetName}'s ${folder} folder`)
    setAttachPickerFor(null); setAttachSearch(''); setAttachFolder('Correspondence')
  }

  function searchClient(val){
    fld('clientName',val)
    if(val.length<2){setSug([]);return}
    setSug(clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,5))
  }

  function useTemplate(t){
    // Tenant-substitute at apply time so templates read for whichever firm is
    // signed in (TCR, demo, or a future tenant). {name}=recipient, {firm}=firm
    // display name, {phone}=firm phone (unformatted → keep the placeholder
    // exactly as typed in the template constant).
    const name  = form.clientName || '{name}'
    const firm  = FIRM.name  || 'Tax Case Review'
    const phone = FIRM.phone || '(888) 334-5052'
    const body = t.body
      .replace(/\{name\}/g,  name)
      .replace(/\{firm\}/g,  firm)
      .replace(/\{phone\}/g, phone)
    fld('body', body)
    setView('compose')
  }

  async function send(){
    if(!form.clientName||!form.body){showToast('Client and message required');return}
    if(!form.phone){showToast('Recipient phone number required');return}
    setSaving(true)

    const toNum = '+1' + form.phone.replace(/\D/g,'').slice(-10)
    let status = 'Sent', sw_id = null, errMsg = null

    if (settings?.sw_space_url || myTenantId === 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae') {
      try {
        const { data: resData, error: invokeErr } = await supabase.functions.invoke('send-sms', {
          body: { to: toNum, body: form.body, client_id: clients.find(c=>c.name===form.clientName)?.id || null }
        })
        if (!invokeErr && resData?.success) {
          sw_id = resData.sid || null
        } else {
          status = 'Failed'
          errMsg = resData?.error || invokeErr?.message || 'SignalWire send failed'
        }
      } catch (e) {
        status = 'Failed'
        errMsg = e.message
      }
    } else {
      status = 'Logged (not sent)'
    }

    let error = null
    if (!(myTenantId === 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae' && sw_id)) {
      ;({error}=await supabase.from('sms_messages').insert([{
        ...form, phone: toNum, status,
        signalwire_sms_id: sw_id, sent_by: user?.email || 'Unknown',
        error_msg: errMsg, created_at:new Date().toISOString()
      }]))
    }
    setSaving(false)
    if(error){showToast('Error: '+error.message);return}

    // Auto-log outbound SMS to client activity history
    if (form.clientName && status !== 'Failed') {
      const preview = (form.body || '').slice(0, 120).trim()
      let authorName = user?.email || 'Staff'
      if (user?.email) {
        const { data: empRec } = await supabase.from('employees').select('name').eq('email', user.email).maybeSingle()
        if (empRec?.name) authorName = empRec.name
      }
      await supabase.from('client_notes').insert({
        clientname: form.clientName,
        text: `💬 SMS Sent — ${preview}${form.body?.length > 120 ? '…' : ''}`,
        note_type: 'SMS',
        author: authorName,
        created_at: new Date().toISOString(),
      })
    }

    if (status === 'Sent') showToast(myTenantId === 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae' && !settings?.sw_space_url ? '✅ SMS sent through the TaxRes platform relay!' : '✅ SMS sent via SignalWire!')
    else if (status === 'Failed') showToast('SignalWire error: ' + (errMsg||'send failed'))
    else showToast('Logged — add SignalWire credentials in Settings to send for real')
    setForm(BLANK);load()
  }

  async function del(id){
    const { error } = await supabase.from('sms_messages').delete().eq('id',id)
    if (error) { showToast('Error: ' + error.message); return }
    showToast('Deleted');load()
  }

  const charCount = form.body.length
  const smsCount  = Math.ceil(charCount/160)||0

  return (
    <div style={{padding:'20px 24px',maxWidth:1100,margin:'0 auto'}}>
      {toast&&<div className="toast show">{toast}</div>}

      {/* Tab bar */}
      <div style={{display:'flex',gap:6,marginBottom:18}}>
        {['compose','sent','templates'].map(t=>(
          <span key={t} className={`chip${view===t?' on':''}`} onClick={()=>setView(t)}
            style={{textTransform:'capitalize',fontSize:13,padding:'6px 16px',fontWeight:600,cursor:'pointer'}}>
            {t==='sent'?`Messages (${sent.length})`:t==='templates'?'Templates':'💬 Compose'}
          </span>
        ))}
      </div>

      {/* COMPOSE VIEW */}
      {view==='compose'&&(
        <div className="g2" style={{alignItems:'start',gap:16}}>
          {/* Left — Send form */}
          <div className="card" style={{padding:'20px 24px'}}>
            <h3 style={{fontSize:17,fontWeight:800,margin:'0 0 18px'}}>Send SMS</h3>

            <div className="field" style={{position:'relative'}}>
              <label style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--t3)'}}>Client *</label>
              <input value={form.clientName} onChange={e=>searchClient(e.target.value)} placeholder="Search client..." autoComplete="off"
                style={{fontSize:14,padding:'10px 14px'}}/>
              {sug.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--sf)',border:'1px solid var(--br)',borderRadius:8,zIndex:500,boxShadow:'0 4px 20px rgba(0,0,0,.3)'}}>
                  {sug.map(c=>(
                    <div key={c.id} onClick={()=>{ fld('clientName',c.name); fld('phone',c.phone||''); setSug([]); setForm(f => ({ ...f, clientName: c.name, phone: c.phone||'', body: f.body.replace(/\{name\}/g, c.name).replace(/\{firm\}/g, FIRM.name || 'Tax Case Review').replace(/\{phone\}/g, FIRM.phone || '(888) 334-5052') })) }}
                      style={{padding:'10px 14px',cursor:'pointer',fontSize:14}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{fontWeight:700}}>{c.name}</div>
                      {c.phone&&<div style={{fontSize:11,color:'var(--t3)'}}>{c.phone}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <label style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--t3)'}}>To (Phone #)</label>
              <input value={form.phone} onChange={e=>fld('phone',e.target.value)} placeholder="(305) 555-0000"
                style={{fontSize:14,padding:'10px 14px'}}/>
            </div>

            {(() => {
              const matched = clients.find(c => c.name === form.clientName)
              if (matched && !matched.smsConsent) {
                return (
                  <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 8, fontSize: 12, color: 'var(--warn)' }}>
                    ⚠️ No SMS consent on file for {matched.name}. Confirm consent and check the box on their client record before texting (TCR compliance).
                  </div>
                )
              }
              return null
            })()}

            <div className="field">
              <label style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'var(--t3)'}}>Message *</span>
                <span style={{fontSize:11,color:charCount>160?'var(--warn)':'var(--t3)',fontWeight:600}}>{charCount} chars · {smsCount} SMS</span>
              </label>
              <textarea value={form.body} onChange={e=>fld('body',e.target.value)}
                style={{minHeight:150,fontSize:14,padding:'12px 14px',lineHeight:1.6}} placeholder="Type your message..."/>
            </div>

            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:'12px',fontSize:15,fontWeight:700,marginBottom:12}} onClick={send} disabled={saving}>
              {saving?'Sending…':(settings?.sw_space_url?'📱 Send SMS':'📱 Log SMS')}
            </button>

            <div style={{padding:'10px 14px',background:'var(--s2)',borderRadius:8,fontSize:12,color:'var(--t3)',lineHeight:1.6}}>
              {settings?.sw_space_url
                ? '✅ SignalWire is connected — messages send for real and get logged here.'
                : '💡 Add SignalWire credentials in Settings to enable real sending.'}
            </div>
          </div>

          {/* Right — Quick Templates */}
          <div className="card" style={{padding:'20px 24px'}}>
            <h3 style={{fontSize:17,fontWeight:800,margin:'0 0 18px'}}>Quick Templates</h3>
            {TEMPLATES.map(t=>(
              <div key={t.label} style={{padding:'12px 0',borderBottom:'1px solid var(--br)'}}>
                <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{t.icon} {t.label}</div>
                <div style={{fontSize:12,color:'var(--t3)',marginBottom:8,lineHeight:1.6}}>{t.body.slice(0,100)}…</div>
                <button className="btn sm" style={{fontSize:12,padding:'5px 14px',fontWeight:600}} onClick={()=>useTemplate(t)}>Use</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MESSAGES VIEW */}
      {view==='sent'&&(
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid var(--br)'}}>
            <h3 style={{margin:0,fontSize:17,fontWeight:800}}>Messages ({messageTotal})</h3>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'10px 14px',borderBottom:'1px solid var(--br)',flexWrap:'wrap'}}>
            <div style={{fontSize:11,color:'var(--t3)'}}>Showing {messageTotal ? ((messagePage-1)*MESSAGE_PAGE_SIZE)+1 : 0}–{Math.min(messagePage*MESSAGE_PAGE_SIZE,messageTotal)} of {messageTotal}</div>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <button className="btn sec" style={{fontSize:11,padding:'4px 9px'}} disabled={messagePage<=1} onClick={()=>setMessagePage(p=>Math.max(1,p-1))}>← Prev</button>
              <span style={{fontSize:11,color:'var(--t2)'}}>Page {messagePage} / {Math.max(1,Math.ceil(messageTotal/MESSAGE_PAGE_SIZE))}</span>
              <button className="btn sec" style={{fontSize:11,padding:'4px 9px'}} disabled={messagePage>=Math.max(1,Math.ceil(messageTotal/MESSAGE_PAGE_SIZE))} onClick={()=>setMessagePage(p=>p+1)}>Next →</button>
            </div>
          </div>
          <div className="ovx">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--br)',background:'var(--s2)'}}>
                  {['','Client','Phone','Message','Date','Status',''].map(h=>(
                    <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sent.length===0
                  ?<tr><td colSpan={7} style={{textAlign:'center',color:'var(--t3)',padding:'40px 20px'}}><div style={{fontSize:32,marginBottom:8}}>💬</div><div style={{fontWeight:600,fontSize:14,color:'var(--tx)',marginBottom:4}}>No messages yet</div><div style={{fontSize:12}}>Send an SMS to see it here.</div></td></tr>
                  :sent.map(s=>{
                    const hasMedia = s.direction==='inbound' && s.media?.length > 0
                    const isMatched = hasMedia && s.clientName && s.clientName !== s.phone
                    const pickerOpen = attachPickerFor === s.id
                    const pickerResults = attachSearch.length >= 2
                      ? [...clients.map(c=>({...c,_type:'Client'})), ...leads.map(l=>({...l,_type:'Lead'}))]
                          .filter(p=>p.name.toLowerCase().includes(attachSearch.toLowerCase())).slice(0,6)
                      : []
                    return (
                    <Fragment key={s.id}>
                    <tr key={s.id} style={{borderBottom: pickerOpen ? 'none' : '1px solid var(--br)'}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={{padding:'12px 14px',fontSize:18}}>{s.direction==='inbound'?<span style={{color:'var(--blue)'}}>📥</span>:<span style={{color:'var(--t3)'}}>📤</span>}</td>
                      <td style={{padding:'12px 14px',fontWeight:700,fontSize:14}}>{s.clientName}</td>
                      <td style={{padding:'12px 14px'}}><PhoneNumber val={s.phone} /></td>
                      <td style={{padding:'12px 14px',fontSize:13,maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--t2)'}}>
                        {s.body}{hasMedia && <span title={`${s.media.length} attachment(s)`} style={{marginLeft:6}}>📎 {s.media.length}</span>}
                      </td>
                      <td style={{padding:'12px 14px',fontSize:12,color:'var(--t3)',whiteSpace:'nowrap'}}>{s.created_at?.slice(0,10)}</td>
                      <td style={{padding:'12px 14px'}}><span className="bdg bg" style={{fontSize:12,padding:'3px 10px',fontWeight:700}}>{s.status||'Sent'}</span></td>
                      <td style={{padding:'12px 14px',display:'flex',gap:6,alignItems:'center'}}>
                        {hasMedia && (
                          <button className="btn sec" style={{fontSize:11,padding:'4px 10px'}}
                            onClick={()=>{ setAttachPickerFor(pickerOpen ? null : s.id); setAttachSearch(''); setAttachFolder('Correspondence') }}>
                            📎 {isMatched ? `Attach to ${s.clientName}'s file` : 'Attach to file'}
                          </button>
                        )}
                        <button className="btn del" style={{fontSize:11,padding:'4px 10px'}} onClick={()=>del(s.id)}>Del</button>
                      </td>
                    </tr>
                    {pickerOpen && (
                      <tr key={s.id+'-picker'} style={{borderBottom:'1px solid var(--br)',background:'var(--s2)'}}>
                        <td colSpan={7} style={{padding:'10px 14px'}}>
                          <div style={{display:'flex',flexDirection:'column',gap:6,maxWidth:360}}>
                            {isMatched ? (
                              <div style={{fontSize:13,fontWeight:600}}>Attaching to: {s.clientName} <span style={{color:'var(--t3)',fontWeight:400,fontSize:11}}>(matched by phone)</span></div>
                            ) : (
                              <>
                                <input autoFocus placeholder="Search client or lead name…" value={attachSearch}
                                  onChange={e=>setAttachSearch(e.target.value)}
                                  style={{fontSize:13,padding:'6px 10px',borderRadius:6,border:'1px solid var(--br)',background:'var(--bg)',color:'var(--tx)'}}/>
                                {pickerResults.map(p=>(
                                  <div key={p._type+p.id} onClick={()=>setAttachSearch(p.name)}
                                    style={{fontSize:13,padding:'6px 10px',cursor:'pointer',borderRadius:6,background:attachSearch===p.name?'var(--br)':'transparent'}}
                                    onMouseEnter={e=>e.currentTarget.style.background='var(--br)'}
                                    onMouseLeave={e=>e.currentTarget.style.background=attachSearch===p.name?'var(--br)':''}>
                                    {p.name} <span style={{color:'var(--t3)',fontSize:11}}>({p._type})</span>
                                  </div>
                                ))}
                              </>
                            )}
                            <div className="field"><label style={{fontSize:11}}>Folder</label>
                              <select value={attachFolder} onChange={e=>setAttachFolder(e.target.value)} style={{fontSize:13,padding:'6px 10px'}}>
                                {DOC_FOLDERS.map(f=><option key={f}>{f}</option>)}
                              </select>
                            </div>
                            <div style={{display:'flex',gap:8}}>
                              <button className="btn pri" style={{fontSize:12,padding:'5px 12px'}} disabled={!!attaching || (!isMatched && !attachSearch)}
                                onClick={()=>s.media.forEach(m=>attachMediaToFile(s, m, isMatched ? s.clientName : attachSearch, attachFolder))}>
                                Confirm Attach
                              </button>
                              <button className="btn sec" style={{fontSize:12,padding:'5px 12px'}} onClick={()=>{setAttachPickerFor(null);setAttachSearch('');setAttachFolder('Correspondence')}}>Cancel</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TEMPLATES VIEW */}
      {view==='templates'&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:12}}>
          {TEMPLATES.map(t=>(
            <div key={t.label} className="card" style={{padding:'18px 20px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <div style={{fontWeight:800,fontSize:15}}>{t.icon} {t.label}</div>
                <button className="btn pri" style={{fontSize:12,padding:'5px 14px',fontWeight:700}} onClick={()=>{useTemplate(t);setView('compose')}}>Use →</button>
              </div>
              <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7}}>{t.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
