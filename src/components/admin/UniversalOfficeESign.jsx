import React,{useEffect,useMemo,useRef,useState} from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker

const BRAND={
  taxres_crm:{name:'TaxRes CRM',email:'romy@taxrescrm.net'},camvella:{name:'Camvella',email:'romy@camvella.com'},
  arcvena:{name:'Arcvena',email:'romy@arcvena.com'},bocasync:{name:'BocaSync',email:'romy@bocasync.com'},
  groundivo:{name:'Groundivo',email:'info@romylabs.com'},oculivo:{name:'Oculivo',email:'info@romylabs.com'},
  restore_relay:{name:'Restore Relay',email:'info@romylabs.com'},
  romylabs:{name:'RomyLabs',email:'info@romylabs.com'},
}
const STATUS={draft:'#64748b',sent:'#6366f1',viewed:'#0ea5e9',signed:'#10b981',declined:'#ef4444',expired:'#f59e0b',void:'#475569'}
const FIELD_META={
  signature:{label:'Signature',w:.28,h:.055},initials:{label:'Initials',w:.13,h:.05},date:{label:'Date Signed',w:.18,h:.045},
  name:{label:'Full Name',w:.24,h:.045},title:{label:'Title',w:.2,h:.045},text:{label:'Text',w:.24,h:.045},
}
const dt=v=>v?new Date(v).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'—'
const clean=v=>String(v||'document.pdf').replace(/[^a-zA-Z0-9._-]/g,'_')

export default function UniversalOfficeESign({supabase,productKey,externalOfficeId,firmName,contactName='',contactEmail='',contactPhone=''}){
  const brand=BRAND[productKey]||BRAND.romylabs
  const [docs,setDocs]=useState([])
  const [file,setFile]=useState(null)
  const [pdf,setPdf]=useState(null)
  const [page,setPage]=useState(1)
  const [size,setSize]=useState({w:0,h:0})
  const [tool,setTool]=useState('signature')
  const [fields,setFields]=useState([])
  const [title,setTitle]=useState('')
  const [signer,setSigner]=useState({name:contactName||'',email:contactEmail||'',phone:contactPhone||''})
  const [working,setWorking]=useState(false)
  const [loading,setLoading]=useState(true)
  const [msg,setMsg]=useState('')
  const [error,setError]=useState('')
  const canvasRef=useRef(null)

  async function load(){
    if(!productKey||!externalOfficeId)return
    setLoading(true);setError('')
    const {data,error:e}=await supabase.rpc('admin_romylabs_office_signing_documents',{p_product_key:productKey,p_external_office_id:String(externalOfficeId)})
    if(e){setError(e.message);setDocs([])}else setDocs(Array.isArray(data)?data:[])
    setLoading(false)
  }
  useEffect(()=>{load()},[productKey,externalOfficeId])

  useEffect(()=>{
    let cancelled=false
    async function render(){
      if(!pdf||!canvasRef.current)return
      const p=await pdf.getPage(page)
      const viewport=p.getViewport({scale:1.25})
      const canvas=canvasRef.current
      const ctx=canvas.getContext('2d')
      canvas.width=viewport.width;canvas.height=viewport.height
      canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`
      if(!cancelled){setSize({w:viewport.width,h:viewport.height});await p.render({canvasContext:ctx,viewport}).promise}
    }
    render().catch(e=>setError(e.message||String(e)))
    return()=>{cancelled=true}
  },[pdf,page])

  async function chooseFile(e){
    const f=e.target.files?.[0]
    if(!f)return
    setError('');setMsg('')
    if(f.type!=='application/pdf'&&!f.name.toLowerCase().endsWith('.pdf')){setError('Upload a PDF contract. Word files should be saved/exported as PDF before sending.');return}
    if(f.size>25*1024*1024){setError('PDF must be 25 MB or smaller.');return}
    try{
      const bytes=new Uint8Array(await f.arrayBuffer())
      const doc=await pdfjsLib.getDocument({data:bytes}).promise
      setFile(f);setPdf(doc);setPage(1);setFields([]);setTitle(f.name.replace(/\.pdf$/i,''))
    }catch(err){setError('Could not open this PDF: '+(err.message||String(err)))}
  }

  function addField(e){
    if(!pdf||!size.w||!size.h)return
    const rect=e.currentTarget.getBoundingClientRect()
    const meta=FIELD_META[tool]
    const x=Math.max(0,Math.min(.98-meta.w,(e.clientX-rect.left)/rect.width-meta.w/2))
    const y=Math.max(0,Math.min(.98-meta.h,(e.clientY-rect.top)/rect.height-meta.h/2))
    setFields(v=>[...v,{id:crypto.randomUUID(),type:tool,label:meta.label,page,x,y,w:meta.w,h:meta.h,required:true}])
  }

  function dragField(e,f){
    e.preventDefault();e.stopPropagation()
    const host=e.currentTarget.parentElement
    const rect=host.getBoundingClientRect();const sx=e.clientX,sy=e.clientY,ox=f.x,oy=f.y
    const move=ev=>setFields(all=>all.map(x=>x.id===f.id?{...x,x:Math.max(0,Math.min(1-x.w,ox+(ev.clientX-sx)/rect.width)),y:Math.max(0,Math.min(1-x.h,oy+(ev.clientY-sy)/rect.height))}:x))
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)}
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
  }

  async function markDelivered(documentId,eventName='sent'){
    const {data,error:e}=await supabase.rpc('admin_romylabs_mark_office_signing_sent',{p_document_id:documentId,p_event:eventName})
    if(e||!data?.ok)throw new Error(e?.message||data?.error||'Could not mark signing request delivered')
  }

  async function sendMail(url,recipient,titleText){
    const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>${brand.name} — Signature Requested</h2><p>Hi ${recipient.name||'there'},</p><p><strong>${firmName}</strong> has a document ready for your review and electronic signature.</p><div style="background:#f5f7fb;border-radius:10px;padding:14px 16px;margin:18px 0"><strong>${titleText}</strong></div><p><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Review & Sign Document</a></p><p style="font-size:12px;color:#64748b">This secure signing link expires in 14 days.</p><p>Best Regards,<br><strong>${brand.name}</strong><br>RomyLabs</p></div>`
    const {data,error:e}=await supabase.functions.invoke('send-email',{body:{kind:'office_esign_request',product_key:productKey,external_office_id:String(externalOfficeId),to:recipient.email,subject:`Signature Requested: ${titleText}`,html,tenant_id:'a0000000-0000-0000-0000-000000000001',from_name:brand.name}})
    if(e||!data?.success)throw new Error(e?.message||data?.error||'Email send failed')
  }

  async function sendDocument(){
    if(!file){setError('Choose a PDF contract first.');return}
    if(!signer.email){setError('Signer email is required.');return}
    if(!title.trim()){setError('Document title is required.');return}
    if(!fields.some(f=>f.type==='signature')){setError('Place at least one Signature field on the document.');return}
    if(!window.confirm(`Send “${title}” to ${signer.email} for signature?`))return
    setWorking(true);setError('');setMsg('')
    let path=''
    let createdRequest=false
    try{
      path=`${productKey}/${externalOfficeId}/${Date.now()}-${clean(file.name)}`
      const up=await supabase.storage.from('romylabs-esign').upload(path,file,{contentType:'application/pdf',upsert:false})
      if(up.error)throw up.error
      const {data,error:e}=await supabase.rpc('admin_romylabs_create_office_signing_document',{
        p_product_key:productKey,p_external_office_id:String(externalOfficeId),p_firm_name:firmName,p_title:title.trim(),
        p_source_filename:file.name,p_source_path:path,p_signer_name:signer.name||null,p_signer_email:signer.email,p_fields:fields,p_expires_days:14,
      })
      if(e||!data?.ok)throw new Error(e?.message||data?.error||'Could not create signing request')
      createdRequest=true
      const signUrl=`${window.location.origin}${data.sign_url}`
      await sendMail(signUrl,signer,title.trim())
      await markDelivered(data.id,'sent')
      setMsg(`Sent “${title}” to ${signer.email} for signature ✓`)
      setFile(null);setPdf(null);setFields([]);setTitle('');setPage(1)
      await load()
    }catch(e){
      if(path&&!createdRequest){ try{ await supabase.storage.from('romylabs-esign').remove([path]) }catch(_){} }
      setError(e.message||String(e))
    }
    setWorking(false)
  }

  async function openFile(row,signed=false){
    const filePath=signed?row.signed_path:row.source_path
    if(!filePath)return
    const {data,error:e}=await supabase.functions.invoke('office-agreement-file',{body:{action:'esign_geturl',file_path:filePath}})
    if(e||!data?.url){setError(e?.message||data?.error||'Could not open document');return}
    window.open(data.url,'_blank','noopener,noreferrer')
  }

  async function resend(row){
    if(!window.confirm(`Send a fresh signing link to ${row.signer_email}?`))return
    setWorking(true);setError('');setMsg('')
    try{
      const {data,error:e}=await supabase.rpc('admin_romylabs_refresh_office_signing_link',{p_document_id:row.id,p_expires_days:14})
      if(e||!data?.ok)throw new Error(e?.message||data?.error||'Could not refresh signing link')
      await sendMail(`${window.location.origin}${data.sign_url}`,{name:row.signer_name,email:row.signer_email},row.title)
      await markDelivered(row.id,'resent')
      setMsg('Fresh signing link sent ✓');await load()
    }catch(e){setError(e.message||String(e))}
    setWorking(false)
  }

  async function voidDoc(row){
    const reason=window.prompt('Reason for voiding this signing request?');if(reason===null)return
    setWorking(true);setError('');setMsg('')
    const {data,error:e}=await supabase.rpc('admin_romylabs_void_office_signing_document',{p_document_id:row.id,p_reason:reason||null})
    setWorking(false)
    if(e||!data?.ok)setError(e?.message||data?.error||'Void failed');else{setMsg('Signing request voided');await load()}
  }

  const currentFields=useMemo(()=>fields.filter(f=>f.page===page),[fields,page])
  return <div style={{display:'grid',gap:16}}>
    <section style={{background:'rgba(255,255,255,.025)',border:'1px solid rgba(99,102,241,.18)',borderRadius:12,padding:18}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',marginBottom:14}}>
        <div><div style={{fontSize:16,fontWeight:900,color:'#fff'}}>Documents & E-Sign</div><div style={{fontSize:11,color:'#64748b',marginTop:3}}>Upload a contract, place signature fields, and send it like DocuSign.</div></div>
        <label style={{padding:'9px 12px',borderRadius:8,background:'#6366f1',color:'#fff',fontWeight:900,fontSize:11,cursor:'pointer'}}>+ Upload Contract<input type="file" accept="application/pdf,.pdf" onChange={chooseFile} style={{display:'none'}}/></label>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8,marginBottom:12}}>
        <label style={{fontSize:9,color:'#64748b',fontWeight:800,textTransform:'uppercase'}}>Document title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Service Agreement" style={inputStyle}/></label>
        <label style={{fontSize:9,color:'#64748b',fontWeight:800,textTransform:'uppercase'}}>Signer name<input value={signer.name} onChange={e=>setSigner(s=>({...s,name:e.target.value}))} style={inputStyle}/></label>
        <label style={{fontSize:9,color:'#64748b',fontWeight:800,textTransform:'uppercase'}}>Signer email<input type="email" value={signer.email} onChange={e=>setSigner(s=>({...s,email:e.target.value}))} style={inputStyle}/></label>
      </div>

      {pdf&&<div style={{display:'grid',gridTemplateColumns:'160px minmax(0,1fr)',gap:14,alignItems:'start'}}>
        <div style={{display:'grid',gap:7}}>
          <div style={{fontSize:10,fontWeight:900,color:'#94a3b8',textTransform:'uppercase'}}>Place fields</div>
          {Object.entries(FIELD_META).map(([k,m])=><button key={k} onClick={()=>setTool(k)} style={{padding:'8px 9px',textAlign:'left',borderRadius:7,border:`1px solid ${tool===k?'#6366f1':'rgba(99,102,241,.16)'}`,background:tool===k?'rgba(99,102,241,.18)':'rgba(255,255,255,.025)',color:tool===k?'#c7d2fe':'#94a3b8',fontSize:10,fontWeight:800,cursor:'pointer'}}>{m.label}</button>)}
          <div style={{fontSize:9,color:'#64748b',lineHeight:1.45}}>Choose a field, then click the PDF to place it. Drag a field to move it. Use × to remove it.</div>
          <button disabled={working} onClick={sendDocument} style={{marginTop:5,padding:'10px 12px',borderRadius:8,border:'none',background:'#10b981',color:'#052e16',fontWeight:900,fontSize:11,cursor:'pointer'}}>Send for Signature</button>
        </div>
        <div style={{minWidth:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:7,fontSize:10,color:'#94a3b8'}}><span>{file?.name}</span><span><button disabled={page<=1} onClick={()=>setPage(p=>p-1)} style={navBtn}>←</button> Page {page} of {pdf.numPages} <button disabled={page>=pdf.numPages} onClick={()=>setPage(p=>p+1)} style={navBtn}>→</button></span></div>
          <div onClick={addField} style={{position:'relative',display:'inline-block',maxWidth:'100%',overflow:'auto',borderRadius:8,border:'1px solid rgba(148,163,184,.2)',background:'#fff',cursor:'crosshair'}}>
            <canvas ref={canvasRef} style={{display:'block',maxWidth:'none'}}/>
            {currentFields.map(f=><div key={f.id} onPointerDown={e=>dragField(e,f)} onClick={e=>e.stopPropagation()} style={{position:'absolute',left:`${f.x*100}%`,top:`${f.y*100}%`,width:`${f.w*100}%`,height:`${f.h*100}%`,boxSizing:'border-box',border:'2px solid #6366f1',background:'rgba(99,102,241,.16)',borderRadius:5,color:'#312e81',fontSize:10,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',cursor:'move',userSelect:'none'}}>{FIELD_META[f.type]?.label||f.type}<button onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setFields(all=>all.filter(x=>x.id!==f.id))}} style={{position:'absolute',right:-7,top:-8,width:17,height:17,borderRadius:9,border:'none',background:'#ef4444',color:'#fff',fontSize:10,fontWeight:900,cursor:'pointer',padding:0}}>×</button></div>)}
          </div>
        </div>
      </div>}
      {!pdf&&<div style={{padding:'24px 18px',border:'1px dashed rgba(99,102,241,.22)',borderRadius:10,textAlign:'center',color:'#64748b',fontSize:11}}>Upload a PDF contract to start placing signature fields.</div>}
      {msg&&<div style={{fontSize:10,color:'#10b981',marginTop:10}}>{msg}</div>}{error&&<div style={{fontSize:10,color:'#f87171',marginTop:10,lineHeight:1.5}}>{error}</div>}
    </section>

    <section style={{background:'rgba(255,255,255,.025)',border:'1px solid rgba(99,102,241,.18)',borderRadius:12,padding:18}}>
      <div style={{fontSize:13,fontWeight:900,color:'#fff',marginBottom:12}}>Signing Requests</div>
      {loading?<div style={{fontSize:11,color:'#64748b'}}>Loading documents…</div>:docs.length===0?<div style={{fontSize:11,color:'#64748b'}}>No documents have been sent for signature yet.</div>:docs.map(row=>{const c=STATUS[row.status]||'#64748b';return <div key={row.id} style={{padding:11,borderRadius:9,border:'1px solid rgba(99,102,241,.1)',background:'rgba(255,255,255,.02)',marginBottom:8}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><span style={{fontSize:9,fontWeight:900,color:c,textTransform:'uppercase'}}>{row.status}</span><strong style={{fontSize:11,color:'#e2e8f0'}}>{row.title}</strong><span style={{fontSize:10,color:'#64748b'}}>{row.signer_email}</span>{row.signed_at&&<span style={{fontSize:10,color:'#10b981',marginLeft:'auto'}}>Signed {dt(row.signed_at)}</span>}</div>
        <div style={{fontSize:9,color:'#64748b',marginTop:5}}>Sent {dt(row.sent_at)} · {row.source_filename}</div>
        <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}><button onClick={()=>openFile(row,false)} style={smallBtn}>View Original</button>{row.status==='signed'&&row.signed_path&&<button onClick={()=>openFile(row,true)} style={{...smallBtn,color:'#34d399',borderColor:'rgba(16,185,129,.25)',background:'rgba(16,185,129,.08)'}}>Open Signed Contract</button>}{!['signed','void'].includes(row.status)&&<><button disabled={working} onClick={()=>resend(row)} style={smallBtn}>Resend</button><button disabled={working} onClick={()=>voidDoc(row)} style={{...smallBtn,color:'#f87171',borderColor:'rgba(239,68,68,.2)',background:'rgba(239,68,68,.06)'}}>Void</button></>}</div>
      </div>})}
    </section>
  </div>
}

const inputStyle={display:'block',width:'100%',boxSizing:'border-box',marginTop:5,padding:'8px 9px',borderRadius:7,border:'1px solid rgba(99,102,241,.2)',background:'rgba(255,255,255,.035)',color:'#e2e8f0',fontSize:12}
const smallBtn={fontSize:9,padding:'5px 8px',borderRadius:6,border:'1px solid rgba(99,102,241,.25)',background:'rgba(99,102,241,.08)',color:'#a5b4fc',cursor:'pointer'}
const navBtn={fontSize:10,padding:'2px 6px',borderRadius:5,border:'1px solid rgba(99,102,241,.2)',background:'rgba(99,102,241,.06)',color:'#94a3b8',cursor:'pointer'}
