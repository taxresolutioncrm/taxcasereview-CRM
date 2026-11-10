import { useState } from 'react'
import { parseFloridaSunbizPdf } from '../../lib/flSunbizPdfImport'
import './SunbizFilingWorkspace.css'

const URLS = {
  'LLC':'https://efile.sunbiz.org/llc_file.html',
  'Professional LLC (PLLC)':'https://efile.sunbiz.org/llc_file.html',
  'C-Corp':'https://efile.sunbiz.org/profit_file.html',
  'Non-Profit 501(c)(3)':'https://efile.sunbiz.org/np_file.html',
}

const GROUPS = [
  { name:'Business details', fields:[
    ['Company name',c=>c.entity_name],
    ['Principal address',c=>c.principal_address],
    ['Mailing address',c=>c.mailing_address||c.principal_address],
    ['Effective date',c=>c.effective_date||'Effective upon filing'],
  ] },
  { name:'Registered agent',fields:[
    ['Registered agent',c=>c.registered_agent],
    ['Agent address',c=>c.registered_agent_address],
    ['Agent signature',c=>c.fl_registered_agent_signature],
  ] },
  { name:'Filing contacts',fields:[
    ['Correspondence contact',c=>c.fl_correspondence_name||c.client_name],
    ['Correspondence email',c=>c.correspondence_email],
    ['Authorized representative',c=>c.authorized_representative],
    ['Representative signature',c=>c.fl_authorized_representative_signature],
  ] },
]

export default function SunbizFilingWorkspace({caseRecord, onClose, onRecordReceipt, onImportPdf}) {
  const isSavedCase=!!caseRecord?.id
  const officialUrl=URLS[caseRecord?.entity_type||'LLC']
  const isPreviouslyRecorded=!!caseRecord?.fl_submitted_at
  const [receipt,setReceipt]=useState({
    tracking:caseRecord?.fl_tracking_number||'',
    payment:caseRecord?.fl_payment_reference||'',
    reference:caseRecord?.fl_confirmation_url||'',
  })
  const [recording,setRecording]=useState(false)
  const [pdfFile,setPdfFile]=useState(null)
  const [pdfResult,setPdfResult]=useState(null)
  const [pdfError,setPdfError]=useState('')
  const [pdfKind,setPdfKind]=useState('Filed Articles')
  const [importing,setImporting]=useState(false)
  const readPdf=async file=>{
    setPdfFile(null);setPdfResult(null);setPdfError('')
    if(!file)return
    try {
      const parsed=await parseFloridaSunbizPdf(file,caseRecord?.entity_name)
      if(!parsed.companyName)throw new Error('The PDF does not contain a recognizable company name. No business data was changed.')
      if(!parsed.nameMatches)throw new Error('Business-name mismatch. PDF: '+parsed.companyName+'; FormaCorp: '+caseRecord.entity_name+'. Select the correct business before importing.')
      if(!parsed.floridaHeader)throw new Error('Cannot identify Florida Division of Corporations text in this PDF.')
      setPdfFile(file);setPdfResult(parsed)
    } catch(err){setPdfError(err?.message||String(err))}
  }
  const importPdf=async()=>{
    if(!pdfFile||!pdfResult?.canVerify||!onImportPdf||importing)return
    setImporting(true);setPdfError('')
    try {
      await onImportPdf(pdfFile,pdfKind)
      setPdfFile(null);setPdfResult(null)
    } catch(error){setPdfError(error?.message||String(error))}
    finally{setImporting(false)}
  }
  const [copied,setCopied]=useState('')
  const copy=async(label,value)=>{
    if(!value)return
    try {
      await navigator.clipboard.writeText(String(value))
      setCopied(label+' copied')
    } catch {setCopied('Copy unavailable; select the value manually')}
  }
  const save=async()=>{
    if(!isSavedCase||!onRecordReceipt||recording||!receipt.tracking.trim()||!receipt.payment.trim())return
    setRecording(true)
    try {
      await onRecordReceipt({
        tracking:receipt.tracking.trim(),
        payment:receipt.payment.trim(),
        reference:receipt.reference.trim(),
      })
    } finally {setRecording(false)}
  }

  return <div className="modal-bg open" role="dialog" aria-modal="true" aria-label="Florida official filing workspace">
    <div className="modal sunbiz-workspace-modal">
      <div className="sunbiz-workspace">
        <header className="sunbiz-header">
          <div>
            <h2 className="sunbiz-heading">Florida Filing — Sunbiz Workspace</h2>
            <div className="sunbiz-subtitle">{caseRecord?.entity_name||'New Florida filing'} · Official government filing inside FormaCorp</div>
          </div>
          <div className="sunbiz-header-actions">
            <span className="sunbiz-origin">Florida Department of State</span>
            <button type="button" className="btn sm" onClick={onClose} aria-label="Close Sunbiz filing workspace">✕</button>
          </div>
        </header>

        <details className="sunbiz-notice">
          <summary>ⓘ Official Sunbiz page · Florida handles submission and government payment</summary>
          <p>The official website is loaded directly from efile.sunbiz.org. Florida may prevent its website from being displayed inside other applications. FormaCorp cannot read, prefill or complete fields on the government page, collect its payment information, or automatically detect acceptance. If embedding is blocked, use the official direct link. A filing is not submitted until Florida issues its receipt.</p>
        </details>

        <div className={isSavedCase?'sunbiz-main':'sunbiz-main sunbiz-no-case'}>
          {isSavedCase&&<aside className="sunbiz-sidebar" aria-label="Saved formation case details">
            <h3>Saved filing details</h3>
            <div className="sunbiz-helper">Copy details into the official application when needed.</div>
            {GROUPS.map((group,index)=><details key={group.name} className="sunbiz-detail-group" open={index===0?true:undefined}>
              <summary>{group.name}</summary>
              {group.fields.map(([label,getValue])=>{
                const value=getValue(caseRecord)
                return <div className="sunbiz-data-row" key={label}>
                  <div className="sunbiz-data-label">{label}</div>
                  <div className="sunbiz-data-line">
                    <span className="sunbiz-data-value">{value||'—'}</span>
                    {!!value&&<button type="button" className="btn sm sunbiz-copy-btn" onClick={()=>copy(label,value)} aria-label={'Copy '+label}>Copy</button>}
                  </div>
                </div>
              })}
            </details>)}
            {Array.isArray(caseRecord.fl_llc_managers)&&caseRecord.fl_llc_managers.some(m=>m.name)&&<details className="sunbiz-detail-group">
              <summary>Managers / Authorized Persons</summary>
              {caseRecord.fl_llc_managers.filter(m=>m.name).map((m,i)=>{
                const line=[m.title,m.name,m.street_address].filter(Boolean).join(' / ')
                return <div className="sunbiz-data-row" key={i}>
                  <div className="sunbiz-data-value">{line}</div>
                  <button type="button" className="btn sm sunbiz-copy-btn" onClick={()=>copy('Authorized person',line)}>Copy</button>
                </div>
              })}
            </details>}
            {copied&&<p role="status" className="sunbiz-helper">{copied}</p>}
          </aside>}
          <section className="sunbiz-page" aria-label="Official Florida website">
            <div className="sunbiz-browser">
              <div className="sunbiz-browser-bar">
                <div className="sunbiz-browser-label">Official Florida filing</div>
                <div className="sunbiz-browser-toolbar">
                  <span className="sunbiz-browser-address">efile.sunbiz.org</span>
                  {officialUrl&&<a className="btn sm" href={officialUrl} target="_blank" rel="noopener noreferrer">Open in new tab</a>}
                </div>
              </div>
              {officialUrl
                ? <iframe
                    title="Official Florida Sunbiz government filing website"
                    src={officialUrl}
                    referrerPolicy="strict-origin-when-cross-origin"
                    allow="payment"
                  />
                : <div className="sunbiz-empty">This entity type has no verified official online filing destination. Use the corresponding state filing procedure.</div>}
            </div>
          </section>
        </div>

        {isSavedCase&&<section className="sunbiz-confirmation" aria-label="Import downloaded Sunbiz PDF">
          <div className="sunbiz-confirmation-body">
            <h3>Save downloaded Sunbiz PDF to this client's business file</h3>
            <p className="sunbiz-helper">Finish filing and payment on Florida's official site, then select the downloaded PDF. FormaCorp reads its text, checks the company name against this formation, and saves one file for both business documents and FormaCorp. State approval is not assumed from a PDF upload.</p>
            <label>Sunbiz document type
              <select value={pdfKind} onChange={e=>setPdfKind(e.target.value)} disabled={importing}>
                <option>Filed Articles</option>
                <option>Payment Receipt</option>
                <option>Certificate of Status</option>
                <option>Certified Copy</option>
              </select>
            </label>
            <label>Downloaded PDF
              <input type="file" accept=".pdf,application/pdf" disabled={importing} onChange={e=>readPdf(e.target.files?.[0])}/>
            </label>
            {pdfResult&&<div role="status" className="sunbiz-helper">
              ✓ Matched: {pdfResult.companyName}. {pdfResult.documentNumber?'Document '+pdfResult.documentNumber+'. ':''}{pdfResult.filedDate?'Filed '+pdfResult.filedDate+'. ':''}The PDF is ready to archive under this business.
            </div>}
            {pdfError&&<p role="alert" style={{color:'var(--red,#dc2626)'}}>{pdfError}</p>}
            <button className="btn pri" type="button" onClick={importPdf} disabled={!pdfResult?.canVerify||!pdfFile||importing}>
              {importing?'Saving PDF…':'Verify and save to client business file'}
            </button>
          </div>
        </section>}
        {isSavedCase&&<details className="sunbiz-confirmation">
          <summary>Record official Florida confirmation {isPreviouslyRecorded?'· Already recorded':'· After submission'}</summary>
          <div className="sunbiz-confirmation-body">
            <p className="sunbiz-helper">Enter the tracking and government payment references only after Florida confirms them. A fax-provider reference is not a state receipt. Recording here never submits a filing or charges a card.</p>
            <div className="sunbiz-confirmation-fields">
              <label>State tracking number<input value={receipt.tracking} onChange={e=>setReceipt(r=>({...r,tracking:e.target.value}))} placeholder="Florida tracking number"/></label>
              <label>Government payment reference<input value={receipt.payment} onChange={e=>setReceipt(r=>({...r,payment:e.target.value}))} placeholder="State payment receipt"/></label>
              <label>Official confirmation URL (optional)<input value={receipt.reference} onChange={e=>setReceipt(r=>({...r,reference:e.target.value}))} placeholder="https://..."/></label>
            </div>
            <div className="sunbiz-confirmation-actions">
              <button className="btn pri" disabled={recording||isPreviouslyRecorded||!receipt.tracking.trim()||!receipt.payment.trim()} onClick={save}>{recording?'Recording…':isPreviouslyRecorded?'Submission already recorded':'Record confirmed state submission'}</button>
            </div>
          </div>
        </details>}
      </div>
    </div>
  </div>
}
