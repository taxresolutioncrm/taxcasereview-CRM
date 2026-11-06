import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useCall } from '../../context/CallContext'
import { playSound } from '../../lib/notifySound'

// This component stays mounted in the Admin Portal shell, not in the Email
// iframe or Communications route. Each source is owner-authorized server-side.
const REFRESH_MS = 30000
const ADMIN_ROUTES = {call:'/crm-admin/dialer?tab=phone',sms:'/crm-admin/dialer?tab=sms',email:'/crm-admin/email'}
const timeOf = value => { const n=Date.parse(value||''); return Number.isFinite(n)?n:0 }
const ageOk = value => timeOf(value) > Date.now()-10*60*1000
const hideAutomated = m => /^(mailer-daemon|postmaster)@/i.test(String(m?.from?.[0]?.email||'')) ||
  /^(report domain:|delivery status notification|undeliverable)/i.test(String(m?.subject||''))
const countsDefault = {call:0,email:0,sms:0}

export default function AdminCommsNotifications(){
  const navigate=useNavigate()
  const { incomingCall }=useCall()
  const [open,setOpen]=useState(false)
  const [counts,setCounts]=useState(countsDefault)
  const [events,setEvents]=useState([])
  const [dismissed,setDismissed]=useState('')
  const [problems,setProblems]=useState([])
  const [permission,setPermission]=useState(() => typeof Notification==='undefined'?'unsupported':Notification.permission)
  const seen=useRef({sms:null,email:null,call:null})
  const running=useRef(false)
  const lastIncoming=useRef('')
  const alerts=useRef(new Set())
  const mounted=useRef(true)

  const emit=useCallback((kind,id,title,detail)=>{
    const key=kind+':'+id
    if(alerts.current.has(key))return
    alerts.current.add(key)
    if(alerts.current.size>250)alerts.current=new Set([...alerts.current].slice(-160))
    if(kind==='email'||kind==='sms')playSound(kind)
    const record={key,kind,title,detail,at:new Date().toISOString()}
    setEvents(old=>[record,...old].slice(0,20))
    if(typeof Notification!=='undefined' && Notification.permission==='granted'){
      try { const n=new Notification(title,{body:detail,tag:key,icon:'/romylabs-favicon.png'})
        n.onclick=()=>{window.focus();navigate(ADMIN_ROUTES[kind]);n.close()}
      } catch(e){console.warn('[admin notifications] browser notification unavailable',e)}
    }
  },[navigate])

  const refresh=useCallback(async()=>{
    if(running.current || document.visibilityState==='hidden')return
    running.current=true
    try {
      const calls=[
        supabase.functions.invoke('romylabs-sms',{body:{action:'list',limit:500}}),
        supabase.functions.invoke('romylabs-mailbox',{body:{action:'list',limit:75}}),
        supabase.functions.invoke('romylabs-phone-state',{body:{action:'recent_calls'}}),
      ]
      const results=await Promise.allSettled(calls)
      if(!mounted.current)return
      const errors=[]
      const values=results.map((r,i)=>{
        if(r.status==='rejected'){errors.push(['SMS','Email','Calls'][i]+' unavailable');return null}
        if(r.value.error||!r.value.data?.ok){
          errors.push(['SMS','Email','Calls'][i]+': '+(r.value.data?.error||r.value.error?.message||'Not available'))
          return null
        }
        return r.value.data
      })
      const [sms,mail,phone]=values
      setCounts(old=>({
        call:phone?(Number.isFinite(phone.missed_last_24h_count)?phone.missed_last_24h_count:phone.calls.filter(c=>c.direction==='Inbound'&&c.status==='missed'&&timeOf(c.created_at)>Date.now()-24*3600*1000).length):old.call,
        sms:sms?(Number.isFinite(sms.unread_count)?sms.unread_count:sms.messages.filter(m=>m.direction==='inbound'&&!m.read).length):old.sms,
        email:mail?(mail.mailboxes.find(m=>String(m.role||'').toLowerCase()==='inbox')?.unreadEmails ?? mail.messages.filter(m=>!m.keywords?.['$seen']).length):old.email
      }))
      if(sms){
        const rows=sms.messages.filter(m=>m.direction==='inbound').sort((a,b)=>timeOf(b.created_at)-timeOf(a.created_at))
        const ids=new Set(rows.map(m=>String(m.id)))
        if(seen.current.sms!==null)for(const m of rows){
          if(!seen.current.sms.has(String(m.id))&&ageOk(m.created_at))emit('sms',m.id,'New RomyLabs SMS',String(m.phone||'Unknown number')+' · '+String(m.body||'').slice(0,100))
        }
        seen.current.sms=ids
      }
      if(mail){
        const rows=(mail.messages||[]).filter(m=>!hideAutomated(m))
        const ids=new Set(rows.map(m=>String(m.id)))
        if(seen.current.email!==null)for(const m of rows){
          if(!seen.current.email.has(String(m.id))&&ageOk(m.receivedAt)){
            const from=m.from?.[0]?.email||'Unknown sender'
            emit('email',m.id,'New Admin Email',from+' · '+String(m.subject||'(No subject)').slice(0,120))
          }
        }
        seen.current.email=ids
      }
      if(phone){
        const rows=phone.calls.filter(c=>c.direction==='Inbound'&&c.status==='missed')
        const ids=new Set(rows.map(c=>String(c.id)))
        if(seen.current.call!==null)for(const c of rows){
          if(!seen.current.call.has(String(c.id))&&ageOk(c.created_at))
            emit('call','missed-'+c.id,'Missed RomyLabs Call',String(c.phone||'Unknown number'))
        }
        seen.current.call=ids
      }
      setProblems(errors)
    } catch(e) {
      if(mounted.current)setProblems(['Notification refresh failed; retrying automatically'])
    } finally {running.current=false}
  },[emit])

  useEffect(()=>{
    mounted.current=true
    void refresh()
    const timer=setInterval(()=>void refresh(),REFRESH_MS)
    const foreground=()=>void refresh()
    window.addEventListener('focus',foreground)
    document.addEventListener('visibilitychange',foreground)
    return ()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground)}
  },[refresh])

  useEffect(()=>{ if(incomingCall) setOpen(false) },[incomingCall])
  useEffect(()=>{
    if(!incomingCall)return
    const number=String(incomingCall?.options?.remoteCallerNumber||'Unknown caller')
    const id=String(incomingCall?.id||incomingCall?.call_id||number)
    if(lastIncoming.current===id)return
    lastIncoming.current=id
    emit('call','ring-'+id+'-'+Date.now(),'Incoming RomyLabs Call',number)
  },[incomingCall,emit])
  useEffect(()=>{if(!incomingCall)lastIncoming.current=''},[incomingCall])

  const enableDesktop=async()=>{
    if(typeof Notification==='undefined')return setPermission('unsupported')
    try { setPermission(await Notification.requestPermission()) }catch(e){setPermission('denied')}
  }
  useEffect(()=>{
    if(!open)return
    const onKey=e=>{if(e.key==='Escape')setOpen(false)}
    document.addEventListener('keydown',onKey)
    return ()=>document.removeEventListener('keydown',onKey)
  },[open])
  const total=counts.call+counts.sms+counts.email
  const chip={border:'1px solid #46516f',padding:'6px 9px',borderRadius:8,background:'#15172a',color:'#e2e8f0',cursor:'pointer',fontSize:12}
  return <div className="rl-comms-control" style={{position:'fixed',right:16,bottom:16,zIndex:10002,fontFamily:'Inter,Arial,sans-serif',color:'#e2e8f0'}}>
    <style>{`\n      .rl-comms-control .rl-comms-panel{position:fixed;right:16px;bottom:150px;width:min(92vw,370px);max-height:calc(100dvh - 164px);overflow-y:auto;overscroll-behavior:contain}\n      .rl-comms-control .rl-comms-alert{width:min(90vw,345px)}\n      .rl-comms-control .rl-comms-trigger{min-height:44px}\n      @media(max-width:640px){\n        .rl-comms-control{left:12px!important;right:auto!important;bottom:calc(76px + env(safe-area-inset-bottom,0px))!important}\n        .rl-comms-control .rl-comms-trigger{font-size:0!important;border-radius:50%!important;width:48px;height:48px;padding:0!important;display:flex;align-items:center;justify-content:center;gap:3px}\n        .rl-comms-control .rl-comms-trigger .rl-comms-trigger-label{font-size:19px}\n        .rl-comms-control .rl-comms-trigger .rl-comms-trigger-text{display:none}\n        .rl-comms-control .rl-comms-trigger .rl-comms-trigger-count{font-size:11px!important;margin-left:0!important;padding:2px 5px!important}\n        .rl-comms-control .rl-comms-trigger .rl-comms-trigger-error{font-size:13px!important;margin-left:0!important}\n        .rl-comms-control .rl-comms-panel{left:8px;right:8px;bottom:calc(138px + env(safe-area-inset-bottom,0px));width:auto;max-height:min(72dvh,calc(100dvh - 164px));border-radius:16px;padding:14px!important}\n        .rl-comms-control .rl-comms-alert{width:min(82vw,290px);max-height:140px;overflow:auto;margin-bottom:8px}\n      }\n      @media(max-height:420px){.rl-comms-control .rl-comms-panel{bottom:8px;max-height:calc(100dvh - 16px)}}\n    `}</style>
    {!open&&events.length>0&&events[0].key!==dismissed&&<div role="status" className="rl-comms-alert" style={{width:'min(90vw,345px)',background:'#17263b',border:'1px solid #6366f1',borderRadius:10,boxShadow:'0 9px 26px #0009',padding:10,marginBottom:8,display:'flex',gap:7,alignItems:'center'}}>
      <button onClick={()=>{navigate(ADMIN_ROUTES[events[0].kind]);setDismissed(events[0].key)}} style={{flex:1,minWidth:0,textAlign:'left',background:'transparent',border:0,color:'#fff',cursor:'pointer'}}>
        <strong style={{fontSize:12,display:'block'}}>{events[0].title}</strong>
        <span style={{display:'block',color:'#cbd5e1',fontSize:12,overflowWrap:'anywhere'}}>{events[0].detail}</span>
      </button>
      <button onClick={()=>setDismissed(events[0].key)} aria-label="Dismiss alert" style={{background:'none',border:0,color:'#cbd5e1',cursor:'pointer'}}>✕</button>
    </div>}
    {open&&<section className="rl-comms-panel" role="dialog" aria-modal="false" aria-label="RomyLabs communications notifications" style={{position:'fixed',right:16,bottom:150,width:'min(92vw,370px)',maxHeight:'calc(100dvh - 164px)',overflowY:'auto',background:'#0f1425',border:'1px solid #4f5f80',borderRadius:14,boxShadow:'0 18px 50px #0009',padding:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:12}}>
        <strong style={{fontSize:15}}>Communications Notifications</strong>
        <button style={chip} onClick={()=>setOpen(false)} aria-label="Close notifications">✕</button>
      </div>
      <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:14}}>
        <button style={chip} onClick={()=>{navigate(ADMIN_ROUTES.call);setOpen(false)}}>📞 Missed 24h: {counts.call}</button>
        <button style={chip} onClick={()=>{navigate(ADMIN_ROUTES.email);setOpen(false)}}>📧 Unread: {counts.email}</button>
        <button style={chip} onClick={()=>{navigate(ADMIN_ROUTES.sms);setOpen(false)}}>💬 Unread: {counts.sms}</button>
      </div>
      {permission!=='granted'&&<button style={{...chip,width:'100%',marginBottom:12}} onClick={enableDesktop}>
        {permission==='denied'?'Desktop alerts blocked — enable in browser settings':permission==='unsupported'?'Desktop notifications unsupported':'Enable Desktop Notifications'}
      </button>}
      {problems.length>0&&<div role="status" style={{fontSize:12,color:'#fecaca',padding:'8px 10px',border:'1px solid #963e47',borderRadius:8,marginBottom:9}}>Connection issue: {problems.join(' · ')}. Alerts will retry automatically.</div>}
      <div style={{maxHeight:255,overflowY:'auto',display:'grid',gap:6}}>
        {!events.length&&<p style={{fontSize:12,color:'#94a3b8'}}>New incoming communications will appear here. Existing unread messages are counted above.</p>}
        {events.map(e=><button key={e.key} onClick={()=>{navigate(ADMIN_ROUTES[e.kind]);setOpen(false)}} style={{textAlign:'left',padding:'9px 10px',background:'#1c263b',border:'1px solid #334155',borderRadius:8,color:'#e2e8f0',cursor:'pointer'}}>
          <strong style={{display:'block',fontSize:12}}>{e.title}</strong>
          <span style={{display:'block',fontSize:12,color:'#cbd5e1',overflowWrap:'anywhere'}}>{e.detail}</span>
        </button>)}
      </div>
      <p style={{fontSize:11,color:'#94a3b8',marginTop:12}}>Live call ringing and automatic inbox checks every 30 seconds while the portal is open. Browser alerts require permission.</p>
    </section>}
    <button type="button" className="rl-comms-trigger" aria-label={'Communications notifications'+(total?' ('+total+')':'')} aria-expanded={open}
      onClick={()=>setOpen(v=>!v)} style={{border:'1px solid #6366f1',boxShadow:'0 8px 25px #0009',borderRadius:999,padding:'11px 16px',background:'#202049',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>
      <span className="rl-comms-trigger-label">🔔</span><span className="rl-comms-trigger-text"> Calls · Email · SMS</span> {total>0&&<span className="rl-comms-trigger-count" style={{display:'inline-block',marginLeft:7,padding:'2px 7px',borderRadius:12,background:'#c6ff00',color:'#10210a'}}>{total>99?'99+':total}</span>}
      {problems.length>0&&<span className="rl-comms-trigger-error" style={{color:'#ffb4b4',marginLeft:7}}>!</span>}
    </button>
  </div>
}
