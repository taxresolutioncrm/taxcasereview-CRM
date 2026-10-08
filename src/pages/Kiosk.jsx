import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Kiosk(){
  const [now,setNow]=useState(new Date())
  const [logoUrl,setLogoUrl]=useState('')
  const [firmName,setFirmName]=useState('')
  const [resolvedTenant,setResolvedTenant]=useState('')
  const [params]=useSearchParams()
  const tenantHint=(params.get('t')||'').trim()

  const clockUrl=useMemo(
    ()=>`${window.location.origin}/clockin${resolvedTenant?`?t=${encodeURIComponent(resolvedTenant)}`:''}`,
    [resolvedTenant]
  )

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t)},[])

  useEffect(()=>{
    let cancelled=false
    ;(async()=>{
      let tenant=tenantHint
      if(!tenant){
        const { data:{ session }={} }=await supabase.auth.getSession()
        if(session){
          const { data:currentTenant }=await supabase.rpc('current_tenant_id')
          tenant=String(currentTenant||'').trim()
        }
      }
      if(cancelled)return
      setResolvedTenant(tenant)
      if(!tenant){ setFirmName('Employee'); setLogoUrl(''); return }

      const {data,error}=await supabase.rpc('booking_get_public_meta',{p_tenant:tenant})
      if(cancelled)return
      if(error||!data){ setFirmName('Employee'); setLogoUrl(''); return }

      setFirmName((data.firm_name||'Employee').trim())
      setLogoUrl(data.logo_url||'')
    })()
    return()=>{cancelled=true}
  },[tenantHint])

  useEffect(()=>{
    const el=document.getElementById('kiosk-qr-canvas')
    if(!el)return
    el.innerHTML=''
    const render=()=>{
      try{new window.QRCode(el,{text:clockUrl,width:200,height:200,colorDark:'#0a2540',colorLight:'#ffffff'})}
      catch{el.innerHTML='<div style="padding:80px 20px;color:#64748b">QR unavailable</div>'}
    }
    if(window.QRCode)render()
    else{
      const s=document.createElement('script')
      s.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
      s.onload=render
      document.head.appendChild(s)
      return()=>s.remove()
    }
  },[clockUrl])

  return <div style={{minHeight:'100vh',background:'linear-gradient(160deg,#071c30,#0a3f60)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,fontFamily:'system-ui'}}>
    <div style={{background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.12)',borderRadius:24,padding:'30px 34px',width:'100%',maxWidth:390,textAlign:'center',color:'#fff'}}>
      {logoUrl
        ? <img src={logoUrl} alt={firmName||'Firm'} style={{height:58,maxWidth:240,objectFit:'contain',background:'#fff',borderRadius:12,padding:'6px 14px',marginBottom:12}} onError={e=>{e.currentTarget.style.display='none'}}/>
        : null}
      <div style={{fontSize:19,fontWeight:800}}>{firmName||'Employee'} Time Clock</div>
      <div style={{fontSize:44,fontWeight:800,fontVariantNumeric:'tabular-nums',marginTop:16}}>{now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
      <div style={{fontSize:13,color:'rgba(255,255,255,.5)',marginBottom:20}}>{now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
      <div style={{background:'#fff',borderRadius:16,padding:14,display:'inline-block'}}>
        <div id="kiosk-qr-canvas" style={{minHeight:200,minWidth:200,display:'flex',alignItems:'center',justifyContent:'center'}}/>
        <div style={{fontSize:11,color:'#64748b',marginTop:8}}>Scan to open the secure PIN time clock</div>
      </div>
      <div style={{fontSize:11,color:'rgba(255,255,255,.45)',marginTop:14}}>🔒 Employee PIN required for every clock or time-off action.</div>
      <a href="/" style={{display:'inline-block',marginTop:16,color:'#bfdbfe',fontSize:13,textDecoration:'none'}}>← Back to CRM</a>
    </div>
  </div>
}
