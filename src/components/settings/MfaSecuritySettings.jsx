import {useEffect,useState} from 'react'
import {supabase} from '../../lib/supabase'

// Authenticator keys are presented only in the user's own authenticated browser.
// Never store QR, secret or TOTP codes in the CRM database, app logs or localStorage.
export default function MfaSecuritySettings({standalone=false}){
 const [factors,setFactors]=useState([])
 const [assurance,setAssurance]=useState(null)
 const [setup,setSetup]=useState(null)
 const [code,setCode]=useState('')
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 async function reload(){
   const [f,a]=await Promise.all([supabase.auth.mfa.listFactors(),supabase.auth.mfa.getAuthenticatorAssuranceLevel()])
   if(f.error)throw f.error
   if(a.error)throw a.error
   setFactors((f.data?.totp||[]).filter(x=>x.status==='verified'))
   setAssurance(a.data)
 }
 useEffect(()=>{let live=true;(async()=>{try{await reload()}catch(e){if(live)setError(e.message||'Could not load MFA')}finally{if(live)setLoading(false)}})();return()=>{live=false}},[])
 async function start(){
   setError('');setMessage('');setBusy(true)
   try{
     const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'TaxRes CRM Authenticator'})
     if(error)throw error
     if(!data?.id||!data?.totp?.qr_code)throw new Error('Authenticator setup is unavailable.')
     setSetup({id:data.id,qr:data.totp.qr_code,secret:data.totp.secret||''})
     setCode('')
   }catch(e){setError(e.message||'Could not start authenticator setup')}
   finally{setBusy(false)}
 }
 async function verify(){
   if(!setup?.id||!/^\d{6}$/.test(code)){setError('Enter the six-digit code from your authenticator.');return}
   setBusy(true);setError('')
   try{
     const {error}=await supabase.auth.mfa.challengeAndVerify({factorId:setup.id,code})
     if(error)throw error
     setCode('');setSetup(null);await reload()
     setMessage('Authenticator enabled. Future logins require its verification code.')
   }catch(e){setError(e.message||'Code could not be verified')}
   finally{setBusy(false)}
 }
 async function cancelSetup(){
   const id=setup?.id
   setSetup(null);setCode('');setError('')
   if(id)await supabase.auth.mfa.unenroll({factorId:id}).catch(()=>{})
 }
 async function removeFactor(id){
   if(!window.confirm('Remove this authenticator? Your account will lose MFA protection unless another verified factor remains.'))return
   setBusy(true);setError('')
   try{
     const {data,error}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
     if(error)throw error
     if(data?.currentLevel!=='aal2')throw new Error('Verify your authenticator in a new sign-in before removing it.')
     const res=await supabase.auth.mfa.unenroll({factorId:id})
     if(res.error)throw res.error
     await supabase.auth.refreshSession()
     await reload()
     setMessage('Authenticator removed.')
   }catch(e){setError(e.message||'Could not remove authenticator')}
   finally{setBusy(false)}
 }
 return <div className="card" style={{padding:20,maxWidth:640}}>
   <h3 style={{margin:'0 0 8px'}}>Authenticator app (MFA)</h3>
   <p style={{fontSize:13,color:'var(--t2)',lineHeight:1.6}}>Protect your tax records with a second factor from an authenticator app. Once enabled, every new password login requires the six-digit code. Keep a second enrolled device as backup.</p>
   {loading?<p>Checking MFA status…</p>:<p style={{fontSize:13,fontWeight:600}}>Status: {factors.length?'Enabled on '+factors.length+' authenticator'+(factors.length===1?'':'s'):'Not yet enabled'}{assurance?.currentLevel==='aal2'?' · This session is verified':''}</p>}
   {error&&<p role="alert" style={{color:'#b91c1c',fontSize:13}}>{error}</p>}
   {message&&<p role="status" style={{color:'var(--ok)',fontSize:13}}>{message}</p>}
   {factors.map(f=><div key={f.id} style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--br)'}}>
     <span style={{fontSize:13}}>{f.friendly_name||'Authenticator'} · Verified</span>
     <button type="button" className="btn" disabled={busy} onClick={()=>removeFactor(f.id)}>Remove</button>
   </div>)}
   {setup?<div style={{marginTop:16}}>
     <p style={{fontSize:13}}>Scan this QR code in your authenticator app. If you cannot scan, enter the secret manually. Never share it.</p>
     <img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(setup.qr)} alt="Authenticator setup QR code" style={{width:190,height:190,maxWidth:'100%',background:'#fff',padding:10}}/>
     {setup.secret&&<div style={{fontSize:12,margin:'10px 0',overflowWrap:'anywhere'}}>Manual setup key: <strong>{setup.secret}</strong></div>}
     <label style={{display:'block',fontSize:13,marginTop:10}}>Six-digit verification code</label>
     <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} style={{maxWidth:180,display:'block',margin:'8px 0',padding:9}}/>
     <div style={{display:'flex',gap:8}}><button type="button" className="btn pri" disabled={busy||code.length!==6} onClick={verify}>Verify and enable</button><button type="button" className="btn" disabled={busy} onClick={cancelSetup}>Cancel</button></div>
   </div>:<button type="button" className="btn pri" disabled={busy||loading} onClick={start} style={{marginTop:10}}>Add authenticator</button>}
   {standalone&&<p style={{marginTop:16,fontSize:13}}><a href="/login">Back to sign in</a></p>}
 </div>
}
