import { useEffect,useMemo,useRef,useState } from 'react'
import { useParams } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { supabase } from '../lib/supabase'

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker

const autoInitials=name=>String(name||'').split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,4).toUpperCase()
const today=()=>new Date().toLocaleDateString('en-US',{timeZone:'America/New_York'})

export default function OfficeDocumentSign(){
  const {token}=useParams()
  const [doc,setDoc]=useState(null)
  const [pdf,setPdf]=useState(null)
  const [page,setPage]=useState(1)
  const [values,setValues]=useState({})
  const [signature,setSignature]=useState('')
  const [consent,setConsent]=useState(false)
  const [loading,setLoading]=useState(true)
  const [working,setWorking]=useState(false)
  const [error,setError]=useState('')
  const [done,setDone]=useState(false)
  const [declined,setDeclined]=useState(false)
  const canvasRef=useRef(null)

  async function load(){
    setLoading(true);setError('')
    const {data,error:e}=await supabase.functions.invoke('office-agreement-file',{body:{action:'esign_load',token}})
    if(e||!data?.ok){setError(e?.message||data?.error||'Could not open signing request');setLoading(false);return}
    setDoc(data.document)
    setDone(data.document.status==='signed')
    setDeclined(data.document.status==='declined')
    const auto={}
    for(const f of(data.document.fields||[])){
      if(f.type==='date')auto[f.id]=today()
      if(f.type==='name')auto[f.id]=data.document.signer_name||''
      if(f.type==='initials')auto[f.id]=autoInitials(data.document.signer_name||'')
    }
    setValues(v=>({...auto,...v}))
    try{
      const bytes=new Uint8Array(await (await fetch(data.document.file_url)).arrayBuffer())
      const p=await pdfjsLib.getDocument({data:bytes}).promise
      setPdf(p)
    }catch(err){setError('Could not render document: '+(err.message||String(err)))}
    setLoading(false)
  }
  useEffect(()=>{load()},[token])

  useEffect(()=>{
    let cancelled=false
    async function render(){
      if(!pdf||!canvasRef.current)return
      const p=await pdf.getPage(page)
      const viewport=p.getViewport({scale:1.25})
      const canvas=canvasRef.current;const ctx=canvas.getContext('2d')
      canvas.width=viewport.width;canvas.height=viewport.height
      canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`
      if(!cancelled)await p.render({canvasContext:ctx,viewport}).promise
    }
    render().catch(e=>setError(e.message||String(e)))
    return()=>{cancelled=true}
  },[pdf,page])

  function setField(id,value){setValues(v=>({...v,[id]:value}))}
  function adoptSignature(){
    const suggested=signature||doc?.signer_name||''
    const name=window.prompt('Type your full legal name to adopt as your electronic signature:',suggested)
    if(name===null)return
    const trimmed=name.trim();if(!trimmed)return
    setSignature(trimmed)
    const next={...values}
    for(const f of(doc?.fields||[])){
      if(f.type==='signature')next[f.id]=trimmed
      if(f.type==='initials'&&!next[f.id])next[f.id]=autoInitials(trimmed)
      if(f.type==='name'&&!next[f.id])next[f.id]=trimmed
    }
    setValues(next)
  }

  async function decline(){
    const reason=window.prompt('Please tell the sender why you are declining to sign this document:')
    if(reason===null)return
    if(!reason.trim()){setError('A reason is required to decline this document.');return}
    if(!window.confirm('Decline this document? The sender will be notified and this signing request will stop.'))return
    setWorking(true);setError('')
    const {data,error:e}=await supabase.functions.invoke('office-agreement-file',{body:{action:'esign_decline',token,reason:reason.trim()}})
    setWorking(false)
    if(e||!data?.ok){setError(e?.message||data?.error||'Could not decline document');return}
    setDeclined(true);await load()
  }

  async function finish(){
    const fields=doc?.fields||[]
    if(!consent){setError('You must consent to electronic records and signatures before finishing.');return}
    let sig=signature
    if(!sig){adoptSignature();setError('Adopt your signature, then click Finish & Sign again.');return}
    for(const f of fields){
      if(f.required!==false&&!String(values[f.id]??'').trim()&&!['date','signature','name','initials'].includes(f.type)){setError(`Complete required field: ${f.label||f.type}`);setPage(f.page||1);return}
    }
    if(!window.confirm('Finish signing this document? Your electronic signature will be applied to the contract.'))return
    setWorking(true);setError('')
    const {data,error:e}=await supabase.functions.invoke('office-agreement-file',{body:{action:'esign_sign',token,signature_name:sig,values,consent:true}})
    setWorking(false)
    if(e||!data?.ok){setError(e?.message||data?.error||'Could not complete signature');return}
    setDone(true);await load()
  }

  const pageFields=useMemo(()=>doc?.fields?.filter(f=>(f.page||1)===page)||[],[doc,page])
  if(loading)return <Shell><div style={notice}>Loading secure document…</div></Shell>
  if(error&&!doc)return <Shell><div style={{...notice,color:'#b91c1c'}}>{error}</div></Shell>

  return <Shell>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',marginBottom:16,flexWrap:'wrap'}}>
      <div><div style={{fontSize:12,fontWeight:900,color:'#4f46e5',textTransform:'uppercase',letterSpacing:'.08em'}}>Secure E-Signature</div><h1 style={{fontSize:22,margin:'5px 0 4px',color:'#0f172a'}}>{doc?.title}</h1><div style={{fontSize:13,color:'#64748b'}}>{doc?.firm_name} · Sent to {doc?.signer_email}</div></div>
      {done?<span style={{padding:'7px 11px',borderRadius:999,background:'#dcfce7',color:'#166534',fontSize:12,fontWeight:900}}>✓ Signed</span>:declined?<span style={{padding:'7px 11px',borderRadius:999,background:'#fee2e2',color:'#991b1b',fontSize:12,fontWeight:900}}>Declined</span>:<button onClick={adoptSignature} style={primaryBtn}>{signature?'Change Signature':'Adopt Signature'}</button>}
    </div>

    {done&&<div style={{padding:'12px 14px',borderRadius:9,background:'#ecfdf5',border:'1px solid #a7f3d0',color:'#065f46',fontSize:13,fontWeight:700,marginBottom:14}}>Completed. Your signed contract is locked, stored with the office record, and a completion certificate has been generated.</div>}
    {declined&&<div style={{padding:'12px 14px',borderRadius:9,background:'#fef2f2',border:'1px solid #fecaca',color:'#991b1b',fontSize:13,fontWeight:700,marginBottom:14}}>You declined this agreement. The sender can see your decline reason and audit record.</div>}
    {error&&<div style={{padding:'10px 12px',borderRadius:8,background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',fontSize:12,marginBottom:12}}>{error}</div>}

    {pdf&&<>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,color:'#64748b',fontSize:12}}><span>{done?'Signed contract':'Review every page and complete the highlighted fields.'}</span><span><button disabled={page<=1} onClick={()=>setPage(p=>p-1)} style={navBtn}>←</button> Page {page} of {pdf.numPages} <button disabled={page>=pdf.numPages} onClick={()=>setPage(p=>p+1)} style={navBtn}>→</button></span></div>
      <div style={{overflow:'auto',border:'1px solid #cbd5e1',borderRadius:10,background:'#e2e8f0',padding:12,textAlign:'center'}}>
        <div style={{position:'relative',display:'inline-block',background:'#fff',boxShadow:'0 8px 28px rgba(15,23,42,.12)',textAlign:'left'}}>
          <canvas ref={canvasRef} style={{display:'block'}}/>
          {!done&&!declined&&pageFields.map(f=><Field key={f.id} f={f} value={values[f.id]||''} signature={signature} signerName={doc?.signer_name||''} onChange={v=>setField(f.id,v)} onSign={adoptSignature}/>) }
        </div>
      </div>
    </>}

    {!done&&!declined&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginTop:16,flexWrap:'wrap'}}><label style={{fontSize:11,color:'#475569',display:'flex',gap:8,alignItems:'flex-start',maxWidth:650}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{marginTop:2}}/><span>I agree to use electronic records and signatures and intend the signature I adopt above to be legally binding for this document.</span></label><div style={{display:'flex',gap:8,alignItems:'center'}}><button disabled={working} onClick={decline} style={{...primaryBtn,background:'#fff',color:'#b91c1c',border:'1px solid #fecaca'}}>Decline to Sign</button><button disabled={working||!consent} onClick={finish} style={{...primaryBtn,background:'#059669',opacity:(working||!consent)?0.55:1}}>{working?'Applying Signature…':'Finish & Sign'}</button></div></div>}
  </Shell>
}

function Field({f,value,signature,signerName,onChange,onSign}){
  const base={position:'absolute',left:`${f.x*100}%`,top:`${f.y*100}%`,width:`${f.w*100}%`,height:`${f.h*100}%`,boxSizing:'border-box',border:'2px solid #4f46e5',background:'rgba(238,242,255,.94)',borderRadius:4,zIndex:3,minHeight:24}
  if(f.type==='signature')return <button onClick={onSign} style={{...base,fontFamily:'Georgia,serif',fontStyle:'italic',fontSize:14,color:'#312e81',cursor:'pointer',overflow:'hidden'}}>{signature||'Click to Sign'}</button>
  if(f.type==='date')return <div style={{...base,padding:'5px 7px',fontSize:11,color:'#1e293b',display:'flex',alignItems:'center'}}>{value||today()}</div>
  if(f.type==='name')return <input value={value||signerName} onChange={e=>onChange(e.target.value)} style={{...base,padding:'4px 6px',fontSize:11,color:'#1e293b'}}/>
  if(f.type==='initials')return <input value={value} onChange={e=>onChange(e.target.value)} placeholder="Initials" style={{...base,padding:'4px 6px',fontSize:11,color:'#1e293b'}}/>
  return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={f.label||f.type} style={{...base,padding:'4px 6px',fontSize:11,color:'#1e293b'}}/>
}

function Shell({children}){return <div style={{minHeight:'100vh',background:'#f8fafc',padding:'28px 16px',fontFamily:'Inter,Arial,sans-serif'}}><main style={{maxWidth:980,margin:'0 auto',background:'#fff',border:'1px solid #e2e8f0',borderRadius:14,padding:22,boxShadow:'0 10px 35px rgba(15,23,42,.06)'}}>{children}</main></div>}
const primaryBtn={padding:'10px 15px',borderRadius:8,border:'none',background:'#4f46e5',color:'#fff',fontWeight:900,fontSize:12,cursor:'pointer'}
const navBtn={padding:'4px 8px',borderRadius:6,border:'1px solid #cbd5e1',background:'#fff',color:'#475569',fontSize:11,cursor:'pointer'}
const notice={padding:30,textAlign:'center',fontSize:14,color:'#64748b'}
