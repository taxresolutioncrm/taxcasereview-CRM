import React,{useEffect,useMemo,useState} from 'react'
import { supabase } from '../lib/supabase'
import UniversalOfficeESign from '../components/admin/UniversalOfficeESign'

// Universal RomyLabs contract-signing workspace. Office rows come from the shared registry,
// so newly registered product offices automatically become available here.
const PRODUCT_LABEL={taxres_crm:'TaxRes CRM',camvella:'Camvella',arcvena:'Arcvena',bocasync:'BocaSync',groundivo:'Groundivo',oculivo:'Oculivo',restore_relay:'RestoreRelay'}

export default function ESignaturesHub(){
  const [offices,setOffices]=useState([])
  const [selected,setSelected]=useState(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [q,setQ]=useState('')

  useEffect(()=>{
    let dead=false
    ;(async()=>{
      setLoading(true);setError('')
      // Refresh live product offices first. Failure of one product must not block
      // access to already-registered offices.
      try{
        const {data:syncData,error:syncError}=await supabase.functions.invoke('sync-product-offices',{body:{}})
        if(syncError)console.warn('Office registry sync failed',syncError)
        else if(syncData?.results?.some?.(r=>r?.ok===false))console.warn('Partial office registry sync',syncData.results)
      }catch(syncErr){console.warn('Office registry sync unavailable',syncErr)}
      const {data,error:e}=await supabase.rpc('admin_romylabs_office_registry')
      if(dead)return
      if(e){setError(e.message);setOffices([])}
      else{
        const rows=Array.isArray(data)?data:[]
        setOffices(rows)
        if(rows.length)setSelected(rows[0])
      }
      setLoading(false)
    })()
    return()=>{dead=true}
  },[])

  const visible=useMemo(()=>{
    const needle=q.trim().toLowerCase()
    if(!needle)return offices
    return offices.filter(o=>`${o.firm_name||''} ${o.product_key||''} ${o.primary_contact_name||''} ${o.primary_contact_email||''}`.toLowerCase().includes(needle))
  },[offices,q])

  return <div style={{padding:'28px 32px',maxWidth:1320}}>
    <div style={{marginBottom:22}}>
      <div style={{fontSize:11,fontWeight:900,color:'#8b5cf6',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>RomyLabs</div>
      <div style={{fontSize:28,fontWeight:900,color:'#fff'}}>E-Signatures</div>
      <div style={{fontSize:13,color:'#64748b',marginTop:5}}>Upload any PDF contract, place signature fields, send it for signature, and keep the executed copy with the office.</div>
    </div>

    {error&&<div style={{padding:12,border:'1px solid rgba(239,68,68,.35)',borderRadius:9,color:'#fca5a5',background:'rgba(239,68,68,.08)',marginBottom:14}}>Unable to load offices: {error}</div>}
    {loading?<div style={{color:'#64748b',padding:24}}>Loading offices…</div>:
      <div style={{display:'grid',gridTemplateColumns:'minmax(240px,300px) minmax(0,1fr)',gap:18,alignItems:'start'}}>
        <aside style={{background:'rgba(255,255,255,.025)',border:'1px solid rgba(99,102,241,.18)',borderRadius:12,padding:12,position:'sticky',top:16}}>
          <div style={{fontSize:12,fontWeight:900,color:'#e2e8f0',marginBottom:9}}>Choose Office</div>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search offices…" style={{width:'100%',boxSizing:'border-box',padding:'9px 10px',borderRadius:8,border:'1px solid rgba(99,102,241,.22)',background:'#0f0e1a',color:'#e2e8f0',outline:'none',marginBottom:9}}/>
          <div style={{display:'grid',gap:6,maxHeight:'68vh',overflow:'auto'}}>
            {visible.map(o=>{
              const active=selected?.id===o.id
              return <button key={o.id} onClick={()=>setSelected(o)} style={{textAlign:'left',padding:'10px 11px',borderRadius:8,border:`1px solid ${active?'#6366f1':'rgba(99,102,241,.12)'}`,background:active?'rgba(99,102,241,.18)':'rgba(255,255,255,.015)',color:'#e2e8f0',cursor:'pointer'}}>
                <div style={{fontSize:12,fontWeight:900}}>{o.firm_name||'Unnamed Office'}</div>
                <div style={{fontSize:10,color:'#64748b',marginTop:3}}>{PRODUCT_LABEL[o.product_key]||o.product_key||'RomyLabs'}{o.status?` · ${o.status}`:''}</div>
              </button>
            })}
            {!visible.length&&<div style={{fontSize:11,color:'#64748b',padding:10}}>No offices found.</div>}
          </div>
        </aside>

        <main style={{minWidth:0}}>
          {!selected?<div style={{padding:24,color:'#64748b'}}>Select an office to manage its contracts.</div>:
            <>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginBottom:14}}>
                {[
                  ['Office',selected.firm_name||'—'],['Product',PRODUCT_LABEL[selected.product_key]||selected.product_key||'—'],['Contact',selected.primary_contact_name||'—'],['Email',selected.primary_contact_email||'—'],['Status',selected.status||'—']
                ].map(([k,v])=><div key={k} style={{background:'rgba(255,255,255,.025)',border:'1px solid rgba(99,102,241,.16)',borderRadius:10,padding:'12px 13px'}}><div style={{fontSize:9,color:'#64748b',fontWeight:900,textTransform:'uppercase',letterSpacing:'.06em'}}>{k}</div><div style={{fontSize:12,color:'#e2e8f0',fontWeight:800,marginTop:5,wordBreak:'break-word'}}>{String(v)}</div></div>)}
              </div>
              <UniversalOfficeESign
                key={`${selected.product_key||'romylabs'}:${selected.external_office_id||selected.id}`}
                supabase={supabase}
                productKey={selected.product_key||'romylabs'}
                externalOfficeId={selected.external_office_id||selected.id}
                firmName={selected.firm_name||'Office'}
                contactName={selected.primary_contact_name||''}
                contactEmail={selected.primary_contact_email||''}
                contactPhone={selected.primary_contact_phone||''}
              />
            </>
          }
        </main>
      </div>
    }
  </div>
}
