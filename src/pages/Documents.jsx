import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { logActivity, getActor } from '../lib/activityLog'
import { useState, useEffect, useRef } from 'react'
import { validateFile, maybeCompressImage } from '../lib/uploadUtils'
import { supabase } from '../lib/supabase'
import { triggerWorkflow } from '../lib/triggerWorkflow'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { DOC_FOLDERS as ROOT_FOLDERS } from './Clients'

// Generate a short-lived signed URL for private storage bucket access
async function getDocumentUrl(supabase, storedUrl) {
  if (!storedUrl) return null
  try {
    const rawUrl = String(storedUrl)
    // Extract the storage path from the stored URL
    const match = rawUrl.match(/\/documents\/(.+)$/)
    if (!match) return rawUrl // Not a storage URL, return as-is
    const path = match[1]
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 3600) // 1 hour expiry
    if (error || !data?.signedUrl) return rawUrl
    return data.signedUrl
  } catch {
    return typeof storedUrl === 'string' ? storedUrl : null
  }
}

const FILE_ICONS = { pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', jpg:'🖼️', jpeg:'🖼️', png:'🖼️', mp3:'🎵', mp4:'🎬', default:'📎' }
function fileIcon(name='') { const ext=(String(name || '').split('.').pop()||'').toLowerCase(); return FILE_ICONS[ext]||FILE_ICONS.default }
function fmtSize(b) { const n=Number(b); if(!Number.isFinite(n)||n<=0)return ''; if(n<1024)return n+'B'; if(n<1048576)return (n/1024).toFixed(1)+'KB'; return (n/1048576).toFixed(1)+'MB' }
function fmtDate(d) { if(!d)return ''; const date=new Date(d); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) }

export default function Documents() {
  const location = useLocation()
  const { role, user } = useApp()
  const isAdmin = role === 'Admin' || role === 'Super Admin' || role === 'Manager'
  const clientParam = new URLSearchParams(location.search).get('client') || ''

  const [docs,         setDocs]         = useState([])
  const [people,       setPeople]        = useState([]) // { key, id, name, type }
  const [folder,       setFolder]        = useState('All')
  const [clientFilter, setClientFilter]  = useState(clientParam)
  const [search,       setSearch]        = useState('')
  const [modal,        setModal]         = useState(false)
  const [searchParams] = useSearchParams()
  useEffect(() => { if (searchParams.get('new') === '1') setModal(true) }, [searchParams])
  const [form,         setForm]          = useState({ name:'', client:'', docType:'IRS Docs', notes:'' })
  const [file,         setFile]          = useState(null)
  const [saving,       setSaving]        = useState(false)
  const [toast,        setToast]         = useState('')
  const [confirmDel,   setConfirmDel]    = useState(null)
  const [customFolders,setCustomFolders] = useState([])
  const [addingFolder, setAddingFolder]  = useState(false)
  const [newFolderName,setNewFolderName] = useState('')
  const [viewMode,     setViewMode]      = useState(() => localStorage.getItem('docs_view') || 'grid') // 'grid' | 'list' | 'table'
  const [sortCol,      setSortCol]       = useState('created_at')
  const [sortDir,      setSortDir]       = useState('desc')
  const [previewDoc,   setPreviewDoc]    = useState(null)
  const [previewUrl,   setPreviewUrl]    = useState('')
  const [previewLoading,setPreviewLoading]= useState(false)
  const [cardPreviewUrls,setCardPreviewUrls] = useState({})

  function changeView(v) { setViewMode(v); localStorage.setItem('docs_view', v) }
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  function sortedDocs(arr) {
    return [...arr].sort((a, b) => {
      let av = a?.[sortCol] ?? '', bv = b?.[sortCol] ?? ''
      if (sortCol === 'file_size') { av = Number(av) || 0; bv = Number(bv) || 0 }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }
  const fileRef = useRef(null)

  const ALL_FOLDERS = [...(Array.isArray(ROOT_FOLDERS) ? ROOT_FOLDERS : []), ...customFolders]

  useEffect(() => { loadAll() }, [clientFilter, folder])

  async function loadAll() {
    // Load documents
    let q = supabase.from('documents').select('*').order('created_at', { ascending: false })
    if (clientFilter) {
      if (clientFilter.startsWith('client:')) q = q.eq('client_id', clientFilter.slice(7))
      else if (clientFilter.startsWith('lead:')) {
        const lead = people.find(p => p.key === clientFilter)
        if (lead?.name) q = q.eq('client', lead.name)
      } else q = q.eq('client', clientFilter)
    }
    if (folder !== 'All') q = q.eq('docType', folder)
    const { data: docsData } = await q
    const nextDocs = Array.isArray(docsData) ? docsData : []
    setDocs(nextDocs)
    loadCardPreviews(nextDocs).catch(()=>{})

    // Load clients + leads for autocomplete
    const [{ data: cl }, { data: ld }] = await Promise.all([
      supabase.from('clients').select('id,name').order('name'),
      supabase.from('leads').select('id,name').order('name'),
    ])
    const nextPeople = [
      ...(cl || []).filter(p => p?.id && p?.name).map(p => ({ key:`client:${p.id}`, id:String(p.id), name:p.name, type:'client' })),
      ...(ld || []).filter(p => p?.id && p?.name).map(p => ({ key:`lead:${p.id}`, id:String(p.id), name:p.name, type:'lead' })),
    ].sort((a,b)=>a.name.localeCompare(b.name))
    setPeople(nextPeople)
    if (clientParam && clientFilter === clientParam) {
      const exact = nextPeople.find(p => p.type === 'client' && p.name.toLowerCase() === clientParam.toLowerCase())
      if (exact) setClientFilter(exact.key)
    }

    // Load custom folders from settings
    const { data: s } = await supabase.from('settings').select('custom_doc_folders').limit(1).maybeSingle()
    if (s?.custom_doc_folders) {
      try {
        const parsed = JSON.parse(s.custom_doc_folders)
        setCustomFolders(Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string' && v.trim()) : [])
      } catch { setCustomFolders([]) }
    } else {
      setCustomFolders([])
    }
  }

  function showToast(msg) { setToast(String(msg || '')); setTimeout(()=>setToast(''),3000) }

  function docDisplayName(doc) { return doc?.file_name || doc?.name || 'Document' }
  function docExt(doc) { return (docDisplayName(doc).split('.').pop() || '').toLowerCase() }
  function docPreviewKind(doc) {
    const ext = docExt(doc)
    if (ext === 'pdf') return 'pdf'
    if (['jpg','jpeg','png','gif','webp','tif','tiff'].includes(ext)) return 'image'
    return 'other'
  }
  async function resolveDocUrl(doc) {
    if (!doc) return ''
    const storagePath = doc.storage_path
      || (String(doc.file_url || '').startsWith('storage://documents/') ? String(doc.file_url).replace('storage://documents/','') : '')
    if (storagePath) {
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, 3600)
      if (error || !data?.signedUrl) return ''
      return data.signedUrl
    }
    if (!doc.file_url) return ''
    return (await getDocumentUrl(supabase, doc.file_url)) || ''
  }
  async function previewDocument(doc) {
    if (!doc?.file_url) return
    setPreviewDoc(doc)
    setPreviewUrl('')
    setPreviewLoading(true)
    try {
      const url = await resolveDocUrl(doc)
      if (!url) throw new Error('Document URL unavailable')
      setPreviewUrl(url)
    } catch (e) {
      setPreviewDoc(null)
      showToast('Could not preview document: ' + (e?.message || e))
    } finally {
      setPreviewLoading(false)
    }
  }
  async function loadCardPreviews(rows) {
    const candidates=(rows||[]).filter(doc=>doc?.file_url && ['pdf','image'].includes(docPreviewKind(doc))).slice(0,40)
    if(!candidates.length){ setCardPreviewUrls({}); return }
    const pairs=await Promise.all(candidates.map(async doc=>{
      try{return [doc.id,await resolveDocUrl(doc)]}catch{return [doc.id,'']}
    }))
    setCardPreviewUrls(Object.fromEntries(pairs.filter(([,url])=>url)))
  }

  async function saveCustomFolder() {
    const name = String(newFolderName || '').trim()
    if (!name) return
    if (ALL_FOLDERS.includes(name)) { showToast('Folder already exists'); return }
    const updated = [...customFolders, name]
    const { data: s } = await supabase.from('settings').select('id').limit(1).maybeSingle()
    if (s?.id) {
      await supabase.from('settings').update({ custom_doc_folders: JSON.stringify(updated) }).eq('id', s.id)
    }
    setCustomFolders(updated)
    setNewFolderName('')
    setAddingFolder(false)
    showToast(`✅ Folder "${name}" created`)
  }

  async function upload() {
    const docName = String(form.name || '').trim()
    const docType = String(form.docType || '').trim()
    if (!docName || !docType) { showToast('Name and folder required'); return }
    if (file) { const _v = validateFile(file); if (!_v.ok) { showToast('❌ ' + _v.error); return }; if (_v.warn) showToast('⚠️ ' + _v.warn) }
    const selectedPerson = people.find(p => p.key === form.client)
      || people.find(p => p.name.toLowerCase() === String(form.client || '').trim().toLowerCase())
    const entityName = selectedPerson?.name || String(form.client || '').trim()
    const entityClientId = selectedPerson?.type === 'client' ? selectedPerson.id : null
    setSaving(true)
    let fileUrl = null, fileName = docName, fileSize = null, storagePath = null
    if (file) {
      const ownerKey = entityClientId || entityName.replace(/[^a-zA-Z0-9._-]+/g,'-') || 'general'
      const folderKey = docType.replace(/[^a-zA-Z0-9._-]+/g,'-') || 'Documents'
      const originalName = String(file.name || 'document').replace(/[^a-zA-Z0-9._-]+/g,'-')
      const path = `docs/${ownerKey}/${folderKey}/${Date.now()}_${originalName}`
      storagePath = path
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
      if (upErr) { showToast('Upload error: '+upErr.message); setSaving(false); return }
      const { data: signedData } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
      fileUrl = signedData?.signedUrl || null; fileName = file.name || docName; fileSize = file.size
    }
    const { error } = await supabase.from('documents').insert([{
      name: docName,
      client: entityName,
      clientname: entityName,
      client_id: entityClientId,
      docType,
      notes: form.notes,
      file_url: fileUrl,
      file_name: fileName,
      file_size: fileSize,
      storage_path: storagePath,
      created_at: new Date().toISOString()
    }])
    setSaving(false)
    if (error) { showToast('Error: '+error.message); return }
    showToast('✅ Document saved!')
    const actor = getActor(user)
    await triggerWorkflow('document_uploaded', 'client', entityName, actor.name).catch(()=>{})
    await logActivity(supabase, {
      employeeName: actor.name,
      employeeEmail: actor.email,
      action: 'document_uploaded',
      category: 'document',
      description: `Uploaded doc: ${docName} — ${entityName || 'General'}`,
      entityName: entityName || null,
      meta: { docType, fileName },
    }).catch(()=>{})
    setModal(false)
    setForm({ name:'', client:'', docType:'IRS Docs', notes:'' })
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
    loadAll()
  }

  async function del(doc) {
    if (!doc?.id) return
    if (doc.file_name && (doc.file_url || doc.storage_path)) {
      const rawUrl = String(doc.file_url || '')
      const path = doc.storage_path
        || (rawUrl.startsWith('storage://documents/') ? rawUrl.replace('storage://documents/','') : rawUrl.split('/documents/')[1])
      if (path) await supabase.storage.from('documents').remove([path]).catch(()=>{})
    }
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    if (error) { showToast('Error: '+error.message); return }
    showToast('🗑 Document deleted')
    loadAll()
  }

  async function addNote(doc) {
    if (!doc?.id) return
    const note = prompt('Add note:')
    if (note === null) return
    const { error } = await supabase.from('documents').update({ notes: String(note) }).eq('id', doc.id)
    if (error) { showToast('Error: '+error.message); return }
    loadAll()
  }

  async function openDocument(doc) {
    if (!doc?.file_url) return
    const tab = window.open('about:blank','_blank')
    if (tab) tab.opener = null
    try {
      const url = previewDoc?.id===doc?.id && previewUrl ? previewUrl : await resolveDocUrl(doc)
      if (!url) throw new Error('Document URL unavailable')
      if (tab) tab.location.href = url
      else showToast('Allow pop-ups to open documents')
    } catch (e) {
      if (tab) tab.close()
      showToast('Could not open document: ' + (e?.message || e))
    }
  }

  const needle = search.toLowerCase()
  const filtered = sortedDocs(docs.filter(d =>
    !search || String(d?.name || '').toLowerCase().includes(needle) ||
    String(d?.client || '').toLowerCase().includes(needle) ||
    String(d?.notes || '').toLowerCase().includes(needle)
  ))

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}
      <DeleteConfirmModal
        open={!!confirmDel}
        title="Delete Document?"
        message={confirmDel ? `Delete “${confirmDel.name || 'this document'}”? This cannot be undone.` : ''}
        onCancel={()=>setConfirmDel(null)}
        onConfirm={()=>{ const d=confirmDel; setConfirmDel(null); del(d) }}
      />
      <div className="page-header">
        <div><h1>Documents</h1><p>All client files and documents</p></div>
        <button className="btn primary" onClick={()=>setModal(true)}>＋ Upload Document</button>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <input className="input" placeholder="Search documents…" value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:280}} />
          <select className="select" value={clientFilter} onChange={e=>setClientFilter(e.target.value)} style={{maxWidth:220}}>
            <option value="">All Clients & Leads</option>
            {people.map(p=><option key={p.key} value={p.key}>{p.name}{p.type==='lead'?' (Lead)':''}</option>)}
          </select>
          <select className="select" value={folder} onChange={e=>setFolder(e.target.value)} style={{maxWidth:200}}>
            <option value="All">All Folders</option>
            {ALL_FOLDERS.map(f=><option key={f}>{f}</option>)}
          </select>
          <div style={{marginLeft:'auto',display:'flex',gap:6}}>
            <button className={`btn sm ${viewMode==='grid'?'primary':''}`} onClick={()=>changeView('grid')} title="Grid view">▦</button>
            <button className={`btn sm ${viewMode==='list'?'primary':''}`} onClick={()=>changeView('list')} title="List view">☰</button>
            <button className={`btn sm ${viewMode==='table'?'primary':''}`} onClick={()=>changeView('table')} title="Table view">▤</button>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          {!addingFolder ? (
            <button className="btn sm" onClick={()=>setAddingFolder(true)}>＋ New Folder</button>
          ) : (
            <>
              <input className="input" autoFocus placeholder="Folder name" value={newFolderName} onChange={e=>setNewFolderName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveCustomFolder();if(e.key==='Escape')setAddingFolder(false)}} style={{maxWidth:220}} />
              <button className="btn sm primary" onClick={saveCustomFolder}>Save</button>
              <button className="btn sm" onClick={()=>setAddingFolder(false)}>Cancel</button>
            </>
          )}
        </div>
      )}

      {filtered.length===0 ? (
        <div className="card" style={{textAlign:'center',padding:48,color:'var(--t3)'}}>
          <div style={{fontSize:40,marginBottom:12}}>📁</div>
          <div style={{fontWeight:700,color:'var(--tx)',marginBottom:6}}>No documents found</div>
          <div style={{fontSize:13}}>Upload your first document to get started.</div>
        </div>
      ) : viewMode === 'table' ? (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table className="data-table"><thead><tr>
            {[['name','Name'],['client','Client / Lead'],['docType','Folder'],['file_size','Size'],['created_at','Date']].map(([col,label])=><th key={col} onClick={()=>toggleSort(col)} style={{cursor:'pointer'}}>{label} {sortCol===col?(sortDir==='asc'?'↑':'↓'):''}</th>)}
            <th>Actions</th>
          </tr></thead><tbody>
            {filtered.map(d=><tr key={d.id}>
              <td><span style={{marginRight:8}}>{fileIcon(d.file_name)}</span><strong>{d.name || 'Untitled document'}</strong></td>
              <td>{d.client||'—'}</td><td>{d.docType||'—'}</td><td>{fmtSize(d.file_size)}</td><td>{fmtDate(d.created_at)}</td>
              <td><div style={{display:'flex',gap:5}}>{d.file_url&&<button className="btn sm" onClick={()=>openDocument(d)}>Open</button>}<button className="btn sm" onClick={()=>addNote(d)}>✏️</button>{isAdmin&&<button className="btn sm danger" onClick={()=>setConfirmDel(d)}>🗑</button>}</div></td>
            </tr>)}
          </tbody></table>
        </div>
      ) : viewMode === 'list' ? (
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {filtered.map(d=><div key={d.id} className="card" style={{padding:'10px 14px',display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:24}}>{fileIcon(d.file_name)}</span>
            <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,color:'var(--tx)'}}>{d.name || 'Untitled document'}</div><div style={{fontSize:11,color:'var(--t3)'}}>{d.client||'General'} · {d.docType||'Unfiled'} · {fmtSize(d.file_size)} · {fmtDate(d.created_at)}</div></div>
            {d.file_url&&<button className="btn sm" onClick={()=>openDocument(d)}>Open</button>}
            <button className="btn sm" onClick={()=>addNote(d)}>✏️</button>
            {isAdmin&&<button className="btn sm danger" onClick={()=>setConfirmDel(d)}>🗑</button>}
          </div>)}
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'22px 28px',alignItems:'start'}}>
          {filtered.map(doc=>{
            const cardUrl=cardPreviewUrls[doc.id]||''
            const isPdf=docPreviewKind(doc)==='pdf'
            const isImage=docPreviewKind(doc)==='image'
            return (
              <div key={doc.id} style={{minWidth:0}}>
                <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8,marginBottom:6}}>
                  <div style={{fontSize:12,fontWeight:800,color:'var(--tx)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{doc.name||docDisplayName(doc)}</div>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--t3)',whiteSpace:'nowrap'}}>{fmtDate(doc.created_at)}</div>
                </div>
                <div style={{border:'1px solid var(--br)',borderRadius:4,overflow:'hidden',background:'#fff',boxShadow:'0 1px 2px rgba(0,0,0,.08)'}}>
                  <div style={{height:28,display:'flex',alignItems:'center',gap:7,padding:'0 9px',background:'#69b8ee',color:'#fff',fontSize:10,fontWeight:800}}>
                    <span style={{width:9,height:9,border:'1px solid rgba(255,255,255,.75)',display:'inline-block'}}/>
                    <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{doc.docType||'Document'}</span>
                    <span style={{marginLeft:'auto',fontSize:10}}>{docExt(doc).toUpperCase()}</span>
                  </div>
                  <button type="button" onClick={()=>previewDocument(doc)} style={{display:'block',width:'100%',height:295,padding:0,border:0,background:'#fff',cursor:doc.file_url?'pointer':'default',position:'relative',overflow:'hidden'}}>
                    {isPdf&&cardUrl ? (
                      <iframe src={cardUrl+'#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH'} title={'Document thumbnail '+doc.id} style={{width:'100%',height:'100%',border:0,pointerEvents:'none',background:'#fff'}}/>
                    ) : isImage&&cardUrl ? (
                      <img src={cardUrl} alt={docDisplayName(doc)} style={{width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none',background:'#fff'}}/>
                    ) : (
                      <div style={{height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'#7b8794'}}>
                        <div style={{fontSize:40}}>{fileIcon(docDisplayName(doc))}</div>
                        <div style={{fontSize:11,fontWeight:700}}>{doc.file_url?'Document preview':'No file attached'}</div>
                      </div>
                    )}
                  </button>
                  <div style={{minHeight:32,display:'flex',alignItems:'center',gap:7,padding:'0 9px',background:'#f3f5fb',borderTop:'1px solid #e1e5ec',fontSize:10,color:'#394150'}}>
                    <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{doc.client||'General'}</span>
                    <span style={{marginLeft:'auto'}}>{doc.file_size?fmtSize(doc.file_size):''}</span>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:5,marginTop:7,flexWrap:'wrap'}}>
                  {doc.file_url&&<>
                    <button className="btn sm" style={{fontSize:10,padding:'4px 7px'}} onClick={()=>previewDocument(doc)}>Preview</button>
                    <button className="btn sm" style={{fontSize:10,padding:'4px 7px'}} onClick={()=>openDocument(doc)}>Open ↗</button>
                  </>}
                  <button className="btn sm" onClick={()=>addNote(doc)}>✏️</button>
                  {isAdmin&&<button className="btn sm danger" onClick={()=>setConfirmDel(doc)}>🗑</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}}

      {previewDoc&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setPreviewDoc(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{width:'min(1100px,94vw)',height:'min(820px,88vh)',display:'flex',flexDirection:'column',padding:0,overflow:'hidden'}}>
            <div className="modal-header" style={{padding:'10px 14px'}}>
              <div style={{minWidth:0}}>
                <h2 style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',margin:0}}>{docDisplayName(previewDoc)}</h2>
                <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>{previewDoc.client||'General'} · {previewDoc.docType||'Other'}{previewDoc.file_size?` · ${fmtSize(previewDoc.file_size)}`:''}</div>
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                {previewUrl&&<button className="btn sm" onClick={()=>openDocument(previewDoc)}>Open ↗</button>}
                <button className="modal-close" onClick={()=>setPreviewDoc(null)}>×</button>
              </div>
            </div>
            <div style={{flex:1,minHeight:0,background:'#222',position:'relative'}}>
              {previewLoading?<div style={{padding:40,textAlign:'center',color:'#fff'}}>Loading secure preview…</div>
              :!previewUrl?<div style={{padding:40,textAlign:'center',color:'#fff'}}>Preview unavailable.</div>
              :docPreviewKind(previewDoc)==='pdf'?<iframe title={docDisplayName(previewDoc)} src={previewUrl} style={{width:'100%',height:'100%',border:0,background:'#fff'}}/>
              :docPreviewKind(previewDoc)==='image'?<div style={{width:'100%',height:'100%',overflow:'auto',textAlign:'center',padding:16}}><img src={previewUrl} alt={docDisplayName(previewDoc)} style={{maxWidth:'100%',height:'auto'}}/></div>
              :<div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',padding:30,textAlign:'center',color:'#fff'}}><div><div style={{fontSize:60,marginBottom:12}}>{fileIcon(docDisplayName(previewDoc))}</div><div style={{fontWeight:800,marginBottom:12}}>Preview not available for this file type</div><button className="btn primary" onClick={()=>openDocument(previewDoc)}>Open Document</button></div></div>}
            </div>
          </div>
        </div>
      )}

      {modal&&<div className="modal-overlay" onClick={()=>setModal(false)}><div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h2>Upload Document</h2><button className="modal-close" onClick={()=>setModal(false)}>×</button></div>
        <div className="form-group"><label>Document Name *</label><input className="input" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. 2024 Tax Return" /></div>
        <div className="form-group"><label>Client / Lead</label><select className="select" value={form.client} onChange={e=>setForm({...form,client:e.target.value})}><option value="">General / Unassigned</option>{people.map(p=><option key={p.key} value={p.key}>{p.name}{p.type==='lead'?' (Lead)':''}</option>)}</select></div>
        <div className="form-group"><label>Folder *</label><select className="select" value={form.docType} onChange={e=>setForm({...form,docType:e.target.value})}>{ALL_FOLDERS.map(f=><option key={f}>{f}</option>)}</select></div>
        <div className="form-group"><label>File</label><input ref={fileRef} type="file" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;const v=validateFile(f);if(!v.ok){showToast('❌ '+v.error);e.target.value='';return}if(v.warn)showToast('⚠️ '+v.warn);const c=await maybeCompressImage(f);setFile(c)}} /></div>
        <div className="form-group"><label>Notes</label><textarea className="textarea" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button className="btn" onClick={()=>setModal(false)}>Cancel</button><button className="btn primary" disabled={saving} onClick={upload}>{saving?'Saving…':'Upload'}</button></div>
      </div></div>}
    </div>
  )
}
