import { useEffect, useState } from 'react'
import Esign from './Esign'
import UniversalOfficeESign from '../components/admin/UniversalOfficeESign'
import { supabase } from '../lib/supabase'
import { FIRM, loadFirmBranding } from '../lib/firmBranding'
import EsignManagerAuditBridge from '../components/EsignManagerAuditBridge'

// Shared by Tax Case Review, Nashville, demo tenants, current TaxRes offices,
// and future TaxRes offices. The original tax-specific signing workflow stays
// untouched; the universal PDF contract flow is exposed as a second option.
export default function TaxOfficeEsign(){
  const [mode,setMode]=useState('tax')
  const [identity,setIdentity]=useState({
    tenantId:FIRM.tenantId||'',
    firmName:FIRM.name||'Tax Office',
    email:FIRM.email||'',
    phone:FIRM.phone||'',
  })

  useEffect(()=>{
    let alive=true
    loadFirmBranding().then(()=>{
      if(!alive)return
      setIdentity({
        tenantId:FIRM.tenantId||'',
        firmName:FIRM.name||'Tax Office',
        email:FIRM.email||'',
        phone:FIRM.phone||'',
      })
    }).catch(()=>{})
    return()=>{alive=false}
  },[])

  return (
    <div>
      <EsignManagerAuditBridge />
      <div style={{padding:'16px 24px 0',maxWidth:1100,margin:'0 auto'}}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',padding:6,border:'1px solid var(--br)',borderRadius:10,background:'var(--s2)',width:'fit-content'}}>
          <button className={`btn ${mode==='tax'?'pri':'sec'}`} onClick={()=>setMode('tax')} style={{fontWeight:800}}>Tax Forms & Agreements</button>
          <button className={`btn ${mode==='pdf'?'pri':'sec'}`} onClick={()=>setMode('pdf')} style={{fontWeight:800}}>Upload Contract / PDF</button>
        </div>
        <div style={{fontSize:12,color:'var(--t3)',marginTop:8,lineHeight:1.5}}>
          Use the existing tax-specific e-sign workflow, or upload any PDF contract and place signature fields DocuSign-style.
        </div>
      </div>

      {mode==='tax' ? <Esign /> : (
        <div style={{padding:'20px 24px',maxWidth:1100,margin:'0 auto'}}>
          {!identity.tenantId ? (
            <div className="card" style={{padding:18,color:'var(--t3)'}}>Loading this office's signing workspace…</div>
          ) : (
            <UniversalOfficeESign
              key={`taxres_crm:${identity.tenantId}`}
              supabase={supabase}
              productKey="taxres_crm"
              externalOfficeId={identity.tenantId}
              firmName={identity.firmName}
              contactEmail={identity.email}
              contactPhone={identity.phone}
            />
          )}
        </div>
      )}
    </div>
  )
}
