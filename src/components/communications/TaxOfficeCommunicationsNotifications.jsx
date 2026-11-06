import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { useCall } from '../../context/CallContext'

const routes={call:'/dialer',email:'/email',sms:'/sms'}
const accessibleKind=(tag='')=>String(tag).startsWith('email-')?'email':String(tag).startsWith('sms-')?'sms':String(tag).startsWith('voicemail-')?'call':null
export default function TaxOfficeCommunicationsNotifications(){
  const { user, can }=useApp()
  const { incomingCall }=useCall()
  const navigate=useNavigate()
  const [open,setOpen]=useState(false)
  const [counts,setCounts]=useState({email:null,sms:null,call:null})
  const [failures,setFailures]=useState([])
  const [events,setEvents]=useState([])
  const seen=useRef(new Set())
  const activeRing=useRef(null)
  const allowed={call:can('view','dialer'),email:can('view','email'),sms:can('view','sms')}
  useEffect(()=>{setOpen(false);setCounts({email:null,sms:null,call:null});setFailures([]);setEvents([]);seen.current=new Set()},[user?.id])
  useEffect(()=>{
    if(!user?.id)return
    const onCount=({detail})=>{
      if(detail?.owner!==user.id)return
      if(detail.error){setFailures(old=>[...new Set([...old,detail.source||'Communications'])]);return}
      setFailures(old=>old.filter(x=>x!==detail.source))
      setCounts(old=>({...old,...detail.counts}))
    }
    const onEvent=({detail})=>{
      if(detail?.owner!==user.id)return
      const kind=accessibleKind(detail.tag)
      if(!kind||!allowed[kind])return
      const key=String(detail.tag)
      if(seen.current.has(key))return
      seen.current.add(key)
      if(seen.current.size>160)seen.current=new Set([...seen.current].slice(-100))
      setEvents(old=>[{key,kind,title:detail.title,body:detail.body||''},...old].slice(0,20))
    }
    window.addEventListener('taxoffice:comm-counts',onCount)
    window.addEventListener('taxoffice:comm-event',onEvent)
    return()=>{window.removeEventListener('taxoffice:comm-counts',onCount);window.removeEventListener('taxoffice:comm-event',onEvent)}
  },[user?.id,allowed.call,allowed.email,allowed.sms])
  useEffect(()=>{
    if(incomingCall)setOpen(false)
    if(!incomingCall){activeRing.current=null;return}
    if(!allowed.call||activeRing.current===incomingCall)return
    activeRing.current=incomingCall
    const key='ring-'+String(incomingCall.id||Date.now())
    setEvents(old=>[{key,kind:'call',title:'Incoming call',body:'Open phone controls to answer or decline'},...old].slice(0,20))
  },[incomingCall,allowed.call])
  useEffect(()=>{
    if(!open)return
    const onKey=e=>{if(e.key==='Escape')setOpen(false)}
    document.addEventListener('keydown',onKey)
    return()=>document.removeEventListener('keydown',onKey)
  },[open])
  if(!user||!allowed.call&&!allowed.email&&!allowed.sms)return null
  const total=Object.entries(counts).reduce((n,[kind,value])=>n+(allowed[kind]?Number(value||0):0),0)
  const go=(kind)=>{navigate(routes[kind]);setOpen(false)}
  const chip={minHeight:44,borderRadius:10,border:'1px solid #4c5c74',background:'#1b2840',color:'#fff',cursor:'pointer',padding:'9px',fontSize:12}
  return <div className="taxoffice-comms">
    <style>{`
      .taxoffice-comms{position:fixed;right:16px;bottom:16px;z-index:10002;color:#e2e8f0}
      .taxoffice-comms-toggle{background:#202049;color:#fff;border:1px solid #6366f1;border-radius:999px;min-height:44px;padding:11px 16px;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 8px 24px #0008}
      .taxoffice-comms-panel{position:fixed;right:16px;bottom:150px;width:min(92vw,370px);max-height:calc(100dvh - 164px);overflow-y:auto;overscroll-behavior:contain;padding:16px;background:#111a2c;color:#f1f5f9;border:1px solid #52627e;box-shadow:0 18px 50px #0009;border-radius:16px}
      .taxoffice-comms-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:12px 0}
      .taxoffice-comms-events{max-height:240px;overflow-y:auto;display:grid;gap:7px}
      @media(max-width:640px){
        .taxoffice-comms{left:12px;right:auto;bottom:calc(76px + env(safe-area-inset-bottom,0px))}
        .taxoffice-comms-toggle{height:48px;width:48px;border-radius:50%;padding:0;font-size:0}
        .taxoffice-comms-toggle .taxoffice-comms-bell{font-size:20px}.taxoffice-comms-toggle .taxoffice-comms-count{font-size:11px}
        .taxoffice-comms-toggle .taxoffice-comms-title{display:none}
        .taxoffice-comms-panel{left:8px;right:8px;width:auto;bottom:calc(138px + env(safe-area-inset-bottom,0px));max-height:min(70dvh,calc(100dvh - 156px));padding:14px}
      }
      @media(max-height:420px){.taxoffice-comms-panel{bottom:8px;max-height:calc(100dvh - 16px)}}
    `}</style>
    {open&&<section className="taxoffice-comms-panel" role="dialog" aria-modal="false" aria-label="Communications notifications">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
        <strong>Communications Notifications</strong><button type="button" style={chip} aria-label="Close notifications" onClick={()=>setOpen(false)}>✕</button>
      </div>
      <div className="taxoffice-comms-grid">
        {allowed.call&&<button style={chip} onClick={()=>go('call')}>📞 Voicemail: {counts.call??'—'}</button>}
        {allowed.email&&<button style={chip} onClick={()=>go('email')}>📧 Unread: {counts.email??'—'}</button>}
        {allowed.sms&&<button style={chip} onClick={()=>go('sms')}>💬 New SMS: {counts.sms??'—'}</button>}
      </div>
      {failures.length>0&&<p role="status" style={{fontSize:12,color:'#fecaca'}}>Counts unavailable: {failures.join(', ')}. Checking again automatically.</p>}
      <div className="taxoffice-comms-events">
        {events.length===0&&<p style={{fontSize:12,color:'#94a3b8'}}>New messages and calls will appear here while this CRM is open.</p>}
        {events.map(e=><button type="button" key={e.key} style={{...chip,textAlign:'left'}} onClick={()=>go(e.kind)}>
          <strong style={{display:'block'}}>{e.title}</strong><span style={{color:'#cbd5e1',overflowWrap:'anywhere'}}>{e.body}</span>
        </button>)}
      </div>
      <p style={{fontSize:11,color:'#94a3b8',marginTop:12}}>Counts and sounds reuse existing office alerts. New SMS means messages since you last viewed SMS.</p>
    </section>}
    <button type="button" className="taxoffice-comms-toggle" aria-label="Communications notifications" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
      <span className="taxoffice-comms-bell">🔔</span><span className="taxoffice-comms-title"> Calls · Email · SMS</span> {total>0&&<span className="taxoffice-comms-count" style={{background:'#c6ff00',color:'#14220a',borderRadius:20,padding:'2px 6px'}}>{total>99?'99+':total}</span>}
      {failures.length>0&&<span style={{color:'#fecaca'}}>!</span>}
    </button>
  </div>
}
