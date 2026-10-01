import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { logActivity, getActor } from '../lib/activityLog'
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { applyWorkflowTemplate } from '../lib/triggerWorkflow'

const BLANK = { title:'', clientName:'', caseNum:'', assignedTo:'', dueDate:'', priority:'Normal', notes:'', done:false, section_title:'' }
const QT_BLANK = { title:'', dueDate:'', priority:'Normal', clientName:'', assignedTo:'' }
// Mirrors the quick-pick list in Clients.jsx / Leads.jsx so the Tasks-page
// Add Task modal and Quick Add row offer the same common tasks. Keep in sync.
const QUICK_TASK_TITLES = ['Request transcripts from IRS','Follow up with client','Prepare & send POA (2848/8821)','Call IRS for account status','Draft engagement letter','Collect financial documents','File tax return','Submit installment agreement','Prepare Offer in Compromise','Follow up on offer','Request wage & income transcripts','Schedule consultation','Send resolution options','Collect payment / trade']

function resolveActorName(user, employees) {
  const email = user?.email?.toLowerCase()
  const emp = email ? employees.find(e => e.email && e.email.toLowerCase() === email) : null
  return emp?.name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
}

export default function Tasks() {
  const { user, myTenantId } = useApp()
  const navigate = useNavigate()

  // Jump from a task to the client/lead file it belongs to.
  function openLinkedFile(name) {
    if (!name) return
    const c = clients.find(x => x.name === name)
    if (c) { navigate(`/clients/${c.id}`); return }
    const l = leads.find(x => x.name === name)
    if (l) { navigate(`/leads/${l.id}`); return }
  }
  const [tasks,     setTasks]     = useState([])
  const [deleted,   setDeleted]   = useState([])   // soft-deleted tasks
  const [clients,   setClients]   = useState([])
  const [leads,     setLeads]     = useState([])
  const [employees, setEmployees] = useState([])
  const [statusCategories, setStatusCategories] = useState([]) // [{...category, statuses:[...]}]
    const [modal,     setModal]     = useState(false)
  const [searchParams] = useSearchParams()
  useEffect(() => { if (searchParams.get('new') === '1') { setForm(BLANK); setModal(true) } }, [searchParams])
  const [form,      setForm]      = useState(BLANK)
  // Additional sub-task titles being built in the same Add Task session —
  // lets someone create a whole section (main task + N sub-tasks) in one
  // go, instead of reopening the modal repeatedly (Karbon-style).
  const [subtasks,  setSubtasks]  = useState([])
  const [qtForm,    setQt]        = useState(QT_BLANK)
  const [sug,       setSug]       = useState([])
  const [qtSug,     setQtSug]     = useState([])
  const [saving,    setSaving]    = useState(false)
  // Workflow-template picker (mirrors Clients.jsx / Leads.jsx). templateTarget
  // holds the resolved client/lead the picker will apply against, since the
  // global Tasks modal has no implicit entity like the per-record pages do.
  const [templateModal,       setTemplateModal]       = useState(false)
  const [availableTemplates,  setAvailableTemplates]  = useState([])
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([])
  const [templateSearch,      setTemplateSearch]      = useState('')
  const [applyingTemplateId,  setApplyingTemplateId]  = useState('')
  const [templateTarget,      setTemplateTarget]      = useState({ name:'', type:null })
  const [confirmDelId, setConfirmDelId] = useState(null)
  const [toast,     setToast]     = useState('')
  const [view,      setView]      = useState('open') // 'open' | 'completed' | 'deleted'
  const [collapsedSections, setCollapsedSections] = useState({}) // key -> true when manually collapsed
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [filterPri, setFilterPri] = useState('All')
  const [filterAssign, setFilterAssign] = useState('All')
  const [sortBy, setSortBy] = useState('dueDate') // 'dueDate' | 'priority' | 'created'

  useEffect(() => {
    if (!myTenantId) return
    load()
    // Request notification permission for reminders
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [myTenantId])

  // Check for due tasks and show browser notifications
  useEffect(() => {
    if (!tasks.length) return
    const today = new Date().toISOString().slice(0,10)
    const dueSoon = tasks.filter(t => !t.done && t.dueDate && t.dueDate <= today)
    if (dueSoon.length > 0 && Notification.permission === 'granted') {
      dueSoon.forEach(t => {
        const overdue = t.dueDate < today
        new Notification(`${overdue?'⚠️ OVERDUE':'📅 Due Today'}: ${t.title}`, {
          body: `${t.clientName ? 'Client: '+t.clientName+'\n' : ''}Priority: ${t.priority||'Normal'}`,
          icon: '/favicon.ico',
          tag: 'task-'+t.id,
        })
      })
    }
  }, [tasks])
  useEffect(() => {
    // Check the current user's role only after the tenant is resolved.
    if (user?.email && myTenantId) checkRole(user.email)
  }, [user, myTenantId])

  async function checkRole(email) {
    const { data } = await supabase.from('employees').select('access').eq('tenant_id', myTenantId).eq('email', email).maybeSingle()
    if (data?.access === 'Super Admin') setIsSuperAdmin(true)
    // Also check against known super admin email directly
    if (email === 'romy@taxcasereview.org') setIsSuperAdmin(true)
  }

  async function load() {
    const [{ data:t },{ data:dt },{ data:c },{ data:lds },{ data:e },{ data:cats },{ data:sts }] = await Promise.all([
      // `not is true` rather than `eq false`: a task inserted without the column
      // set is NULL, and eq('deleted', false) hid those from this page entirely
      // — so they could never be deleted from here while still showing on the
      // lead and client tabs.
      supabase.from('tasks').select('*').eq('tenant_id', myTenantId).not('deleted','is',true).order('created_at',{ascending:false}),
      supabase.from('tasks').select('*').eq('tenant_id', myTenantId).eq('deleted', true).order('deleted_at',{ascending:false}),
      supabase.from('clients').select('id,name').eq('tenant_id', myTenantId),
      supabase.from('leads').select('id,name').eq('tenant_id', myTenantId),
      supabase.from('employees').select('id,name,email,avatar_url').eq('tenant_id', myTenantId),
      supabase.from('workflow_status_categories').select('*').eq('tenant_id', myTenantId).order('sort_order'),
      supabase.from('workflow_statuses').select('*').eq('tenant_id', myTenantId).order('sort_order'),
    ])
    // Handle case where 'deleted' column may not exist yet — fall back gracefully
    if (t) setTasks(t)
    else {
      const { data: fallback } = await supabase.from('tasks').select('*').eq('tenant_id', myTenantId).order('created_at',{ascending:false})
      if (fallback) setTasks(fallback)
    }
    if (dt) setDeleted(dt)
    if (c) setClients(c)
    if (lds) setLeads(lds)
    if (e) setEmployees(e)
    if (cats) setStatusCategories(cats.map(cat => ({ ...cat, statuses: (sts||[]).filter(s => s.category_id === cat.id) })))
  }

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(''),3500)}
  function fld(k,v){setForm(f=>({...f,[k]:v}))}

  function searchClient(val, isQt=false) {
    if (isQt) setQt(f=>({...f,clientName:val})); else fld('clientName',val)
    if (val.length<2){isQt?setQtSug([]):setSug([]);return}
    const res=clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    isQt?setQtSug(res):setSug(res)
  }

  // The Tasks page is global, so a workflow template needs to know WHICH
  // client/lead it targets and whether that entity is a client or a lead
  // (templates are scoped by entity_type). Resolve from the already-loaded
  // lists rather than re-querying.
  function resolveEntity(name) {
    const n = (name||'').trim()
    if (!n) return { name:'', type:null }
    if (clients.some(c => c.name === n)) return { name:n, type:'client' }
    if (leads.some(l => l.name === n))   return { name:n, type:'lead' }
    return { name:n, type:null }
  }

  async function openTemplatePicker(name) {
    const target = resolveEntity(name)
    if (!target.type) { showToast('Pick an existing client or lead first to apply a workflow template'); return }
    const types = target.type === 'client' ? ['client','both'] : ['lead','both']
    const { data } = await supabase.from('workflow_templates')
      .select('id,name,description').in('entity_type',types).eq('active',true).order('name')
    setAvailableTemplates(data || [])
    setTemplateSearch('')
    setSelectedTemplateIds([])
    setTemplateTarget(target)
    setModal(false)   // close the Add Task modal if it was open (mirrors Clients.jsx)
    setTemplateModal(true)
  }

  function toggleTemplateSelection(id) {
    setSelectedTemplateIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function applySelectedTemplates() {
    if (!selectedTemplateIds.length || !templateTarget.type) return
    setApplyingTemplateId('__batch__')
    const actorName = resolveActorName(user, employees)
    const result = await applyWorkflowTemplate(selectedTemplateIds, templateTarget.name, actorName, templateTarget.type)
    setApplyingTemplateId('')
    if (result?.error) { showToast('❌ ' + result.error); return }
    const names = availableTemplates.filter(t => selectedTemplateIds.includes(t.id)).map(t => t.name).join(', ')
    setTemplateModal(false)
    showToast(`✅ Applied "${names}" — ${result.count} task(s) created`)
    load()
  }

  async function save(data) {
    if (!data.title.trim()){showToast('Title required');return}
    setSaving(true)
    const sectionTitle = data.section_title?.trim() || null
    const extraTitles = subtasks.map(s=>s.trim()).filter(Boolean)
    // If there are extra sub-tasks but no section name was given, use the
    // main task's own title as the section heading so they still group.
    const effectiveSection = extraTitles.length && !sectionTitle ? data.title.trim() : sectionTitle
    const linkedClient = clients.find(x => x.name === data.clientName)
    const base = { clientName:data.clientName, client_id:linkedClient?.id || null, caseNum:data.caseNum, assignedTo:data.assignedTo, dueDate:data.dueDate, priority:data.priority, done:false, deleted:false, created_at:new Date().toISOString() }
    const rows = [
      { ...base, title:data.title, notes:data.notes, section_title:effectiveSection },
      ...extraTitles.map(t => ({ ...base, title:t, notes:'', section_title:effectiveSection })),
    ]
    const {error} = await supabase.from('tasks').insert(rows)
    setSaving(false)
    if (error){showToast('❌ '+error.message);return}
    showToast(rows.length>1 ? `✅ ${rows.length} tasks added!` : '✅ Task added!')
    setModal(false); setForm(BLANK); setQt(QT_BLANK); setSubtasks([]); load()
    const _ta=getActor(user); await logActivity(supabase,{employeeName:_ta.name,employeeEmail:_ta.email,action:'task_created',category:'task',description:`Created task: ${form.title}`,entityName:form.clientName,meta:{assignedTo:form.assignedTo,priority:form.priority}}).catch(()=>{})
  }

  async function toggleDone(t) {
    const { error } = await supabase.from('tasks').update({done:!t.done}).eq('id',t.id)
    if (error) { showToast('❌ ' + error.message); return }
    load()
  }

  async function updateTaskStatus(t, value) {
    if (!value) {
      const { error } = await supabase.from('tasks').update({status_category:null, status_label:null}).eq('id',t.id)
      if (error) { showToast('❌ ' + error.message); return }
      load()
      return
    }
    const [category, label] = value.split('|||')
    // "Completed" category also flips the done flag so existing done-based
    // logic elsewhere (dashboards, counts) stays correct.
    const completed = statusCategories.find(c=>c.name===category)?.name?.toLowerCase() === 'completed'
    const prevLabel = t.status_label || (t.done ? 'Completed' : 'Ready to Start')
    const { error: statusErr } = await supabase.from('tasks').update({status_category:category, status_label:label, done:completed}).eq('id',t.id)
    if (statusErr) { showToast('❌ ' + statusErr.message); return }

    // Log a note on whichever entity this task is linked to.
    if (t.clientName) {
      const actor = resolveActorName(user, employees)
      const noteText = `🔄 Task status changed: "${t.title}" — ${prevLabel} → ${label}`
      const lead = leads.find(l => l.name === t.clientName)
      if (lead) {
        await supabase.from('lead_notes').insert([{
          lead_id: lead.id, lead_name: lead.name,
          text: noteText, type: 'System', author: actor, created_at: new Date().toISOString()
        }])
      } else if (clients.find(c => c.name === t.clientName)) {
        await supabase.from('client_notes').insert({
          clientname: t.clientName, text: noteText, author: actor, created_at: new Date().toISOString()
        })
      }
    }
    load()
  }

  // Add a sub-task under an existing task/group. If the parent task doesn't
  // have a section yet, this promotes it (uses its own title as the section
  // heading) so it and the new sibling now group together. Existing
  // standalone tasks are otherwise completely unaffected until this is used.
  async function addSubtask(parent) {
    const sectionTitle = parent.section_title || parent.title
    if (parent.id && !parent.section_title) {
      await supabase.from('tasks').update({ section_title: sectionTitle }).eq('id', parent.id)
      setTasks(prev => prev.map(x => x.id === parent.id ? { ...x, section_title: sectionTitle } : x))
    }
    setForm({ ...BLANK, clientName: parent.clientName || '', section_title: sectionTitle })
    setModal(true)
  }

  // Soft delete — sets deleted=true, records timestamp
  async function softDelete(id) {
    const {error} = await supabase.from('tasks').update({deleted:true, deleted_at:new Date().toISOString()}).eq('id',id)
    if (error) {
      const { error: hardErr } = await supabase.from('tasks').delete().eq('id',id)
      if (hardErr) { showToast('❌ ' + hardErr.message); return }
      setTasks(prev => prev.filter(t => t.id !== id))
      showToast('Task deleted')
    } else {
      setTasks(prev => prev.map(t => t.id === id ? {...t, deleted:true, deleted_at:new Date().toISOString()} : t))
      showToast('Task moved to deleted')
    }
  }

  // Restore a deleted task (Super Admin only)
  async function restore(id) {
    const {error} = await supabase.from('tasks').update({deleted:false, deleted_at:null}).eq('id',id)
    if (error){showToast('❌ '+error.message);return}
    setTasks(prev => prev.map(t => t.id === id ? {...t, deleted:false, deleted_at:null} : t))
    showToast('✅ Task restored!')
  }

  // Permanent delete (Super Admin only)
  async function permDelete(id) {
    if (!window._confirmDel) { setConfirmDelId(id); return }
    window._confirmDel = false
    const { error } = await supabase.from('tasks').delete().eq('id',id)
    if (error) { showToast('❌ ' + error.message); return }
    setTasks(prev => prev.filter(t => t.id !== id)); showToast('Permanently deleted')
  }

  const reps = employees.length>0 ? employees.map(e=>e.name) : ['Romy Cruz','Dana Richard','Yesenia Gonzalez']
  const today2 = new Date().toISOString().slice(0,10)
  const PRIORITY_ORDER = { 'High':0, 'Normal':1, 'Low':2, '':3 }
  const allOpen = tasks.filter(t=>!t.done && !t.deleted)
  const open = allOpen
    .filter(t => filterPri === 'All' || (t.priority||'Normal') === filterPri)
    .filter(t => filterAssign === 'All' || t.assignedTo === filterAssign)
    .sort((a,b) => {
      if (sortBy === 'priority') return (PRIORITY_ORDER[a.priority||'']||1) - (PRIORITY_ORDER[b.priority||'']||1)
      if (sortBy === 'dueDate') {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1; if (!b.dueDate) return -1
        return a.dueDate.localeCompare(b.dueDate)
      }
      return (b.created_at||'').localeCompare(a.created_at||'')
    })
  const completed = tasks.filter(t=>t.done  && !t.deleted)
  const assignees = [...new Set(tasks.filter(t=>t.assignedTo).map(t=>t.assignedTo))].sort()
  const pc = p => p==='Urgent'?'br':p==='High'?'ba':'bn'

  // Group tasks sharing a client + section_title (Karbon-style grouped
  // sub-tasks). Tasks with no section_title each remain their own group of
  // one and render exactly as before -- no visual change for existing data.
  function groupTasks(list) {
    const groups = []
    const byKey = new Map()
    list.forEach(t => {
      const key = t.section_title ? `${t.clientName||''}::${t.section_title}` : `t-${t.id}`
      if (!byKey.has(key)) {
        const g = { key, section_title: t.section_title || null, clientName: t.clientName, tasks: [] }
        byKey.set(key, g)
        groups.push(g)
      }
      byKey.get(key).tasks.push(t)
    })
    return groups
  }
  const openGroups = groupTasks(open)

  const AVATAR_PALETTE = ['#e8590c','#2563eb','#16a34a','#9333ea','#d97706','#0891b2','#dc2626','#4f46e5']
  function avatarColor(name){
    const s = name || '?'
    let hash = 0
    for (let i=0;i<s.length;i++) hash = s.charCodeAt(i) + ((hash<<5)-hash)
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
  }
  function initials(name){ return (name||'?').trim().split(/\s+/).filter(Boolean).map(p=>p[0]).join('').slice(0,2).toUpperCase() || '?' }

  function TaskItem({t, showRestore=false, onAddSub}) {
    const emp = employees.find(e => e.name && t.assignedTo && e.name.toLowerCase()===t.assignedTo.toLowerCase())
    const overdue = t.dueDate && new Date(t.dueDate)<new Date() && !t.done
    return (
      <div style={{display:'flex',gap:10,alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--br)'}}>
        {/* Checkbox */}
        <div
          onClick={()=>!showRestore&&toggleDone(t)}
          style={{
            width:20,height:20,borderRadius:5,flexShrink:0,cursor:showRestore?'default':'pointer',
            border:'1.5px solid var(--b2c)',
            background:t.done?'var(--ok)':'var(--s2)',
            display:'flex',alignItems:'center',justifyContent:'center',
            color:'#fff',fontSize:12,fontWeight:700
          }}
        >{t.done?'✓':''}</div>

        {/* Content */}
        <div style={{flex:1,minWidth:0}}>
          <div style={{
            fontSize:13,fontWeight:t.done?400:600,
            textDecoration:t.done||showRestore?'line-through':'none',
            opacity:t.done||showRestore?0.55:1,
            color:'var(--tx)',
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'
          }}>{t.title}</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
            {t.clientName&&(()=>{const known=clients.some(c=>c.name===t.clientName)||leads.some(l=>l.name===t.clientName);return known?<span onClick={e=>{e.stopPropagation();openLinkedFile(t.clientName)}} style={{cursor:'pointer',color:'var(--blue)',textDecoration:'underline'}} title="Open file">🏢 {t.clientName} ↗</span>:<span>🏢 {t.clientName}</span>})()}
            {t.priority&&<span className={`bdg ${pc(t.priority)}`} style={{fontSize:9}}>{t.priority}</span>}
            {showRestore&&t.deleted_at&&<span style={{color:'var(--bad)'}}>Deleted {t.deleted_at?.slice(0,10)}</span>}
          </div>
          {t.notes&&<div style={{fontSize:11,color:'var(--t2)',marginTop:3,lineHeight:1.5}}>{t.notes}</div>}
        </div>

        {/* Status dropdown */}
        <div style={{width:150,flexShrink:0,position:'relative'}}>
          <select
            value={t.status_category && t.status_label ? `${t.status_category}|||${t.status_label}` : ''}
            onChange={e=>updateTaskStatus(t, e.target.value)}
            style={{
              width:'100%',fontSize:10,fontWeight:700,padding:'4px 20px 4px 6px',borderRadius:20,textAlign:'center',
              border:'1px solid rgba(148,163,184,.35)',cursor:'pointer',appearance:'none',WebkitAppearance:'none',
              background:t.done?'rgba(22,163,74,.15)':'rgba(148,163,184,.15)',
              color:t.done?'var(--ok)':'var(--tx)'
            }}
          >
            <option value="" style={{color:'#000',background:'#fff'}}>{t.done?'Completed':'Ready to Start'}</option>
            {statusCategories.map(cat => (
              <optgroup key={cat.id} label={cat.name} style={{color:'#000',background:'#fff'}}>
                <option value={`${cat.name}|||${cat.name}`} style={{color:'#000',background:'#fff',fontWeight:700}}>{cat.name} (general)</option>
                {cat.statuses.map(s => (
                  <option key={s.id} value={`${cat.name}|||${s.label}`} style={{color:'#000',background:'#fff'}}>{s.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',fontSize:9,color:t.done?'var(--ok)':'var(--tx)',pointerEvents:'none'}}>▾</span>
        </div>

        {/* Due date */}
        <div style={{width:112,flexShrink:0,textAlign:'center'}}>
          {t.dueDate ? (
            <span style={{
              fontSize:10.5,fontWeight:600,padding:'3px 9px',borderRadius:6,whiteSpace:'nowrap',
              background:overdue?'rgba(239,68,68,.12)':'rgba(148,163,184,.08)',
              color:overdue?'var(--bad)':'var(--t3)',
              border:`1px solid ${overdue?'rgba(239,68,68,.35)':'var(--br)'}`,
            }}>{overdue?'⚠ ':''}{t.dueDate}</span>
          ) : <span style={{fontSize:11,color:'var(--t3)',opacity:.5}}>—</span>}
        </div>

        {/* Assignee + avatar */}
        <div style={{width:130,flexShrink:0,display:'flex',alignItems:'center',gap:6,justifyContent:'flex-end'}}>
          {t.assignedTo && (
            <>
              <span style={{fontSize:11,color:'var(--t3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.assignedTo}</span>
              <div style={{width:24,height:24,borderRadius:'50%',flexShrink:0,overflow:'hidden',background:avatarColor(t.assignedTo),display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,color:'#fff'}}>
                {emp?.avatar_url ? <img src={emp.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : initials(t.assignedTo)}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div style={{display:'flex',gap:4,flexShrink:0}}>
          {!showRestore ? (
            <>
              {!t.done&&<button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>toggleDone(t)}>✓ Done</button>}
              {onAddSub&&<button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>onAddSub(t)}>+ Sub</button>}
              <button className="btn del" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>softDelete(t.id)}>Del</button>
            </>
          ) : isSuperAdmin ? (
            <>
              <button className="btn sec" style={{fontSize:12,padding:'4px 10px',color:'var(--ok)'}} onClick={()=>restore(t.id)}>↩ Restore</button>
              <button className="btn del" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>permDelete(t.id)}>☠ Perm</button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  // Stats bar
  const totalCreated   = tasks.length + deleted.length
  const totalCompleted = completed.length
  const totalDeleted   = deleted.length

  return (
    <div style={{padding:'20px 24px',maxWidth:1240,margin:'0 auto'}}>
      {toast&&<div className="toast show">{toast}</div>}

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{fontSize:17,fontWeight:700,margin:0}}>✅ Tasks</h2>
          <p style={{fontSize:12,color:'var(--t3)',margin:'4px 0 0'}}>Track and manage work assigned to the team.</p>
        </div>
        <button className="btn pri" onClick={()=>setModal(true)}>+ Add Task</button>
      </div>

      {/* One compact strip: counts double as the view switcher */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        {[
          ['open', 'Open', open.length, 'var(--b2)'],
          ['completed', 'Completed', totalCompleted, 'var(--ok)'],
          ...(isSuperAdmin ? [['deleted', '🗑 Deleted', totalDeleted, totalDeleted>0?'var(--bad)':'var(--t3)']] : []),
        ].map(([key,lbl,count,color])=>(
          <div key={key} onClick={()=>setView(key)}
            style={{
              display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderRadius:9,cursor:'pointer',
              border:`1px solid ${view===key?color:'var(--br)'}`,
              background:view===key?'var(--s2)':'transparent',
              transition:'all .12s ease',
            }}>
            <span style={{fontSize:12.5,fontWeight:view===key?700:500,color:view===key?'var(--tx)':'var(--t3)'}}>{lbl}</span>
            <span style={{fontSize:13,fontWeight:800,color}}>{count}</span>
          </div>
        ))}
        <span style={{marginLeft:'auto',fontSize:11.5,color:'var(--t3)'}}>{totalCreated} created all-time</span>
      </div>

      <div className="tasksg">
        {/* Left: task list */}
        <div>
          {/* Open tasks */}
          {view==='open'&&(
            <div className="card">
              <div className="ch">
                <span className="ct">Open Tasks ({open.length}{allOpen.length !== open.length ? ` / ${allOpen.length}` : ''})</span>
              </div>
              {/* Filter + Sort bar */}
              <div style={{ display:'flex', gap:6, padding:'0 16px 12px', flexWrap:'wrap', alignItems:'center' }}>
                <select value={filterPri} onChange={e=>setFilterPri(e.target.value)}
                  style={{ fontSize:11, padding:'4px 8px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6, color:'var(--tx)' }}>
                  <option value="All">All Priorities</option>
                  {['High','Normal','Low'].map(p=><option key={p}>{p}</option>)}
                </select>
                {assignees.length > 0 && (
                  <select value={filterAssign} onChange={e=>setFilterAssign(e.target.value)}
                    style={{ fontSize:11, padding:'4px 8px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6, color:'var(--tx)' }}>
                    <option value="All">All Assignees</option>
                    {assignees.map(a=><option key={a}>{a}</option>)}
                  </select>
                )}
                <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                  style={{ fontSize:11, padding:'4px 8px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6, color:'var(--tx)' }}>
                  <option value="dueDate">Sort: Due Date</option>
                  <option value="priority">Sort: Priority</option>
                  <option value="created">Sort: Newest</option>
                </select>
                {(filterPri!=='All'||filterAssign!=='All') && (
                  <button className="btn sec" style={{ fontSize:10, padding:'4px 8px' }} onClick={()=>{setFilterPri('All');setFilterAssign('All')}}>✕ Clear</button>
                )}
              </div>
              {open.length===0
                ?<div style={{color:'var(--t3)',fontSize:13,textAlign:'center',padding:'20px 0'}}>🎉 No open tasks!</div>
                :openGroups.map(g => g.section_title ? (
                    <div key={g.key} style={{marginBottom:12,borderRadius:9,overflow:'hidden',border:'1px solid var(--br)'}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 14px',background:'var(--s2)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',flex:1}}
                          onClick={()=>setCollapsedSections(prev=>({...prev,[g.key]:!prev[g.key]}))}>
                          <span style={{fontSize:11,color:'var(--t3)',transform:collapsedSections[g.key]?'none':'rotate(90deg)',transition:'transform .15s',display:'inline-block'}}>▶</span>
                          <div style={{fontSize:13,fontWeight:700,color:'var(--tx)'}}>
                            📋 {g.section_title}{g.clientName?<span onClick={e=>{e.stopPropagation();openLinkedFile(g.clientName)}} style={{fontWeight:400,color:'var(--blue)',cursor:'pointer',textDecoration:'underline'}} title="Open file"> · {g.clientName} ↗</span>:''}
                          </div>
                        </div>
                        <button className="btn sec" style={{fontSize:10.5,padding:'4px 10px',fontWeight:600,opacity:.85}} onClick={()=>addSubtask({clientName:g.clientName, section_title:g.section_title})}>+ Task</button>
                      </div>
                      {!collapsedSections[g.key] && (
                        <div style={{padding:'2px 14px 4px'}}>
                          {g.tasks.map(t=><TaskItem key={t.id} t={t} onAddSub={addSubtask}/>)}
                        </div>
                      )}
                    </div>
                  ) : (
                    g.tasks.map(t=><TaskItem key={t.id} t={t} onAddSub={addSubtask}/>)
                  )
                )
              }
            </div>
          )}

          {/* Completed */}
          {view==='completed'&&(
            <div className="card">
              <div className="ch"><span className="ct">Completed Tasks ({totalCompleted})</span></div>
              {totalCompleted===0
                ?<div style={{color:'var(--t3)',fontSize:13,padding:'8px 0'}}>No completed tasks yet</div>
                :completed.map(t=><TaskItem key={t.id} t={t}/>)
              }
            </div>
          )}

          {/* Deleted — Super Admin only */}
          {view==='deleted'&&isSuperAdmin&&(
            <div className="card" style={{borderColor:'var(--bad)'}}>
              <div className="ch">
                <span className="ct" style={{color:'var(--bad)'}}>🗑 Deleted Tasks ({totalDeleted})</span>
                <span style={{fontSize:11,color:'var(--t3)'}}>Super Admin View</span>
              </div>
              {totalDeleted===0
                ?<div style={{color:'var(--t3)',fontSize:13,padding:'8px 0'}}>No deleted tasks</div>
                :deleted.map(t=><TaskItem key={t.id} t={t} showRestore={true}/>)
              }
            </div>
          )}

          {/* Blocked non-admin */}
          {view==='deleted'&&!isSuperAdmin&&(
            <div className="card" style={{textAlign:'center',padding:40}}>
              <div style={{fontSize:32,marginBottom:8}}>🔒</div>
              <div style={{fontWeight:700}}>Super Admin Only</div>
              <div style={{fontSize:13,color:'var(--t3)',marginTop:4}}>You don't have permission to view deleted tasks.</div>
            </div>
          )}
        </div>

        {/* Right: Quick Add */}
        <div className="card">
          <div className="ch"><span className="ct">Quick Add Task</span></div>
          <div className="field"><label>Title *</label>
            <input value={qtForm.title} onChange={e=>setQt(f=>({...f,title:e.target.value}))}
              onKeyDown={e=>e.key==='Enter'&&save(qtForm)}
              placeholder="Task description"/>
          </div>
          <div style={{margin:'-4px 0 8px'}}>
            <select value="" onChange={e=>{if(e.target.value)setQt(f=>({...f,title:e.target.value}))}}
              style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--t2)',fontSize:12}}>
              <option value="">⚡ Quick-pick a common task…</option>
              {QUICK_TASK_TITLES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{marginTop:6,fontSize:11,color:'var(--t3)'}}>
              <span style={{color:'var(--blue)',cursor:'pointer',textDecoration:'underline'}}
                onClick={()=>openTemplatePicker(qtForm.clientName)}>Apply a workflow template →</span>
            </div>
          </div>
          <div className="fg2">
            <div className="field"><label>Due Date</label>
              <input type="date" value={qtForm.dueDate} onChange={e=>setQt(f=>({...f,dueDate:e.target.value}))}/>
            </div>
            <div className="field"><label>Priority</label>
              <select value={qtForm.priority} onChange={e=>setQt(f=>({...f,priority:e.target.value}))}>
                <option>Normal</option><option>High</option><option>Urgent</option>
              </select>
            </div>
          </div>
          <div className="fg2">
            <div className="field" style={{position:'relative'}}>
              <label>Linked Client</label>
              <input value={qtForm.clientName} onChange={e=>searchClient(e.target.value,true)} placeholder="Search..." autoComplete="off"/>
              {qtSug.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--s3)',border:'1px solid var(--b2c)',borderRadius:7,zIndex:500}}>
                  {qtSug.map(c=><div key={c.id} onClick={()=>{setQt(f=>({...f,clientName:c.name}));setQtSug([])}} style={{padding:'7px 12px',cursor:'pointer',fontSize:13}}>{c.name}</div>)}
                </div>
              )}
            </div>
            <div className="field"><label>Assigned To</label>
              <select value={qtForm.assignedTo} onChange={e=>setQt(f=>({...f,assignedTo:e.target.value}))}>
                <option value="">Unassigned</option>
                {reps.map(r=><option key={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={()=>save(qtForm)} disabled={saving}>
            {saving?'Adding…':'Add Task'}
          </button>


        </div>
      </div>

      {/* Full add modal */}
      {modal&&(
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&(setModal(false),setSubtasks([]))}>
          <div className="modal" style={{width:540}}>
            <div className="mh"><span className="mt">Add Task</span><button className="xbtn" onClick={()=>{setModal(false);setSubtasks([])}}>&times;</button></div>
            <div className="field"><label>Title *</label><input value={form.title} onChange={e=>fld('title',e.target.value)} placeholder="Task description"/></div>
            <div style={{margin:'-4px 0 8px'}}>
              <select value="" onChange={e=>{if(e.target.value)fld('title',e.target.value)}}
                style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--t2)',fontSize:12}}>
                <option value="">⚡ Quick-pick a common task…</option>
                {QUICK_TASK_TITLES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{marginTop:8,fontSize:11.5,color:'var(--t3)'}}>
                Need a full set of tasks?{' '}
                <span style={{color:'var(--blue)',cursor:'pointer',textDecoration:'underline'}}
                  onClick={()=>openTemplatePicker(form.clientName)}>Apply a workflow template →</span>
              </div>
            </div>
            <div className="field" style={{position:'relative'}}>
              <label>Client / Lead</label>
              <input value={form.clientName} onChange={e=>searchClient(e.target.value)} placeholder="Search clients..." autoComplete="off"/>
              {sug.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--s3)',border:'1px solid var(--b2c)',borderRadius:7,zIndex:500}}>
                  {sug.map(c=><div key={c.id} onClick={()=>{fld('clientName',c.name);setSug([])}} style={{padding:'7px 12px',cursor:'pointer',fontSize:13}}>{c.name}</div>)}
                </div>
              )}
            </div>
            <div className="fg2">
              <div className="field"><label>Section</label><input value={form.section_title||''} onChange={e=>fld('section_title',e.target.value)} placeholder="Optional — groups with other sub-tasks"/></div>
              <div className="field"><label>Case #</label><input value={form.caseNum} onChange={e=>fld('caseNum',e.target.value)}/></div>
            </div>
            <div style={{margin:'2px 0 4px'}}>
              <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--t3)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.04em'}}>Add More Tasks To This Section</label>
              {subtasks.map((s,i)=>(
                <div key={i} style={{display:'flex',gap:6,marginBottom:6}}>
                  <input value={s} onChange={e=>setSubtasks(arr=>arr.map((x,idx)=>idx===i?e.target.value:x))}
                    placeholder="Another task title…"
                    style={{flex:1,padding:'8px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:13}}/>
                  <button onClick={()=>setSubtasks(arr=>arr.filter((_,idx)=>idx!==i))}
                    style={{background:'none',border:'none',color:'var(--bad)',cursor:'pointer',fontSize:18,padding:'0 6px'}}>×</button>
                </div>
              ))}
              <button className="btn sec" style={{fontSize:11,padding:'5px 12px',fontWeight:600}} onClick={()=>setSubtasks(arr=>[...arr,''])}>+ Add Another Task</button>
            </div>
            <div className="fg2">
              <div className="field"><label>Assigned To</label>
                <select value={form.assignedTo} onChange={e=>fld('assignedTo',e.target.value)}>
                  <option value="">Unassigned</option>
                  {reps.map(r=><option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="field"><label>Due Date</label><input type="date" value={form.dueDate} onChange={e=>fld('dueDate',e.target.value)}/></div>
            </div>
            <div className="field"><label>Priority</label>
              <select value={form.priority} onChange={e=>fld('priority',e.target.value)}>
                <option>Normal</option><option>High</option><option>Urgent</option>
              </select>
            </div>
            <div className="field"><label>Notes</label><textarea value={form.notes} onChange={e=>fld('notes',e.target.value)} style={{minHeight:70}}/></div>
            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={()=>save(form)} disabled={saving}>
              {saving?'Saving…':'Add Task'}
            </button>
          </div>
        </div>
      )}
      {templateModal&&(
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setTemplateModal(false)}>
          <div className="modal" style={{width:480,maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
            <div className="mh">
              <span className="mt">📋 Apply Work Template — {templateTarget.name}</span>
              <button className="xbtn" onClick={()=>setTemplateModal(false)}>&times;</button>
            </div>
            <div style={{padding:'0 4px 12px'}}>
              <input value={templateSearch} onChange={e=>setTemplateSearch(e.target.value)} placeholder="Search templates..."
                style={{width:'100%',boxSizing:'border-box',padding:'9px 13px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:7,color:'var(--tx)',fontSize:13}}/>
            </div>
            <div style={{overflowY:'auto',flex:1}}>
              {availableTemplates.length===0 && (
                <div style={{color:'var(--t3)',fontSize:12,textAlign:'center',padding:'20px 0'}}>No active workflow templates for {templateTarget.type||'this'} yet. Build one in Workflows first.</div>
              )}
              {availableTemplates
                .filter(t => !templateSearch.trim() || t.name.toLowerCase().includes(templateSearch.toLowerCase()))
                .map(t => (
                  <div key={t.id} onClick={()=>!applyingTemplateId && toggleTemplateSelection(t.id)}
                    style={{padding:'12px 10px',borderBottom:'1px solid var(--br)',cursor:applyingTemplateId?'default':'pointer',opacity:applyingTemplateId?0.5:1,display:'flex',gap:10,alignItems:'flex-start'}}>
                    <input type="checkbox" checked={selectedTemplateIds.includes(t.id)} readOnly style={{marginTop:3}}/>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:'var(--tx)'}}>{t.name}</div>
                      {t.description&&<div style={{fontSize:11,color:'var(--t3)',marginTop:3,lineHeight:1.5}}>{t.description}</div>}
                    </div>
                  </div>
                ))
              }
            </div>
            <div style={{padding:'12px 4px 4px',borderTop:'1px solid var(--br)'}}>
              <button className="btn pri" style={{width:'100%'}} disabled={!selectedTemplateIds.length||!!applyingTemplateId} onClick={applySelectedTemplates}>
                {applyingTemplateId ? 'Applying…' : selectedTemplateIds.length ? `Apply Selected (${selectedTemplateIds.length})` : 'Select a template to apply'}
              </button>
            </div>
          </div>
        </div>
      )}
      <DeleteConfirmModal open={!!confirmDelId} label="task" onConfirm={() => { window._confirmDel=true; permDelete(confirmDelId); setConfirmDelId(null) }} onCancel={() => setConfirmDelId(null)} />
    </div>
  )
}
