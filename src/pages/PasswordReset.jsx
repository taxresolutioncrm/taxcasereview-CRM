import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function PasswordReset() {
  const [ready,setReady]=useState(false)
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')

  useEffect(()=>{
    let cancelled=false
    const check=async()=>{
      const { data }=await supabase.auth.getSession()
      if(!cancelled)setReady(!!data?.session?.user)
    }
    check()
    const { data:listener }=supabase.auth.onAuthStateChange((event,session)=>{
      if(cancelled)return
      if(event==='PASSWORD_RECOVERY' || session?.user)setReady(true)
    })
    return()=>{cancelled=true;listener.subscription.unsubscribe()}
  },[])

  async function save(e){
    e.preventDefault()
    setError('');setSuccess('')
    if(password.length<8){setError('Use at least 8 characters.');return}
    if(password!==confirm){setError('Passwords do not match.');return}
    setSaving(true)
    try{
      const { error }=await supabase.auth.updateUser({password})
      if(error)throw error
      setSuccess('Password updated. You can now sign in.')
      setPassword('');setConfirm('')
      setTimeout(async()=>{try{await supabase.auth.signOut()}catch(_){};window.location.href='/login'},1200)
    }catch(err){setError(err?.message||'Could not update password.')}
    finally{setSaving(false)}
  }

  return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#060F1C',padding:20,fontFamily:'-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif'}}>
    <div style={{width:'100%',maxWidth:430,background:'#fff',borderRadius:18,padding:'34px 36px',boxShadow:'0 28px 70px rgba(0,0,0,.45)'}}>
      <img src="/taxrescrm-logo.png" alt="TaxRes CRM" style={{height:42,maxWidth:210,objectFit:'contain',marginBottom:24}}/>
      <div style={{fontSize:22,fontWeight:800,color:'#0A1929',marginBottom:6}}>Set your password</div>
      <div style={{fontSize:13,color:'#64748B',lineHeight:1.55,marginBottom:22}}>Create the password you’ll use to access your office securely.</div>
      {!ready && <div style={{background:'#FFF7ED',border:'1px solid #FED7AA',color:'#9A3412',borderRadius:9,padding:'10px 12px',fontSize:12,lineHeight:1.5,marginBottom:16}}>Open this page from the password-reset link in your email. If the link expired, return to the login page and request another.</div>}
      {error && <div style={{background:'#FEF2F2',border:'1px solid #FECACA',color:'#B91C1C',borderRadius:9,padding:'10px 12px',fontSize:12,marginBottom:16}}>{error}</div>}
      {success && <div style={{background:'#ECFDF5',border:'1px solid #A7F3D0',color:'#047857',borderRadius:9,padding:'10px 12px',fontSize:12,marginBottom:16}}>{success}</div>}
      <form onSubmit={save}>
        <label style={{display:'block',fontSize:12,fontWeight:700,color:'#334155',marginBottom:5}}>New password</label>
        <input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={!ready||saving} style={{width:'100%',boxSizing:'border-box',padding:'11px 13px',border:'1.5px solid #E2E8F0',borderRadius:9,fontSize:14,marginBottom:14}}/>
        <label style={{display:'block',fontSize:12,fontWeight:700,color:'#334155',marginBottom:5}}>Confirm password</label>
        <input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={!ready||saving} style={{width:'100%',boxSizing:'border-box',padding:'11px 13px',border:'1.5px solid #E2E8F0',borderRadius:9,fontSize:14,marginBottom:18}}/>
        <button type="submit" disabled={!ready||saving} style={{width:'100%',border:0,borderRadius:9,padding:'12px 14px',fontSize:14,fontWeight:800,background:'#1A7FD4',color:'#fff',cursor:!ready||saving?'not-allowed':'pointer',opacity:!ready||saving?.65:1}}>{saving?'Saving…':'Save password'}</button>
      </form>
      <button type="button" onClick={()=>window.location.href='/login'} style={{width:'100%',border:0,background:'transparent',color:'#64748B',fontSize:12,fontWeight:700,marginTop:14,cursor:'pointer'}}>Back to sign in</button>
    </div>
  </div>
}
