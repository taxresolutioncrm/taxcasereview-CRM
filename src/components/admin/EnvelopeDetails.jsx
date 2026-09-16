import { useEffect,useMemo,useState } from 'react'

const dt=v=>v?new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—'

export default function EnvelopeDetails({supabase,row,brand,onClose,onOpenFile}){
  const [recipients,setRecipients]=useState([])
  const [events,setEvents]=useState([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  useEffect(()=>{
    let live=true
    async function load(){
      setLoading(true);setError('')
      const [rec,evt]=await Promise.all([
        supabase.from('romylabs_esign_recipients')
          .select('id,recipient_order,role,name,email,status,auth_method,sent_at,opened_at,completed_at,declined_at,decline_reason,created_at,updated_at')
          .eq('envelope_id',row.id).order('recipient_order',{ascending:true}),
        supabase.from('romylabs_esign_events')
          .select('id,recipient_id,event_type,actor_email,actor_name,ip_address,user_agent,metadata,occurred_at')
          .eq('envelope_id',row.id).order('occurred_at',{ascending:true}),
      ])
      if(!live)return
      if(rec.error||evt.error)setError(rec.error?.message||evt.error?.message||'Could not load envelope details')
      setRecipients(rec.data||[]);setEvents(evt.data||[]);setLoading(false)
    }
    load()
    return()=>{live=false}
  },[row.id,supabase])

  const progress=useMemo(()=>[
    ['Sent',!!row.sent_at],
    ['Delivered',events.some(e=>['sent','resent','delivered'].includes(String(e.event_type||'').toLowerCase()))],
    ['Viewed',!!row.opened_at],
    ['Signed',!!(row.signed_at||row.completed_at)],
  ],[events,row])

  const latestProgress=useMemo(()=>{
    const evt=[...events].reverse().find(e=>String(e.event_type||'').toLowerCase()==='progress')
    return evt?.metadata&&typeof evt.metadata==='object'?evt.metadata:null
  },[events])
  const incompleteFields=Array.isArray(latestProgress?.incomplete_fields)?latestProgress.incomplete_fields:[]
  const incompletePages=Array.isArray(latestProgress?.incomplete_pages)?latestProgress.incomplete_pages:[]
  const exactPercent=latestProgress?Math.max(0,Math.min(100,Number(latestProgress.completion_percent||0))):null

  const resendCount=events.filter(e=>String(e.event_type||'').toLowerCase()==='resent').length
  const signatureMethod=row.envelope_settings?.signature_method==='draw'?'Draw':'Type'

  return <section style={box}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',marginBottom:14}}>
      <div>
        <div style={{fontSize:15,fontWeight:900,color:'#fff'}}>Envelope Details</div>
        <div style={{fontSize:10,color:'#64748b',marginTop:3}}>Envelope ID: {row.id}</div>
      </div>
      <button onClick={onClose} style={smallBtn}>Close</button>
    </div>

    {loading?<div style={muted}>Loading envelope audit…</div>:<>
      {error&&<div style={{...muted,color:'#f87171',marginBottom:10}}>{error}</div>}
      <div style={grid}>
        <Meta k="Document" v={row.title}/>
        <Meta k="From" v={brand.email}/>
        <Meta k="Recipient" v={(row.signer_name?row.signer_name+' · ':'')+(row.signer_email||'')}/>
        <Meta k="Status" v={String(row.status||'').toUpperCase()}/>
        <Meta k="Sent" v={dt(row.sent_at)}/>
        <Meta k="Viewed" v={dt(row.opened_at)}/>
        <Meta k="Signed" v={dt(row.signed_at||row.completed_at)}/>
        <Meta k="Expires" v={dt(row.expires_at)}/>
        <Meta k="Signature Method" v={signatureMethod}/>
        <Meta k="Reminders" v={row.reminder_enabled?'On · '+String(row.reminder_delay_days||0)+'d delay · every '+String(row.reminder_frequency_days||0)+'d':'Off'}/>
        <Meta k="Last Reminder" v={dt(row.last_reminder_at)}/>
        <Meta k="Resends" v={String(resendCount)}/>
        <Meta k="Required Fields" v={latestProgress?`${latestProgress.required_completed||0} / ${latestProgress.required_total||0}`:'—'}/>
        <Meta k="Current Page" v={latestProgress?`${latestProgress.current_page||1} / ${latestProgress.page_count||1}`:'—'}/>
        <Meta k="Signer IP" v={row.signer_ip||'—'}/>
        <Meta k="Browser / Device" v={row.signer_user_agent||'—'}/>
      </div>

      <Label>Progress</Label>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
        {progress.map(([label,ok])=><span key={label} style={{padding:'6px 9px',borderRadius:999,fontSize:9,fontWeight:900,background:ok?'rgba(16,185,129,.14)':'rgba(100,116,139,.12)',color:ok?'#34d399':'#64748b',border:'1px solid '+(ok?'rgba(16,185,129,.22)':'rgba(100,116,139,.16)')}}>{ok?'✓ ':''}{label}</span>)}
      </div>

      {latestProgress&&<>
        <Label>Signing Completion</Label>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:9}}>
          <div style={{flex:1,maxWidth:420,height:8,borderRadius:999,background:'rgba(100,116,139,.18)',overflow:'hidden'}}>
            <div style={{width:`${exactPercent}%`,height:'100%',background:exactPercent===100?'#10b981':'#6366f1'}}/>
          </div>
          <strong style={{fontSize:11,color:'#e2e8f0'}}>{exactPercent}%</strong>
        </div>
        <div style={{fontSize:10,color:'#94a3b8',marginBottom:8}}>
          Page {latestProgress.current_page||1} of {latestProgress.page_count||1} · {latestProgress.required_completed||0} of {latestProgress.required_total||0} required fields completed
        </div>
        {incompletePages.length>0&&<div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:8}}>
          <span style={{fontSize:9,color:'#94a3b8',padding:'4px 0'}}>Incomplete pages:</span>
          {incompletePages.map(p=><span key={p} style={{padding:'4px 7px',borderRadius:999,fontSize:9,fontWeight:800,background:'rgba(245,158,11,.12)',color:'#fbbf24',border:'1px solid rgba(245,158,11,.2)'}}>Page {p}</span>)}
        </div>}
        {incompleteFields.length>0&&<div style={{padding:'9px 10px',borderRadius:8,background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.14)',marginBottom:14}}>
          <div style={{fontSize:9,fontWeight:900,color:'#fbbf24',marginBottom:5}}>Still required</div>
          {incompleteFields.map(f=><div key={f.id} style={{fontSize:9,color:'#cbd5e1',padding:'2px 0'}}>Page {f.page} · {f.label||f.type}</div>)}
        </div>}
      </>}

      {recipients.length>0&&<>
        <Label>Recipients</Label>
        {recipients.map(r=><div key={r.id} style={recipientBox}>
          <strong>{r.name||r.email}</strong> · {r.email} · {String(r.status||'').toUpperCase()}
          <div style={{fontSize:9,color:'#64748b',marginTop:3}}>
            Sent {dt(r.sent_at)} · Viewed {dt(r.opened_at)} · Completed {dt(r.completed_at)}
            {r.decline_reason?' · Declined: '+r.decline_reason:''}
          </div>
        </div>)}
      </>}

      <Label>Audit Trail</Label>
      {events.length===0?<div style={muted}>No audit events recorded.</div>:events.map(e=><div key={e.id} style={auditRow}>
        <span style={{color:'#64748b'}}>{dt(e.occurred_at)}</span>
        <strong style={{color:'#a5b4fc',textTransform:'uppercase'}}>{e.event_type}</strong>
        <span>{e.actor_name||e.actor_email||'System'}{e.ip_address?' · '+e.ip_address:''}</span>
      </div>)}

      {(row.source_sha256||row.signed_sha256||row.certificate_sha256)&&<div style={hashBox}>
        <Label>Document Integrity</Label>
        {row.source_sha256&&<HashLine label="Source SHA-256" value={row.source_sha256}/>}
        {row.signed_sha256&&<HashLine label="Signed SHA-256" value={row.signed_sha256}/>}
        {row.certificate_sha256&&<HashLine label="Certificate SHA-256" value={row.certificate_sha256}/>}
      </div>}

      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:14}}>
        <button onClick={()=>onOpenFile(row,'source')} style={smallBtn}>Original</button>
        {row.signed_path&&<button onClick={()=>onOpenFile(row,'signed')} style={goodBtn}>Signed Contract</button>}
      </div>
    </>}
  </section>
}

function Meta({k,v}){return <div style={metaBox}><div style={metaKey}>{k}</div><div style={metaVal}>{v||'—'}</div></div>}
function Label({children}){return <div style={{fontSize:10,fontWeight:900,color:'#94a3b8',textTransform:'uppercase',margin:'14px 0 8px'}}>{children}</div>}
function HashLine({label,value}){return <div style={{fontSize:8,color:'#64748b',wordBreak:'break-all',marginBottom:5}}>{label}: {value}</div>}

const box={background:'rgba(255,255,255,.035)',border:'1px solid rgba(99,102,241,.28)',borderRadius:12,padding:18}
const grid={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8,marginBottom:14}
const metaBox={padding:'10px 11px',borderRadius:8,background:'rgba(15,23,42,.55)',border:'1px solid rgba(148,163,184,.1)'}
const metaKey={fontSize:8,fontWeight:900,color:'#64748b',textTransform:'uppercase',letterSpacing:'.05em'}
const metaVal={fontSize:10,color:'#e2e8f0',marginTop:4,wordBreak:'break-word'}
const recipientBox={padding:'9px 10px',borderRadius:8,border:'1px solid rgba(148,163,184,.1)',background:'rgba(255,255,255,.02)',marginBottom:6,fontSize:10,color:'#cbd5e1'}
const auditRow={display:'grid',gridTemplateColumns:'145px 90px minmax(0,1fr)',gap:8,padding:'8px 0',borderBottom:'1px solid rgba(148,163,184,.08)',fontSize:9,color:'#cbd5e1'}
const hashBox={marginTop:14,padding:12,borderRadius:8,background:'rgba(15,23,42,.55)',border:'1px solid rgba(148,163,184,.1)'}
const muted={fontSize:10,color:'#64748b'}
const smallBtn={fontSize:9,padding:'5px 8px',borderRadius:6,border:'1px solid rgba(99,102,241,.25)',background:'rgba(99,102,241,.08)',color:'#a5b4fc',cursor:'pointer'}
const goodBtn={...smallBtn,color:'#34d399',borderColor:'rgba(16,185,129,.25)',background:'rgba(16,185,129,.08)'}
const certBtn={...smallBtn,color:'#fbbf24',borderColor:'rgba(245,158,11,.25)',background:'rgba(245,158,11,.08)'}
