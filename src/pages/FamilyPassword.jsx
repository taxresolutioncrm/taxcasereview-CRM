import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function FamilyPassword(){
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [showPassword,setShowPassword]=useState(false)
  const [showConfirm,setShowConfirm]=useState(false)
  const [ready,setReady]=useState(false)
  const [saving,setSaving]=useState(false)
  const [redeeming,setRedeeming]=useState(false)
  const [message,setMessage]=useState('Checking your secure TaxRes family link…')
  const [error,setError]=useState('')
  const [verifiedEmail,setVerifiedEmail]=useState('')
  const redeemedUserIdRef=useRef('')
  const params=new URLSearchParams(window.location.search)
  const office=params.get('office')||''
  const isNashville=office==='nashville'
  const isCenturion=office==='centurion' && window.location.hostname==='centurionfirm.taxrescrm.app'
  const returnUrl=isNashville?'https://nashville.taxrescrm.app/login?family=ready':'/login'
  const brandLogo=isNashville?'https://nashville.taxrescrm.app/nashville-logo.png':isCenturion?'/centurion-logo.svg':''

  useEffect(()=>{
    const p=new URLSearchParams(window.location.search)
    const tokenHash=p.get('token_hash')
    const code=p.get('code')
    if(!tokenHash&&!code){
      setMessage('')
      setError('This secure setup link is missing its employee authentication token.')
      return
    }
    // IMPORTANT: Do not redeem one-time Auth tokens during page load.
    // Enterprise email security scanners (including Microsoft Safe Links)
    // can open links before the employee does. Redemption only happens after
    // the human explicitly clicks Continue below.
    setMessage(isNashville
      ? 'Your secure Nashville Tax Solutions password link is ready. Click Continue to verify your identity.'
      : isCenturion ? 'Your secure Centurion Firm password link is ready. Click Continue to verify your identity.'
      : 'Your secure TaxRes CRM password link is ready. Click Continue to verify your identity.')
  },[isNashville,isCenturion])

  async function redeemLink(){
    setError('')
    setRedeeming(true)
    try{
      const p=new URLSearchParams(window.location.search)
      const tokenHash=p.get('token_hash')
      const type=p.get('type')||'recovery'
      const code=p.get('code')

      await supabase.auth.signOut({ scope:'local' }).catch(()=>{})

      let linkUser=null
      if(tokenHash){
        const {data,error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type})
        if(error) throw error
        linkUser=data?.user||data?.session?.user||null
      }else if(code){
        const {data,error}=await supabase.auth.exchangeCodeForSession(code)
        if(error) throw error
        linkUser=data?.user||data?.session?.user||null
      }else{
        throw new Error('This secure setup link is missing its employee authentication token.')
      }

      if(!linkUser?.id||!linkUser?.email){
        await supabase.auth.signOut({ scope:'local' }).catch(()=>{})
        throw new Error('This secure setup link could not establish the employee identity.')
      }

      const {data:verified,error:verifyUserError}=await supabase.auth.getUser()
      if(verifyUserError||!verified?.user?.id||verified.user.id!==linkUser.id){
        await supabase.auth.signOut({ scope:'local' }).catch(()=>{})
        throw new Error('Employee identity verification failed. Ask your administrator for a new link.')
      }

      redeemedUserIdRef.current=verified.user.id
      setVerifiedEmail(String(verified.user.email||'').toLowerCase())
      setReady(true)
      setMessage('')
      // Remove the one-time token from the visible address bar after successful
      // redemption so refreshes/scanners cannot try to reuse it.
      window.history.replaceState({},'',window.location.pathname+(isNashville?'?office=nashville':isCenturion?'?office=centurion':''))
    }catch(e){
      await supabase.auth.signOut({ scope:'local' }).catch(()=>{})
      redeemedUserIdRef.current=''
      setVerifiedEmail('')
      setReady(false)
      setMessage('')
      setError(e?.message||'Could not verify this setup link.')
    }finally{
      setRedeeming(false)
    }
  }

  async function save(e){
    e.preventDefault();setError('')
    if(password.length<10) return setError('Password must be at least 10 characters.')
    if(password!==confirm) return setError('Passwords do not match.')
    setSaving(true)
    // Re-check the active identity immediately before changing credentials.
    // A stale or replaced session can never update another employee's password.
    const {data:verified,error:identityError}=await supabase.auth.getUser()
    if(identityError||!verified?.user?.id||!redeemedUserIdRef.current||verified.user.id!==redeemedUserIdRef.current){
      setSaving(false);setReady(false)
      redeemedUserIdRef.current='';setVerifiedEmail('')
      await supabase.auth.signOut({ scope:'local' }).catch(()=>{})
      return setError('The active employee identity no longer matches this reset link. Request a new password link.')
    }
    const {error}=await supabase.auth.updateUser({password})
    if(error){setSaving(false);setError(error.message);return}
    await supabase.auth.signOut({ scope:'local' })
    redeemedUserIdRef.current='';setVerifiedEmail('')
    setReady(false);setSaving(false)
    setMessage(isNashville?'Your password is ready. Redirecting to Nashville Tax Solutions CRM…':isCenturion?'Your Centurion Firm password is ready. Redirecting to login…':'Your TaxRes family password is ready. Redirecting to your CRM…')
    setTimeout(()=>{window.location.href=returnUrl},900)
  }

  return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#06101d',padding:20,fontFamily:'Inter,system-ui,sans-serif'}}>
    <div style={{width:'100%',maxWidth:430,background:'#fff',borderRadius:18,padding:'30px',boxShadow:'0 24px 70px rgba(0,0,0,.4)'}}>
      {(isNashville||isCenturion)&&<div style={{textAlign:'center',marginBottom:18}}><img src={brandLogo} alt={isCenturion?'Centurion Firm':'Nashville Tax Solutions'} style={{maxWidth:240,maxHeight:80,objectFit:'contain'}}/></div>}
      <div style={{textAlign:'center',fontSize:22,fontWeight:800,color:'#0f172a',marginBottom:7}}>{isNashville?'Set Up Your Nashville Tax Solutions CRM Password':isCenturion?'Set Up Your Centurion Firm Password':'Set Up Your TaxRes CRM Password'}</div>
      <div style={{textAlign:'center',fontSize:13,color:'#64748b',lineHeight:1.6,marginBottom:24}}>{isNashville?'Secure access to Nashville Tax Solutions CRM, powered by TaxResCRM.':isCenturion?'Secure access to Centurion Firm CRM. Your account belongs to Centurion only.':'One secure password for the TaxRes CRM family. Office access remains separate and permission-based.'}</div>
      {message&&<div style={{fontSize:13,color:'#475569',lineHeight:1.6,textAlign:'center'}}>{message}</div>}
      {error&&<div style={{background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:8,padding:'10px 12px',fontSize:12,lineHeight:1.5,marginBottom:16}}>{error}</div>}
      {!ready&&!error&&message&&<button type="button" onClick={redeemLink} disabled={redeeming} style={{width:'100%',marginTop:16,marginBottom:20,padding:'12px 14px',border:0,borderRadius:8,background:'#1A7FD4',color:'#fff',fontWeight:800,cursor:'pointer',opacity:redeeming?.7:1}}>{redeeming?'Verifying…':isNashville?'Continue to Nashville CRM Password Setup':isCenturion?'Continue to Centurion Password Setup':'Continue to Password Setup'}</button>}
      {ready&&verifiedEmail&&<div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:10,padding:'11px 12px',marginBottom:16,textAlign:'center'}}>
        <div style={{fontSize:10,fontWeight:800,color:'#1d4ed8',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{isNashville?'Verified Nashville CRM Identity':isCenturion?'Verified Centurion Identity':'Verified TaxRes Identity'}</div>
        <div style={{fontSize:13,fontWeight:800,color:'#0f172a'}}>{verifiedEmail}</div>
        <div style={{fontSize:11,color:'#64748b',marginTop:4,lineHeight:1.45}}>{isNashville?'This password change applies to the verified Nashville Tax Solutions CRM account shown above.':isCenturion?'This password change applies only to the verified Centurion Firm account shown above.':'This password change applies only to the verified TaxRes account shown above. Your Chrome/Google browser profile does not control this identity.'}</div>
      </div>}
      {ready&&<form onSubmit={save}>
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6,textTransform:'uppercase'}}>New Password</label>
        <div style={{position:'relative',marginBottom:14}}>
          <input type={showPassword?'text':'password'} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:'11px 44px 11px 12px',borderRadius:8,border:'1px solid #cbd5e1'}}/>
          <button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide new password':'Show new password'} aria-pressed={showPassword} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',width:32,height:32,border:0,borderRadius:7,background:'transparent',color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{showPassword?(
            <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.6 10.6 0 0 1 12 4c5.5 0 9.5 5 9.5 5a15.8 15.8 0 0 1-3.1 3.7"/><path d="M6.2 6.2C4 7.7 2.5 10 2.5 10S6.5 16 12 16c1 0 2-.2 2.9-.5"/></svg>
          ):(
            <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6.5 6 12 6s9.5 6 9.5 6-4 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>
          )}</button>
        </div>
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'#64748b',marginBottom:6,textTransform:'uppercase'}}>Confirm Password</label>
        <div style={{position:'relative',marginBottom:18}}>
          <input type={showConfirm?'text':'password'} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:'11px 44px 11px 12px',borderRadius:8,border:'1px solid #cbd5e1'}}/>
          <button type="button" onClick={()=>setShowConfirm(v=>!v)} aria-label={showConfirm?'Hide confirmation password':'Show confirmation password'} aria-pressed={showConfirm} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',width:32,height:32,border:0,borderRadius:7,background:'transparent',color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{showConfirm?(
            <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.6 10.6 0 0 1 12 4c5.5 0 9.5 5 9.5 5a15.8 15.8 0 0 1-3.1 3.7"/><path d="M6.2 6.2C4 7.7 2.5 10 2.5 10S6.5 16 12 16c1 0 2-.2 2.9-.5"/></svg>
          ):(
            <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6.5 6 12 6s9.5 6 9.5 6-4 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>
          )}</button>
        </div>
        <button type="submit" disabled={saving} style={{width:'100%',padding:'12px 14px',border:0,borderRadius:8,background:'#1A7FD4',color:'#fff',fontWeight:800,cursor:'pointer',opacity:saving?.7:1}}>{saving?'Saving…':isNashville?'Create Nashville CRM Password':isCenturion?'Create Centurion Password':'Create TaxRes Family Password'}</button>
      </form>}
    </div>
  </div>
}
