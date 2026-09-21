import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function FamilyPassword(){
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [showPassword,setShowPassword]=useState(false)
  const [showConfirm,setShowConfirm]=useState(false)
  const [ready,setReady]=useState(false)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState('Checking your secure TaxRes family link…')
  const [error,setError]=useState('')
  const params=new URLSearchParams(window.location.search)
  const office=params.get('office')||''
  const returnUrl=office==='nashville'?'https://nashville.taxrescrm.app/login?family=ready':'/login'

  useEffect(()=>{
    let mounted=true
    ;(async()=>{
      try{
        const p=new URLSearchParams(window.location.search)
        const tokenHash=p.get('token_hash')
        const type=p.get('type')||'recovery'
        const code=p.get('code')
        if(tokenHash){
          const {error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type})
          if(error) throw error
        }else if(code){
          const {error}=await supabase.auth.exchangeCodeForSession(code)
          if(error) throw error
        }
        const {data}=await supabase.auth.getSession()
        if(!mounted) return
        if(!data?.session){
          setMessage('')
          setError('This TaxRes family setup link is invalid or expired. Ask your administrator to send a new invite.')
          return
        }
        setReady(true);setMessage('')
      }catch(e){
        if(!mounted) return
        setMessage('');setError(e?.message||'Could not verify this setup link.')
      }
    })()
    return()=>{mounted=false}
  },[])

  async function save(e){
    e.preventDefault();setError('')
    if(password.length<10) return setError('Password must be at least 10 characters.')
    if(password!==confirm) return setError('Passwords do not match.')
    setSaving(true)
    const {error}=await supabase.auth.updateUser({password})
    if(error){setSaving(false);setError(error.message);return}
    await supabase.auth.signOut()
    setReady(false);setSaving(false)
    setMessage('Your TaxRes family password is ready. Redirecting to your CRM…')
    setTimeout(()=>{window.location.href=returnUrl},900)
  }

  return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#06101d',padding:20,fontFamily:'Inter,system-ui,sans-serif'}}>
    <div style={{width:'100%',maxWidth:430,background:'#fff',borderRadius:18,padding:'30px',boxShadow:'0 24px 70px rgba(0,0,0,.4)'}}>
      <div style={{textAlign:'center',fontSize:22,fontWeight:800,color:'#0f172a',marginBottom:7}}>Set Up Your TaxRes CRM Password</div>
      <div style={{textAlign:'center',fontSize:13,color:'#64748b',lineHeight:1.6,marginBottom:24}}>One secure password for the TaxRes CRM family. Office access remains separate and permission-based.</div>
      {message&&<div style={{fontSize:13,color:'#475569',lineHeight:1.6,textAlign:'center'}}>{message}</div>}
      {error&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:8,padding:'10px 12px',fontSize:12,lineHeight:1.5,marginBottom:16}}>{error}</div>}
      {ready&&<form onSubmit={save}>
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6,textTransform:'uppercase'}}>New Password</label>
        <div style={{position:'relative',marginBottom:14}}>
          <input type={showPassword?'text':'password'} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:'11px 44px 11px 12px',borderRadius:8,border:'1px solid #cbd5e1'}}/>
          <button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide new password':'Show new password'} aria-pressed={showPassword} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',width:32,height:32,border:0,borderRadius:7,background:'transparent',color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{showPassword?'◉':'◎'}</button>
        </div>
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6,textTransform:'uppercase'}}>Confirm Password</label>
        <div style={{position:'relative',marginBottom:18}}>
          <input type={showConfirm?'text':'password'} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:'11px 44px 11px 12px',borderRadius:8,border:'1px solid #cbd5e1'}}/>
          <button type="button" onClick={()=>setShowConfirm(v=>!v)} aria-label={showConfirm?'Hide confirmation password':'Show confirmation password'} aria-pressed={showConfirm} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',width:32,height:32,border:0,borderRadius:7,background:'transparent',color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{showConfirm?'◉':'◎'}</button>
        </div>
        <button type="submit" disabled={saving} style={{width:'100%',padding:'12px 14px',border:0,borderRadius:8,background:'#1A7FD4',color:'#fff',fontWeight:800,cursor:'pointer',opacity:saving?.7:1}}>{saving?'Saving…':'Create TaxRes Family Password'}</button>
      </form>}
    </div>
  </div>
}
