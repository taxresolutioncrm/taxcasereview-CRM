import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchGmailAttachmentBlob } from '../lib/gmailUtils'
import { DOC_FOLDERS } from '../lib/docFolders'

const MAX_PREVIEW = 25 * 1024 * 1024
const safeFileName = value => String(value || 'attachment').replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 140) || 'attachment'
const sizeLabel = value => Number.isFinite(Number(value)) && Number(value) >= 0
  ? (Number(value) / 1024).toFixed(Number(value) < 10240 ? 1 : 0) + ' KB' : 'size unknown'
const safePreviewType = att => {
  const filename = String(att?.filename || '').toLowerCase()
  const mime = String(att?.mimeType || '').split(';')[0].trim().toLowerCase()
  const ext = filename.split('.').pop()
  if (ext === 'pdf' && (mime === 'application/pdf' || !mime || mime === 'application/octet-stream')) return 'pdf'
  if (ext === 'txt' && (mime === 'text/plain' || !mime || mime === 'application/octet-stream')) return 'text'
  const types = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp' }
  if (types[ext] && (mime === types[ext] || !mime || mime === 'application/octet-stream')) return 'image'
  return ''
}
const fingerprint = async value => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export default function ReceivedEmailAttachments({ email, clients = [], suggestedClient, user, tenantId, mailboxOwner }) {
  const [clientId, setClientId] = useState('')
  const [folder, setFolder] = useState('Correspondence')
  const [folders, setFolders] = useState([])
  const [folderError, setFolderError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState('')
  const [preview, setPreview] = useState(null)
  const [results, setResults] = useState([])
  const [progress, setProgress] = useState('')
  const busyRef = useRef(false)
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => { liveRef.current = false }
  }, [])
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url) }, [preview])
  useEffect(() => {
    let active = true
    setFolders([])
    setFolderError('')
    setFolder('Correspondence')
    if (!clientId || !tenantId) return () => { active = false }
    supabase.from('client_document_folders').select('id,name,parent_folder_id,client_id,tenant_id')
      .eq('tenant_id', tenantId).eq('client_id', clientId).order('name')
      .then(({ data, error }) => {
        if (!active) return
        if (error) setFolderError('Document folders unavailable: ' + error.message)
        else setFolders((data || []).filter(f => String(f.client_id) === String(clientId) && String(f.tenant_id) === String(tenantId)))
      })
    return () => { active = false }
  }, [clientId, tenantId])

  const attachments = Array.isArray(email?.attachments) ? email.attachments : []
  const owner = String(email?.mailbox_owner || '').toLowerCase()
  const authorizedMailbox = !!mailboxOwner && owner === String(mailboxOwner).toLowerCase()
  const gmailReady = authorizedMailbox && !!email?.gmail_message_id
  const isReceived = String(email?.direction || '').toLowerCase() !== 'outbound' && (email?.triage || '') !== 'Sent'
  const selected = clients.find(c => String(c.id) === String(clientId))
  const suggested = clients.find(c => String(c.id) === String(suggestedClient?.id))
  const activeFolder = folders.find(f => folder === 'custom:' + f.id)
  const folderChoiceValid = !folderError && (activeFolder ? true : DOC_FOLDERS.includes(folder))
  const canAttach = gmailReady && isReceived && selected && folderChoiceValid && !busy

  async function attachmentBlob(att) {
    if (!gmailReady || !isReceived || !att?.attachmentId) throw new Error('No authorized Gmail attachment is available for this message.')
    return fetchGmailAttachmentBlob(supabase, {
      gmailMessageId: email.gmail_message_id,
      attachmentId: att.attachmentId,
      mimeType: att.mimeType,
      employeeEmail: email.mailbox_owner,
    })
  }

  async function openPreview(att) {
    if (loadingPreview || !safePreviewType(att)) return
    setLoadingPreview(String(att.attachmentId))
    try {
      const kind = safePreviewType(att)
      const blob = await attachmentBlob(att)
      if (blob.size > MAX_PREVIEW) throw new Error('Preview is limited to 25 MB; use Download instead.')
      if (!liveRef.current) return
      if (kind === 'text') {
        const text = await blob.text()
        if (liveRef.current) setPreview({ name:att.filename || 'Attachment', kind, text:text.slice(0, 1024 * 1024) })
        return
      }
      const type = kind === 'pdf' ? 'application/pdf' : String(att.mimeType || blob.type || 'image/png').toLowerCase()
      const url = URL.createObjectURL(new Blob([blob], { type }))
      if (!liveRef.current) { URL.revokeObjectURL(url); return }
      setPreview({ name:att.filename || 'Attachment', kind, url })
    } catch (error) {
      if (liveRef.current) setResults([{ name:att.filename || 'Attachment', status:'error', message:'Preview failed: ' + error.message }])
    } finally {
      if (liveRef.current) setLoadingPreview('')
    }
  }

  async function attachAll() {
    if (busyRef.current || !canAttach) return
    busyRef.current = true
    setBusy(true)
    setProgress('')
    const outcome = []
    try {
      const { data:resolvedTenant, error:tenantError } = await supabase.rpc('current_tenant_id')
      if (tenantError || String(resolvedTenant) !== String(tenantId)) throw new Error('Active office could not be verified.')
      if (email.tenant_id && String(email.tenant_id) !== String(tenantId)) throw new Error('Message does not belong to this office.')
      const { data:level, error:permissionError } = await supabase.rpc('current_employee_permission', { p_column:'perm_documents' })
      if (permissionError || Number(level) < 2) throw new Error('Document edit permission is required.')
      const { data:client, error:clientError } = await supabase.from('clients').select('id,name,tenant_id')
        .eq('tenant_id', tenantId).eq('id', selected.id).single()
      if (clientError || !client || String(client.tenant_id) !== String(tenantId)) throw new Error('Client is not accessible in this office.')
      if (!folderChoiceValid) throw new Error('Choose an authorized destination folder.')
      const folderId = activeFolder?.id || null
      const docType = activeFolder?.name || folder
      for (const [index, att] of attachments.entries()) {
        const name = String(att.filename || 'Attachment')
        if (liveRef.current) setProgress('Filing ' + (index + 1) + ' of ' + attachments.length)
        try {
          if (!att.attachmentId) throw new Error('No retrievable attachment identifier.')
          const identity = [tenantId, email.mailbox_owner, email.gmail_message_id, att.attachmentId].map(String).join(':')
          const key = await fingerprint(identity)
          const path = String(tenantId) + '/docs/' + String(client.id) + '/received-email/' + key + '_' + safeFileName(name)
          const { data:existing, error:existingError } = await supabase.from('documents').select('id')
            .eq('tenant_id',tenantId).eq('client_id',client.id).eq('storage_path',path).limit(1)
          if (existingError) throw existingError
          if (existing?.length) { outcome.push({name,status:'skipped',message:'Already filed'}); continue }
          const blob = await attachmentBlob(att)
          const { error:uploadError } = await supabase.storage.from('documents')
            .upload(path,blob,{upsert:false,contentType:att.mimeType || blob.type || 'application/octet-stream'})
          if (uploadError) throw new Error('Storage rejected file (no overwrite): ' + uploadError.message)
          const { error:saveError } = await supabase.from('documents').insert([{
            tenant_id:tenantId, client_id:client.id, client:client.name,clientname:client.name,
            name,docType,client_document_folder_id:folderId,
            file_name:name,original_file_name:name,file_size:blob.size,
            file_url:'storage://documents/' + path,storage_path:path,
            source:'Received Email',uploaded_by:user?.email || null,
            notes:'Received email ' + email.id + ' | mailbox ' + email.mailbox_owner +
              ' | Gmail message ' + email.gmail_message_id + ' | attachment ' + att.attachmentId,
            created_at:new Date().toISOString(),
          }])
          if (saveError) {
            const { error:cleanupError } = await supabase.storage.from('documents').remove([path])
            if (cleanupError) throw new Error(saveError.message + '; newly uploaded file requires storage cleanup: ' + cleanupError.message)
            throw saveError
          }
          outcome.push({name,status:'saved',message:'Saved to ' + docType})
        } catch (error) {
          outcome.push({name,status:'error',message:error?.message || String(error)})
        }
        if (liveRef.current) setResults([...outcome])
      }
    } catch (error) {
      outcome.push({name:'Attach All',status:'error',message:error?.message || String(error)})
    } finally {
      if (liveRef.current) {
        setResults(outcome)
        setProgress('Saved ' + outcome.filter(x=>x.status==='saved').length +
          ', already filed ' + outcome.filter(x=>x.status==='skipped').length +
          ', failed ' + outcome.filter(x=>x.status==='error').length)
        setBusy(false)
      }
      busyRef.current = false
    }
  }

  return <section data-received-email-attachments style={{display:'flex',flexDirection:'column',gap:8,minWidth:0}}>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'8px 10px',border:'1px solid var(--br)',borderRadius:8,background:'var(--s2)'}}>
      <strong style={{fontSize:12,color:'var(--tx)'}}>📎 {attachments.length} received attachment(s)</strong>
      {suggested && !clientId && <button type="button" className="btn sec" style={{fontSize:11,padding:'5px 8px'}}
        onClick={()=>setClientId(String(suggested.id))}>Use suggested: {suggested.name}</button>}
      <select aria-label="Exact destination client" value={clientId} disabled={busy} onChange={e=>{setClientId(e.target.value);setResults([])}}
        style={{maxWidth:'100%',minWidth:150,fontSize:12,padding:'6px 8px'}}>
        <option value="">Select exact client…</option>
        {clients.map(c=><option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
      </select>
      <select aria-label="Destination document folder" value={folder} disabled={busy || !clientId || !!folderError}
        onChange={e=>setFolder(e.target.value)} style={{maxWidth:'100%',fontSize:12,padding:'6px 8px'}}>
        {DOC_FOLDERS.map(f=><option key={f} value={f}>{f}</option>)}
        {folders.map(f=><option key={f.id} value={'custom:' + f.id}>{f.name} (custom)</option>)}
      </select>
      <button type="button" className="btn pri" disabled={!canAttach}
        onClick={attachAll} style={{fontSize:12,padding:'6px 10px'}}>{busy?'Filing…':'📁 Attach All'}</button>
      {!gmailReady && <span style={{fontSize:11,color:'var(--t3)'}}>Mailbox attachment retrieval is unavailable for this message.</span>}
      {folderError && <span role="alert" style={{fontSize:11,color:'var(--bad)'}}>{folderError}</span>}
    </div>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,minWidth:0}}>
      {attachments.map((att,i)=><div key={String(att.attachmentId || i)}
        style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',minWidth:0}}>
        <span style={{fontSize:11,color:'var(--tx)',overflowWrap:'anywhere'}}>📄 {att.filename || 'Attachment'} ({sizeLabel(att.size)})</span>
        {safePreviewType(att) && <button type="button" className="btn sec" disabled={!gmailReady || !isReceived || !!loadingPreview}
          onClick={()=>openPreview(att)} style={{fontSize:11,padding:'4px 8px'}}>
          {loadingPreview === String(att.attachmentId) ? 'Loading…' : '👁 Preview'}</button>}
      </div>)}
    </div>
    {(progress || results.length > 0) && <div role="status" aria-live="polite" style={{fontSize:11,color:'var(--t3)'}}>
      {progress && <strong>{progress}</strong>}
      {results.length>0 && <div style={{display:'flex',flexDirection:'column',gap:3}}>
        {results.map((result,i)=><div key={i} style={{overflowWrap:'anywhere',color:result.status==='error'?'var(--bad)':'var(--t3)'}}>
          {result.status==='saved'?'✓':result.status==='skipped'?'↷':'✕'} {result.name}: {result.message}
        </div>)}
      </div>}
    </div>}
    {preview && <div role="dialog" aria-modal="true" aria-label={'Preview '+preview.name}
      onClick={()=>setPreview(null)}
      style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,.78)',padding:12,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div onClick={e=>e.stopPropagation()} style={{width:'min(100%,960px)',height:'min(90vh,840px)',display:'flex',flexDirection:'column',background:'var(--sf)',border:'1px solid var(--br)',borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:10,display:'flex',gap:8,alignItems:'center',borderBottom:'1px solid var(--br)'}}>
          <strong style={{flex:1,minWidth:0,overflowWrap:'anywhere',color:'var(--tx)',fontSize:13}}>{preview.name}</strong>
          <button type="button" className="btn sec" onClick={()=>setPreview(null)}>✕ Close</button>
        </div>
        {preview.kind==='text'
          ? <pre style={{flex:1,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:12,color:'var(--tx)'}}>{preview.text}</pre>
          : preview.kind==='image'
            ? <div style={{flex:1,minHeight:0,display:'flex',alignItems:'center',justifyContent:'center',overflow:'auto',padding:12}}>
                <img src={preview.url} alt={'Preview '+preview.name} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain'}} />
              </div>
            : <iframe title={'Preview '+preview.name} src={preview.url} sandbox=""
                style={{width:'100%',flex:1,minHeight:0,border:0,background:'#fff'}} />}
      </div>
    </div>}
  </section>
}
