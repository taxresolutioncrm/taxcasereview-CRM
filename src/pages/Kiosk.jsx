import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { FIRM } from '../lib/firmBranding'

const LOGO='/logo.png'
export default function Kiosk(){
 const[now,setNow]=useState(new Date()),[logoUrl,setLogoUrl]=useState(LOGO),[firmName,setFirmName]=useState(''),[params]=useSearchParams()
 const tenantHint=params.get('t')||''
 // When opened from inside a tenant CRM (for example CloudCPA), carry that
 // tenant into the public kiosk instead of falling back to TCR branding.
 const effectiveTenant=tenantHint||FIRM.tenantId||''
 const clockUrl=`${window.location.origin}/clockin${effectiveTenant?`?t=${encodeURIComponent(effectiveTenant)}`:''}`
 useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t)},[])
 useEffect(()=>{;(async()=>{const{data}=await supabase.rpc('booking_get_public_meta',effectiveTenant?{p_tenant:effectiveTenant}:{});if(data?.firm_name)setFirmName(data.firm_name);if(data?.logo_url)setLogoUrl(data.logo_url)})()},[effectiveTenant])
 useEffect(()=>{const el=document.getElementById('kiosk-qr-canvas');if(!el)return;el.innerHTML='';const render=()=>{try{new window.QRCode(el,{text:clockUrl,width:200,height:200,colorDark:'#0a2540',colorLight:'#ffffff'})}catch{el.innerHTML='<div style="padding:80px 20px;color:#64748b">QR unavailable</div>'}};if(window.QRCode)render();else{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';s.onload=render;document.head.appendChild(s);return()=>s.remove()}},[clockUrl])
 return <div style={{minHeight:'100vh',background:'linear-gradient(160deg,#071c30,#0a3f60)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,fontFamily:'system-ui'}}><div style={{background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.12)',borderRadius:24,padding:'36px 40px',width:'100%',maxWidth:420,textAlign:'center',color:'#fff'}}>
  <img src={logoUrl} alt={firmName||'Firm'} style={{height:64,maxWidth:260,objectFit:'contain',background:'#fff',borderRadius:12,padding:'6px 14px',marginBottom:14}} onError={e=>{e.currentTarget.src=LOGO}}/>
  <div style={{fontSize:20,fontWeight:800}}>{firmName||'Employee'} Time Clock</div><div style={{fontSize:48,fontWeight:800,fontVariantNumeric:'tabular-nums',marginTop:18}}>{now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div><div style={{fontSize:13,color:'rgba(255,255,255,.5)',marginBottom:22}}>{now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</div>
  <div style={{background:'#fff',borderRadius:16,padding:16,display:'inline-block'}}><div id="kiosk-qr-canvas" style={{minHeight:200,minWidth:200,display:'flex',alignItems:'center',justifyContent:'center'}}/><div style={{fontSize:11,color:'#64748b',marginTop:10}}>Scan to open the secure PIN time clock</div></div>
  <div style={{fontSize:11,color:'rgba(255,255,255,.45)',marginTop:16}}>🔒 Employee PIN required for every clock or time-off action.</div><a href="/" style={{display:'inline-block',marginTop:18,color:'#bfdbfe',fontSize:13,textDecoration:'none'}}>← Back to CRM</a>
 </div></div>
}
