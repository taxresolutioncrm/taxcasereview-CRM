import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCall } from '../context/CallContext'

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
        call:phone?phone.calls.filter(c=>c.direction==='Inbound'&&c.status==='missed'&&timeOf(c.created_at)>Date.now()-24*3600*1000).length:old.call,
        sms:sms?sms.messages.filter(m=>m.direction==='inbound'&&!m.read).length:old.sms,
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
  const total=counts.call+counts.sms+counts.email
  const chip={border:'1px solid #46516f',padding:'6px 9px',borderRadius:8,background:'#15172a',color:'#e2e8f0',cursor:'pointer',fontSize:12}
  return <div style={{position:'fixed',right:16,bottom:16,zIndex:9400,fontFamily:'Inter,Arial,sans-serif',color:'#e2e8f0'}}>
    {open&&<section aria-label="RomyLabs communications notifications" style={{width:'min(92vw,370px)',background:'#0f1425',border:'1px solid #4f5f80',borderRadius:14,boxShadow:'0 18px 50px #0009',padding:16,marginBottom:10}}>
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
    <button type="button" aria-label={'Communications notifications'+(total?' ('+total+')':'')} aria-expanded={open}
      onClick={()=>setOpen(v=>!v)} style={{border:'1px solid #6366f1',boxShadow:'0 8px 25px #0009',borderRadius:999,padding:'11px 16px',background:'#202049',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>
      🔔 Calls · Email · SMS {total>0&&<span style={{display:'inline-block',marginLeft:7,padding:'2px 7px',borderRadius:12,background:'#c6ff00',color:'#10210a'}}>{total>99?'99+':total}</span>}
      {problems.length>0&&<span style={{color:'#ffb4b4',marginLeft:7}}>!</span>}
    </button>
  </div>
}
