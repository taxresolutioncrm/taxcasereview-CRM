// AdminPortal — TaxRes CRM founder/admin shell.
// Only renders for romy@taxrescrm.net. Full platform control:
// impersonation, per-office deep dive, billing, provisioning,
// demo management, system health, audit log, support, email.

import React, { useState, useEffect, Suspense, lazy, useCallback } from 'react'
import { ScreenShareProvider, useScreenShare } from '../context/ScreenShareContext'
import { Routes, Route, NavLink, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { FIRM, loadFirmBranding, loadFirmBrandingPublic } from '../lib/firmBranding'
import { useApp } from '../context/AppContext'
import AIAssistant from '../components/AIAssistant'
import { CallProvider, useCall } from '../context/CallContext'
import ActiveCallBar from '../components/calling/ActiveCallBar'
import RomyLabsBilling from '../components/admin/RomyLabsBilling'
import TrafficCoverage from '../components/admin/TrafficCoverage'
import CredentialVault from '../components/admin/CredentialVault'
import UniversalOfficeESign from '../components/admin/UniversalOfficeESign'
const AdminChatPage = lazy(() => import('./AdminChat'))

const ESignaturesHub = lazy(() => import('./ESignaturesHub'))
const NewOffice    = lazy(() => import('./NewOffice'))
const Support      = lazy(() => import('./Support'))
const CalendarPage = lazy(() => import('./Calendar'))
const TrainingPage = lazy(() => import('./MeetTrainingHub'))

// ── Constants ────────────────────────────────────────────────────────────────
const TCR_TENANT      = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
const DEMO_TENANT     = '489ace07-1a6b-4864-833a-4f8420568b40'
const TAXRESCRM_TENANT = 'a0000000-0000-0000-0000-000000000001'
const STATUS_COLOR = { active:'#10b981', trial:'#f59e0b', past_due:'#f97316', cancelled:'#ef4444', suspended:'#ef4444' }
const TIER_COLOR   = { starter:'#6366f1', growth:'#0ea5e9', pro:'#10b981' }

// ── ErrorBoundary — catches crashes in individual routes without killing the portal ──
class AdminRouteErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('[AdminPortal] Route crashed:', error, info) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>This page encountered an error</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>{this.state.error?.message || 'Unknown error'}</div>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}>
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}


function fmtBytes(n) {
  if (!n) return '0 B'
  if (n < 1048576)    return (n/1024).toFixed(0) + ' KB'
  if (n < 1073741824) return (n/1048576).toFixed(1) + ' MB'
  return (n/1073741824).toFixed(2) + ' GB'
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—' }
function fmtAgo(d) {
  if (!d) return 'Never'
  const s = (Date.now()-new Date(d).getTime())/1000
  if (s < 60) return 'Just now'
  if (s < 3600) return Math.floor(s/60)+'m ago'
  if (s < 86400) return Math.floor(s/3600)+'h ago'
  if (s < 604800) return Math.floor(s/86400)+'d ago'
  return fmtDate(d)
}

// ── Shared UI primitives ─────────────────────────────────────────────────────
const S = {
  card: { background:'rgba(255,255,255,.03)', border:'1px solid rgba(99,102,241,.2)', borderRadius:14, overflow:'hidden' },
  th:   { padding:'10px 16px', fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', textAlign:'left', borderBottom:'1px solid rgba(99,102,241,.12)' },
  td:   { padding:'11px 16px', borderBottom:'1px solid rgba(99,102,241,.07)', fontSize:13 },
  badge:(color,bg)=>({ fontSize:10, fontWeight:700, padding:'2px 9px', borderRadius:20, textTransform:'capitalize', background:bg||color+'22', color }),
  btn:  (variant='primary')=>({
    padding:'8px 18px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:13,
    ...(variant==='primary'   ? { background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff' }
      : variant==='danger'    ? { background:'rgba(239,68,68,.12)', color:'#ef4444', border:'1px solid rgba(239,68,68,.3)' }
      : variant==='ghost'     ? { background:'rgba(99,102,241,.1)', color:'#a5b4fc', border:'1px solid rgba(99,102,241,.25)' }
      :                         { background:'rgba(255,255,255,.06)', color:'#94a3b8', border:'1px solid rgba(255,255,255,.1)' })
  }),
}

function Toast({ msg, type='ok' }) {
  if (!msg) return null
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, padding:'12px 20px', borderRadius:10,
      background: type==='error' ? '#7f1d1d' : '#14532d', color:'#fff', fontWeight:600, fontSize:13,
      boxShadow:'0 8px 32px rgba(0,0,0,.4)' }}>{msg}</div>
  )
}

function Spinner() {
  return <div style={{ padding:48, textAlign:'center', color:'#475569', fontSize:13 }}>Loading…</div>
}

const EXTERNAL_OFFICE_PRODUCTS = {
  arcvena:  { label:'Arcvena',  color:'#00c2ff', appUrl:'https://app.arcvena.com/' },
  camvella: { label:'Camvella', color:'#55B96A', appUrl:'https://app.camvella.com/' },
  bocasync: { label:'BocaSync', color:'#22c7d3', appUrl:'https://app.bocasync.com/' },
}

async function loadPlatformOfficeRows() {
  const { data: taxresRows, error: taxresError } = await supabase.rpc('admin_tenant_overview')
  if (taxresError) throw taxresError

  const rows = [...(taxresRows || [])]
  const warnings = []
  const productKeys = Object.keys(EXTERNAL_OFFICE_PRODUCTS)
  const results = await Promise.all(productKeys.map(async productKey => {
    const response = await supabase.functions.invoke('hub-proxy', { body:{ product:productKey } })
    return { productKey, ...response }
  }))

  for (const result of results) {
    const cfg = EXTERNAL_OFFICE_PRODUCTS[result.productKey]
    const offices = Array.isArray(result.data?.offices) ? result.data.offices : null
    if (result.error || !offices) {
      warnings.push(`${cfg.label} offices unavailable`)
      continue
    }
    for (const office of offices) {
      rows.push({
        id: `${result.productKey}:${office.id}`,
        source_id: office.id,
        product: result.productKey,
        firm_name: office.name || `${cfg.label} Office`,
        brand_color: cfg.color,
        employee_count: 0,
        client_count: 0,
        lead_count: 0,
        storage_bytes: 0,
        total_collected: 0,
        transaction_count: 0,
        status: office.is_active === false ? 'inactive' : 'active',
        plan_tier: cfg.label,
        effective_monthly: Number(office.mrr || 0),
        last_activity: office.since || null,
      })
    }
    if (result.data?.ok === false) warnings.push(`${cfg.label} metrics are partial`)
  }

  return { rows, warnings }
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
// Operational items only — Marketing/Content/LinkedIn/Search/System live in Command Center tabs
const NAV = [
  { path:'/crm-admin',                label:'Overview',        icon:'📊' },
  { path:'/crm-admin/command-center', label:'Command Center', icon:'⚡' },
  { path:'/crm-admin/traffic',        label:'Traffic Coverage', icon:'🌐' },
  { path:'/crm-admin/vault',          label:'Credential Vault', icon:'🔐' },
  { path:'/crm-admin/email',          label:'Email',          icon:'📧' },
  { path:'/crm-admin/dialer',         label:'Communications', icon:'📞' },
  { path:'/crm-admin/calendar',       label:'Calendar',       icon:'📅' },
  { path:'/crm-admin/meet',           label:'Meet & Training', icon:'🎥' },
  { path:'/crm-admin/chat',           label:'Chat (All)',      icon:'💬' },
  { path:'/crm-admin/provision',      label:'+ New Office',   icon:'➕' },
  { path:'/crm-admin/offices',        label:'Offices',         icon:'🏢' },
  { path:'/crm-admin/esign',          label:'E-Signatures',    icon:'✍️' },
  { path:'/crm-admin/demo',           label:'Demo Mgmt',       icon:'🎭' },
  { path:'/crm-admin/employees',      label:'Employees',       icon:'👥' },
  { path:'/crm-admin/support',        label:'Support',         icon:'🎫' },
  { path:'/crm-admin/audit',          label:'Audit Log',       icon:'📋' },
  { path:'/crm-admin/billing',        label:'Billing',         icon:'💳' },
]

function Sidebar({ onSignOut, mobile=false, onClose }) {
  const location = useLocation()
  return (
    <div style={{ width:mobile ? 'min(86vw,300px)' : 220, minHeight:'100vh', flexShrink:0, background:'#0f0e1a',
      borderRight:'1px solid rgba(99,102,241,.2)', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'18px 16px 16px', borderBottom:'1px solid rgba(99,102,241,.15)' }}>
        <img src="/romylabs-logo.png" alt="RomyLabs"
          style={{ height:38, objectFit:'contain', display:'block', marginBottom:6 }}
          onError={e=>{e.target.style.display='none'}} />
        <div style={{ fontSize:10, color:'#C6FF00', letterSpacing:'.06em', fontWeight:700, textTransform:'uppercase' }}>Command Center</div>
      </div>

      <nav style={{ flex:1, padding:'10px 8px', overflowY:'auto' }}>
        {NAV.map(item => {
          const active = item.path === '/crm-admin'
            ? location.pathname === '/crm-admin' || location.pathname === '/crm-admin/'
            : location.pathname === item.path || location.pathname.startsWith(item.path + '/')
          return (
            <NavLink key={item.path} to={item.path} onClick={mobile ? onClose : undefined}
              style={{ display:'flex', alignItems:'center', gap:9, padding:mobile ? '11px 12px' : '8px 11px',
                borderRadius:8, marginBottom:1, textDecoration:'none', fontSize:13,
                fontWeight: active ? 700 : 400,
                background: active ? 'rgba(99,102,241,.18)' : 'transparent',
                color: active ? '#a5b4fc' : '#64748b' }}>
              <span style={{ fontSize:15, width:20, textAlign:'center' }}>{item.icon}</span>
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <div style={{ padding:'14px 14px', borderTop:'1px solid rgba(99,102,241,.15)' }}>
        <div style={{ fontSize:11, color:'#a5b4fc', fontWeight:600, marginBottom:2 }}>info@romylabs.com</div>
        <div style={{ fontSize:10, color:'#6366f1', fontWeight:700, marginBottom:10 }}>Platform Owner</div>
        <button onClick={onSignOut} style={{ ...S.btn('ghost'), width:'100%', justifyContent:'center', fontSize:12, padding:'7px 0' }}>
          Sign Out
        </button>
      </div>
    </div>
  )
}


function AdminDialer() {
  const {
    relayStatus, calling, active, elapsed,
    startCall, endCall, cancelCall,
  } = useCall()
  const [tab,setTab] = useState('phone')
  const [number, setNumber] = useState('')
  const [voicemails, setVoicemails] = useState([])
  const [vmLoading, setVmLoading] = useState(true)
  const [recentCalls, setRecentCalls] = useState([])
  const [callsLoading, setCallsLoading] = useState(true)
  const [recordings, setRecordings] = useState([])
  const [recordingsLoading, setRecordingsLoading] = useState(true)
  const [smsMessages,setSmsMessages] = useState([])
  const [smsLoading,setSmsLoading] = useState(true)
  const [smsSending,setSmsSending] = useState(false)
  const [smsPhone,setSmsPhone] = useState('')
  const [smsBody,setSmsBody] = useState('')
  const [selectedSmsPhone,setSelectedSmsPhone] = useState('')
  const [smsToast,setSmsToast] = useState('')

  const loadVoicemails = useCallback(async () => {
    setVmLoading(true)
    const { data, error } = await supabase.functions.invoke('romylabs-voicemails', { body:{ action:'list' } })
    if (!error && data?.ok) setVoicemails(data.voicemails || [])
    setVmLoading(false)
  }, [])

  const loadRecentCalls = useCallback(async () => {
    setCallsLoading(true)
    const { data, error } = await supabase.functions.invoke('romylabs-phone-state', { body:{ action:'recent_calls' } })
    if (!error && data?.ok) setRecentCalls(data.calls || [])
    setCallsLoading(false)
  }, [])

  const loadRecordings = useCallback(async () => {
    setRecordingsLoading(true)
    const { data, error } = await supabase.functions.invoke('romylabs-phone-state', { body:{ action:'recordings' } })
    if (!error && data?.ok) setRecordings(data.recordings || [])
    setRecordingsLoading(false)
  }, [])

  const loadSms = useCallback(async () => {
    setSmsLoading(true)
    const {data,error}=await supabase.functions.invoke('romylabs-sms',{body:{action:'list',limit:300}})
    if(!error&&data?.ok)setSmsMessages(data.messages||[])
    setSmsLoading(false)
  },[])

  useEffect(() => {
    loadVoicemails(); loadRecentCalls(); loadRecordings(); loadSms()
    const refreshOnFocus = () => { loadVoicemails(); loadRecentCalls(); loadRecordings(); loadSms() }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [loadVoicemails, loadRecentCalls, loadRecordings, loadSms])

  const smsNorm=v=>String(v||'').replace(/\D/g,'').slice(-10)
  const smsFmt=v=>{const d=smsNorm(v);return d.length===10?`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`:String(v||'')}
  const smsThreads=Object.values(smsMessages.reduce((acc,m)=>{
    const key=smsNorm(m.phone)
    if(!key)return acc
    if(!acc[key])acc[key]={phone:m.phone,key,messages:[],unread:0,lastAt:m.created_at,lastBody:m.body||'',name:m.clientName||''}
    acc[key].messages.push(m)
    if(m.direction==='inbound'&&!m.read)acc[key].unread++
    if(new Date(m.created_at||0)>new Date(acc[key].lastAt||0)){acc[key].lastAt=m.created_at;acc[key].lastBody=m.body||''}
    if(!acc[key].name&&m.clientName)acc[key].name=m.clientName
    return acc
  },{})).sort((a,b)=>new Date(b.lastAt||0)-new Date(a.lastAt||0))
  const selectedThread=smsThreads.find(t=>t.key===selectedSmsPhone)||null
  const selectedMessages=(selectedThread?.messages||[]).slice().sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0))
  const unreadSms=smsMessages.filter(m=>m.direction==='inbound'&&!m.read).length
  const unreadVm=voicemails.filter(v=>!v.is_read).length

  async function selectSmsThread(thread){
    setSelectedSmsPhone(thread.key); setSmsPhone(thread.phone||'')
    if(thread.unread){
      await supabase.functions.invoke('romylabs-sms',{body:{action:'mark_thread_read',phone:thread.phone}})
      setSmsMessages(ms=>ms.map(m=>smsNorm(m.phone)===thread.key&&m.direction==='inbound'?{...m,read:true}:m))
    }
  }

  async function sendSms(){
    const d=smsNorm(smsPhone)
    if(d.length!==10||!smsBody.trim()||smsSending)return
    setSmsSending(true);setSmsToast('')
    const {data,error}=await supabase.functions.invoke('send-sms',{
      body:{to:'+1'+d,body:smsBody.trim(),phoneContext:'romylabs'}
    })
    setSmsSending(false)
    if(error||!data?.success){setSmsToast(data?.error||error?.message||'SMS send failed');return}
    setSmsBody('');setSelectedSmsPhone(d);setSmsToast('Sent')
    await loadSms()
    setTimeout(()=>setSmsToast(''),2500)
  }

  async function markVoicemailRead(id) {
    const { data, error } = await supabase.functions.invoke('romylabs-voicemails', { body:{ action:'mark_read', id } })
    if (!error && data?.ok) setVoicemails(v => v.map(x => x.id===id ? { ...x, is_read:true } : x))
  }

  async function deleteVoicemail(id) {
    if (!window.confirm('Delete this RomyLabs voicemail?')) return
    const { data, error } = await supabase.functions.invoke('romylabs-voicemails', { body:{ action:'delete', id } })
    if (!error && data?.ok) setVoicemails(v => v.filter(x => x.id !== id))
  }

  const clean = number.replace(/\D/g, '')
  const canCall = relayStatus === 'ready' && !calling && clean.length >= 7

  function placeCall() {
    if (!canCall) return
    startCall({id:null,name:number,phone:number,status:'Manual',entityType:null})
  }

  function callBack(phone, name) {
    const digits=String(phone||'').replace(/\D/g,'')
    if (relayStatus !== 'ready' || calling || digits.length < 7) return
    setNumber(phone);setTab('phone')
    startCall({id:null,name:name || phone || 'RomyLabs Call',phone,status:'Manual',entityType:null})
  }

  const tabs=[
    ['phone','Phone',0],
    ['sms','SMS',unreadSms],
    ['voicemail','Voicemail',unreadVm],
    ['recordings','Recordings',0],
  ]

  return (
    <div style={{ padding:'28px 32px', maxWidth:1180 }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, marginBottom:18 }}>
        <div>
          <div style={{ fontSize:27, fontWeight:900, color:'#fff', marginBottom:4 }}>RomyLabs Communications</div>
          <div style={{ fontSize:13, color:'#64748b' }}>Calls, texts, voicemail and recordings from the RomyLabs main line.</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:10, color:'#64748b', fontWeight:800, textTransform:'uppercase', letterSpacing:'.06em' }}>SignalWire</div>
          <div style={{ fontSize:13, fontWeight:800, color:relayStatus==='ready'?'#10b981':relayStatus==='error'?'#ef4444':'#f59e0b' }}>
            {relayStatus==='ready' ? '● Ready' : relayStatus==='connecting' ? '● Connecting' : '● '+relayStatus}
          </div>
        </div>
      </div>

      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:18,padding:5,borderRadius:12,background:'rgba(255,255,255,.025)',border:'1px solid rgba(99,102,241,.12)',width:'fit-content'}}>
        {tabs.map(([key,label,badge])=><button key={key} onClick={()=>setTab(key)} style={{
          border:'none',cursor:'pointer',borderRadius:9,padding:'9px 14px',fontSize:12,fontWeight:800,
          background:tab===key?'linear-gradient(135deg,#6366f1,#8b5cf6)':'transparent',
          color:tab===key?'#fff':'#64748b'
        }}>{label}{badge>0&&<span style={{marginLeft:7,background:'#ef4444',color:'#fff',fontSize:9,borderRadius:999,padding:'2px 6px'}}>{badge}</span>}</button>)}
      </div>

      {tab==='phone' && <>
        <div style={{display:'grid',gridTemplateColumns:'minmax(320px,560px) 1fr',gap:16,alignItems:'start'}}>
          <div style={{ ...S.card, padding:22 }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:16, alignItems:'end' }}>
              <div>
                <div style={{ fontSize:10, color:'#64748b', fontWeight:800, textTransform:'uppercase', marginBottom:5 }}>Outbound identity</div>
                <div style={{ background:'#12111f', color:'#e2e8f0', border:'1px solid rgba(99,102,241,.3)', borderRadius:8, padding:'8px 10px', fontSize:12, fontWeight:800 }}>RomyLabs Main Line · (561) 420-6999</div>
              </div>
            </div>
            <input value={number} onChange={e=>setNumber(e.target.value)} onKeyDown={e=>e.key==='Enter'&&placeCall()} placeholder="Enter phone number" inputMode="tel" autoComplete="tel"
              style={{width:'100%',boxSizing:'border-box',background:'#0d0c1a',color:'#fff',border:'1px solid rgba(99,102,241,.3)',borderRadius:10,padding:'14px 16px',fontSize:20,letterSpacing:'.04em',marginBottom:12}}/>
            {!calling ? <button onClick={placeCall} disabled={!canCall} style={{...S.btn('primary'),width:'100%',padding:'12px 18px',opacity:canCall?1:.5}}>📞 Call</button> :
              <div><div style={{fontSize:14,color:'#e2e8f0',marginBottom:12}}>Calling <strong>{active?.name||active?.phone||number}</strong><span style={{color:'#64748b'}}> · {Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</span></div>
              <div style={{display:'flex',gap:8}}><button onClick={()=>endCall()} style={{...S.btn('danger'),flex:1}}>End Call</button><button onClick={cancelCall} style={S.btn('ghost')}>Cancel</button></div></div>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(150px,1fr))',gap:10}}>
            {[['1','Sales'],['2','Support'],['3','Billing'],['4','Representative'],['5','Voicemail']].map(([digit,label])=><div key={digit} style={{...S.card,padding:'13px 15px',display:'flex',alignItems:'center',gap:9}}>
              <span style={{width:26,height:26,borderRadius:7,display:'grid',placeItems:'center',background:'rgba(198,255,0,.12)',color:'#C6FF00',fontWeight:900}}>{digit}</span>
              <span style={{fontSize:12,fontWeight:800,color:'#e2e8f0'}}>{label}</span>
            </div>)}
          </div>
        </div>
        <div style={{...S.card,marginTop:16}}>
          <div style={{padding:'13px 16px',borderBottom:'1px solid rgba(99,102,241,.12)',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><div style={{fontSize:14,fontWeight:900,color:'#fff'}}>Recent Calls</div><div style={{fontSize:10,color:'#64748b'}}>Inbound, missed and outbound RomyLabs activity</div></div><button onClick={loadRecentCalls} style={{...S.btn('ghost'),padding:'6px 10px',fontSize:11}}>Refresh</button></div>
          {callsLoading?<Spinner/>:recentCalls.length===0?<div style={{padding:30,textAlign:'center',color:'#475569',fontSize:12}}>No RomyLabs call activity yet.</div>:recentCalls.slice(0,30).map((call,i)=><div key={call.id} style={{padding:'10px 16px',display:'flex',alignItems:'center',gap:12,borderBottom:i<Math.min(recentCalls.length,30)-1?'1px solid rgba(99,102,241,.08)':'none'}}>
            <div style={{width:30,height:30,borderRadius:9,display:'grid',placeItems:'center',background:call.direction==='Inbound'?'rgba(16,185,129,.1)':'rgba(99,102,241,.1)'}}>{call.direction==='Inbound'?'↙':'↗'}</div>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:800,color:'#e2e8f0'}}>{call.name||call.phone||'RomyLabs Call'}</div><div style={{fontSize:10,color:'#64748b',marginTop:2}}>{call.phone||'—'} · {call.created_at?new Date(call.created_at).toLocaleString():'—'}</div></div>
            <span style={{fontSize:10,fontWeight:800,padding:'3px 8px',borderRadius:999,background:String(call.status).toLowerCase()==='missed'?'rgba(239,68,68,.12)':'rgba(99,102,241,.12)',color:String(call.status).toLowerCase()==='missed'?'#fca5a5':'#a5b4fc'}}>{call.status}</span>
            {call.phone&&<button disabled={relayStatus!=='ready'||calling} onClick={()=>callBack(call.phone,call.name)} style={{...S.btn('ghost'),padding:'4px 8px',fontSize:9,opacity:relayStatus==='ready'&&!calling?1:.45}}>Call Back</button>}
          </div>)}
        </div>
      </>}

      {tab==='sms' && <div style={{...S.card,overflow:'hidden'}}>
        <div style={{padding:'14px 16px',borderBottom:'1px solid rgba(99,102,241,.12)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div><div style={{fontSize:14,fontWeight:900,color:'#fff'}}>RomyLabs SMS</div><div style={{fontSize:10,color:'#64748b',marginTop:2}}>Send and receive texts on (561) 420-6999</div></div>
          <button onClick={loadSms} style={{...S.btn('ghost'),padding:'6px 10px',fontSize:11}}>Refresh</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'310px minmax(0,1fr)',minHeight:520}}>
          <div style={{borderRight:'1px solid rgba(99,102,241,.12)',background:'rgba(255,255,255,.015)'}}>
            <div style={{padding:10,borderBottom:'1px solid rgba(99,102,241,.08)'}}>
              <button onClick={()=>{setSelectedSmsPhone('');setSmsPhone('');setSmsBody('')}} style={{...S.btn('primary'),width:'100%',fontSize:11}}>+ New Message</button>
            </div>
            {smsLoading?<Spinner/>:smsThreads.length===0?<div style={{padding:24,textAlign:'center',color:'#475569',fontSize:11}}>No RomyLabs text conversations yet.</div>:smsThreads.map(t=><button key={t.key} onClick={()=>selectSmsThread(t)} style={{width:'100%',border:'none',borderBottom:'1px solid rgba(99,102,241,.07)',background:selectedSmsPhone===t.key?'rgba(99,102,241,.10)':'transparent',padding:'12px 13px',textAlign:'left',cursor:'pointer'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:800,color:'#e2e8f0'}}>{t.name||smsFmt(t.phone)}</div><div style={{fontSize:9,color:'#475569',marginTop:2}}>{smsFmt(t.phone)} · {t.lastAt?new Date(t.lastAt).toLocaleDateString():'—'}</div></div>{t.unread>0&&<span style={{background:'#ef4444',color:'#fff',fontSize:9,fontWeight:800,borderRadius:999,padding:'2px 6px'}}>{t.unread}</span>}</div>
              <div style={{fontSize:10,color:'#64748b',marginTop:6,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.lastBody||'Attachment'}</div>
            </button>)}
          </div>
          <div style={{display:'flex',flexDirection:'column',minWidth:0}}>
            <div style={{padding:'12px 14px',borderBottom:'1px solid rgba(99,102,241,.08)',display:'flex',alignItems:'center',gap:8}}>
              <input value={smsPhone} onChange={e=>{setSmsPhone(e.target.value);setSelectedSmsPhone(smsNorm(e.target.value))}} placeholder="Recipient phone number" inputMode="tel" style={{flex:1,minWidth:0,background:'#0d0c1a',color:'#e2e8f0',border:'1px solid rgba(99,102,241,.24)',borderRadius:8,padding:'9px 11px',fontSize:12}}/>
              {smsNorm(smsPhone).length===10&&<button disabled={relayStatus!=='ready'||calling} onClick={()=>callBack(smsPhone,selectedThread?.name||smsPhone)} style={{...S.btn('ghost'),fontSize:10,padding:'7px 10px'}}>📞 Call</button>}
            </div>
            <div style={{flex:1,padding:14,overflowY:'auto',maxHeight:390}}>
              {selectedMessages.length===0?<div style={{height:'100%',display:'grid',placeItems:'center',color:'#475569',fontSize:12}}>Start a new RomyLabs text conversation.</div>:selectedMessages.map(m=><div key={m.id} style={{display:'flex',justifyContent:m.direction==='outbound'?'flex-end':'flex-start',marginBottom:9}}>
                <div style={{maxWidth:'78%',padding:'9px 11px',borderRadius:m.direction==='outbound'?'12px 12px 3px 12px':'12px 12px 12px 3px',background:m.direction==='outbound'?'rgba(99,102,241,.25)':'rgba(255,255,255,.06)',border:'1px solid rgba(99,102,241,.10)'}}>
                  <div style={{fontSize:12,color:'#e2e8f0',whiteSpace:'pre-wrap',lineHeight:1.5}}>{m.body||'(attachment)'}</div>
                  {Array.isArray(m.media)&&m.media.length>0&&<div style={{marginTop:6,fontSize:10,color:'#818cf8'}}>{m.media.length} attachment{m.media.length===1?'':'s'}</div>}
                  <div style={{fontSize:8,color:'#475569',marginTop:5,textAlign:'right'}}>{m.created_at?new Date(m.created_at).toLocaleString():'—'}{m.status?` · ${m.status}`:''}</div>
                </div>
              </div>)}
            </div>
            <div style={{padding:12,borderTop:'1px solid rgba(99,102,241,.08)'}}>
              <textarea value={smsBody} onChange={e=>setSmsBody(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendSms()}}} placeholder="Write a RomyLabs text…  Enter to send, Shift+Enter for a new line" rows={3} style={{width:'100%',boxSizing:'border-box',background:'#0d0c1a',color:'#e2e8f0',border:'1px solid rgba(99,102,241,.24)',borderRadius:9,padding:'10px 12px',fontSize:12,resize:'vertical'}}/>
              <div style={{display:'flex',alignItems:'center',gap:10,marginTop:8}}><div style={{fontSize:10,color:smsToast==='Sent'?'#10b981':'#ef4444',flex:1}}>{smsToast}</div><span style={{fontSize:9,color:'#475569'}}>{smsBody.length}/1600</span><button onClick={sendSms} disabled={smsSending||smsNorm(smsPhone).length!==10||!smsBody.trim()||smsBody.length>1600} style={{...S.btn('primary'),padding:'8px 14px',fontSize:11,opacity:smsSending||smsNorm(smsPhone).length!==10||!smsBody.trim()?0.5:1}}>{smsSending?'Sending…':'Send SMS'}</button></div>
            </div>
          </div>
        </div>
      </div>}

      {tab==='voicemail' && <div style={{...S.card}}>
        <div style={{padding:'14px 16px',borderBottom:'1px solid rgba(99,102,241,.12)',display:'flex',alignItems:'center',justifyContent:'space-between'}}><div><div style={{fontSize:14,fontWeight:900,color:'#fff'}}>Voicemail</div><div style={{fontSize:10,color:'#64748b'}}>RomyLabs messages only</div></div><button onClick={loadVoicemails} style={{...S.btn('ghost'),padding:'6px 10px',fontSize:11}}>Refresh</button></div>
        {vmLoading?<Spinner/>:voicemails.length===0?<div style={{padding:30,textAlign:'center',color:'#475569',fontSize:12}}>No RomyLabs voicemails yet.</div>:voicemails.map((vm,i)=><div key={vm.id} style={{padding:'13px 16px',borderBottom:i<voicemails.length-1?'1px solid rgba(99,102,241,.08)':'none',background:vm.is_read?'transparent':'rgba(99,102,241,.06)'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}><div style={{width:32,height:32,borderRadius:10,display:'grid',placeItems:'center',background:'rgba(99,102,241,.12)'}}>📵</div><div style={{flex:1}}><div style={{fontSize:13,fontWeight:800,color:'#e2e8f0'}}>{vm.from_number||'Unknown caller'}</div><div style={{fontSize:10,color:'#64748b'}}>{vm.created_at?new Date(vm.created_at).toLocaleString():'—'}{vm.duration_seconds?` · ${vm.duration_seconds}s`:''}</div></div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{vm.from_number&&<button onClick={()=>callBack(vm.from_number,'Voicemail Callback')} style={{...S.btn('ghost'),fontSize:10,padding:'5px 9px'}}>Call Back</button>}{!vm.is_read&&<button onClick={()=>markVoicemailRead(vm.id)} style={{...S.btn('ghost'),fontSize:10,padding:'5px 9px'}}>Mark read</button>}<button onClick={()=>deleteVoicemail(vm.id)} style={{...S.btn('danger'),fontSize:10,padding:'5px 9px'}}>Delete</button></div></div>
          {vm.recording_url&&<audio controls src={vm.recording_url} onPlay={()=>!vm.is_read&&markVoicemailRead(vm.id)} style={{width:'100%',height:30,marginTop:10}}/>}
          <div style={{marginTop:8,padding:'9px 11px',borderRadius:8,background:'rgba(255,255,255,.025)',fontSize:11,color:vm.transcript?'#94a3b8':'#475569',whiteSpace:'pre-wrap'}}>{vm.transcript||(`Transcription: ${vm.transcription_status||'pending'}`)}</div>
        </div>)}
      </div>}

      {tab==='recordings' && <div style={{...S.card}}>
        <div style={{padding:'14px 16px',borderBottom:'1px solid rgba(99,102,241,.12)',display:'flex',alignItems:'center',justifyContent:'space-between'}}><div><div style={{fontSize:14,fontWeight:900,color:'#fff'}}>Recordings & AI Summaries</div><div style={{fontSize:10,color:'#64748b'}}>Private RomyLabs call recordings</div></div><button onClick={loadRecordings} style={{...S.btn('ghost'),padding:'6px 10px',fontSize:11}}>Refresh</button></div>
        {recordingsLoading?<Spinner/>:recordings.length===0?<div style={{padding:30,textAlign:'center',color:'#475569',fontSize:12}}>No RomyLabs recordings yet.</div>:recordings.slice(0,30).map((rec,i)=><div key={rec.id} style={{padding:'13px 16px',borderBottom:i<Math.min(recordings.length,30)-1?'1px solid rgba(99,102,241,.08)':'none'}}>
          <div style={{display:'flex',gap:12,alignItems:'flex-start'}}><div style={{flex:1}}><div style={{fontSize:12,fontWeight:800,color:'#e2e8f0'}}>{rec.from_number||'Unknown'} → {rec.to_number||'RomyLabs'}</div><div style={{fontSize:10,color:'#64748b'}}>{rec.created_at?new Date(rec.created_at).toLocaleString():'—'}{rec.duration_seconds?` · ${rec.duration_seconds}s`:''}</div></div>{rec.ai?.sentiment&&<span style={{fontSize:9,fontWeight:800,padding:'3px 7px',borderRadius:999,background:'rgba(99,102,241,.12)',color:'#a5b4fc'}}>{rec.ai.sentiment}</span>}</div>
          {rec.recording_url&&<audio controls src={rec.recording_url} style={{width:'100%',height:30,marginTop:9}}/>}{rec.ai?.summary&&<div style={{marginTop:8,fontSize:11,color:'#94a3b8',lineHeight:1.55}}><strong style={{color:'#cbd5e1'}}>Summary:</strong> {rec.ai.summary}</div>}{rec.ai?.next_steps&&<div style={{marginTop:5,fontSize:11,color:'#64748b'}}><strong style={{color:'#94a3b8'}}>Next:</strong> {rec.ai.next_steps}</div>}{rec.ai?.transcript&&<details style={{marginTop:8}}><summary style={{cursor:'pointer',fontSize:10,fontWeight:800,color:'#6366f1'}}>View transcript</summary><div style={{marginTop:6,padding:'8px 10px',borderRadius:7,background:'rgba(255,255,255,.025)',fontSize:10,color:'#64748b',lineHeight:1.55,whiteSpace:'pre-wrap'}}>{rec.ai.transcript}</div></details>}
        </div>)}
      </div>}

      <div style={{marginTop:16,fontSize:10,color:'#475569',lineHeight:1.6}}>RomyLabs main line: (561) 420-6999 · Business hours Monday–Friday, 9:00 AM–6:00 PM Eastern.</div>
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────
function Overview() {
  const [stats, setStats] = useState(null)
  const [loadError, setLoadError] = useState('')
  const navigate = useNavigate()
  const { user } = useApp()

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      try {
        const { rows, warnings } = await loadPlatformOfficeRows()
        if (cancelled) return
        setStats(rows)
        setLoadError(warnings.join(' · '))
      } catch (error) {
        if (!cancelled) {
          setStats([])
          setLoadError(error?.message || 'Unable to load platform offices')
        }
      }
    })()
    return () => { cancelled = true }
  }, [user])

  function openOffice(row) {
    navigate(`/crm-admin/offices/${row.id}`)
  }

  const totalMRR     = (stats||[]).reduce((s,r) => s+Number(r.effective_monthly||0), 0)
  const activeOff    = (stats||[]).filter(r => r.status==='active').length
  const totalSeats   = (stats||[]).reduce((s,r) => s+Number(r.employee_count||0), 0)
  const totalClients = (stats||[]).reduce((s,r) => s+Number(r.client_count||0), 0)
  const totalLeads   = (stats||[]).reduce((s,r) => s+Number(r.lead_count||0), 0)
  const totalStorage   = (stats||[]).reduce((s,r) => s+Number(r.storage_bytes||0), 0)
  const totalCollected = (stats||[]).reduce((s,r) => s+Number(r.total_collected||0), 0)
  const totalTx        = (stats||[]).reduce((s,r) => s+Number(r.transaction_count||0), 0)

  const h = new Date().getHours()
  const greeting = h<12?'Good morning':'h<17'?'Good afternoon':'Good evening'

  const KPI = [
    { label:'Monthly Recurring', val: `$${totalMRR.toLocaleString('en-US',{maximumFractionDigits:0})}`, sub:'MRR', color:'#10b981' },
    { label:'Active Offices',    val: activeOff, sub:`${(stats||[]).length} total`, color:'#6366f1' },
    { label:'Total Seats',       val: totalSeats, sub:'across all firms', color:'#f59e0b' },
    { label:'Total Clients',     val: totalClients.toLocaleString(), sub:`${totalLeads} leads`, color:'#0ea5e9' },
    { label:'Storage Used',      val: fmtBytes(totalStorage), sub:'documents', color:'#8b5cf6' },
    { label:'Total Collected',    val: `$${totalCollected.toLocaleString('en-US',{maximumFractionDigits:0})}`, sub:`${totalTx.toLocaleString()} transactions`, color:'#10b981' },
  ]

  return (
    <div style={{ padding:'32px 36px', maxWidth:1100 }}>
      <div style={{ marginBottom:28 }}>
        <img src="/romylabs-logo.png" alt="RomyLabs"
          style={{ height:44, objectFit:'contain', display:'block', marginBottom:16 }}
          onError={e=>{e.target.style.display='none'}} />
        <div style={{ fontSize:26, fontWeight:800, color:'#fff', marginBottom:4 }}>
          {h<12?'Good morning':h<17?'Good afternoon':'Good evening'}, Romy 👋
        </div>
        <div style={{ fontSize:14, color:'#475569' }}>RomyLabs Platform — {(stats||[]).length} offices</div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:14, marginBottom:32 }}>
        {KPI.map(k => (
          <div key={k.label} style={{ ...S.card, padding:'20px 18px' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>{k.label}</div>
            <div style={{ fontSize:28, fontWeight:900, color:k.color, lineHeight:1 }}>{stats===null?'…':k.val}</div>
            <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {loadError && <div style={{padding:14,borderRadius:10,background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',color:'#fca5a5',marginBottom:16}}>Unable to load platform offices: {loadError}</div>}
      <div style={{ fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:12 }}>All Offices</div>
      <div style={S.card}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr>{['Firm','Status','Plan','Seats','Clients','Storage','Collected','MRR','Last Activity',''].map(h=>(
              <th key={h} style={S.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {!stats ? <tr><td colSpan={9}><Spinner /></td></tr> :
            stats.map(r => (
              <tr key={r.id} style={{ cursor:'pointer' }} onClick={() => navigate(`/crm-admin/offices/${r.id}`)}>
                <td style={{ ...S.td, color:'#e2e8f0', fontWeight:600 }}>
                  {r.brand_color && <span style={{ display:'inline-block',width:8,height:8,borderRadius:'50%',background:r.brand_color,marginRight:8 }}/>}
                  {r.firm_name}
                </td>
                <td style={S.td}><span style={S.badge(STATUS_COLOR[r.status]||'#64748b')}>{r.status}</span></td>
                <td style={S.td}><span style={S.badge(TIER_COLOR[r.plan_tier]||'#64748b')}>{r.plan_tier||'—'}</span></td>
                <td style={{ ...S.td, color:'#94a3b8' }}>{r.employee_count}</td>
                <td style={{ ...S.td, color:'#94a3b8' }}>{r.client_count}</td>
                <td style={{ ...S.td, color:'#94a3b8' }}>{fmtBytes(r.storage_bytes)}</td>
                <td style={{ ...S.td, color:'#10b981', fontWeight:600 }}>{r.total_collected ? `$${Number(r.total_collected).toLocaleString('en-US',{maximumFractionDigits:0})}` : '—'}</td>
                <td style={{ ...S.td, color:'#10b981', fontWeight:700 }}>
                  {r.effective_monthly!=null ? `$${Number(r.effective_monthly).toFixed(0)}/mo` : '—'}
                </td>
                <td style={{ ...S.td, color:'#475569' }}>{fmtAgo(r.last_activity)}</td>
                <td style={S.td}>
                  <button onClick={e=>{e.stopPropagation();openOffice(r)}}
                    style={{ ...S.btn('ghost'), padding:'5px 12px', fontSize:11 }}>View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ArcvenaOfficePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const officeId = String(id || '').replace(/^arcvena:/, '')
  const [office,setOffice] = useState(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')

  useEffect(() => {
    let cancelled=false
    ;(async()=>{
      setLoading(true); setError('')
      const {data,error:invokeError}=await supabase.functions.invoke('hub-proxy',{body:{product:'arcvena'}})
      if(cancelled) return
      if(invokeError || data?.ok===false){
        setError(invokeError?.message || data?.error || 'Unable to load Arcvena office')
        setLoading(false)
        return
      }
      const match=(data?.offices||[]).find(o=>String(o.id)===officeId)
      if(!match){ setError('Arcvena office not found'); setLoading(false); return }
      setOffice(match); setLoading(false)
    })()
    return()=>{cancelled=true}
  },[officeId])

  if(loading) return <Spinner/>
  if(error) return <div style={{padding:32}}><button onClick={()=>navigate('/crm-admin/offices')} style={S.btn('ghost')}>← Offices</button><div style={{marginTop:18,color:'#fca5a5'}}>{error}</div></div>

  const kv=[['Product','Arcvena'],['Status',office.status||'active'],['Office ID',office.id],['Created',office.since?fmtDate(office.since):'—']]
  return (
    <div style={{padding:'28px 36px',maxWidth:1100}}>
      <button onClick={()=>navigate('/crm-admin/offices')} style={{...S.btn('ghost'),marginBottom:18}}>← All Offices</button>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:22}}>
        <div>
          <div style={{fontSize:11,color:'#8b5cf6',fontWeight:800,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>Arcvena Office</div>
          <div style={{fontSize:28,fontWeight:900,color:'#fff'}}>{office.name||'Arcvena Office'}</div>
          <div style={{fontSize:13,color:'#64748b',marginTop:4}}>You are inside this office only.</div>
        </div>
        <button onClick={()=>window.open('https://app.arcvena.com/','_blank','noopener,noreferrer')} style={S.btn('primary')}>Open Arcvena CRM ↗</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:22}}>
        {kv.map(([label,value])=><div key={label} style={{...S.card,padding:'16px 18px'}}><div style={{fontSize:10,fontWeight:800,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>{label}</div><div style={{fontSize:14,fontWeight:700,color:'#e2e8f0',wordBreak:'break-word'}}>{String(value??'—')}</div></div>)}
      </div>
      <UniversalOfficeESign
        supabase={supabase}
        productKey="arcvena"
        externalOfficeId={office.id}
        firmName={office.name||'Arcvena Office'}
        contactName=""
        contactEmail=""
        seats={null}
        monthlyAmount={null}
      />
    </div>
  )
}

function ExternalProductOfficePage({ productKey }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const cfg = EXTERNAL_OFFICE_PRODUCTS[productKey]
  const officeId = String(id || '').replace(new RegExp(`^${productKey}:`), '')
  const [office,setOffice] = useState(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')

  useEffect(() => {
    let cancelled=false
    ;(async()=>{
      setLoading(true); setError('')
      const {data,error:invokeError}=await supabase.functions.invoke('hub-proxy',{body:{product:productKey}})
      if(cancelled) return
      const offices=Array.isArray(data?.offices)?data.offices:[]
      if(invokeError || !offices.length){
        setError(invokeError?.message || data?.error || `Unable to load ${cfg.label} office`)
        setLoading(false)
        return
      }
      const match=offices.find(o=>String(o.id)===officeId)
      if(!match){ setError(`${cfg.label} office not found`); setLoading(false); return }
      setOffice(match); setLoading(false)
    })()
    return()=>{cancelled=true}
  },[officeId,productKey,cfg.label])

  if(loading) return <Spinner/>
  if(error) return <div style={{padding:32}}><button onClick={()=>navigate('/crm-admin/offices')} style={S.btn('ghost')}>← Offices</button><div style={{marginTop:18,color:'#fca5a5'}}>{error}</div></div>

  const kv=[['Product',cfg.label],['Status',office.is_active===false?'inactive':'active'],['Office ID',office.id],['Created',office.since?fmtDate(office.since):'—']]
  return (
    <div style={{padding:'28px 36px',maxWidth:1100}}>
      <button onClick={()=>navigate('/crm-admin/offices')} style={{...S.btn('ghost'),marginBottom:18}}>← All Offices</button>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:22}}>
        <div>
          <div style={{fontSize:11,color:cfg.color,fontWeight:800,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>{cfg.label} Office</div>
          <div style={{fontSize:28,fontWeight:900,color:'#fff'}}>{office.name||`${cfg.label} Office`}</div>
          <div style={{fontSize:13,color:'#64748b',marginTop:4}}>You are inside this office only.</div>
        </div>
        <button onClick={()=>window.open(cfg.appUrl,'_blank','noopener,noreferrer')} style={S.btn('primary')}>Open {cfg.label} CRM ↗</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:22}}>
        {kv.map(([label,value])=><div key={label} style={{...S.card,padding:'16px 18px'}}><div style={{fontSize:10,fontWeight:800,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>{label}</div><div style={{fontSize:14,fontWeight:700,color:'#e2e8f0',wordBreak:'break-word'}}>{String(value??'—')}</div></div>)}
      </div>
      <UniversalOfficeESign
        supabase={supabase}
        productKey={productKey}
        externalOfficeId={office.id}
        firmName={office.name||`${cfg.label} Office`}
        contactName=""
        contactEmail=""
        seats={null}
        monthlyAmount={office.mrr ?? null}
      />
    </div>
  )
}

function OfficePageRouter(){
  const {id}=useParams()
  const raw=String(id||'')
  if(raw.startsWith('arcvena:')) return <ArcvenaOfficePage/>
  if(raw.startsWith('camvella:')) return <ExternalProductOfficePage productKey="camvella"/>
  if(raw.startsWith('bocasync:')) return <ExternalProductOfficePage productKey="bocasync"/>
  return <OfficePage/>
}

// ── Per-Office Deep Dive ─────────────────────────────────────────────────────
function OfficePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [tab, setTab] = useState('overview')
  const [toast, setToast] = useState(null)
  const [billing, setBilling] = useState({ per_seat_rate:'', monthly_rate:'', plan_tier:'', status:'', primary_contact_name:'', primary_contact_email:'', contract_start_date:'', contract_end_date:'', notes:'' })
  const [officePayments, setOfficePayments] = useState([])
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeNote, setChargeNote] = useState('')
  const [charging, setCharging] = useState(false)
  const [mercuryConfigured, setMercuryConfigured] = useState(false)
  const [impersonating, setImpersonating] = useState(false)
  const [offDocs, setOffDocs]     = useState([])
  const [docUploading, setDocUploading] = useState(false)

  const toast_ = (msg, type='ok') => { setToast({msg,type}); setTimeout(()=>setToast(null),3500) }

  useEffect(() => {
    setLoadError(null)
    supabase.rpc('get_office_full', { p_tenant_id: id })
      .then(({ data:d, error }) => {
        if (error) { setLoadError(error.message); toast_(error.message,'error'); return }
        if (!d?.tenant) { setLoadError('Office data was not returned by get_office_full.'); return }
        setData(d)
        setBilling({
          per_seat_rate:        d.tenant.per_seat_rate||'',
          monthly_rate:         d.tenant.monthly_rate||'',
          plan_tier:            d.tenant.plan_tier||'',
          status:               d.tenant.status||'active',
          primary_contact_name: d.tenant.primary_contact_name||'',
          primary_contact_email:d.tenant.primary_contact_email||'',
          contract_start_date:  d.tenant.contract_start_date?.slice(0,10)||'',
          contract_end_date:    d.tenant.contract_end_date?.slice(0,10)||'',
          notes:                d.tenant.notes||'',
        })
        // Load office documents
        supabase.from('office_documents').select('*').eq('tenant_id', id).order('created_at', { ascending: false })
          .then(({ data: docs }) => setOffDocs(docs || []))
      })
  }, [id])

  async function handleImpersonate() {
    setImpersonating(true)
    const { data: token, error } = await supabase.rpc('create_impersonation_token', { p_tenant_id: id })
    setImpersonating(false)
    if (error) { toast_(error.message,'error'); return }
    // Open the CRM in a new tab with the impersonation token in the URL
    // The CRM reads this token on load and sets the tenant context
    const url = `${window.location.origin}/impersonate?admin_token=${token}`
    window.open(url, '_blank')
    toast_(`✅ Jumping into ${data?.tenant?.firm_name} — token valid 15 min`)
  }

  async function saveBilling() {
    // Save billing fields via RPC
    const { error } = await supabase.rpc('update_office_billing', {
      p_tenant_id:    id,
      p_per_seat_rate: billing.per_seat_rate ? Number(billing.per_seat_rate) : null,
      p_monthly_rate:  billing.monthly_rate  ? Number(billing.monthly_rate)  : null,
      p_plan_tier:     billing.plan_tier  || null,
      p_status:        billing.status     || null,
    })
    // Save contact/contract fields directly
    await supabase.from('tenants').update({
      primary_contact_name:  billing.primary_contact_name  || null,
      primary_contact_email: billing.primary_contact_email || null,
      contract_start_date:   billing.contract_start_date   || null,
      contract_end_date:     billing.contract_end_date     || null,
      notes:                 billing.notes                 || null,
    }).eq('id', id)
    if (error) { toast_(error.message,'error') } else {
      const status = billing.status
      if (status === 'suspended') toast_('✅ Billing updated — account suspended. Staff will be blocked on next login.')
      else if (status === 'cancelled') toast_('✅ Billing updated — account cancelled. Staff will be blocked on next login.')
      else toast_('✅ Billing updated')
    }
  }

  async function loadOfficePayments(tenantId) {
    const { data } = await supabase.from('office_billing_payments').select('*').eq('tenant_id', tenantId).order('charged_at', { ascending: false }).limit(20)
    setOfficePayments(data || [])
    const { data: s } = await supabase.from('settings').select('mercury_api_key').eq('tenant_id', '61a89aef-0e7e-4ea2-b222-44ab2024655a').maybeSingle()
    setMercuryConfigured(!!s?.mercury_api_key)
  }

  async function chargeOffice() {
    if (!chargeAmount || Number(chargeAmount) <= 0) { toast_('Enter a valid amount'); return }
    setCharging(true)
    const { data, error } = await supabase.functions.invoke('mercury-charge', { body: { tenant_id: id, amount: Number(chargeAmount), description: chargeNote || null } })
    setCharging(false)
    if (error) { toast_('❌ ' + error.message, 'error'); return }
    if (data?.pending) { toast_('⏳ Saved as pending — configure Mercury API key in Settings to process') }
    else if (data?.ok) { toast_('✅ Payment processed via Mercury'); setChargeAmount(''); setChargeNote('') }
    else { toast_('❌ ' + (data?.error || 'Unknown error'), 'error') }
    loadOfficePayments(id)
  }

  function resetDemo() {
    toast_('Demo reset is disabled until a secured server-side reset endpoint is deployed.', 'error')
  }

  useEffect(() => {
    if (tab === 'billing' && id) loadOfficePayments(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, id])

  if (loadError) return (
    <div style={{ padding:40, maxWidth:760 }}>
      <div style={{ ...S.card, padding:24, border:'1px solid rgba(239,68,68,.35)' }}>
        <div style={{ color:'#ef4444', fontWeight:800, marginBottom:8 }}>Unable to load office</div>
        <div style={{ color:'#94a3b8', fontSize:13, lineHeight:1.6 }}>{loadError}</div>
        <button onClick={()=>navigate('/crm-admin/offices')} style={{ ...S.btn('ghost'), marginTop:16 }}>← Back to Offices</button>
      </div>
    </div>
  )
  if (!data) return <Spinner />

  const t = data.tenant
  const employees = data.employees || []
  const TABS = ['overview','employees','billing','actions','documents']

  return (
    <div style={{ padding:'28px 36px', maxWidth:1050 }}>
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:28 }}>
        <button onClick={()=>navigate('/crm-admin/offices')} style={{ ...S.btn('ghost'), padding:'6px 12px', fontSize:12 }}>← Back</button>
        {t.brand_color && <div style={{ width:14,height:14,borderRadius:'50%',background:t.brand_color }}/>}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:22,fontWeight:800,color:'#fff' }}>{t.firm_name}</div>
          <div style={{ fontSize:12,color:'#475569' }}>
            {t.tenant_code} · Since {fmtDate(t.created_at)} · {t.primary_contact_email||'—'}
          </div>
        </div>
        <span style={S.badge(STATUS_COLOR[t.status]||'#64748b')}>{t.status}</span>
        <button onClick={handleImpersonate} disabled={impersonating}
          style={{ ...S.btn('primary'), display:'flex', alignItems:'center', gap:6 }}>
          {impersonating ? '⏳' : '🚀'} {impersonating ? 'Opening…' : 'Jump In'}
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display:'flex', gap:12, marginBottom:24, flexWrap:'wrap' }}>
        {[
          { label:'Employees', val:employees.length, color:'#6366f1' },
          { label:'Clients', val:data.client_count, color:'#0ea5e9' },
          { label:'Leads', val:data.lead_count, color:'#f59e0b' },
          { label:'Storage', val:fmtBytes(data.storage_bytes), color:'#8b5cf6' },
          { label:'Collected', val:data.total_collected ? `$${Number(data.total_collected).toLocaleString('en-US',{maximumFractionDigits:0})}` : '$0', color:'#10b981' },
          { label:'Transactions', val:(data.transaction_count||0).toLocaleString(), color:'#6366f1' },
          { label:'Last Activity', val:fmtAgo(data.last_activity), color:'#10b981' },
          { label:'MRR', val: t.monthly_rate ? `$${t.monthly_rate}/mo` : t.per_seat_rate ? `$${(t.per_seat_rate*employees.length).toFixed(0)}/mo` : '—', color:'#10b981' },
        ].map(k => (
          <div key={k.label} style={{ ...S.card, padding:'12px 16px', flex:1, minWidth:110 }}>
            <div style={{ fontSize:9,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em' }}>{k.label}</div>
            <div style={{ fontSize:18,fontWeight:800,color:k.color,marginTop:2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, marginBottom:20, borderBottom:'1px solid rgba(99,102,241,.15)', paddingBottom:0 }}>
        {TABS.map(tb => (
          <button key={tb} onClick={()=>setTab(tb)}
            style={{ padding:'8px 18px', borderRadius:'8px 8px 0 0', border:'none', cursor:'pointer',
              fontSize:13, fontWeight:tab===tb?700:400, marginBottom:-1,
              background: tab===tb ? 'rgba(99,102,241,.15)' : 'transparent',
              color: tab===tb ? '#a5b4fc' : '#475569',
              borderBottom: tab===tb ? '2px solid #6366f1' : '2px solid transparent' }}>
            {tb.charAt(0).toUpperCase()+tb.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab==='overview' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div style={{ ...S.card, padding:18 }}>
            <div style={{ fontSize:12,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:12 }}>Firm Details</div>
            {[
              ['Firm Name', t.firm_name],
              ['Tenant Code', t.tenant_code],
              ['Plan', t.plan_tier||'—'],
              ['Status', t.status],
              ['Contact', t.primary_contact_name||'—'],
              ['Email', t.primary_contact_email||'—'],
              ['Phone', t.firm_phone||'—'],
              ['Address', t.firm_address||'—'],
              ['Contract Start', fmtDate(t.contract_start_date)],
              ['Contract End', fmtDate(t.contract_end_date)],
              ['Notes', t.notes||'—'],
            ].map(([k,v]) => (
              <div key={k} style={{ display:'flex', gap:8, padding:'5px 0', borderBottom:'1px solid rgba(99,102,241,.07)', fontSize:13 }}>
                <span style={{ color:'#475569', width:120, flexShrink:0 }}>{k}</span>
                <span style={{ color:'#e2e8f0' }}>{v}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ ...S.card, padding:18, marginBottom:16 }}>
              <div style={{ fontSize:12,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:12 }}>Admin Actions</div>
              {(data.recent_actions||[]).length===0 ? (
                <div style={{ color:'#475569',fontSize:13 }}>No admin actions yet.</div>
              ) : (data.recent_actions||[]).slice(0,8).map(a => (
                <div key={a.created_at} style={{ padding:'6px 0', borderBottom:'1px solid rgba(99,102,241,.07)', fontSize:12 }}>
                  <span style={{ color:'#6366f1', fontWeight:600 }}>{a.action}</span>
                  <span style={{ color:'#475569' }}> · {fmtAgo(a.created_at)}</span>
                </div>
              ))}
            </div>
            {t.id === DEMO_TENANT && (
              <div style={{ ...S.card, padding:18, border:'1px solid rgba(251,146,60,.3)' }}>
                <div style={{ fontSize:12,fontWeight:700,color:'#f97316',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:10 }}>🎭 Demo Controls</div>
                <div style={{ fontSize:12,color:'#475569',marginBottom:12 }}>Reset this tenant to a clean demo state before showing to a prospect.</div>
                <button onClick={resetDemo} disabled title="Requires secured server-side reset endpoint" style={{ ...S.btn('danger'), fontSize:12, opacity:.45, cursor:'not-allowed' }}>🔒 Demo Reset Unavailable</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Employees tab */}
      {tab==='employees' && (
        <div style={S.card}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead><tr>
              {['Name','Email','Role','Last Activity'].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.id}>
                  <td style={{ ...S.td, color:'#e2e8f0', fontWeight:600 }}>
                    {e.avatar_url && <img src={e.avatar_url} style={{ width:24,height:24,borderRadius:'50%',marginRight:8,verticalAlign:'middle' }} onError={ev=>ev.target.style.display='none'}/>}
                    {e.name}
                  </td>
                  <td style={{ ...S.td, color:'#94a3b8' }}>{e.email}</td>
                  <td style={S.td}><span style={S.badge('#6366f1')}>{e.role||e.access}</span></td>
                  <td style={{ ...S.td, color:'#475569' }}>{fmtAgo(e.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Billing tab */}
      {tab==='billing' && (
        <div style={{ maxWidth:480 }}>
          <div style={{ ...S.card, padding:20 }}>
            <div style={{ fontSize:12,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:16 }}>Billing Settings</div>
            {[
              ['Per-Seat Rate ($/month)', 'per_seat_rate', 'number', '65'],
              ['Flat Monthly Rate ($)', 'monthly_rate', 'number', 'Leave blank if using per-seat'],
            ].map(([label,key,type,ph]) => (
              <div key={key} style={{ marginBottom:14 }}>
                <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.05em',display:'block',marginBottom:6 }}>{label}</label>
                <input value={billing[key]} onChange={e=>setBilling(b=>({...b,[key]:e.target.value}))} type={type} placeholder={ph}
                  style={{ width:'100%', padding:'10px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)',
                    background:'rgba(255,255,255,.04)', color:'#e2e8f0', fontSize:14, boxSizing:'border-box' }}/>
              </div>
            ))}
            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.05em',display:'block',marginBottom:6 }}>Plan Tier</label>
              <select value={billing.plan_tier} onChange={e=>setBilling(b=>({...b,plan_tier:e.target.value}))}
                style={{ width:'100%', padding:'10px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)', background:'#1a1830', color:'#e2e8f0', fontSize:14 }}>
                <option value="">— Select —</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="pro">Pro</option>
              </select>
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.05em',display:'block',marginBottom:6 }}>Status</label>
              <select value={billing.status} onChange={e=>setBilling(b=>({...b,status:e.target.value}))}
                style={{ width:'100%', padding:'10px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)', background:'#1a1830', color:'#e2e8f0', fontSize:14 }}>
                {['active','trial','past_due','cancelled','suspended'].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ fontSize:13, color:'#475569', marginBottom:16, padding:'10px 14px', background:'rgba(99,102,241,.06)', borderRadius:8 }}>
              Estimated MRR: <strong style={{ color:'#10b981' }}>
                ${Number(billing.monthly_rate) > 0 ? Number(billing.monthly_rate).toFixed(0)
                  : Number(billing.per_seat_rate) > 0 ? (Number(billing.per_seat_rate)*employees.length).toFixed(0)
                  : '0'}/mo
              </strong> · {employees.length} seat{employees.length!==1?'s':''}
            </div>
            <div style={{ borderTop:'1px solid rgba(99,102,241,.15)', paddingTop:16, marginTop:4 }}>
              <div style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:12 }}>Contract & Contact</div>
              {[
                ['Primary Contact Name', 'primary_contact_name', 'text', 'e.g. Chris Bennett'],
                ['Primary Contact Email', 'primary_contact_email', 'email', 'e.g. chris@firm.com'],
              ].map(([label,key,type,ph]) => (
                <div key={key} style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.05em',display:'block',marginBottom:6 }}>{label}</label>
                  <input value={billing[key]} onChange={e=>setBilling(b=>({...b,[key]:e.target.value}))} type={type} placeholder={ph}
                    style={{ width:'100%', padding:'10px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)', background:'rgba(255,255,255,.04)', color:'#e2e8f0', fontSize:14, boxSizing:'border-box' }}/>
                </div>
              ))}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                {[['Contract Start', 'contract_start_date'],['Contract End', 'contract_end_date']].map(([label,key]) => (
                  <div key={key}>
                    <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.05em',display:'block',marginBottom:6 }}>{label}</label>
                    <input value={billing[key]} onChange={e=>setBilling(b=>({...b,[key]:e.target.value}))} type="date"
                      style={{ width:'100%', padding:'10px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)', background:'#1a1830', color:'#e2e8f0', fontSize:14, boxSizing:'border-box' }}/>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',letterSpacing:'.05em',display:'block',marginBottom:6 }}>Notes</label>
                <textarea value={billing.notes} onChange={e=>setBilling(b=>({...b,notes:e.target.value}))} rows={3} placeholder="Internal notes about this office..."
                  style={{ width:'100%', padding:'10px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)', background:'rgba(255,255,255,.04)', color:'#e2e8f0', fontSize:14, boxSizing:'border-box', resize:'vertical', fontFamily:'inherit' }}/>
              </div>
            </div>
            <button onClick={saveBilling} style={{ ...S.btn('primary'), width:'100%', justifyContent:'center' }}>
              💾 Save Billing & Contact
            </button>
          </div>
        </div>
      )}

      {/* Actions tab — support tickets */}
      {tab==='documents' && (
        <div>
          <div style={{marginBottom:18}}>
            <UniversalOfficeESign
              supabase={supabase}
              productKey="taxres_crm"
              externalOfficeId={t.id}
              firmName={t.firm_name||'Office'}
              contactName={t.primary_contact_name||''}
              contactEmail={t.primary_contact_email||''}
              contactPhone={t.firm_phone||''}
              seats={t.billing_seats||employees.length||null}
              monthlyAmount={t.monthly_rate||null}
            />
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em' }}>Firm Documents</div>
            <label style={{ ...S.btn('primary'), fontSize:12, padding:'7px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              📎 Upload Document
              <input type="file" style={{ display:'none' }} onChange={async e => {
                const file = e.target.files?.[0]
                if (!file) return
                setDocUploading(true)
                toast_('Uploading…')
                const path = `office-docs/${id}/${Date.now()}-${file.name}`
                const { error: upErr } = await supabase.storage.from('firm-assets').upload(path, file, { upsert: false })
                if (upErr) { toast_(upErr.message, 'error'); setDocUploading(false); return }
                const { data: urlData } = supabase.storage.from('firm-assets').getPublicUrl(path)
                const { error: dbErr } = await supabase.from('office_documents').insert([{
                  tenant_id: id,
                  name: file.name,
                  file_url: urlData.publicUrl,
                  file_size: file.size,
                  uploaded_by: 'romy@taxrescrm.net',
                  created_at: new Date().toISOString(),
                }])
                if (dbErr) { toast_(dbErr.message, 'error') }
                else {
                  toast_('✅ Document uploaded')
                  setOffDocs(prev => [...prev, { name: file.name, file_url: urlData.publicUrl, file_size: file.size, created_at: new Date().toISOString() }])
                }
                setDocUploading(false)
                e.target.value = ''
              }} />
            </label>
          </div>
          <div style={S.card}>
            {offDocs.length === 0 ? (
              <div style={{ padding:'24px 20px', color:'#475569', fontSize:13, textAlign:'center' }}>
                <div style={{ fontSize:28, marginBottom:8 }}>📄</div>
                No documents uploaded yet. Upload the signed agreement, contract, or any firm-level document.
              </div>
            ) : offDocs.map((doc, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 18px', borderBottom: i < offDocs.length-1 ? '1px solid rgba(99,102,241,.08)' : 'none' }}>
                <span style={{ fontSize:20 }}>📄</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'#e2e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.name}</div>
                  <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>{fmtDate(doc.created_at)} · {doc.file_size ? (doc.file_size/1024).toFixed(0)+' KB' : ''}</div>
                </div>
                <a href={doc.file_url} target="_blank" rel="noreferrer"
                  style={{ ...S.btn('ghost'), fontSize:11, padding:'5px 12px', textDecoration:'none' }}>
                  Download ↗
                </a>
              </div>
            ))}
          </div>
          {docUploading && <div style={{ fontSize:12, color:'#6366f1', marginTop:8, textAlign:'center' }}>Uploading…</div>}
        </div>
      )}

      {tab==='actions' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ ...S.card, padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em' }}>💳 Charge Office</div>
              <div style={{ fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:700, background: mercuryConfigured ? 'rgba(16,185,129,.15)' : 'rgba(245,158,11,.15)', color: mercuryConfigured ? '#10b981' : '#f59e0b' }}>
                {mercuryConfigured ? '● Mercury Connected' : '⚠ Mercury Not Configured'}
              </div>
            </div>
            {!mercuryConfigured && <div style={{ fontSize:12, color:'#64748b', marginBottom:14, padding:'10px 14px', background:'rgba(245,158,11,.08)', borderRadius:8, border:'1px solid rgba(245,158,11,.2)' }}>Add your Mercury API key in Settings to enable live payments. Charges saved as pending until then.</div>}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:10, marginBottom:12 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:6 }}>Amount ($)</label>
                <input type="number" value={chargeAmount} onChange={e=>setChargeAmount(e.target.value)} placeholder={Number(billing.per_seat_rate)>0 ? String((Number(billing.per_seat_rate)*employees.length).toFixed(0)) : '0.00'} style={{ width:'100%', padding:'10px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)', background:'rgba(255,255,255,.04)', color:'#e2e8f0', fontSize:14, boxSizing:'border-box' }}/>
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:6 }}>Note (optional)</label>
                <input value={chargeNote} onChange={e=>setChargeNote(e.target.value)} placeholder="e.g. August 2026 subscription" style={{ width:'100%', padding:'10px 14px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)', background:'rgba(255,255,255,.04)', color:'#e2e8f0', fontSize:14, boxSizing:'border-box' }}/>
              </div>
            </div>
            <button onClick={chargeOffice} disabled={charging||!chargeAmount} style={{ ...S.btn('primary'), width:'100%', justifyContent:'center', opacity: charging||!chargeAmount?.5:1 }}>
              {charging ? '⏳ Processing…' : mercuryConfigured ? '💳 Charge via Mercury' : '💾 Save as Pending'}
            </button>
            {officePayments.length > 0 && <div style={{ marginTop:18 }}><div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:10 }}>Payment History</div><div style={{ display:'flex', flexDirection:'column', gap:6 }}>{officePayments.map(p => <div key={p.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)', borderRadius:8 }}><div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>${Number(p.amount).toFixed(2)}{p.description && <span style={{ fontWeight:400, color:'#94a3b8', marginLeft:8 }}>{p.description}</span>}</div><div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{new Date(p.charged_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · {p.charged_by}</div></div><span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, background: p.status==='completed'?'rgba(16,185,129,.15)':p.status==='failed'?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)', color: p.status==='completed'?'#10b981':p.status==='failed'?'#ef4444':'#f59e0b' }}>{p.status}</span></div>)}</div></div>}
          </div>
          <div style={S.card}>
          <div style={{ padding:16, fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.05em' }}>Support Tickets</div>
          {(data.support_tickets||[]).length===0 ? (
            <div style={{ padding:'16px 20px', color:'#475569', fontSize:13 }}>No support tickets for this office.</div>
          ) : (data.support_tickets||[]).map(t => (
            <div key={t.id} style={{ padding:'12px 20px', borderTop:'1px solid rgba(99,102,241,.1)', fontSize:13, color:'#e2e8f0' }}>
              <div style={{ fontWeight:600 }}>{t.subject||t.title||'Support request'}</div>
              <div style={{ fontSize:11, color:'#475569', marginTop:3 }}>{fmtAgo(t.created_at)} · {t.status}</div>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Offices List ─────────────────────────────────────────────────────────────
function OfficesList() {
  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { rows: allRows, warnings } = await loadPlatformOfficeRows()
        if (cancelled) return
        setRows(allRows)
        setLoadError(warnings.join(' · '))
      } catch (error) {
        if (!cancelled) {
          setRows([])
          setLoadError(error?.message || 'Unable to load offices')
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  function openOffice(row) {
    navigate(`/crm-admin/offices/${row.id}`)
  }
  return (
    <div style={{ padding:'28px 36px', maxWidth:1050 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div style={{ fontSize:22, fontWeight:800, color:'#fff' }}>🏢 All Offices</div>
        <button onClick={()=>navigate('/crm-admin/provision')} style={S.btn('primary')}>➕ New Office</button>
      </div>
      {loadError && <div style={{padding:14,borderRadius:10,background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.25)',color:'#fca5a5',marginBottom:16}}>Unable to load offices: {loadError}</div>}
      {!rows ? <Spinner /> : rows.length===0 && !loadError ? <div style={{color:'#64748b',fontSize:13}}>No offices found.</div> : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {rows.map(r => (
            <div key={r.id} style={{ ...S.card, padding:'18px 20px', display:'flex', alignItems:'center', gap:16, cursor:'pointer' }}
              onClick={()=>openOffice(r)}>
              <div style={{ width:40,height:40,borderRadius:10,flexShrink:0,
                background: r.brand_color ? r.brand_color+'33' : 'rgba(99,102,241,.15)',
                border: `2px solid ${r.brand_color||'#6366f1'}44`,
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:16,fontWeight:800,color:r.brand_color||'#6366f1' }}>
                {(r.firm_name||'?')[0]}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>{r.firm_name}</div>
                <div style={{ fontSize:12, color:'#475569', marginTop:2 }}>
                  {r.employee_count} seats · {r.client_count} clients · {fmtBytes(r.storage_bytes)}
                </div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={S.badge(STATUS_COLOR[r.status]||'#64748b')}>{r.status}</span>
                <span style={{ ...S.badge(TIER_COLOR[r.plan_tier]||'#64748b'), opacity:r.plan_tier?1:0.3 }}>{r.plan_tier||'no plan'}</span>
                <span style={{ color:'#10b981', fontWeight:700, fontSize:13 }}>
                  {r.effective_monthly!=null ? `$${Number(r.effective_monthly).toFixed(0)}/mo` : '$0'}
                </span>
                <div style={{ fontSize:12, color:'#475569' }}>{fmtAgo(r.last_activity)}</div>
              </div>
              <button onClick={e=>{e.stopPropagation();openOffice(r)}}
                style={{ ...S.btn('ghost'), padding:'6px 14px', fontSize:12, flexShrink:0 }}>Open →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Billing Overview ─────────────────────────────────────────────────────────
function Billing() {
  const [rows, setRows] = useState(null)
  const navigate = useNavigate()
  useEffect(() => { supabase.rpc('admin_tenant_overview').then(({data})=>setRows(data||[])) }, [])
  const totalMRR = (rows||[]).reduce((s,r)=>s+Number(r.effective_monthly||0),0)
  return (
    <div style={{ padding:'28px 36px', maxWidth:900 }}>
      <div style={{ fontSize:22,fontWeight:800,color:'#fff',marginBottom:6 }}>💳 Billing</div>
      <div style={{ fontSize:14,color:'#475569',marginBottom:24 }}>
        Total MRR: <span style={{ color:'#10b981',fontWeight:800,fontSize:18 }}>${totalMRR.toLocaleString('en-US',{maximumFractionDigits:0})}/mo</span>
      </div>
      {!rows ? <Spinner /> : (
        <div style={S.card}>
          <table style={{ width:'100%',borderCollapse:'collapse',fontSize:13 }}>
            <thead><tr>{['Firm','Status','Plan','Seats','Per Seat','Flat Rate','MRR','Actions'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.id} onClick={()=>navigate(`/crm-admin/offices/${r.id}`)}
                  style={{ cursor:'pointer' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(99,102,241,.06)'}
                  onMouseLeave={e=>e.currentTarget.style.background=''}>
                  <td style={{ ...S.td,color:'#e2e8f0',fontWeight:600 }}>{r.firm_name}</td>
                  <td style={S.td}><span style={S.badge(STATUS_COLOR[r.status]||'#64748b')}>{r.status}</span></td>
                  <td style={S.td}><span style={S.badge(TIER_COLOR[r.plan_tier]||'#64748b',undefined)}>{r.plan_tier||'—'}</span></td>
                  <td style={{ ...S.td,color:'#94a3b8' }}>{r.employee_count}</td>
                  <td style={{ ...S.td,color:'#94a3b8' }}>{r.per_seat_rate ? `$${r.per_seat_rate}` : '—'}</td>
                  <td style={{ ...S.td,color:'#94a3b8' }}>{r.monthly_rate ? `$${r.monthly_rate}` : '—'}</td>
                  <td style={{ ...S.td,color:'#10b981',fontWeight:700 }}>
                    {r.effective_monthly!=null ? `$${Number(r.effective_monthly).toFixed(0)}/mo` : '—'}
                  </td>
                  <td style={S.td} onClick={e=>e.stopPropagation()}>
                    <button onClick={()=>navigate(`/crm-admin/offices/${r.id}?tab=billing`)}
                      style={{ ...S.btn('ghost'),padding:'4px 12px',fontSize:11 }}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Demo Management ──────────────────────────────────────────────────────────
function DemoMgmt() {
  const [rows, setRows] = useState(null)
  const [toast, setToast] = useState(null)
  const toast_ = (msg,type='ok')=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3500) }
  useEffect(()=>{ supabase.rpc('admin_tenant_overview').then(({data})=>setRows(data||[])) },[])

  async function jumpIn(tenantId, firmName) {
    const { data:token, error } = await supabase.rpc('create_impersonation_token',{ p_tenant_id:tenantId })
    if (error) { toast_(error.message,'error'); return }
    window.open(`${window.location.origin}/impersonate?admin_token=${token}`,'_blank')
    toast_(`✅ Opened ${firmName}`)
  }

  return (
    <div style={{ padding:'28px 36px', maxWidth:820 }}>
      {toast && <Toast msg={toast.msg} type={toast.type} />}
      <div style={{ fontSize:22,fontWeight:800,color:'#fff',marginBottom:6 }}>🎭 Demo Management</div>
      <div style={{ fontSize:14,color:'#475569',marginBottom:24 }}>Jump into any office, run a demo, reset demo data before a prospect call.</div>
      {!rows ? <Spinner /> : rows.map(r=>(
        <div key={r.id} style={{ ...S.card,padding:'18px 20px',marginBottom:12,display:'flex',alignItems:'center',gap:14 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15,fontWeight:700,color:'#fff' }}>{r.firm_name}</div>
            <div style={{ fontSize:12,color:'#475569',marginTop:2 }}>{r.employee_count} seats · {r.client_count} clients · Last active {fmtAgo(r.last_activity)}</div>
          </div>
          <span style={S.badge(STATUS_COLOR[r.status]||'#64748b')}>{r.status}</span>
          <button onClick={()=>jumpIn(r.id,r.firm_name)} style={{ ...S.btn('primary'),fontSize:12,padding:'7px 16px' }}>
            🚀 Jump In
          </button>
        </div>
      ))}
    </div>
  )
}

// ── System Health ────────────────────────────────────────────────────────────
function SystemHealth() {
  const [health, setHealth] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [loading, setLoading] = useState(false)

  async function loadHealth() {
    setLoading(true)
    try {
      // 1. Platform overview via RPC
      let overview = []
      try { const r = await supabase.rpc('admin_tenant_overview'); overview = r.data || [] } catch(_) {}
      const offices      = (overview||[]).length
      const totalSeats   = (overview||[]).reduce((s,r)=>s+Number(r.employee_count||0),0)
      const totalClients = (overview||[]).reduce((s,r)=>s+Number(r.client_count||0),0)
      const activeOff    = (overview||[]).filter(r=>r.status==='active').length

      // 2. Database ping via Supabase client
      const dbStart = Date.now()
      const { error: dbErr } = await supabase.from('tenants').select('id').limit(1)
      const dbMs = Date.now() - dbStart
      const dbOk = !dbErr

      // 3. Auth session
      const { data: sess } = await supabase.auth.getSession().catch(()=>({data:null}))
      const authOk = !!sess?.session?.user

      // 4. Edge function — use supabase.functions.invoke (avoids CORS issues)
      const fnStart = Date.now()
      let fnOk = false, fnMs = 0
      try {
        const { error: fnErr } = await supabase.functions.invoke('send-email', { body: { ping: true } })
        fnMs = Date.now() - fnStart
        fnOk = !fnErr || fnErr.message !== 'FunctionsFetchError'
      } catch(_) { fnMs = Date.now() - fnStart; fnOk = false }

      // 5. Webmail — no-cors fetch, success = reachable
      let mailOk = false
      try {
        await fetch('https://webmail.taxrescrm.net:7443', { mode:'no-cors', signal: AbortSignal.timeout(5000) })
        mailOk = true
      } catch(_) { mailOk = false }

      // 6. ICS watcher — last ics_auto insert
      let icsRows = []
      try { const r = await supabase.from('calevents').select('created_at').eq('source','ics_auto').order('created_at',{ascending:false}).limit(1); icsRows = r.data || [] } catch(_) {}

      setLastRefresh(new Date())
      setHealth({ offices, activeOff, totalSeats, totalClients, dbOk, dbMs, authOk, fnOk, fnMs, mailOk, icsRow: (icsRows||[])[0]||null })
    } catch(e) {
      console.error('SystemHealth load error:', e)
      setHealth({ offices:0, activeOff:0, totalSeats:0, totalClients:0, dbOk:false, dbMs:0, authOk:false, fnOk:false, fnMs:0, mailOk:false, icsRow:null, loadError: String(e) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(()=>{ loadHealth() },[])

  const checks = health ? [
    { label:'Database (Supabase)',  ok:health.dbOk,   note: health.dbOk ? `Responding — ${health.dbMs}ms` : 'Not reachable' },
    { label:'Auth Session',         ok:health.authOk, note: health.authOk ? 'Admin session valid' : 'Session expired — re-login' },
    { label:'Edge Functions',       ok:health.fnOk,   note: health.fnOk ? `Deployed & responding — ${health.fnMs}ms` : 'send-email unreachable' },
    { label:'Webmail (SnappyMail)', ok:health.mailOk, note: health.mailOk ? 'webmail.taxrescrm.net:7443 reachable' : 'Not reachable — check OCI server' },
    { label:'ICS Watcher',          ok:true,           note: health.icsRow ? `Last auto-import: ${fmtAgo(health.icsRow.created_at)}` : 'Running — no imports yet' },
    { label:'Cloudflare Pages',      ok:true,           note: 'taxrescrm.app live (Cloudflare)' },
  ] : []

  return (
    <div style={{ padding:'28px 36px', maxWidth:900 }}>
      <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:24 }}>
        <div style={{ fontSize:22,fontWeight:800,color:'#fff' }}>💚 System Health</div>
        {lastRefresh && <span style={{ fontSize:11,color:'#475569',marginLeft:'auto' }}>Last checked {fmtAgo(lastRefresh.toISOString())} ET</span>}
        <button onClick={loadHealth} disabled={loading} style={{ ...S.btn('ghost'),fontSize:11,padding:'4px 12px' }}>{loading?'Checking…':'↻ Refresh'}</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:14, marginBottom:28 }}>
        {[
          { label:'Active Offices',  val:health?.activeOff??'…', color:'#10b981' },
          { label:'Total Offices',   val:health?.offices??'…',   color:'#6366f1' },
          { label:'Total Seats',     val:health?.totalSeats??'…',color:'#f59e0b' },
          { label:'Total Clients',   val:health?.totalClients??'…',color:'#0ea5e9' },
        ].map(k=>(
          <div key={k.label} style={{ ...S.card,padding:'16px 18px' }}>
            <div style={{ fontSize:9,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'.06em' }}>{k.label}</div>
            <div style={{ fontSize:22,fontWeight:800,color:k.color,marginTop:4 }}>{loading && k.val==='…' ? '…' : k.val}</div>
          </div>
        ))}
      </div>
      <div style={{ ...S.card,padding:20 }}>
        {loading && !health ? <Spinner /> : checks.map(c=>(
          <div key={c.label} style={{ display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid rgba(99,102,241,.1)' }}>
            <span style={{ fontSize:16 }}>{c.ok ? '✅' : '❌'}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13,fontWeight:600,color:c.ok?'#e2e8f0':'#ef4444' }}>{c.label}</div>
              <div style={{ fontSize:11,color:'#475569' }}>{c.note}</div>
            </div>
            <span style={S.badge(c.ok?'#10b981':'#ef4444')}>{c.ok?'OK':'ERROR'}</span>
          </div>
        ))}
        {health?.loadError && <div style={{color:'#ef4444',fontSize:12,marginTop:8}}>Load error: {health.loadError}</div>}
      </div>
    </div>
  )
}

// ── Employee Lookup + Edit ───────────────────────────────────────────────────
const ACCESS_LEVELS = ['Super Admin','Admin','Tax Associate','Read Only']

function EmployeeEditModal({ emp, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:   emp.name   || '',
    access: emp.access || emp.role || 'Tax Associate',
    role:   emp.role   || emp.access || 'Tax Associate',
    phone:  emp.phone  || '',
  })
  const [saving, setSaving]     = useState(false)
  const [resetting, setResetting] = useState(false)
  const [toast, setToast]       = useState(null)
  const toast_ = (msg,type='ok')=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3500) }
  const fld = (k,v) => setForm(f=>({...f,[k]:v}))

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('employees')
      .update({ name:form.name, access:form.access, role:form.role, phone:form.phone })
      .eq('id', emp.id)
    setSaving(false)
    if (error) { toast_(error.message,'error'); return }
    toast_('✅ Employee updated')
    setTimeout(()=>{ onSaved(); onClose() }, 800)
  }

  async function resetPassword() {
    if (!confirm(`Send password reset email to ${emp.email}?`)) return
    setResetting(true)
    const { error } = await supabase.auth.resetPasswordForEmail(emp.email, {
      redirectTo: window.location.origin + '/'
    })
    setResetting(false)
    if (error) { toast_(error.message,'error') }
    else { toast_(`✅ Reset email sent to ${emp.email}`) }
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.75)',zIndex:9999,
      display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'#1a1830',border:'1px solid rgba(99,102,241,.35)',
        borderRadius:16,padding:28,width:480,maxWidth:'100%',position:'relative' }}>
        {toast && <Toast msg={toast.msg} type={toast.type} />}
        <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20 }}>
          <div>
            <div style={{ fontSize:18,fontWeight:800,color:'#fff' }}>{emp.name}</div>
            <div style={{ fontSize:12,color:'#6366f1',marginTop:2 }}>{emp.tenants?.firm_name||'—'}</div>
            <div style={{ fontSize:11,color:'#475569',marginTop:1 }}>Joined {fmtDate(emp.created_at)}</div>
          </div>
          <button onClick={onClose} style={{ background:'none',border:'none',color:'#64748b',
            fontSize:22,cursor:'pointer',lineHeight:1 }}>✕</button>
        </div>
        <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
          <div>
            <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:5 }}>Full Name</label>
            <input value={form.name} onChange={e=>fld('name',e.target.value)}
              style={{ width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid rgba(99,102,241,.3)',
                background:'rgba(255,255,255,.04)',color:'#e2e8f0',fontSize:14,boxSizing:'border-box' }}/>
          </div>
          <div>
            <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:5 }}>Phone</label>
            <input value={form.phone} onChange={e=>fld('phone',e.target.value)} type="tel"
              style={{ width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid rgba(99,102,241,.3)',
                background:'rgba(255,255,255,.04)',color:'#e2e8f0',fontSize:14,boxSizing:'border-box' }}/>
          </div>
          <div>
            <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:5 }}>Email</label>
            <input value={emp.email} disabled
              style={{ width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid rgba(99,102,241,.15)',
                background:'rgba(255,255,255,.02)',color:'#475569',fontSize:14,boxSizing:'border-box',cursor:'not-allowed' }}/>
            <div style={{ fontSize:11,color:'#334155',marginTop:3 }}>Email changes require Supabase Auth — use Reset Password below</div>
          </div>
          <div>
            <label style={{ fontSize:11,fontWeight:700,color:'#6366f1',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:5 }}>Access Level</label>
            <select value={form.access} onChange={e=>{ fld('access',e.target.value); fld('role',e.target.value) }}
              style={{ width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid rgba(99,102,241,.3)',
                background:'#1a1830',color:'#e2e8f0',fontSize:14 }}>
              {ACCESS_LEVELS.map(a=><option key={a} value={a}>{a}</option>)}
            </select>
            <div style={{ fontSize:11,color:'#334155',marginTop:4,lineHeight:1.5 }}>
              <strong style={{color:'#10b981'}}>Super Admin</strong> — full access including settings<br/>
              <strong style={{color:'#6366f1'}}>Admin</strong> — all client/lead/billing features<br/>
              <strong style={{color:'#0ea5e9'}}>Tax Associate</strong> — clients, leads, tasks, documents<br/>
              <strong style={{color:'#64748b'}}>Read Only</strong> — view only, no edits
            </div>
          </div>
        </div>
        <div style={{ marginTop:20,paddingTop:16,borderTop:'1px solid rgba(99,102,241,.15)',display:'flex',gap:10 }}>
          <button onClick={save} disabled={saving}
            style={{ ...S.btn('primary'),flex:1,justifyContent:'center',padding:'10px 0' }}>
            {saving?'Saving…':'💾 Save Changes'}
          </button>
          <button onClick={resetPassword} disabled={resetting}
            style={{ ...S.btn('ghost'),padding:'10px 16px',fontSize:12 }}>
            {resetting?'⏳':'🔑'} Reset Password
          </button>
        </div>
      </div>
    </div>
  )
}

function EmployeeLookup() {
  const [q,setQ]             = useState('')
  const [results,setResults] = useState(null)
  const [busy,setBusy]       = useState(false)
  const [selected,setSelected] = useState(null)

  async function search() {
    if (!q.trim()) return
    setBusy(true)
    // Clear tenant override so RLS returns employees across ALL tenants
    await supabase.rpc('set_admin_tenant_override', { p_tenant_id: null }).then(()=>{}).catch(()=>{})
    const { data } = await supabase
      .from('employees')
      .select('id,name,email,role,access,phone,avatar_url,tenant_id,created_at,tenants(firm_name)')
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(50)
    setBusy(false)
    setResults(data||[])
  }

  return (
    <div style={{ padding:'28px 36px',maxWidth:900 }}>
      {selected && <EmployeeEditModal emp={selected} onClose={()=>setSelected(null)} onSaved={search} />}
      <div style={{ fontSize:22,fontWeight:800,color:'#fff',marginBottom:6 }}>👥 Employee Lookup</div>
      <div style={{ fontSize:14,color:'#475569',marginBottom:20 }}>
        Find any employee across every office. Click any row to view full profile, edit details, or reset password.
      </div>
      <div style={{ display:'flex',gap:10,marginBottom:20 }}>
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()}
          placeholder="Name or email…" autoFocus
          style={{ flex:1,padding:'11px 16px',borderRadius:10,border:'1px solid rgba(99,102,241,.3)',
            background:'rgba(255,255,255,.04)',color:'#e2e8f0',fontSize:14,outline:'none' }}/>
        <button onClick={search} disabled={busy||!q.trim()} style={{ ...S.btn('primary'),padding:'11px 24px' }}>
          {busy?'…':'Search'}
        </button>
      </div>
      {results!==null && (results.length===0 ? (
        <div style={{ color:'#475569',fontSize:14 }}>No employees found.</div>
      ) : (
        <div style={S.card}>
          <table style={{ width:'100%',borderCollapse:'collapse',fontSize:13 }}>
            <thead><tr>{['Name','Email','Access Level','Office','Joined',''].map(h=>(
              <th key={h} style={S.th}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {results.map(e=>(
                <tr key={e.id} style={{ cursor:'pointer' }} onClick={()=>setSelected(e)}>
                  <td style={{ ...S.td,color:'#e2e8f0',fontWeight:600 }}>
                    {e.avatar_url&&<img src={e.avatar_url} style={{ width:22,height:22,borderRadius:'50%',
                      marginRight:8,verticalAlign:'middle' }} onError={ev=>ev.target.style.display='none'}/>}
                    {e.name}
                  </td>
                  <td style={{ ...S.td,color:'#94a3b8' }}>{e.email}</td>
                  <td style={S.td}>
                    <span style={S.badge(
                      e.access==='Super Admin'?'#10b981':
                      e.access==='Admin'?'#6366f1':
                      e.access==='Tax Associate'?'#0ea5e9':'#64748b'
                    )}>{e.access||e.role}</span>
                  </td>
                  <td style={{ ...S.td,color:'#6366f1',fontWeight:600 }}>{e.tenants?.firm_name||'—'}</td>
                  <td style={{ ...S.td,color:'#475569' }}>{fmtDate(e.created_at)}</td>
                  <td style={S.td}>
                    <button onClick={ev=>{ev.stopPropagation();setSelected(e)}}
                      style={{ ...S.btn('ghost'),padding:'4px 12px',fontSize:11 }}>Edit →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// ── Audit Log ────────────────────────────────────────────────────────────────
function AuditLog() {
  const [log,setLog] = useState(null)
  const [loadError,setLoadError] = useState('')
  useEffect(()=>{
    supabase.rpc('admin_get_audit_log',{p_limit:100}).then(({data,error})=>{if(error){setLoadError(error.message);setLog([])}else{setLoadError('');setLog(data||[])}})
  },[])
  return (
    <div style={{ padding:'28px 36px', maxWidth:900 }}>
      <div style={{ fontSize:22,fontWeight:800,color:'#fff',marginBottom:24 }}>📋 Audit Log</div>
      {loadError && <div style={{color:'#fca5a5',marginBottom:14}}>Unable to load audit log: {loadError}</div>}
      {!log ? <Spinner /> : log.length===0 ? (
        <div style={{ color:'#475569',fontSize:14 }}>No admin actions recorded yet.</div>
      ) : (
        <div style={S.card}>
          <table style={{ width:'100%',borderCollapse:'collapse',fontSize:13 }}>
            <thead><tr>{['Action','Admin','Office','Detail','When'].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {log.map(a=>(
                <tr key={a.id}>
                  <td style={{ ...S.td,color:'#a5b4fc',fontWeight:600 }}>{a.action}</td>
                  <td style={{ ...S.td,color:'#94a3b8',fontSize:12 }}>{a.admin_email}</td>
                  <td style={{ ...S.td,color:'#e2e8f0' }}>{a.target_name||'—'}</td>
                  <td style={{ ...S.td,color:'#475569',fontSize:11 }}>
                    {a.detail ? JSON.stringify(a.detail).slice(0,60) : '—'}
                  </td>
                  <td style={{ ...S.td,color:'#475569' }}>{fmtAgo(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Search ───────────────────────────────────────────────────────────────────
function Search() {
  const [q,setQ]=useState('')
  const [results,setResults]=useState(null)
  const [busy,setBusy]=useState(false)
  async function search(){
    if(!q.trim())return
    setBusy(true)
    const{data,error}=await supabase.rpc('admin_search_all',{p_query:q.trim()})
    setBusy(false)
    if(error){setResults([]);return}
    setResults(data||[])
  }
  return(
    <div style={{padding:'28px 36px',maxWidth:820}}>
      <div style={{fontSize:22,fontWeight:800,color:'#fff',marginBottom:6}}>🔍 Search All Offices</div>
      <div style={{fontSize:14,color:'#475569',marginBottom:20}}>Find any client or lead across every office by name, email, or phone.</div>
      <div style={{display:'flex',gap:10,marginBottom:20}}>
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()}
          placeholder="Name, email, or phone…" autoFocus
          style={{flex:1,padding:'11px 16px',borderRadius:10,border:'1px solid rgba(99,102,241,.3)',background:'rgba(255,255,255,.04)',color:'#e2e8f0',fontSize:14,outline:'none'}}/>
        <button onClick={search} disabled={busy||!q.trim()} style={{...S.btn('primary'),padding:'11px 24px'}}>
          {busy?'…':'Search'}
        </button>
      </div>
      {results!==null&&(results.length===0?<div style={{color:'#475569',fontSize:14}}>No matches.</div>:(
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {results.map(r=>(
            <div key={r.id} style={{...S.card,padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
              <span style={S.badge(r.record_type==='client'?'#10b981':'#f59e0b')}>{r.record_type}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,color:'#e2e8f0'}}>{r.name}</div>
                <div style={{fontSize:12,color:'#64748b'}}>{[r.email,r.phone].filter(Boolean).join(' · ')||'—'}</div>
              </div>
              <div style={{fontSize:12,color:'#6366f1',fontWeight:600}}>{r.tenant_name}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Email (SnappyMail embed) ─────────────────────────────────────────────────
const WEBMAIL_URL = 'https://webmail.taxrescrm.net:7443'

function Email(){return(
  <div style={{display:'flex',flexDirection:'column',height:'100vh'}}>
    <div style={{padding:'16px 28px 10px',borderBottom:'1px solid #1e293b',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
      <span style={{fontSize:18,fontWeight:800,color:'#fff'}}>📧 Email</span>
      <span style={{fontSize:13,color:'#475569'}}>romy@taxrescrm.net — powered by Stalwart</span>
      <a href={WEBMAIL_URL} target="_blank" rel="noreferrer"
        style={{marginLeft:'auto',fontSize:12,color:'#6366f1',textDecoration:'none'}}>Open in new tab ↗</a>
    </div>
    <iframe src={WEBMAIL_URL} title="SnappyMail"
      style={{flex:1,border:'none',width:'100%',background:'#0f172a'}}
      allow="clipboard-read; clipboard-write" />
  </div>
)}

// ── Training (screen-share training, admin context) ──────────────────────────
// Stamps FIRM with RomyLabs platform branding — never loads TCR practice tenant.
// Restores RomyLabs favicon on unmount so navigating away leaves no trace.
function AdminTraining(){
  const ss = useScreenShare()

  useEffect(()=>{
    // Set FIRM to RomyLabs platform identity — no DB call needed
    FIRM.name     = 'RomyLabs'
    FIRM.logoUrl  = '/romylabs-logo.png'
    FIRM.email    = 'romy@taxrescrm.net'
    FIRM.tenantId = 'a0000000-0000-0000-0000-000000000001'
    FIRM.loaded   = true
    document.title = 'RomyLabs — Command Center'
    return ()=>{
      // Restore RomyLabs favicon on unmount
      try {
        document.querySelectorAll("link[rel*='icon']").forEach(el => {
          el.href = '/romylabs-favicon.png'
        })
        document.title = 'RomyLabs — Command Center'
      } catch(_) {}
    }
  },[])

  return <TrainingPage/>
}

// ── Calendar (real CRM Calendar component, contained in the admin shell) ──────
// Must override to TCR tenant before rendering — romy@taxrescrm.net's own
// current_tenant_id() resolves TCR automatically, but if a demo impersonation
// was active in the same session this ensures the DB context is correct.
function AdminCalendar(){
  const [ready, setReady] = useState(false)

  useEffect(()=>{
    const prev = sessionStorage.getItem('admin_impersonation')
    sessionStorage.removeItem('admin_impersonation')
    // No override — current_tenant_id() resolves naturally from Romy's login (TCR)
    setReady(true)
    return ()=>{
      if (prev) sessionStorage.setItem('admin_impersonation', prev)
    }
  },[])
  if (!ready) return null
  // Wrap in a div with className="page-content" so Calendar's useEffect
  // escape hatch can find it and set overflow:hidden + padding:0.
  // Pre-set those values so there's no flash before the effect runs.
  // key="taxrescrm" forces a fresh mount so CalendarPage queries after the
  // tenant override is set — STABLE fn caching can otherwise return stale results.
  return (
    <div
      key="taxrescrm-calendar"
      className="page-content"
      style={{ position:'relative', overflow:'hidden', padding:0, height:'100%', flex:1 }}
    >
      <CalendarPage />
    </div>
  )
}

// ── Live Demo Launcher ───────────────────────────────────────────────────────
function LiveDemo() {
  const [rows, setRows] = useState(null)
  const [toast, setToast] = useState(null)
  const [launching, setLaunching] = useState(null)
  const toast_ = (msg,type='ok')=>{ setToast({msg,type}); setTimeout(()=>setToast(null),4000) }

  useEffect(()=>{
    supabase.rpc('admin_tenant_overview').then(({data})=>setRows(data||[]))
  },[])

  async function launchDemo(tenantId, firmName) {
    setLaunching(tenantId)
    const { data:token, error } = await supabase.rpc('create_impersonation_token',{ p_tenant_id:tenantId })
    setLaunching(null)
    if (error) { toast_(error.message,'error'); return }
    const url = `${window.location.origin}/impersonate?admin_token=${token}`
    window.open(url, '_blank')
    toast_(`✅ Demo opened for ${firmName} — token valid 15 min`)
  }

  const DEMO_TENANT = '489ace07-1a6b-4864-833a-4f8420568b40'

  return (
    <div style={{ padding:'28px 36px', maxWidth:900 }}>
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* Header with logo */}
      <div style={{ display:'flex', alignItems:'center', gap:20, marginBottom:32,
        padding:'24px 28px', borderRadius:16, background:'rgba(99,102,241,.06)',
        border:'1px solid rgba(99,102,241,.2)' }}>
        {FIRM.logoUrl && (
          <img src={FIRM.logoUrl} alt={FIRM.name || 'TaxRes CRM'}
            style={{ height:52, objectFit:'contain', flexShrink:0 }}
            onError={e=>{e.target.style.display='none'}} />
        )}
        <div>
          <div style={{ fontSize:22, fontWeight:800, color:'#fff', marginBottom:4 }}>🖥️ Live Demo Launcher</div>
          <div style={{ fontSize:14, color:'#64748b' }}>
            Jump into any office as an admin — opens a live CRM session in a new tab.
            Perfect for prospect demos and support calls. Each token expires in 15 minutes.
          </div>
        </div>
      </div>

      {/* Quick launch — Nash Demo highlighted */}
      {rows && rows.find(r=>r.id===DEMO_TENANT) && (() => {
        const demo = rows.find(r=>r.id===DEMO_TENANT)
        return (
          <div style={{ ...S.card, padding:'20px 24px', marginBottom:20,
            border:'1px solid rgba(251,146,60,.4)', background:'rgba(251,146,60,.04)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ fontSize:32 }}>🎭</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:2 }}>Nashville Tax Solutions</div>
                <div style={{ fontSize:13, color:'#64748b' }}>
                  Primary demo tenant · {demo.client_count} demo clients · {demo.employee_count} seats · Last active {fmtAgo(demo.last_activity)}
                </div>
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={()=>launchDemo(demo.id, demo.firm_name)}
                  disabled={launching===demo.id}
                  style={{ ...S.btn('primary'), fontSize:14, padding:'10px 24px',
                    background:'linear-gradient(135deg,#f97316,#fb923c)' }}>
                  {launching===demo.id ? '⏳ Opening…' : '🚀 Launch Demo'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* All offices */}
      <div style={{ fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase',
        letterSpacing:'.06em', marginBottom:14 }}>All Offices</div>

      {!rows ? <Spinner /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {rows.map(r => (
            <div key={r.id} style={{ ...S.card, padding:'16px 20px', display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ width:40, height:40, borderRadius:10, flexShrink:0,
                background: r.brand_color ? r.brand_color+'22' : 'rgba(99,102,241,.12)',
                border: `2px solid ${r.brand_color||'#6366f1'}33`,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:18, fontWeight:800, color:r.brand_color||'#6366f1' }}>
                {(r.firm_name||'?')[0]}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>{r.firm_name}</div>
                <div style={{ fontSize:12, color:'#475569', marginTop:2 }}>
                  {r.employee_count} employees · {r.client_count} clients · {r.lead_count} leads · Last active {fmtAgo(r.last_activity)}
                </div>
              </div>
              <span style={S.badge(STATUS_COLOR[r.status]||'#64748b')}>{r.status}</span>
              <button onClick={()=>launchDemo(r.id, r.firm_name)}
                disabled={!!launching}
                style={{ ...S.btn('ghost'), fontSize:12, padding:'7px 18px', flexShrink:0 }}>
                {launching===r.id ? '⏳' : '🚀'} {launching===r.id ? 'Opening…' : 'Open Session'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* How it works */}
      <div style={{ marginTop:28, padding:'16px 20px', borderRadius:12,
        background:'rgba(99,102,241,.05)', border:'1px solid rgba(99,102,241,.15)',
        fontSize:12, color:'#475569', lineHeight:1.7 }}>
        <div style={{ fontWeight:700, color:'#a5b4fc', marginBottom:4 }}>How it works</div>
        Each session creates a signed 15-minute impersonation token and opens the full CRM pre-authenticated as a Super Admin inside that office.
        You see exactly what the client sees — their data, their branding, their settings.
        Every session is logged in the Audit Log with timestamp and which office you accessed.
      </div>
    </div>
  )
}


// ── Demo Setup Wizard ────────────────────────────────────────────────────────
// Lets Romy skin the demo tenant as either the generic TaxRes CRM demo
// or a custom prospect-specific version (their logo, name, color) in seconds.
// Only touches the settings row of the Nashville demo tenant — nothing else.

const GENERIC_DEFAULTS = {
  firm_name:   'Nashville Tax Solutions',
  logo_url:    '/assets/taxrescrm-logo.png',
  brand_color: '#6366f1',
  phone:       '(888) 334-5052',
  email:       'demo@taxrescrm.net',
  address:     '123 Demo Street, Nashville, TN 37201',
}

function DemoSetup() {
  const [current, setCurrent]     = useState(null)
  const [form, setForm]           = useState(GENERIC_DEFAULTS)
  const [saving, setSaving]       = useState(false)
  const [resetting, setResetting] = useState(false)
  const [toast, setToast]         = useState(null)
  const [logoFile, setLogoFile]   = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const navigate = useNavigate()

  const toast_ = (msg, type='ok') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000) }
  const fld = (k,v) => setForm(f=>({...f,[k]:v}))

  useEffect(() => { loadCurrent() }, [])

  async function loadCurrent() {
    const { data } = await supabase.from('settings')
      .select('name,logourl,phone,email,address')
      .eq('tenant_id', DEMO_TENANT)
      .maybeSingle()
    if (data) {
      setCurrent(data)
      setForm(f => ({
        ...f,
        firm_name:  data.name  || f.firm_name,
        logo_url:   data.logourl || f.logo_url,
        phone:      data.phone || f.phone,
        email:      data.email || f.email,
        address:    data.address || f.address,
      }))
      setLogoPreview(data.logourl || null)
    }
  }

  function handleLogoFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function uploadLogo(file) {
    // Upload logo to Supabase storage — accessible from the browser
    const ext = file.name.split('.').pop() || 'png'
    const path = `demo-logos/prospect-logo-${Date.now()}.${ext}`
    const { data, error } = await supabase.storage
      .from('firm-assets')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (error) throw new Error(error.message)
    const { data: urlData } = supabase.storage.from('firm-assets').getPublicUrl(path)
    return urlData.publicUrl
  }

  async function applyToDemo() {
    setSaving(true)
    try {
      let logoUrl = form.logo_url

      // Upload logo if a file was selected
      if (logoFile) {
        toast_('Uploading logo…', 'ok')
        logoUrl = await uploadLogo(logoFile)
        // Add cache buster so browser loads the new logo
        logoUrl = logoUrl + '?v=' + Date.now()
      }

      // Update the demo tenant settings
      const { error } = await supabase.from('settings').update({
        name:    form.firm_name,
        logourl: logoUrl,
        phone:   form.phone,
        email:   form.email,
        address: form.address,
      }).eq('tenant_id', DEMO_TENANT)

      if (error) throw error

      // Log the action
      await supabase.rpc('log_admin_action', {
        p_action: 'demo_customized',
        p_tenant_id: DEMO_TENANT,
        p_tenant_name: form.firm_name,
        p_detail: { firm_name: form.firm_name, logo_applied: !!logoFile }
      })

      toast_(`✅ Demo is now set up for ${form.firm_name}`)
      loadCurrent()
    } catch (e) {
      toast_(e.message, 'error')
    }
    setSaving(false)
  }

  async function resetToGeneric() {
    setResetting(true)
    try {
      const { error } = await supabase.from('settings').update({
        name:    'Nashville Tax Solutions',
        logourl: '/assets/taxrescrm-logo.png',
        phone:   '(888) 334-5052',
        email:   'demo@taxrescrm.net',
        address: '123 Demo Street, Nashville, TN 37201',
      }).eq('tenant_id', DEMO_TENANT)
      if (error) throw error
      setLogoFile(null)
      setLogoPreview('/assets/taxrescrm-logo.png')
      setForm(GENERIC_DEFAULTS)
      toast_('✅ Demo reset to generic TaxRes CRM defaults')
      loadCurrent()
    } catch (e) {
      toast_(e.message, 'error')
    }
    setResetting(false)
  }

  return (
    <div style={{ padding:'28px 36px', maxWidth:720 }}>
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <div style={{ marginBottom:28 }}>
        <div style={{ fontSize:22,fontWeight:800,color:'#fff',marginBottom:4 }}>🎨 Demo Setup</div>
        <div style={{ fontSize:14,color:'#64748b' }}>
          Customize the demo tenant for a specific prospect, or reset to generic TaxRes CRM defaults.
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display:'flex',gap:12,marginBottom:28 }}>
        <div style={{ ...S.card,flex:1,padding:'18px 20px',cursor:'pointer',
          border: form.firm_name===GENERIC_DEFAULTS.firm_name
            ? '1px solid rgba(99,102,241,.5)' : '1px solid rgba(99,102,241,.2)' }}
          onClick={()=>{ setForm(GENERIC_DEFAULTS); setLogoFile(null); setLogoPreview(GENERIC_DEFAULTS.logo_url) }}>
          <div style={{ fontSize:24,marginBottom:6 }}>🎭</div>
          <div style={{ fontSize:13,fontWeight:700,color:'#fff' }}>Generic Demo</div>
          <div style={{ fontSize:11,color:'#475569',marginTop:2 }}>TaxRes CRM logo · Dummy Nashville data</div>
        </div>
        <div style={{ ...S.card,flex:1,padding:'18px 20px',
          border:'1px solid rgba(251,146,60,.3)',background:'rgba(251,146,60,.04)' }}>
          <div style={{ fontSize:24,marginBottom:6 }}>🏢</div>
          <div style={{ fontSize:13,fontWeight:700,color:'#fff' }}>Prospect Demo</div>
          <div style={{ fontSize:11,color:'#475569',marginTop:2 }}>Their logo · Their name · Their colors</div>
        </div>
      </div>

      {/* Form */}
      <div style={{ ...S.card,padding:24,marginBottom:20 }}>
        <div style={{ fontSize:12,fontWeight:700,color:'#6366f1',textTransform:'uppercase',
          letterSpacing:'.05em',marginBottom:18 }}>Demo Configuration</div>

        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:16 }}>
          {/* Firm name */}
          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:6 }}>Firm Name *</label>
            <input value={form.firm_name} onChange={e=>fld('firm_name',e.target.value)}
              placeholder="e.g. Bennett Tax Resolution"
              style={{ width:'100%',padding:'10px 14px',borderRadius:8,
                border:'1px solid rgba(99,102,241,.3)',background:'rgba(255,255,255,.04)',
                color:'#e2e8f0',fontSize:14,boxSizing:'border-box' }}/>
          </div>

          {/* Logo */}
          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:6 }}>Logo</label>
            <div style={{ display:'flex',gap:12,alignItems:'flex-start' }}>
              {/* Preview */}
              <div style={{ width:80,height:56,borderRadius:8,border:'1px solid rgba(99,102,241,.3)',
                background:'rgba(255,255,255,.06)',display:'flex',alignItems:'center',
                justifyContent:'center',flexShrink:0,overflow:'hidden',padding:6 }}>
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview"
                    style={{ maxWidth:'100%',maxHeight:'100%',objectFit:'contain' }}
                    onError={e=>{e.target.style.display='none'}} />
                ) : (
                  <span style={{ fontSize:24 }}>🏢</span>
                )}
              </div>
              <div style={{ flex:1 }}>
                <label style={{ display:'inline-block',padding:'9px 16px',borderRadius:8,
                  border:'1px solid rgba(99,102,241,.35)',background:'rgba(99,102,241,.1)',
                  color:'#a5b4fc',fontSize:13,fontWeight:600,cursor:'pointer',marginBottom:8 }}>
                  📁 Upload Logo
                  <input type="file" accept="image/*" onChange={handleLogoFile}
                    style={{ display:'none' }} />
                </label>
                <div style={{ fontSize:11,color:'#475569' }}>
                  PNG, JPG, SVG · Recommended: transparent background, landscape format
                </div>
                <div style={{ marginTop:8 }}>
                  <input value={form.logo_url} onChange={e=>{fld('logo_url',e.target.value);setLogoPreview(e.target.value)}}
                    placeholder="Or paste a logo URL…"
                    style={{ width:'100%',padding:'8px 12px',borderRadius:6,
                      border:'1px solid rgba(99,102,241,.2)',background:'rgba(255,255,255,.03)',
                      color:'#94a3b8',fontSize:12,boxSizing:'border-box' }}/>
                </div>
              </div>
            </div>
          </div>

          {/* Phone */}
          <div>
            <label style={{ fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:6 }}>Phone</label>
            <input value={form.phone} onChange={e=>fld('phone',e.target.value)}
              placeholder="(615) 555-0100"
              style={{ width:'100%',padding:'10px 14px',borderRadius:8,
                border:'1px solid rgba(99,102,241,.3)',background:'rgba(255,255,255,.04)',
                color:'#e2e8f0',fontSize:14,boxSizing:'border-box' }}/>
          </div>

          {/* Email */}
          <div>
            <label style={{ fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:6 }}>Email</label>
            <input value={form.email} onChange={e=>fld('email',e.target.value)}
              placeholder="info@theirfirm.com"
              style={{ width:'100%',padding:'10px 14px',borderRadius:8,
                border:'1px solid rgba(99,102,241,.3)',background:'rgba(255,255,255,.04)',
                color:'#e2e8f0',fontSize:14,boxSizing:'border-box' }}/>
          </div>

          {/* Address */}
          <div style={{ gridColumn:'1/-1' }}>
            <label style={{ fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',
              letterSpacing:'.05em',display:'block',marginBottom:6 }}>Address</label>
            <input value={form.address} onChange={e=>fld('address',e.target.value)}
              placeholder="123 Main St, Nashville, TN 37201"
              style={{ width:'100%',padding:'10px 14px',borderRadius:8,
                border:'1px solid rgba(99,102,241,.3)',background:'rgba(255,255,255,.04)',
                color:'#e2e8f0',fontSize:14,boxSizing:'border-box' }}/>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div style={{ ...S.card,padding:20,marginBottom:20,border:'1px solid rgba(99,102,241,.15)' }}>
        <div style={{ fontSize:11,fontWeight:700,color:'#475569',textTransform:'uppercase',
          letterSpacing:'.05em',marginBottom:12 }}>Preview — What the demo will show</div>
        <div style={{ display:'flex',alignItems:'center',gap:14 }}>
          {logoPreview && (
            <img src={logoPreview} alt="preview" style={{ height:40,objectFit:'contain' }}
              onError={e=>{e.target.style.display='none'}} />
          )}
          <div>
            <div style={{ fontSize:16,fontWeight:800,color:'#fff' }}>{form.firm_name||'—'}</div>
            <div style={{ fontSize:12,color:'#475569' }}>{form.phone} · {form.email}</div>
            <div style={{ fontSize:12,color:'#475569' }}>{form.address}</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display:'flex',gap:12 }}>
        <button onClick={applyToDemo} disabled={saving||resetting}
          style={{ ...S.btn('primary'),flex:1,justifyContent:'center',padding:'12px 0',fontSize:14 }}>
          {saving ? '⏳ Applying…' : '✅ Apply to Demo'}
        </button>
        <button onClick={()=>navigate('/crm-admin/demo')} disabled={saving||resetting}
          style={{ ...S.btn('ghost'),padding:'12px 20px',fontSize:13 }}>
          🚀 Launch Demo
        </button>
        <button onClick={resetToGeneric} disabled={saving||resetting}
          style={{ ...S.btn('danger'),padding:'12px 20px',fontSize:13 }}>
          {resetting ? '⏳' : '↺'} Reset to Generic
        </button>
      </div>

      <div style={{ marginTop:14,fontSize:11,color:'#334155',lineHeight:1.6 }}>
        Changes apply immediately to the demo tenant. Click <strong style={{color:'#a5b4fc'}}>Launch Demo</strong> to open the live CRM.
        Use <strong style={{color:'#94a3b8'}}>Reset to Generic</strong> after the call to restore TaxRes CRM defaults.
      </div>
    </div>
  )
}

// ── Main Shell ───────────────────────────────────────────────────────────────
// ── Command Center primitives (module scope — must NOT be inside CommandCenter) ─
const CC = {
  card: (extra={}) => ({
    background:'rgba(255,255,255,.04)',
    border:'1px solid rgba(99,102,241,.18)',
    borderRadius:14,
    overflow:'hidden',
    ...extra,
  }),
  sectionLabel: { fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:12 },
  kpiCard: (color) => ({
    background:`linear-gradient(135deg, ${color}18, ${color}08)`,
    border:`1px solid ${color}30`,
    borderRadius:12,
    padding:'18px 20px',
    cursor:'pointer',
    transition:'transform .15s, box-shadow .15s',
  }),
}

function KPICard({ label, value, sub, color, icon, to, tabKey, onNav, onTab }) {
  const [hover, setHover] = useState(false)
  function handleClick() {
    if (tabKey && onTab) onTab(tabKey)
    else if (to && onNav) onNav(to)
  }
  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...CC.kpiCard(color),
        transform: hover ? 'translateY(-3px)' : 'none',
        boxShadow: hover ? `0 8px 32px ${color}30` : 'none',
      }}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ fontSize:10, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.07em' }}>{label}</div>
        <div style={{ fontSize:18, opacity:.5 }}>{icon}</div>
      </div>
      <div style={{ fontSize:30, fontWeight:900, color, lineHeight:1, marginTop:10 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize:11, color:'#475569', marginTop:5 }}>{sub}</div>}
    </div>
  )
}

function MiniBar({ pct, color }) {
  return (
    <div style={{ height:6, background:'rgba(255,255,255,.06)', borderRadius:3, overflow:'hidden', flex:1 }}>
      <div style={{ height:'100%', width:`${Math.min(100,pct)}%`, background:color, borderRadius:3,
        transition:'width .6s ease', boxShadow:`0 0 8px ${color}60` }} />
    </div>
  )
}

function GoalBar({ label, current, target, unit, color }) {
  const pct = Math.min(100, Math.round((current/target)*100))
  const fmt = (v) => unit==='$' ? `$${Number(v).toLocaleString('en-US',{maximumFractionDigits:0})}` : `${Number(v).toLocaleString()}${unit!=='$'&&unit!=='demos'&&unit!=='firms'&&unit!=='visitors'?' '+unit:''}`
  return (
    <div style={{ marginBottom:18 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
        <div style={{ fontSize:12, fontWeight:600, color:'#e2e8f0' }}>{label}</div>
        <div style={{ fontSize:11, color:'#64748b' }}>{fmt(current)} / {fmt(target)} · <span style={{ color }}>{pct}%</span></div>
      </div>
      <MiniBar pct={pct} color={color} />
    </div>
  )
}

function StatusDot({ ok }) {
  if (ok === null) return <span style={{ fontSize:10, color:'#475569', fontWeight:600 }}>—</span>
  return <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%',
    background: ok ? '#10b981' : '#ef4444',
    boxShadow: ok ? '0 0 6px #10b98160' : '0 0 6px #ef444460' }} />
}



function ProductReportingSelector({ value, onChange, channel, gscConnected, activeGscProduct, registryProducts, marketingConnectedProducts=[], seoConnectedProducts=[] }) {
  // Derives entirely from romylabs_products registry — no hardcoded product list.
  // Integration status starts as 'pending' (setup needed) for all products.
  // Live GSC connection overrides the SEO badge when gscConnected===true for the active product.
  // Adding a new product to romylabs_products automatically makes it appear here — no frontend edit needed.
  if (!registryProducts || registryProducts.length === 0) {
    return <div style={{ fontSize:12, color:'#475569', marginBottom:22 }}>Loading products…</div>
  }
  const corporateReporting = ['seo','marketing'].includes(channel) ? [{
    key:       'romylabs',
    label:     'RomyLabs Corporate',
    icon:      '◆',
    color:     '#C6FF00',
    seo:       'implemented',
    marketing: 'implemented',
  }] : []
  const mapped = [...corporateReporting, ...registryProducts.map(r => ({
    key:       r.product_id,
    label:     r.name,
    icon:      r.icon_ref || '📦',
    color:     r.accent_color || '#6366f1',
    seo:       'pending',
    marketing: 'pending',
  }))]
  return (
    <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:22 }}>
      {mapped.map(p => {
        const status = p[channel]
        // Live GSC connection overrides static label for the active product on the SEO channel
        const isGscLive = channel === 'seo' && (seoConnectedProducts.includes(p.key) || (gscConnected && p.key === activeGscProduct))
        const isMarketingLive = channel === 'marketing' && marketingConnectedProducts.includes(p.key)
        const statusLabel = isMarketingLive
          ? 'GA4 Connected'
          : isGscLive
          ? 'GSC Connected'
          : status === 'connected' ? 'Connected'
          : status === 'implemented' ? `${channel === 'seo' ? 'SEO' : 'Marketing'} implemented · reporting pending`
          : 'Setup needed'
        const statusColor = (status === 'connected' || isGscLive || isMarketingLive) ? '#10b981'
          : status === 'implemented' ? '#a78bfa'
          : '#f59e0b'
        return (
          <button key={p.key} onClick={() => onChange(p.key)} style={{
            minWidth:190, textAlign:'left', padding:'12px 14px', borderRadius:10, cursor:'pointer',
            background:value===p.key ? p.color+'20' : 'rgba(255,255,255,.025)',
            border:value===p.key ? `1px solid ${p.color}` : '1px solid rgba(255,255,255,.08)',
            color:'#fff'
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
              <span>{p.icon}</span><span style={{ fontSize:13, fontWeight:800 }}>{p.label}</span>
            </div>
            <div style={{ fontSize:10, color:statusColor }}>● {statusLabel}</div>

          </button>
        )
      })}
    </div>
  )
}

function ProductReportingSetup({ productKey, channel, registryProduct }) {
  // Registry-driven: no hardcoded REPORTING_PRODUCTS lookup.
  const label = registryProduct?.name || productKey
  const icon  = registryProduct?.icon_ref || '📦'
  const title = channel === 'marketing' ? 'Product usage analytics' : 'SEO reporting'
  const details = `${label} does not have a dedicated ${channel === 'marketing' ? 'GA4 product-usage connection' : 'Search Console data connection'} in the RomyLabs reporting hub yet.`
  return (
    <div style={{ ...CC.card(), padding:'30px', maxWidth:780 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
        <span style={{ fontSize:26 }}>{icon}</span>
        <div>
          <div style={{ fontSize:16, fontWeight:900, color:'#fff' }}>{label} — {title}</div>
        </div>
        <span style={{ marginLeft:'auto', fontSize:10, fontWeight:800, color:'#f59e0b', background:'rgba(245,158,11,.12)', padding:'4px 9px', borderRadius:12 }}>Reporting setup needed</span>
      </div>
      <div style={{ fontSize:13, lineHeight:1.7, color:'#94a3b8', marginBottom:18 }}>{details}</div>
      <div style={{ fontSize:11, color:'#475569', borderTop:'1px solid rgba(255,255,255,.07)', paddingTop:14 }}>
        No TaxRes data is shown here. This panel stays separate until {label}'s own connection is verified.
      </div>
    </div>
  )
}

// ── Products Tab ──────────────────────────────────────────────────────────────
// Shows cross-product metrics from platform_metrics table.
// Products tab — hub for all CRMs. Each card opens a live dashboard panel.
const PRODUCT_REGISTRY = [
  // ── ARCHITECTURE NOTE ────────────────────────────────────────────────────
  // PRODUCTS: TaxRes CRM (platform), Camvella, Arcvena, BocaSync, GroundIVO, Oculivo, Restore Relay, + planned verticals
  // CUSTOMERS/TENANTS: Tax Case Review, Nashville, CloudCPA (live TaxRes tenants — not products)
  // connection: 'connected' | 'partial' | 'not_connected'
  // lifecycleStage: 'live' | 'available' | 'building' | 'research' | 'internal'
  // brandStatus: 'branded' | 'working_name' | 'unnamed'
  // publicOnRomyLabs: bool — whether it appears on romylabs.com
  // commerciallyAvailable: bool

  // ── LIVE PRODUCTS ────────────────────────────────────────────────────────
  {
    key:        'taxres_crm',
    label:      'Tax Res CRM',
    icon:       '📊',
    color:      '#2563EB',
    industry:   'Tax Resolution',
    url:        'https://taxrescrm.app',
    appUrl:     'https://taxrescrm.app',
    websiteUrl: 'https://taxrescrm.net',
    lifecycleStage: 'live',
    connection:     'connected',
    brandStatus:    'branded',
    publicOnRomyLabs: true,
    commerciallyAvailable: true,
    desc:      'Multi-tenant SaaS CRM for tax resolution firms',
    metricsUrl: 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/platform-metrics?view=saas',
  },
  {
    key:        'camvella',
    label:      'Camvella',
    icon:       '🏘️',
    color:      '#0F766E',
    industry:   'HOA / Property Management',
    url:        'https://app.camvella.com',
    appUrl:     'https://app.camvella.com',
    websiteUrl: 'https://www.camvella.com',
    lifecycleStage: 'available',
    connection:     'connected',  // platform-metrics deployed 2026-08-23
    brandStatus:    'branded',
    publicOnRomyLabs: true,
    commerciallyAvailable: true,
    desc:      'HOA & community association management CRM',
    metricsUrl: 'https://fjqywulzsyfyzitneazb.supabase.co/functions/v1/platform-metrics',
  },
  {
    key:        'arcvena',
    label:      'Arcvena',
    icon:       '⚡',
    color:      '#00C2FF',
    industry:   'Electrical Contractors',
    url:        'https://app.arcvena.com',
    appUrl:     'https://app.arcvena.com',
    websiteUrl: 'https://www.arcvena.com',
    lifecycleStage: 'available', // product and public site are active; final reporting connection remains
    connection:     'connected', // live Arcvena platform metrics deployed and session-authenticated
    brandStatus:    'branded',
    publicOnRomyLabs: true,
    commerciallyAvailable: true,
    desc:      'Asset intelligence & job management for electrical contractors',
    metricsUrl: 'https://wzalqfxovxxszojfbnis.supabase.co/functions/v1/platform-metrics',
    nextMilestone: 'Verify Arcvena live metrics, GA4 Data API, and Search Console reporting'
  },
  {
    key:       'bocasync',
    label:     'BocaSync',
    icon:      '🦷',
    color:     '#1596A6',
    industry:  'Dental Practice Management',
    url:       'https://app.bocasync.com',
    appUrl:    'https://app.bocasync.com',
    websiteUrl: 'https://bocasync.com',
    lifecycleStage: 'available',
    connection:     'partial',   // hub-proxy wired; platform-metrics fn pending deployment in bocasync repo
    brandStatus:    'branded',
    publicOnRomyLabs: true,
    commerciallyAvailable: true,
    desc:      'Dental practice management CRM — scheduling, patient records, billing, and team management.',
    metricsUrl: 'https://zmejbkttzvaqzzbmjclz.supabase.co/functions/v1/platform-metrics',
    nextMilestone: 'Deploy platform-metrics in bocasync repo → Command Center goes live',
  },
  {
    key:        'groundivo',
    label:      'GroundIVO',
    icon:       '🌿',
    color:      '#16a34a',
    industry:   'Landscaping & Field Service',
    url:        'https://app.groundivo.com',
    appUrl:     'https://app.groundivo.com',
    websiteUrl: null,  // www.groundivo.com is parked; set when real marketing site deploys
    lifecycleStage: 'available',
    connection:     'partial',
    brandStatus:    'branded',
    publicOnRomyLabs: true,
    commerciallyAvailable: true,
    desc:      'Field service CRM built for landscaping, lawn care, and pest control businesses.',
    metricsUrl: null,
    nextMilestone: 'LinkedIn auth + marketing site launch',
  },

  {
    key:        'oculivo',
    label:      'Oculivo',
    icon:       '👁️',
    color:      '#7C3AED',
    industry:   'Eye Care',
    url:        'https://app.oculivo.com',
    appUrl:     'https://app.oculivo.com',
    websiteUrl: 'https://oculivo.com',
    lifecycleStage: 'building',
    connection:     'partial',
    brandStatus:    'branded',
    publicOnRomyLabs: true,
    commerciallyAvailable: false,
    desc:      'Eye-care CRM and practice operating system for optometry, ophthalmology, optical retail, and multi-location groups.',
    metricsUrl: null,
    nextMilestone: 'Finish product build, deploy platform metrics, and verify analytics reporting',
    priorityRank:   1,
  },
  {
    key:        'restore_relay',
    label:      'Restore Relay',
    icon:       '🏚️',
    color:      '#C2410C',
    industry:   'Restoration & Roofing',
    url:        null,
    appUrl:     null,
    websiteUrl: null,
    lifecycleStage: 'building',
    connection:     'not_connected',
    brandStatus:    'branded',
    publicOnRomyLabs: true,
    commerciallyAvailable: false,
    nextToFinish:   true,
    priorityRank:   2,
    repo:            'taxresolutioncrm/p7-crm',
    desc:      'RomyLabs Product #7 — restoration and roofing CRM for claims, projects, customers, crews, documents, estimates, and field operations.',
    metricsUrl: null,
    nextMilestone: 'NEXT CRM TO FINISH — complete Restore Relay build, deploy Supabase, platform metrics, SEO, and launch QA',
  },
  // ── TENANTS (not products — operational data, not product counts) ─────────
  {
    key:       'tax_case_review',
    label:     'Tax Case Review',
    icon:      '⚖️',
    color:     '#10b981',
    industry:  'Tax Resolution',
    isTenant:  true,  // customer/tenant — not a product
    url:       null,
    lifecycleStage: 'live',
    connection:     'connected',
    brandStatus:    'branded',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      "Romy's own tax practice — origin CRM (TRC-001)",
    metricsUrl: 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/platform-metrics?view=tcr',
    tenantId:  '61a89aef-0e7e-4ea2-b222-44ab2024655a',
  },
  {
    key:       'nashville',
    label:     'Nashville Tax Solutions',
    icon:      '🎸',
    color:     '#14b8a6',
    industry:  'Tax Resolution',
    isTenant:  true,
    url:       'https://nashville.taxrescrm.app',
    lifecycleStage: 'live',
    connection:     'connected',
    brandStatus:    'branded',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'TRC-002 — Nashville tenant on its own Supabase project',
    metricsUrl: 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/platform-metrics?view=nash',
  },
  {
    key:       'cloudcpa',
    label:     'CloudCPA Inc',
    icon:      '☁️',
    color:     '#38bdf8',
    industry:  'Tax Resolution',
    isTenant:  true,
    url:       null,
    lifecycleStage: 'live',
    connection:     'connected',
    brandStatus:    'branded',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'TRC-003 — CloudCPA Inc (trial) — contract pending',
    metricsUrl: 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/platform-metrics?view=cloudcpa',
    tenantId:  'ecd3d3ce-016a-4bb4-800e-f090f51e4cae',
  },

  // ── PLANNED / RESEARCH CRM INITIATIVES ────────────────────────────────────
  {
    key:       'hvac_plumbing',
    label:     'HVAC / Plumbing CRM',
    icon:      '🔧',
    color:     '#64748b',
    industry:  'HVAC & Plumbing',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Field service CRM for HVAC and plumbing contractors',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'auto_repair',
    label:     'Auto Repair CRM',
    icon:      '🚗',
    color:     '#64748b',
    industry:  'Automotive / Auto Repair',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Shop management CRM for auto repair businesses',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'contractors',
    label:     'General Contractors CRM',
    icon:      '🏗️',
    color:     '#64748b',
    industry:  'General Contracting / Construction',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Project & client management for general contractors',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'legal',
    label:     'Legal Practice CRM',
    icon:      '⚖️',
    color:     '#64748b',
    industry:  'Legal / Law Firm',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Client & case management for law firms and solo practitioners',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'health_insurance',
    label:     'Health Insurance Agency CRM',
    icon:      '🏥',
    color:     '#64748b',
    industry:  'Health Insurance',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Policy and client management for health insurance agents',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'real_estate',
    label:     'Real Estate CRM',
    icon:      '🏠',
    color:     '#64748b',
    industry:  'Real Estate',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Lead and transaction management for real estate agents and brokers',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'cleaning',
    label:     'Cleaning / Janitorial CRM',
    icon:      '🧹',
    color:     '#64748b',
    industry:  'Cleaning & Janitorial Services',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Scheduling and client management for cleaning businesses',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'med_spa',
    label:     'Med Spa CRM',
    icon:      '💆',
    color:     '#64748b',
    industry:  'Medical Spa / Aesthetics',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Appointment, treatment, and client management for med spas',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'home_care',
    label:     'Home Care CRM',
    icon:      '🏡',
    color:     '#64748b',
    industry:  'Home Care / Senior Care',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Caregiver scheduling and client management for home care agencies',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },
  {
    key:       'veterinary',
    label:     'Veterinary Practice CRM',
    icon:      '🐾',
    color:     '#64748b',
    industry:  'Veterinary / Animal Health',
    url:       null,
    lifecycleStage: 'research',
    connection:     'not_connected',
    brandStatus:    'unnamed',
    publicOnRomyLabs: false,
    commerciallyAvailable: false,
    desc:      'Patient records and appointment management for veterinary practices',
    metricsUrl: null,
    nextMilestone: 'Define product architecture / brand / build phase',
  },

]

function fmt$(n) { return n ? `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—' }
function fmtN(n) { return n != null ? Number(n).toLocaleString() : '—' }
function ArcvenaOfficeOnboarding({ supabase, onCreated }) {
  const [form, setForm] = useState({
    company_name: '',
    owner_name: '',
    owner_email: '',
    timezone: 'America/New_York',
    subscription_status: 'TRIALING',
    trial_days: 14,
    monthly_rate_dollars: 0,
  })
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const field = (key, value) => setForm(current => ({ ...current, [key]: value }))

  async function createOffice(e) {
    e.preventDefault()
    const submitAction = e.nativeEvent?.submitter?.value
    const action = submitAction === 'stage' ? 'stage' : submitAction === 'prepare' ? 'prepare' : submitAction === 'send_access' ? 'send_access' : submitAction === 'prepare_platform_admin' ? 'prepare_platform_admin' : 'invite'
    setSaving(true)
    setError('')
    setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Admin session expired')
      const response = await fetch('https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1weGd4ZnFkYnF1emtydnZlamtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTkwMDE4OTIsImV4cCI6MjAzNDU3Nzg5Mn0.zr0F_sV9-TJxO1wOST3VHr_n-5jPTpLY_AzEfKR1hSo',
        },
        body: JSON.stringify({
          action: 'onboard_arcvena',
          payload: { ...form, action, monthly_rate_cents: Math.round(Number(form.monthly_rate_dollars || 0) * 100) },
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to create office')
      setResult(data)
      setForm(current => ({ ...current, company_name: '', owner_name: '', owner_email: '' }))
      onCreated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setSaving(false)
  }

  const inputStyle = {
    width:'100%', boxSizing:'border-box', background:'rgba(2,6,23,.72)',
    border:'1px solid rgba(139,92,246,.25)', color:'#e2e8f0',
    borderRadius:8, padding:'9px 11px', fontSize:12, outline:'none',
  }

  return (
    <div style={{ background:'rgba(139,92,246,.06)', border:'1px solid rgba(139,92,246,.25)',
      borderRadius:12, padding:'16px 18px', marginBottom:20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:900, color:'#fff' }}>⚡ Create New Arcvena Office</div>
          <div style={{ fontSize:10, color:'#64748b', marginTop:3 }}>
            Save a shell draft, fully provision without email, or provision and send the Owner invitation.
          </div>
        </div>
        <span style={{ fontSize:9, color:'#10b981', background:'rgba(16,185,129,.1)', padding:'4px 8px', borderRadius:10 }}>
          PLATFORM ADMIN ONLY
        </span>
      </div>
      <form onSubmit={createOffice}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <input required value={form.company_name} onChange={e=>field('company_name',e.target.value)}
            placeholder="Company legal name" style={inputStyle} />
          <input value={form.owner_name} onChange={e=>field('owner_name',e.target.value)}
            placeholder="Owner full name (required to invite)" style={inputStyle} />
          <input type="email" value={form.owner_email} onChange={e=>field('owner_email',e.target.value)}
            placeholder="Owner business email (required to invite)" style={inputStyle} />
          <select value={form.timezone} onChange={e=>field('timezone',e.target.value)} style={inputStyle}>
            <option value="America/New_York">Eastern Time</option>
            <option value="America/Chicago">Central Time</option>
            <option value="America/Denver">Mountain Time</option>
            <option value="America/Phoenix">Arizona Time</option>
            <option value="America/Los_Angeles">Pacific Time</option>
            <option value="America/Anchorage">Alaska Time</option>
            <option value="Pacific/Honolulu">Hawaii Time</option>
          </select>
          <select value={form.subscription_status} onChange={e=>field('subscription_status',e.target.value)} style={inputStyle}>
            <option value="TRIALING">Trial</option>
            <option value="ACTIVE">Active / approved pilot</option>
          </select>
          <input type="number" min="0" max="90" value={form.trial_days}
            disabled={form.subscription_status === 'ACTIVE'}
            onChange={e=>field('trial_days',Number(e.target.value))} placeholder="Trial days" style={inputStyle} />
          <input type="number" min="0" step="0.01" value={form.monthly_rate_dollars}
            onChange={e=>field('monthly_rate_dollars',Number(e.target.value))}
            placeholder="Monthly price ($)" style={inputStyle} />
        </div>
        {error && <div style={{ color:'#f87171', fontSize:11, marginTop:10 }}>{error}</div>}
        {result && (
          <div style={{ color:'#34d399', fontSize:11, marginTop:10 }}>
            {result.access_email_sent
              ? `Arcvena platform administrator access sent to ${result.platform_admin_email}.`
              : result.prepared_owner_access_sent
                ? `Prepared Owner access email sent to ${result.owner_email}. Tenant: ${result.tenant_id}`
              : result.invitation_sent
                ? `Office active. Owner invitation sent to ${result.owner_email}. Tenant: ${result.tenant_id}`
                : result.owner_account_prepared
                ? `Office fully provisioned. Owner account prepared without sending email. Tenant: ${result.tenant_id}`
                : `Draft saved. No email sent and no trial started. Tenant: ${result.tenant_id}`}
          </div>
        )}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12 }}>
          <button type="submit" value="stage" disabled={saving}
            style={{ background:'rgba(139,92,246,.12)', color:'#c4b5fd', border:'1px solid rgba(139,92,246,.35)', borderRadius:8,
              padding:'9px 16px', fontSize:12, fontWeight:800, cursor:saving?'wait':'pointer', opacity:saving ? .65 : 1 }}>
            {saving ? 'Working…' : 'Save as Draft — No Email'}
          </button>
          <button type="submit" value="prepare" disabled={saving || !form.owner_name.trim() || !form.owner_email.trim()}
            style={{ background:'rgba(16,185,129,.12)', color:'#6ee7b7', border:'1px solid rgba(16,185,129,.35)', borderRadius:8,
              padding:'9px 16px', fontSize:12, fontWeight:800, cursor:saving?'wait':'pointer', opacity:(saving || !form.owner_name.trim() || !form.owner_email.trim()) ? .65 : 1 }}>
            {saving ? 'Working…' : 'Fully Provision — Send Email Later'}
          </button>
          <button type="submit" value="prepare_platform_admin" disabled={saving || !form.owner_name.trim() || !form.owner_email.trim()}
            style={{ background:'rgba(245,158,11,.12)', color:'#fcd34d', border:'1px solid rgba(245,158,11,.35)', borderRadius:8,
              padding:'9px 16px', fontSize:12, fontWeight:800, cursor:saving?'wait':'pointer', opacity:(saving || !form.owner_name.trim() || !form.owner_email.trim()) ? .65 : 1 }}>
            {saving ? 'Working…' : 'Set Up Platform Admin Login'}
          </button>
          <button type="submit" value="send_access" disabled={saving || !form.company_name.trim() || !form.owner_email.trim()}
            style={{ background:'rgba(14,165,233,.12)', color:'#7dd3fc', border:'1px solid rgba(14,165,233,.35)', borderRadius:8,
              padding:'9px 16px', fontSize:12, fontWeight:800, cursor:saving?'wait':'pointer', opacity:(saving || !form.company_name.trim() || !form.owner_email.trim()) ? .65 : 1 }}>
            {saving ? 'Working…' : 'Send Prepared Owner Access'}
          </button>
          <button type="submit" value="invite" disabled={saving || !form.owner_name.trim() || !form.owner_email.trim()}
            style={{ background:'#8b5cf6', color:'#fff', border:'none', borderRadius:8,
              padding:'9px 16px', fontSize:12, fontWeight:800, cursor:saving?'wait':'pointer', opacity:(saving || !form.owner_name.trim() || !form.owner_email.trim()) ? .65 : 1 }}>
            {saving ? 'Working…' : 'Create Office & Send Owner Invite'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ProductsTab({ supabase, taxresActivity = [] }) {
  const [productParams] = useSearchParams()
  const portfolioFilter = productParams.get('portfolio') || ''
  const [selected, setSelected]     = useState(null)
  const [liveData, setLiveData]     = useState({})
  const [loading, setLoading]       = useState({})
  const [filter, setFilter]         = useState('all') // 'all' | 'products' | 'tenants' | 'planned'
  const [taxresOps, setTaxresOps]   = useState(null)
  const [taxresLoading, setTaxresLoading] = useState(false)

  async function fetchMetrics(product) {
    if (!product.metricsUrl) return          // only fetch products with a connected endpoint
    if (loading[product.key]) return
    setLoading(l => ({ ...l, [product.key]: true }))
    try {
      // Route through hub-proxy — HUB_METRICS_SECRET never reaches the browser.
      // Browser sends its Supabase JWT; hub-proxy verifies platform_admin server-side.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not authenticated')
      const HUB_PROXY = 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy'
      const res = ['camvella', 'arcvena'].includes(product.key)
        ? await fetch(product.metricsUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          })
        : await fetch(HUB_PROXY, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type':  'application/json',
              'apikey':        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1weGd4ZnFkYnF1emtydnZlamtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTkwMDE4OTIsImV4cCI6MjAzNDU3Nzg5Mn0.zr0F_sV9-TJxO1wOST3VHr_n-5jPTpLY_AzEfKR1hSo',
            },
            body: JSON.stringify({ product: product.key }),
          })
      const data = await res.json()
      setLiveData(d => ({ ...d, [product.key]: data }))
    } catch (e) {
      setLiveData(d => ({ ...d, [product.key]: { ok: false, error: String(e) } }))
    }
    setLoading(l => ({ ...l, [product.key]: false }))
  }

  async function loadTaxResOps() {
    if (taxresLoading || taxresOps) return
    setTaxresLoading(true)
    try {
      const [statsRes, tenantsRes] = await Promise.all([
        supabase.rpc('admin_command_center_stats'),
        supabase.rpc('admin_tenant_overview'),
      ])
      const stats   = statsRes.data || {}
      const tenants = tenantsRes.data || []
      setTaxresOps({ stats, tenants })
    } catch(e) { console.error('TaxRes ops load:', e) }
    setTaxresLoading(false)
  }

  function selectProduct(p) {
    setSelected(p)
    if (p.metricsUrl && !liveData[p.key]) fetchMetrics(p)
    if (p.key === 'taxres_crm') loadTaxResOps()
  }

  const CC = { card: (s={}) => ({ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(99,102,241,.15)', borderRadius: 12, ...s }) }

  // ── Status helpers ──────────────────────────────────────────────────────
  const LIFECYCLE_LABEL = {
    live:      { label: '✅ Live',         color: '#10b981' },
    available: { label: '🟢 Available',    color: '#10b981' },
    coming:    { label: '🔜 Coming Soon',  color: '#8b5cf6' },
    building:  { label: '🔨 Building',     color: '#f59e0b' },
    research:  { label: '🔬 Research',     color: '#64748b' },
    internal:  { label: '🔒 Internal',     color: '#475569' },
  }
  const CONN_LABEL = {
    connected:     { label: 'Connected',     color: '#10b981', dot: '🟢' },
    partial:       { label: 'Partial',       color: '#f59e0b', dot: '🟡' },
    not_connected: { label: 'Not Connected', color: '#64748b', dot: '⚪' },
  }
  const BRAND_LABEL = {
    branded:      'Branded',
    working_name: 'Working Name',
    unnamed:      'Not Selected',
  }

  function getLifecycle(p) { return LIFECYCLE_LABEL[p.lifecycleStage] || { label: p.lifecycleStage, color: '#64748b' } }
  function getConn(p)      { return CONN_LABEL[p.connection] || { label: p.connection, color: '#64748b', dot: '⚪' } }

  // ── Portfolio counts (from registry only — no live data needed) ─────────
  const products = PRODUCT_REGISTRY.filter(p => !p.isTenant)
  const tenants  = PRODUCT_REGISTRY.filter(p =>  p.isTenant)
  const liveCount     = products.filter(p => p.lifecycleStage === 'live' || p.lifecycleStage === 'available').length
  const comingCount   = products.filter(p => p.lifecycleStage === 'coming').length
  const buildingCount = products.filter(p => p.lifecycleStage === 'building').length
  const researchCount = products.filter(p => p.lifecycleStage === 'research').length
  const internalCount = products.filter(p => p.lifecycleStage === 'internal').length
  const connectedCount= products.filter(p => p.connection === 'connected').length
  const partialCount  = products.filter(p => p.connection === 'partial').length

  // ── Filtered list ───────────────────────────────────────────────────────
  const lifecycleOrder = { live:0, available:1, coming:2, internal:3, building:4, research:5 }
  const sortByLifecycle = (a, b) => {
    const lifecycleDiff = (lifecycleOrder[a.lifecycleStage] ?? 9) - (lifecycleOrder[b.lifecycleStage] ?? 9)
    if (lifecycleDiff !== 0) return lifecycleDiff
    if ((a.priorityRank ?? 999) !== (b.priorityRank ?? 999)) return (a.priorityRank ?? 999) - (b.priorityRank ?? 999)
    return 0
  }

  const portfolioFiltered = portfolioFilter === 'total' ? products
    : portfolioFilter === 'live' ? products.filter(p => ['live','available'].includes(p.lifecycleStage))
    : portfolioFilter === 'coming' ? products.filter(p => p.lifecycleStage === 'coming')
    : portfolioFilter === 'building' ? products.filter(p => p.lifecycleStage === 'building')
    : portfolioFilter === 'research' ? products.filter(p => p.lifecycleStage === 'research')
    : portfolioFilter === 'internal' ? products.filter(p => p.lifecycleStage === 'internal')
    : portfolioFilter === 'attention' ? products.filter(p => p.connection === 'partial' || (p.lifecycleStage === 'coming' && !p.metricsUrl))
    : portfolioFilter === 'connected' ? products.filter(p => p.connection === 'connected')
    : portfolioFilter === 'partial' ? products.filter(p => p.connection === 'partial')
    : portfolioFilter === 'not_connected' ? products.filter(p => p.connection === 'not_connected')
    : null

  const filtered = portfolioFiltered ? [...portfolioFiltered].sort(sortByLifecycle)
                 : filter === 'tenants' ? [...tenants].sort(sortByLifecycle)
                 : filter === 'planned'  ? products.filter(p => p.lifecycleStage === 'research')
                 : filter === 'products' ? products.filter(p => p.lifecycleStage !== 'research').sort(sortByLifecycle)
                 : [...products, ...tenants].sort(sortByLifecycle)

  const BADGE = (txt, color) => (
    <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20,
      background:`${color}15`, color, border:`1px solid ${color}30`, whiteSpace:'nowrap' }}>
      {txt}
    </span>
  )

  return (
    <div>
      {/* ── Portfolio summary bar ────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:20 }}>
        {[
          { label:'Total Products',  val:products.length,  color:'#6366f1' },
          { label:'Live / Available',val:liveCount,        color:'#10b981' },
          { label:'Coming Soon',     val:comingCount,      color:'#8b5cf6' },
          { label:'Building',        val:buildingCount,    color:'#f59e0b' },
          { label:'Research',        val:researchCount,    color:'#64748b' },
          { label:'Tenants',         val:tenants.length,   color:'#14b8a6' },
        ].map(k => (
          <div key={k.label} style={{ background:`${k.color}10`, border:`1px solid ${k.color}20`,
            borderRadius:10, padding:'10px 14px', textAlign:'center' }}>
            <div style={{ fontSize:9, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{k.label}</div>
            <div style={{ fontSize:24, fontWeight:900, color:k.color }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* ── Integrations needed ────────────────────────────────────────── */}
      {(partialCount > 0) && (
        <div style={{ background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.25)',
          borderRadius:10, padding:'10px 16px', marginBottom:16,
          display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:16 }}>🟡</span>
          <div>
            <span style={{ fontSize:12, fontWeight:700, color:'#f59e0b' }}>Setup Needed</span>
            <span style={{ fontSize:12, color:'#94a3b8', marginLeft:8 }}>
              {partialCount} product{partialCount>1?'s':''} partially connected — metrics deploy pending
            </span>
          </div>
        </div>
      )}

      {/* ── Filter tabs ────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {[
          { key:'all',      label:`All (${PRODUCT_REGISTRY.length})` },
          { key:'products', label:`Products (${products.filter(p=>p.lifecycleStage!=='research').length})` },
          { key:'planned',  label:`Research (${researchCount})` },
          { key:'tenants',  label:`Tenants (${tenants.length})` },
        ].map(f => (
          <button key={f.key} onClick={()=>{setFilter(f.key);setSelected(null)}}
            style={{ fontSize:11, fontWeight:700, padding:'6px 14px', borderRadius:8, cursor:'pointer',
              background: filter===f.key ? 'rgba(99,102,241,.2)' : 'rgba(255,255,255,.04)',
              color: filter===f.key ? '#a5b4fc' : '#64748b',
              border: filter===f.key ? '1px solid rgba(99,102,241,.4)' : '1px solid rgba(255,255,255,.08)' }}>
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display:'flex', gap:20, alignItems:'flex-start' }}>
        {/* ── Card Grid ─────────────────────────────────────────────────── */}
        <div style={{ flex: selected ? '0 0 360px' : '1', minWidth:0 }}>
          <div style={{ display:'grid', gridTemplateColumns: selected ? '1fr' : 'repeat(3,1fr)', gap:12 }}>
            {filtered.map(p => {
              const lc   = getLifecycle(p)
              const conn = getConn(p)
              const isSelected = selected?.key === p.key
              const isResearch = p.lifecycleStage === 'research'
              const isInternal = p.lifecycleStage === 'internal'
              const accentColor = isResearch ? '#64748b' : isInternal ? '#475569' : p.color
              return (
                <div key={p.key}
                  onClick={() => isSelected ? setSelected(null) : selectProduct(p)}
                  style={{
                    background: isSelected ? `${accentColor}12` : 'rgba(255,255,255,.04)',
                    border: isSelected ? `1px solid ${accentColor}` : `1px solid ${accentColor}30`,
                    borderRadius:12, padding:'16px 18px', cursor:'pointer', transition:'all .15s',
                    opacity: isResearch ? .75 : 1,
                  }}
                  onMouseEnter={e=>{ if(!isSelected){e.currentTarget.style.border=`1px solid ${accentColor}60`; e.currentTarget.style.background=`${accentColor}08`} }}
                  onMouseLeave={e=>{ if(!isSelected){e.currentTarget.style.border=`1px solid ${accentColor}30`; e.currentTarget.style.background='rgba(255,255,255,.04)'} }}
                >
                  {/* Card header */}
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:8 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                      <span style={{ fontSize:20 }}>{p.icon}</span>
                      <div>
                        <div style={{ fontSize:12, fontWeight:800, color:'#e2e8f0', lineHeight:1.2 }}>{p.label}</div>
                        <div style={{ fontSize:9, color:'#64748b', marginTop:2 }}>{p.industry}</div>
                      </div>
                    </div>
                    {/* Open button — shown whenever appUrl or url is available, regardless of metrics connection */}
                    {!isSelected && (p.tenantId || p.appUrl || p.url) && !isResearch && !isInternal && (
                      p.tenantId ? (
                        <button onClick={async e=>{e.stopPropagation();const{data:t}=await supabase.rpc('create_impersonation_token',{p_tenant_id:p.tenantId});if(t)window.open(`${window.location.origin}/impersonate?admin_token=${t}`,'_blank')}}
                          style={{ fontSize:10,color:'#fff',fontWeight:700,background:accentColor,padding:'3px 9px',borderRadius:6,border:'none',cursor:'pointer',flexShrink:0 }}>Open →</button>
                      ) : (
                        <a href={p.appUrl || p.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
                          style={{ fontSize:10,color:'#fff',fontWeight:700,textDecoration:'none',background:accentColor,padding:'3px 9px',borderRadius:6,flexShrink:0 }}>Open →</a>
                      )
                    )}
                  </div>

                  {/* Status badges */}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:8 }}>
                    {p.nextToFinish && BADGE('⭐ NEXT CRM TO FINISH', '#F97316')}
                    {BADGE(lc.label, lc.color)}
                    {BADGE(`${conn.dot} ${conn.label}`, conn.color)}
                    {p.isTenant && BADGE('Tenant', '#14b8a6')}
                  </div>

                  {/* Mini metrics or planned card info */}
                  {p.connection === 'connected' && liveData[p.key]?.ok && !isSelected ? (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
                      {[['MRR', fmt$(liveData[p.key].metrics?.mrr)],['Clients', fmtN(liveData[p.key].metrics?.active_clients)]].map(([l,v])=>(
                        <div key={l} style={{ background:'rgba(255,255,255,.03)', borderRadius:6, padding:'5px 7px' }}>
                          <div style={{ fontSize:8, color:'#334155', fontWeight:700, textTransform:'uppercase' }}>{l}</div>
                          <div style={{ fontSize:12, color:'#e2e8f0', fontWeight:700, marginTop:1 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  ) : isResearch || isInternal ? (
                    <div style={{ fontSize:10, color:'#475569', lineHeight:1.5 }}>
                      <div><span style={{ color:'#334155' }}>Brand:</span> {BRAND_LABEL[p.brandStatus]}</div>
                      <div><span style={{ color:'#334155' }}>Domain:</span> —</div>
                      {p.nextMilestone && <div style={{ marginTop:4, color:'#6366f1', fontStyle:'italic' }}>→ {p.nextMilestone}</div>}
                    </div>
                  ) : p.connection === 'partial' ? (
                    <div style={{ fontSize:10, color:'#f59e0b' }}>⚙ Metrics deploy pending</div>
                  ) : p.connection === 'not_connected' && !isResearch ? (
                    <div style={{ fontSize:10, color:'#334155' }}>Deploy platform-metrics to connect</div>
                  ) : null}

                  {loading[p.key] && <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>Loading…</div>}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Detail Panel ─────────────────────────────────────────────── */}
        {selected && (
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ ...CC.card({ padding:0 }) }}>

              {/* Header */}
              <div style={{ padding:'18px 22px', borderBottom:'1px solid rgba(99,102,241,.1)',
                display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <span style={{ fontSize:26 }}>{selected.icon}</span>
                  <div>
                    <div style={{ fontSize:17, fontWeight:900, color:'#fff' }}>{selected.label}</div>
                    <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>{selected.industry} · {selected.desc}</div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  {selected.connection==='connected' && selected.tenantId && (
                    <button onClick={async()=>{const{data:t}=await supabase.rpc('create_impersonation_token',{p_tenant_id:selected.tenantId});if(t)window.open(`${window.location.origin}/impersonate?admin_token=${t}`,'_blank')}}
                      style={{ fontSize:12,color:'#fff',fontWeight:700,background:selected.color,padding:'7px 16px',borderRadius:8,border:'none',cursor:'pointer' }}>Open CRM →</button>
                  )}
                  {(selected.appUrl || selected.url) && !selected.tenantId && (
                    <a href={selected.appUrl || selected.url} target="_blank" rel="noreferrer"
                      style={{ fontSize:12,color:'#fff',fontWeight:700,textDecoration:'none',background:selected.color,padding:'7px 16px',borderRadius:8 }}>Open App →</a>
                  )}
                  {selected.websiteUrl && !selected.tenantId && (
                    <a href={selected.websiteUrl} target="_blank" rel="noreferrer"
                      style={{ fontSize:12,color:selected.color,fontWeight:700,textDecoration:'none',background:'rgba(99,102,241,.08)',border:`1px solid ${selected.color}33`,padding:'7px 16px',borderRadius:8 }}>Website →</a>
                  )}
                  {selected.metricsUrl && (
                    <button onClick={()=>fetchMetrics(selected)}
                      style={{ fontSize:11,color:'#6366f1',background:'rgba(99,102,241,.1)',border:'1px solid rgba(99,102,241,.2)',borderRadius:8,padding:'7px 14px',cursor:'pointer' }}>
                      ↻ Refresh
                    </button>
                  )}
                  <button onClick={()=>setSelected(null)}
                    style={{ fontSize:18,color:'#475569',background:'none',border:'none',cursor:'pointer',lineHeight:1 }}>×</button>
                </div>
              </div>

              {/* Body */}
              <div style={{ padding:'18px 22px' }}>

                {/* Status grid — always shown */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
                  {[
                    { label:'Stage',      val: LIFECYCLE_LABEL[selected.lifecycleStage]?.label || selected.lifecycleStage },
                    { label:'Connection', val: `${getConn(selected).dot} ${getConn(selected).label}` },
                    { label:'Brand',      val: BRAND_LABEL[selected.brandStatus] || selected.brandStatus },
                    { label:'Domain',     val: selected.url || '—' },
                    { label:'Public',     val: selected.publicOnRomyLabs ? 'Yes — romylabs.com' : 'No' },
                    { label:'Commercial', val: selected.commerciallyAvailable ? 'Yes' : 'Not yet' },
                  ].map(k => (
                    <div key={k.label} style={{ background:'rgba(255,255,255,.03)', borderRadius:8, padding:'10px 12px' }}>
                      <div style={{ fontSize:9, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.06em' }}>{k.label}</div>
                      <div style={{ fontSize:12, color:'#e2e8f0', marginTop:4, wordBreak:'break-all' }}>{k.val}</div>
                    </div>
                  ))}
                </div>

                {selected.key === 'arcvena' && (
                  <ArcvenaOfficeOnboarding
                    supabase={supabase}
                    onCreated={() => fetchMetrics(selected)}
                  />
                )}

                {/* Next milestone for planned products */}
                {selected.nextMilestone && (
                  <div style={{ background:'rgba(99,102,241,.08)', border:'1px solid rgba(99,102,241,.2)',
                    borderRadius:10, padding:'12px 16px', marginBottom:16 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>Next Milestone</div>
                    <div style={{ fontSize:13, color:'#a5b4fc' }}>{selected.nextMilestone}</div>
                  </div>
                )}

                {/* Metrics for connected products */}
                {selected.connection === 'not_connected' ? (
                  <div style={{ textAlign:'center', padding:'32px 0', color:'#334155' }}>
                    <div style={{ fontSize:32, marginBottom:10 }}>
                      {selected.lifecycleStage==='research' ? '🔬' : selected.lifecycleStage==='internal' ? '🔒' : '🔌'}
                    </div>
                    <div style={{ fontSize:14, fontWeight:700, color:'#475569', marginBottom:8 }}>
                      {selected.lifecycleStage==='research' ? 'Research Stage — Not yet built'
                       : selected.lifecycleStage==='internal' ? 'Internal product — Not publicly marketed'
                       : 'No backend connected'}
                    </div>
                    <div style={{ fontSize:12, color:'#334155', maxWidth:340, margin:'0 auto', lineHeight:1.6 }}>
                      {selected.lifecycleStage==='research'
                        ? 'This product is in the research and planning phase. No backend, domain, or metrics have been set up yet. Data will populate here once the build phase begins.'
                        : selected.lifecycleStage==='internal'
                        ? 'This product operates internally. No live metrics are connected. Rebrand or migration needed before public launch.'
                        : 'Deploy the platform-metrics edge function to this product\'s Supabase project to connect live data.'}
                    </div>
                  </div>
                ) : selected.connection === 'partial' ? (
                  <div style={{ textAlign:'center', padding:'32px 0', color:'#334155' }}>
                    <div style={{ fontSize:32, marginBottom:10 }}>🟡</div>
                    <div style={{ fontSize:14, fontWeight:700, color:'#f59e0b', marginBottom:8 }}>Partial Connection</div>
                    <div style={{ fontSize:12, color:'#94a3b8', maxWidth:340, margin:'0 auto', lineHeight:1.6 }}>
                      Product exists and is deployed, but platform-metrics edge function has not been wired yet.
                      Deploy <code style={{ background:'rgba(255,255,255,.06)', padding:'1px 5px', borderRadius:4 }}>push-platform-metrics</code> to this product's Supabase project to enable live data.
                    </div>
                  </div>
                ) : loading[selected.key] ? (
                  <div style={{ textAlign:'center', padding:'32px 0', color:'#475569', fontSize:13 }}>Loading live data…</div>
                ) : liveData[selected.key]?.ok === false ? (
                  <div style={{ textAlign:'center', padding:'32px 0' }}>
                    <div style={{ fontSize:13, color:'#ef4444', marginBottom:8 }}>Failed to load metrics</div>
                    <div style={{ fontSize:11, color:'#334155' }}>{liveData[selected.key]?.error}</div>
                  </div>
                ) : liveData[selected.key] ? (() => {
                  const d = liveData[selected.key]
                  const m = d.metrics || {}
                  return (
                    <div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20 }}>
                        {[
                          { label:'MRR',           value: fmt$(m.mrr),            color:'#10b981' },
                          { label:'ARR',           value: fmt$(m.arr),            color:'#6366f1' },
                          { label:'Active Clients',value: fmtN(m.active_clients), color:'#0ea5e9' },
                          { label:'Active Leads',  value: fmtN(m.active_leads),   color:'#8b5cf6' },
                          { label:'Active Offices',value: fmtN(m.active_offices), color:'#f59e0b' },
                          { label:'Total Offices', value: fmtN(m.total_offices),  color:'#f59e0b' },
                          { label:'Pending Tasks', value: fmtN(m.pending_tasks),  color:'#ef4444' },
                          { label:'Storage',       value: fmtBytes(m.storage_bytes), color:'#475569' },
                        ].map(k => (
                          <div key={k.label} style={{ background:`${k.color}10`, border:`1px solid ${k.color}25`, borderRadius:10, padding:'12px 14px' }}>
                            <div style={{ fontSize:9, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.07em' }}>{k.label}</div>
                            <div style={{ fontSize:20, fontWeight:900, color:k.color, marginTop:6 }}>{k.value}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                        {d.offices?.length > 0 && (
                          <div style={CC.card({ padding:'16px 18px' })}>
                            <div style={{ fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:12 }}>Offices / Tenants</div>
                            {d.offices.map((o, i) => (
                              <div key={o.id}
                                onClick={async()=>{const{data:t}=await supabase.rpc('create_impersonation_token',{p_tenant_id:o.id});if(t)window.open(`${window.location.origin}/impersonate?admin_token=${t}`,'_blank')}}
                                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0',
                                  borderBottom: i < d.offices.length-1 ? '1px solid rgba(99,102,241,.06)' : 'none',
                                  cursor:'pointer' }}
                                onMouseEnter={e=>e.currentTarget.style.background='rgba(99,102,241,.06)'}
                                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                <div>
                                  <div style={{ fontSize:12, fontWeight:600, color:'#e2e8f0' }}>{o.name} <span style={{ fontSize:10, color:'#334155' }}>↗</span></div>
                                  <div style={{ fontSize:10, color:'#475569' }}>Since {o.since || '—'}</div>
                                </div>
                                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                  <span style={{ fontSize:11, fontWeight:700, color:'#10b981' }}>{fmt$(o.mrr)}/mo</span>
                                  <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20,
                                    background: o.is_active ? 'rgba(16,185,129,.12)' : 'rgba(71,85,105,.12)',
                                    color: o.is_active ? '#10b981' : '#475569' }}>
                                    {o.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {d.recent_activity?.length > 0 && (
                          <div style={CC.card({ padding:'16px 18px' })}>
                            <div style={{ fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:12 }}>Recent Activity</div>
                            {d.recent_activity.map((a, i) => (
                              <div key={i} style={{ padding:'8px 0', borderBottom: i < d.recent_activity.length-1 ? '1px solid rgba(99,102,241,.06)' : 'none' }}>
                                <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.5 }}>{a.text}</div>
                                <div style={{ fontSize:10, color:'#334155', marginTop:3 }}>{fmtAgo(a.at)} · {a.by || '—'}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize:10, color:'#334155', marginTop:14, textAlign:'right' }}>
                        Live data · fetched {fmtAgo(d.fetched_at)}
                      </div>
                    </div>
                  )
                })() : (
                  <div style={{ textAlign:'center', padding:'32px 0', color:'#475569', fontSize:13 }}>
                    Click Refresh to load live data
                  </div>
                )}

                {/* TaxRes-specific operational data — only shown when TaxRes is selected */}
                {selected.key === 'taxres_crm' && (() => {
                  if (taxresLoading) return <div style={{ textAlign:'center', padding:'20px 0', color:'#475569', fontSize:12 }}>Loading TaxRes operations…</div>
                  if (!taxresOps) return (
                    <div style={{ textAlign:'center', padding:'20px 0' }}>
                      <button onClick={loadTaxResOps} style={{ fontSize:12, color:'#6366f1', background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.2)', borderRadius:8, padding:'7px 14px', cursor:'pointer' }}>
                        Load TaxRes Operations Data
                      </button>
                    </div>
                  )
                  const { stats, tenants } = taxresOps
                  const activeTenants = tenants.filter(r=>r.status==='active')
                  const totalMRR      = tenants.reduce((s,r)=>s+Number(r.effective_monthly||0),0)
                  return (
                    <div style={{ marginTop:20, borderTop:'1px solid rgba(99,102,241,.1)', paddingTop:20 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:12 }}>
                        TaxRes Operations &amp; Tenant Data
                      </div>
                      {/* Office / Revenue KPIs */}
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
                        {[
                          { label:'Active Offices', val:activeTenants.length, color:'#10b981' },
                          { label:'Total Offices',  val:tenants.length,        color:'#6366f1' },
                          { label:'TaxRes MRR',     val:fmt$(totalMRR),        color:'#10b981' },
                          { label:'Total Seats',    val:tenants.reduce((s,r)=>s+Number(r.employee_count||0),0), color:'#f59e0b' },
                          { label:'Total Clients',  val:fmtN(tenants.reduce((s,r)=>s+Number(r.client_count||0),0)), color:'#0ea5e9' },
                          { label:'Total Leads',    val:fmtN(tenants.reduce((s,r)=>s+Number(r.lead_count||0),0)), color:'#8b5cf6' },
                          { label:'Pending E-Signs',val:fmtN(Number(stats.pending_esigns||0)), color:'#f59e0b' },
                          { label:'Demos Today',    val:fmtN(Number(stats.today_demos||0)),    color:'#ec4899' },
                        ].map(k => (
                          <div key={k.label} style={{ background:`${k.color}10`, border:`1px solid ${k.color}25`, borderRadius:10, padding:'10px 12px' }}>
                            <div style={{ fontSize:9, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.07em' }}>{k.label}</div>
                            <div style={{ fontSize:18, fontWeight:900, color:k.color, marginTop:4 }}>{k.val}</div>
                          </div>
                        ))}
                      </div>
                      {/* Tenant table */}
                      <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>
                        Tenants / Offices
                      </div>
                      {tenants.map((t, i) => (
                        <div key={t.id}
                          onClick={async()=>{const{data:tk}=await supabase.rpc('create_impersonation_token',{p_tenant_id:t.id});if(tk)window.open(`${window.location.origin}/impersonate?admin_token=${tk}`,'_blank')}}
                          style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px',
                            borderRadius:8, marginBottom:6, cursor:'pointer',
                            background:'rgba(255,255,255,.03)', border:'1px solid rgba(99,102,241,.06)' }}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(99,102,241,.08)'}
                          onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.03)'}>
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:'#e2e8f0' }}>{t.name} <span style={{ fontSize:10, color:'#334155' }}>↗ Open CRM</span></div>
                            <div style={{ fontSize:10, color:'#475569' }}>
                              {t.employee_count||0} seats · {t.client_count||0} clients · {t.lead_count||0} leads
                            </div>
                          </div>
                          <div style={{ textAlign:'right' }}>
                            <div style={{ fontSize:13, fontWeight:700, color:'#10b981' }}>{fmt$(Number(t.effective_monthly||0))}/mo</div>
                            <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:20,
                              background: t.status==='active'?'rgba(16,185,129,.12)':'rgba(71,85,105,.12)',
                              color: t.status==='active'?'#10b981':'#475569' }}>
                              {t.status==='active'?'Active':'Inactive'}
                            </span>
                          </div>
                        </div>
                      ))}
                      {/* IRS Deadlines */}
                      {(stats.upcoming_deadlines||[]).length > 0 && (<>
                        <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em', marginTop:16, marginBottom:8 }}>
                          Upcoming IRS Deadlines
                        </div>
                        {(stats.upcoming_deadlines||[]).slice(0,5).map((d,i)=>{
                          const days = Math.ceil((new Date(d.dueDate)-new Date())/86400000)
                          return (
                            <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px',
                              borderRadius:8, marginBottom:4, background:'rgba(255,255,255,.02)' }}>
                              <div>
                                <div style={{ fontSize:12, color:'#e2e8f0', fontWeight:600 }}>{d.title}</div>
                                <div style={{ fontSize:10, color:'#475569' }}>{d.dueDate}</div>
                              </div>
                              <span style={{ fontSize:10, fontWeight:700, padding:'2px 9px', borderRadius:20,
                                background: days<=3?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)',
                                color: days<=3?'#ef4444':'#f59e0b' }}>
                                {days<=0?'TODAY':days===1?'TOMORROW':`${days}d`}
                              </span>
                            </div>
                          )
                        })}
                      </>)}

                      {/* ── Recent TaxRes Activity ──────────────────────────── */}
                      <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em', marginTop:20, marginBottom:8 }}>
                        Recent TaxRes Activity
                      </div>
                      {taxresActivity.length === 0 ? (
                        <div style={{ textAlign:'center', padding:'16px 0', color:'#334155', fontSize:12 }}>
                          No recent activity recorded yet.
                        </div>
                      ) : (
                        <div style={{ background:'rgba(255,255,255,.02)', borderRadius:10, overflow:'hidden', border:'1px solid rgba(99,102,241,.06)' }}>
                          {taxresActivity.slice(0, 15).map((a, i) => (
                            <div key={i} style={{ display:'flex', gap:10, padding:'9px 12px',
                              borderBottom: i < Math.min(taxresActivity.length,15)-1 ? '1px solid rgba(99,102,241,.06)' : 'none',
                              background: i%2===0 ? 'transparent' : 'rgba(255,255,255,.01)' }}>
                              <div style={{ fontSize:15, width:22, textAlign:'center', flexShrink:0, marginTop:1 }}>{a.icon}</div>
                              <div style={{ minWidth:0, flex:1 }}>
                                <div style={{ fontSize:12, color:'#e2e8f0', fontWeight:600 }}>{a.text}</div>
                                <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>
                                  {a.sub ? `${a.sub} · ` : ''}{fmtAgo(a.ts)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// ── Sales Pipeline ────────────────────────────────────────────────────────────
const PIPELINE_STAGES = ['Prospect','Contacted','Interested','Demo Scheduled','Demo Completed','Proposal Sent','Negotiation','Won','Lost']
const STAGE_COLORS    = ['#64748b','#6366f1','#8b5cf6','#0ea5e9','#a855f7','#f59e0b','#f97316','#10b981','#ef4444']
// PRODUCTS: derived inside SalesPipeline from registryProducts prop — see below
const PRICING_LABELS = { monthly:'Monthly', perpetual:'Perpetual License', undecided:'Undecided' }
const ACTIVITY_ICONS = { note:'📝', call:'📞', email:'📧', demo:'🖥️', proposal:'📄', stage_change:'🔄', won:'🏆', lost:'❌', outreach_linkedin:'💼', outreach_email:'📤', outreach_phone:'📱', follow_up:'🔁', demo_booked:'📅', converted:'⭐' }

function SalesPipeline({ data, supabase, registryProducts }) {
  const [prospects, setProspects]     = useState(data?.sales?.prospects || [])
  const [selected, setSelected]       = useState(null)
  const [activities, setActivities]   = useState([])
  const [actLoading, setActLoading]   = useState(false)
  const [productFilter, setProductFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [showForm, setShowForm]       = useState(false)
  const [editMode, setEditMode]       = useState(false)
  const [form, setForm]               = useState({})
  const [saving, setSaving]           = useState(false)
  const [newNote, setNewNote]         = useState('')
  const [addingNote, setAddingNote]   = useState(false)
  const [activityType, setActivityType] = useState('note')
  const [toast, setToast]             = useState(null)

  // PRODUCTS: derived from registry prop — auto-updates when new products are registered
  const PRODUCTS = [
    { value:'all', label:'All Products' },
    ...(registryProducts || []).map(r => ({ value: r.product_id, label: r.name }))
  ]

  function showToast(msg, ok=true) { setToast({msg,ok}); setTimeout(()=>setToast(null),3000) }

  // Reload prospects from DB
  async function reload() {
    const { data: rows } = await supabase.from('prospects').select('*').order('created_at', { ascending: false })
    setProspects(rows || [])
  }

  // Load activities for selected prospect
  async function loadActivities(prospectId) {
    setActLoading(true)
    const { data: rows } = await supabase
      .from('prospect_activities')
      .select('*')
      .eq('prospect_id', prospectId)
      .order('created_at', { ascending: false })
    setActivities(rows || [])
    setActLoading(false)
  }

  useEffect(() => { if (selected) loadActivities(selected.id) }, [selected?.id])

  // ── Account/Firm filter — derived from live prospect records ──
  const [firmFilter, setFirmFilter] = React.useState('all')

  // Build firm list from prospects matching current productFilter
  const availableFirms = React.useMemo(() => {
    const base = productFilter === 'all' ? prospects : prospects.filter(p => p.product === productFilter)
    const seen = new Set()
    const firms = []
    for (const p of base) {
      if (p.firm_name && !seen.has(p.firm_name)) {
        seen.add(p.firm_name)
        firms.push({ name: p.firm_name, product: p.product })
      }
    }
    return firms.sort((a,b) => a.name.localeCompare(b.name))
  }, [prospects, productFilter])

  // Reset firm filter when product filter changes
  React.useEffect(() => { setFirmFilter('all') }, [productFilter])

  // Filtered list
  const filtered = prospects.filter(p => {
    if (productFilter !== 'all' && p.product !== productFilter) return false
    if (firmFilter !== 'all' && p.firm_name !== firmFilter) return false
    if (stageFilter !== 'all' && p.stage !== stageFilter) return false
    return true
  })

  // Derived metrics from filtered or all prospects
  const all = productFilter === 'all' ? prospects : prospects.filter(p => p.product === productFilter)
  const active = all.filter(p => !['Won','Lost'].includes(p.stage))
  const won = all.filter(p => p.stage === 'Won')
  const lost = all.filter(p => p.stage === 'Lost')
  const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0
  const pipeline = active.reduce((s,p) => s + Number(p.mrr_potential || 0), 0)
  const wonRevenue = won.reduce((s,p) => s + (p.pricing_model==='perpetual' ? Number(p.perpetual_price||0) : Number(p.mrr_potential||0)*12), 0)

  const fmt$ = n => n ? `$${Number(n).toLocaleString('en-US',{maximumFractionDigits:0})}` : '—'
  const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'
  const fmtAgo2 = d => { if (!d) return '—'; const diff = Math.floor((Date.now()-new Date(d))/86400000); return diff===0?'Today':diff===1?'Yesterday':`${diff}d ago` }

  function stageColor(stage) {
    const i = PIPELINE_STAGES.indexOf(stage)
    return i >= 0 ? STAGE_COLORS[i] : '#475569'
  }

  // Save prospect (add or edit)
  async function saveProspect() {
    if (!form.firm_name?.trim()) { showToast('Firm name required', false); return }
    setSaving(true)
    const payload = {
      firm_name:          form.firm_name,
      contact_name:       form.contact_name || null,
      contact_email:      form.contact_email || null,
      contact_phone:      form.contact_phone || null,
      contact_linkedin:   form.contact_linkedin || null,
      company_url:        form.company_url || null,
      product:            form.product || 'taxres_crm',
      stage:              form.stage || 'Prospect',
      pricing_model:      form.pricing_model || 'undecided',
      seats:              form.seats ? Number(form.seats) : null,
      mrr_potential:      form.mrr_potential ? Number(form.mrr_potential) : null,
      perpetual_price:    form.perpetual_price ? Number(form.perpetual_price) : null,
      source:             form.source || null,
      source_campaign:    form.source_campaign || null,
      next_action:        form.next_action || null,
      next_followup:      form.next_followup || null,
      expected_close_date:form.expected_close_date || null,
      demo_date:          form.demo_date || null,
      notes:              form.notes || null,
      owner:              form.owner || 'info@romylabs.com',
      updated_at:         new Date().toISOString(),
    }
    if (editMode && form.id) {
      const { error } = await supabase.from('prospects').update(payload).eq('id', form.id)
      if (error) { showToast('Save failed: ' + error.message, false); setSaving(false); return }
      showToast('Saved ✓')
    } else {
      const { error } = await supabase.from('prospects').insert(payload)
      if (error) { showToast('Save failed: ' + error.message, false); setSaving(false); return }
      showToast('Prospect added ✓')
    }
    await reload()
    setShowForm(false)
    setEditMode(false)
    setForm({})
    setSaving(false)
  }

  async function addNote() {
    if (!newNote.trim() || !selected) return
    setAddingNote(true)
    await supabase.from('prospect_activities').insert({
      prospect_id: selected.id,
      activity_type: activityType,
      body: newNote.trim(),
      actor: 'info@romylabs.com',
    })
    setNewNote('')
    await loadActivities(selected.id)
    // Update last_contact
    await supabase.from('prospects').update({ last_contact: new Date().toISOString().slice(0,10), updated_at: new Date().toISOString() }).eq('id', selected.id)
    await reload()
    setAddingNote(false)
  }

  async function updateStage(prospect, newStage) {
    const extra = {}
    if (newStage === 'Won')  { extra.won_lost_date = new Date().toISOString().slice(0,10) }
    if (newStage === 'Lost') { extra.won_lost_date = new Date().toISOString().slice(0,10) }
    if (newStage === 'Demo Scheduled') { extra.demo_date = extra.demo_date || prospect.demo_date }
    if (newStage === 'Proposal Sent')  { extra.proposal_sent_date = new Date().toISOString().slice(0,10) }
    await supabase.from('prospects').update({ stage: newStage, ...extra, updated_at: new Date().toISOString() }).eq('id', prospect.id)
    await supabase.from('prospect_activities').insert({
      prospect_id: prospect.id,
      activity_type: 'stage_change',
      body: `Stage changed: ${prospect.stage} → ${newStage}`,
      actor: 'romy@taxrescrm.net',
    })
    await reload()
    setSelected(prev => prev?.id === prospect.id ? { ...prev, stage: newStage, ...extra } : prev)
    if (selected?.id === prospect.id) await loadActivities(prospect.id)
    showToast(`Moved to ${newStage} ✓`)
  }

  async function deleteProspect(id) {
    if (!window.confirm('Delete this prospect? This cannot be undone.')) return
    await supabase.from('prospects').delete().eq('id', id)
    setSelected(null)
    await reload()
    showToast('Deleted')
  }

  const CC2 = { card: s => ({ background:'rgba(255,255,255,.04)', border:'1px solid rgba(99,102,241,.15)', borderRadius:12, ...s }) }
  const inp = { background:'rgba(255,255,255,.06)', border:'1px solid rgba(99,102,241,.2)', borderRadius:8, color:'#e2e8f0', fontSize:13, padding:'8px 12px', width:'100%', boxSizing:'border-box' }
  const lbl = { fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:5, display:'block' }

  return (
    <div style={{ position:'relative' }}>
      {toast && (
        <div style={{ position:'fixed', top:20, right:20, zIndex:9999, padding:'10px 18px', borderRadius:8,
          background: toast.ok ? 'rgba(16,185,129,.9)' : 'rgba(239,68,68,.9)',
          color:'#fff', fontSize:13, fontWeight:600, boxShadow:'0 4px 20px rgba(0,0,0,.4)' }}>
          {toast.msg}
        </div>
      )}

      {/* ── KPI Row ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20 }}>
        {[
          { label:'Total Prospects',    value:all.length,                icon:'🎯', color:'#6366f1' },
          { label:'Active Opps',         value:active.length,             icon:'📊', color:'#8b5cf6' },
          { label:'Demos Scheduled',    value:all.filter(p=>p.stage==='Demo Scheduled').length, icon:'📅', color:'#0ea5e9' },
          { label:'Proposals Out',      value:all.filter(p=>['Proposal Sent','Negotiation'].includes(p.stage)).length, icon:'📄', color:'#f59e0b' },
          { label:'Pipeline Value',     value:`$${(pipeline*12).toLocaleString('en-US',{maximumFractionDigits:0})}/yr`, icon:'💼', color:'#f97316' },
          { label:'Won Revenue',        value:fmt$(wonRevenue),           icon:'🏆', color:'#10b981' },
          { label:'Lost',               value:lost.length,                icon:'❌', color:'#ef4444' },
          { label:'Win Rate',           value:`${winRate}%`,              icon:'📈', color:'#10b981' },
        ].map(k => (
          <div key={k.label} style={{ background:`${k.color}10`, border:`1px solid ${k.color}25`, borderRadius:10, padding:'14px 16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ fontSize:9, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'.07em' }}>{k.label}</div>
              <span style={{ fontSize:16, opacity:.5 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize:22, fontWeight:900, color:k.color, marginTop:6 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Source attribution ── */}
      {(() => {
        const sources = {}
        all.forEach(p => { const s = p.source || 'Unknown'; sources[s] = (sources[s]||0)+1 })
        const sorted = Object.entries(sources).sort((a,b)=>b[1]-a[1])
        if (sorted.length === 0) return null
        return (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
            <span style={{ fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em', alignSelf:'center' }}>By source:</span>
            {sorted.map(([src,cnt]) => (
              <span key={src} onClick={() => setStageFilter('all')} style={{ fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:20,
                background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.2)', color:'#a5b4fc', cursor:'default' }}>
                {src} ({cnt})
              </span>
            ))}
          </div>
        )
      })()}

      {/* ── Funnel ── */}
      <div style={{ ...CC2.card({ padding:'20px 24px', marginBottom:18 }) }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em' }}>Pipeline Funnel</div>
          <div style={{ display:'flex', gap:6 }}>
            {PRODUCTS.map(p => (
              <button key={p.value} onClick={() => setProductFilter(p.value)} style={{
                padding:'3px 10px', borderRadius:20, border:'none', cursor:'pointer', fontSize:10, fontWeight:700,
                background: productFilter===p.value ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.05)',
                color: productFilter===p.value ? '#a5b4fc' : '#64748b',
              }}>{p.label}</button>
            ))}
          </div>
          {/* ── Account/Firm selector ── */}
          {availableFirms.length > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
              <span style={{ fontSize:9, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em' }}>Account / Firm:</span>
              <select value={firmFilter} onChange={e=>setFirmFilter(e.target.value)}
                style={{ fontSize:11, fontWeight:700, background:'rgba(99,102,241,.12)',
                  border:'1px solid rgba(99,102,241,.25)', borderRadius:6, color:'#e2e8f0',
                  padding:'3px 8px', cursor:'pointer' }}>
                <option value="all">All Firms</option>
                {availableFirms.map(f=>(
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
              {firmFilter !== 'all' && (
                <button onClick={()=>setFirmFilter('all')}
                  style={{ fontSize:10, background:'none', border:'none', color:'#64748b', cursor:'pointer' }}>
                  × Clear
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ display:'flex', gap:3, alignItems:'flex-end', height:100, marginBottom:12 }}>
          {PIPELINE_STAGES.map((stage, i) => {
            const count = (productFilter==='all' ? all : all).filter(p=>p.stage===stage).length
            const maxCount = Math.max(...PIPELINE_STAGES.map(s => all.filter(p=>p.stage===s).length), 1)
            const h = Math.max(12, Math.round((count/maxCount)*88))
            return (
              <div key={stage} onClick={() => setStageFilter(stageFilter===stage?'all':stage)}
                style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3, cursor:'pointer' }}>
                <div style={{ fontSize:12, fontWeight:900, color:STAGE_COLORS[i] }}>{count}</div>
                <div style={{ width:'100%', height:h,
                  background: stageFilter===stage ? STAGE_COLORS[i] : `linear-gradient(to top, ${STAGE_COLORS[i]}70, ${STAGE_COLORS[i]}20)`,
                  border:`1px solid ${STAGE_COLORS[i]}50`, borderRadius:'4px 4px 0 0', transition:'all .2s' }} />
              </div>
            )
          })}
        </div>
        <div style={{ display:'flex', gap:3 }}>
          {PIPELINE_STAGES.map((s,i) => (
            <div key={s} style={{ flex:1, textAlign:'center', fontSize:8, color: stageFilter===s?STAGE_COLORS[i]:'#334155',
              fontWeight:700, textTransform:'uppercase', letterSpacing:'.03em', lineHeight:1.3 }}>{s}</div>
          ))}
        </div>
        {stageFilter !== 'all' && (
          <div style={{ marginTop:10, textAlign:'center' }}>
            <button onClick={() => setStageFilter('all')} style={{ ...S.btn('ghost'), fontSize:11, padding:'4px 12px' }}>
              Clear filter ×
            </button>
          </div>
        )}
      </div>

      {/* ── Prospect Table + Detail ── */}
      <div style={{ display:'grid', gridTemplateColumns: selected ? '1fr 400px' : '1fr', gap:16, alignItems:'start' }}>

        {/* Table */}
        <div style={CC2.card({ padding:'0' })}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid rgba(99,102,241,.1)' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em' }}>
              {filtered.length} Prospect{filtered.length!==1?'s':''}{stageFilter!=='all'?` · ${stageFilter}`:''}
            </div>
            <button onClick={() => { setShowForm(true); setEditMode(false); setForm({ product:'taxres_crm', stage:'Prospect', pricing_model:'undecided', owner:'romy@taxrescrm.net' }) }}
              style={{ ...S.btn('primary'), fontSize:11, padding:'6px 14px' }}>
              + Add Prospect
            </button>
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:'#475569', fontSize:13 }}>No prospects match the current filter.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr>{['Firm / Contact','Product','Stage','Value','Next Follow-up','Last Contact'].map(h=>(
                  <th key={h} style={{ textAlign:'left', padding:'8px 14px', fontSize:9, fontWeight:700, color:'#475569',
                    textTransform:'uppercase', letterSpacing:'.05em', borderBottom:'1px solid rgba(99,102,241,.12)', whiteSpace:'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.map((p,i) => (
                  <tr key={p.id} onClick={() => setSelected(selected?.id===p.id ? null : p)}
                    style={{ cursor:'pointer', borderBottom:'1px solid rgba(99,102,241,.06)',
                      background: selected?.id===p.id ? 'rgba(99,102,241,.08)' : i%2===0 ? 'transparent' : 'rgba(255,255,255,.01)' }}>
                    <td style={{ padding:'10px 14px' }}>
                      <div style={{ fontWeight:700, color:'#e2e8f0' }}>{p.firm_name}</div>
                      <div style={{ fontSize:11, color:'#64748b', marginTop:1 }}>{p.contact_name||'—'}</div>
                    </td>
                    <td style={{ padding:'10px 14px' }}>
                      <span style={{ fontSize:10, fontWeight:700, color:'#6366f1' }}>
                        {PRODUCTS.find(x=>x.value===p.product)?.label || p.product}
                      </span>
                    </td>
                    <td style={{ padding:'10px 14px' }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20,
                        background:`${stageColor(p.stage)}18`, color:stageColor(p.stage) }}>{p.stage}</span>
                    </td>
                    <td style={{ padding:'10px 14px', color:'#10b981', fontWeight:700, fontSize:11 }}>
                      {p.pricing_model==='perpetual'
                        ? fmt$(p.perpetual_price)
                        : p.mrr_potential ? `${fmt$(p.mrr_potential)}/mo` : '—'}
                    </td>
                    <td style={{ padding:'10px 14px', fontSize:11, color: p.next_followup && new Date(p.next_followup+'T12:00:00') < new Date() ? '#ef4444' : '#94a3b8' }}>
                      {fmtDate(p.next_followup)}
                    </td>
                    <td style={{ padding:'10px 14px', fontSize:11, color:'#64748b' }}>{fmtAgo2(p.last_contact)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Drawer */}
        {selected && (
          <div style={{ ...CC2.card({ padding:'0' }), position:'sticky', top:0 }}>
            {/* Header */}
            <div style={{ padding:'16px 18px', borderBottom:'1px solid rgba(99,102,241,.1)' }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>{selected.firm_name}</div>
                  <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{selected.contact_name}{selected.contact_email ? ` · ${selected.contact_email}` : ''}</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ ...S.btn('ghost'), fontSize:11, padding:'3px 8px' }}>×</button>
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                <span style={{ fontSize:10, fontWeight:700, padding:'2px 9px', borderRadius:20,
                  background:`${stageColor(selected.stage)}18`, color:stageColor(selected.stage) }}>{selected.stage}</span>
                <span style={{ fontSize:10, fontWeight:700, color:'#6366f1' }}>
                  {PRODUCTS.find(x=>x.value===selected.product)?.label}
                </span>
                {selected.pricing_model && selected.pricing_model !== 'undecided' && (
                  <span style={{ fontSize:10, color:'#475569', fontWeight:600 }}>{PRICING_LABELS[selected.pricing_model]}</span>
                )}
              </div>
            </div>

            {/* Key fields */}
            <div style={{ padding:'14px 18px', borderBottom:'1px solid rgba(99,102,241,.08)' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
                {[
                  ['Monthly Value', selected.mrr_potential ? `${fmt$(selected.mrr_potential)}/mo` : '—'],
                  ['Perpetual',     fmt$(selected.perpetual_price)],
                  ['Seats',         selected.seats || '—'],
                  ['Source',        selected.source || '—'],
                  ['Campaign',      selected.source_campaign || '—'],
                  ['Demo Date',     fmtDate(selected.demo_date)],
                  ['Proposal Sent', fmtDate(selected.proposal_sent_date)],
                  ['Expected Close',fmtDate(selected.expected_close_date)],
                  ['Next Follow-up',fmtDate(selected.next_followup)],
                ].map(([label,val]) => (
                  <div key={label} style={{ background:'rgba(255,255,255,.03)', borderRadius:6, padding:'8px 10px' }}>
                    <div style={{ fontSize:9, color:'#334155', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em' }}>{label}</div>
                    <div style={{ fontSize:11, color:'#e2e8f0', fontWeight:600, marginTop:2 }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Pricing model callout for Chris */}
              {selected.pricing_model === 'undecided' && selected.mrr_potential && selected.perpetual_price && (
                <div style={{ padding:'8px 12px', borderRadius:8, background:'rgba(245,158,11,.06)', border:'1px solid rgba(245,158,11,.2)', fontSize:11, color:'#f59e0b', marginBottom:8 }}>
                  Two pricing paths presented — awaiting selection
                </div>
              )}

              {selected.next_action && (
                <div style={{ padding:'8px 12px', borderRadius:8, background:'rgba(99,102,241,.06)', border:'1px solid rgba(99,102,241,.2)', fontSize:11, color:'#a5b4fc' }}>
                  Next: {selected.next_action}
                </div>
              )}
            </div>

            {/* Stage mover */}
            <div style={{ padding:'12px 18px', borderBottom:'1px solid rgba(99,102,241,.08)' }}>
              <div style={{ fontSize:9, fontWeight:700, color:'#334155', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>Move Stage</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {PIPELINE_STAGES.filter(s => s !== selected.stage).map((s,i) => (
                  <button key={s} onClick={() => updateStage(selected, s)} style={{
                    padding:'3px 8px', borderRadius:20, border:`1px solid ${stageColor(s)}30`,
                    background:`${stageColor(s)}10`, color:stageColor(s),
                    fontSize:9, fontWeight:700, cursor:'pointer' }}>{s}</button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ padding:'10px 18px', borderBottom:'1px solid rgba(99,102,241,.08)', display:'flex', gap:6 }}>
              {selected.contact_email && (
                <button onClick={() => window.open(`https://webmail.taxrescrm.net:7443/?_to=${encodeURIComponent(selected.contact_email)}`, '_blank')}
                  style={{ ...S.btn('ghost'), fontSize:10, padding:'5px 10px' }}>📧 Email</button>
              )}
              {selected.contact_linkedin && (
                <a href={selected.contact_linkedin} target="_blank" rel="noreferrer"
                  style={{ ...S.btn('ghost'), fontSize:10, padding:'5px 10px', textDecoration:'none', color:'#0ea5e9' }}>💼 LinkedIn</a>
              )}
              <button onClick={() => { setEditMode(true); setShowForm(true); setForm({ ...selected, seats: selected.seats||'', mrr_potential: selected.mrr_potential||'', perpetual_price: selected.perpetual_price||'' }) }}
                style={{ ...S.btn('ghost'), fontSize:10, padding:'5px 10px' }}>✏️ Edit</button>
              <button onClick={() => deleteProspect(selected.id)}
                style={{ ...S.btn('ghost'), fontSize:10, padding:'5px 10px', color:'#ef4444', border:'1px solid rgba(239,68,68,.2)' }}>Delete</button>
            </div>

            {/* Activity log */}
            <div style={{ padding:'12px 18px', maxHeight:280, overflowY:'auto' }}>
              <div style={{ fontSize:9, fontWeight:700, color:'#334155', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>Activity</div>

              {/* Add note / outreach log */}
              <div style={{ marginBottom:12 }}>
                <div style={{ display:'flex', gap:4, marginBottom:6, flexWrap:'wrap' }}>
                  {[['note','📝 Note'],['outreach_linkedin','💼 LinkedIn'],['outreach_email','📤 Email'],['outreach_phone','📱 Call'],['follow_up','🔁 Follow-up'],['demo_booked','📅 Demo']].map(([type,label])=>(
                    <button key={type} onClick={()=>setActivityType(type)} style={{
                      padding:'2px 8px', borderRadius:20, border:'none', cursor:'pointer', fontSize:10, fontWeight:700,
                      background: activityType===type ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.06)',
                      color: activityType===type ? '#a5b4fc' : '#64748b',
                    }}>{label}</button>
                  ))}
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <input value={newNote} onChange={e=>setNewNote(e.target.value)}
                    onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&addNote()}
                    placeholder={activityType==='outreach_linkedin'?'LinkedIn outreach — what you sent…':activityType==='outreach_email'?'Email outreach — subject/summary…':activityType==='outreach_phone'?'Call notes…':activityType==='follow_up'?'Follow-up notes…':activityType==='demo_booked'?'Demo booked — date/time…':'Add a note…'}
                    style={{ ...inp, padding:'6px 10px', fontSize:11 }} />
                  <button onClick={addNote} disabled={addingNote||!newNote.trim()}
                    style={{ ...S.btn('primary'), fontSize:11, padding:'6px 12px', flexShrink:0 }}>
                    {addingNote ? '…' : 'Add'}
                  </button>
                </div>
              </div>

              {actLoading ? (
                <div style={{ fontSize:11, color:'#475569' }}>Loading…</div>
              ) : activities.length === 0 ? (
                <div style={{ fontSize:11, color:'#334155' }}>No activity yet.</div>
              ) : activities.map((a,i) => (
                <div key={a.id} style={{ display:'flex', gap:8, padding:'8px 0',
                  borderBottom: i<activities.length-1 ? '1px solid rgba(99,102,241,.06)' : 'none' }}>
                  <div style={{ fontSize:14, width:20, flexShrink:0, marginTop:1 }}>
                    {ACTIVITY_ICONS[a.activity_type] || '📝'}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, color:'#e2e8f0', lineHeight:1.5 }}>{a.body}</div>
                    <div style={{ fontSize:9, color:'#334155', marginTop:2 }}>
                      {new Date(a.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Add/Edit Modal ── */}
      {showForm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div style={{ background:'#0f0e1a', border:'1px solid rgba(99,102,241,.25)', borderRadius:16, padding:'28px 32px', width:'100%', maxWidth:680, maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:22 }}>
              <div style={{ fontSize:16, fontWeight:800, color:'#fff' }}>{editMode ? 'Edit Prospect' : 'Add Prospect'}</div>
              <button onClick={() => { setShowForm(false); setEditMode(false); setForm({}) }}
                style={{ ...S.btn('ghost'), fontSize:12 }}>Cancel</button>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              {/* Firm + Product */}
              <div style={{ gridColumn:'1/-1' }}>
                <label style={lbl}>Firm Name *</label>
                <input value={form.firm_name||''} onChange={e=>setForm(f=>({...f,firm_name:e.target.value}))} style={inp} placeholder="Nashville Tax Solutions" />
              </div>
              <div>
                <label style={lbl}>Product</label>
                <select value={form.product||'taxres_crm'} onChange={e=>setForm(f=>({...f,product:e.target.value}))} style={inp}>
                  {PRODUCTS.filter(p=>p.value!=='all').map(p=><option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Stage</label>
                <select value={form.stage||'Prospect'} onChange={e=>setForm(f=>({...f,stage:e.target.value}))} style={inp}>
                  {PIPELINE_STAGES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Contact */}
              <div><label style={lbl}>Contact Name</label><input value={form.contact_name||''} onChange={e=>setForm(f=>({...f,contact_name:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Contact Email</label><input value={form.contact_email||''} onChange={e=>setForm(f=>({...f,contact_email:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Contact Phone</label><input value={form.contact_phone||''} onChange={e=>setForm(f=>({...f,contact_phone:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>LinkedIn Profile URL</label><input value={form.contact_linkedin||''} onChange={e=>setForm(f=>({...f,contact_linkedin:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Company URL</label><input value={form.company_url||''} onChange={e=>setForm(f=>({...f,company_url:e.target.value}))} style={inp} /></div>

              {/* Pricing */}
              <div>
                <label style={lbl}>Pricing Model</label>
                <select value={form.pricing_model||'undecided'} onChange={e=>setForm(f=>({...f,pricing_model:e.target.value}))} style={inp}>
                  <option value="undecided">Undecided</option>
                  <option value="monthly">Monthly / Per Seat</option>
                  <option value="perpetual">Perpetual License</option>
                </select>
              </div>
              <div><label style={lbl}>Estimated Seats</label><input type="number" value={form.seats||''} onChange={e=>setForm(f=>({...f,seats:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Monthly Value (MRR)</label><input type="number" value={form.mrr_potential||''} onChange={e=>setForm(f=>({...f,mrr_potential:e.target.value}))} style={inp} placeholder="1625" /></div>
              <div><label style={lbl}>Perpetual License Price</label><input type="number" value={form.perpetual_price||''} onChange={e=>setForm(f=>({...f,perpetual_price:e.target.value}))} style={inp} placeholder="60000" /></div>

              {/* Source */}
              <div>
                <label style={lbl}>Lead Source</label>
                <select value={form.source||''} onChange={e=>setForm(f=>({...f,source:e.target.value}))} style={inp}>
                  <option value="">— Select —</option>
                  {['Referral','LinkedIn','Cold Outreach','Conference','Inbound','Google','Direct'].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Source Campaign / Post</label><input value={form.source_campaign||''} onChange={e=>setForm(f=>({...f,source_campaign:e.target.value}))} style={inp} /></div>

              {/* Dates */}
              <div><label style={lbl}>Next Follow-up</label><input type="date" value={form.next_followup||''} onChange={e=>setForm(f=>({...f,next_followup:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Expected Close</label><input type="date" value={form.expected_close_date||''} onChange={e=>setForm(f=>({...f,expected_close_date:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Demo Date</label><input type="date" value={form.demo_date||''} onChange={e=>setForm(f=>({...f,demo_date:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Owner</label><input value={form.owner||''} onChange={e=>setForm(f=>({...f,owner:e.target.value}))} style={inp} /></div>

              {/* Next action + notes */}
              <div style={{ gridColumn:'1/-1' }}>
                <label style={lbl}>Next Action</label>
                <input value={form.next_action||''} onChange={e=>setForm(f=>({...f,next_action:e.target.value}))} style={inp} placeholder="e.g. Follow up on proposal" />
              </div>
              <div style={{ gridColumn:'1/-1' }}>
                <label style={lbl}>Notes</label>
                <textarea value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={3}
                  style={{ ...inp, resize:'vertical', lineHeight:1.6 }} />
              </div>
            </div>

            <div style={{ display:'flex', gap:8, marginTop:20, justifyContent:'flex-end' }}>
              <button onClick={() => { setShowForm(false); setEditMode(false); setForm({}) }}
                style={{ ...S.btn('ghost'), fontSize:13, padding:'9px 18px' }}>Cancel</button>
              <button onClick={saveProspect} disabled={saving}
                style={{ ...S.btn('primary'), fontSize:13, padding:'9px 20px' }}>
                {saving ? 'Saving…' : editMode ? 'Save Changes' : 'Add Prospect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Command Center ────────────────────────────────────────────────────────────
function CommandCenter() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'overview'
  const setTab = (key) => setSearchParams({ tab: key }, { replace: false })
  const [data, setData] = useState(null)
  const [crmProduct, setCrmProduct] = useState('taxres_crm')
  const [crmAccount, setCrmAccount] = useState('all')
  const [crmRemoteData, setCrmRemoteData] = useState(null)
  const [crmRemoteLoading, setCrmRemoteLoading] = useState(false)
  const [crmRemoteError, setCrmRemoteError] = useState('')
  const [crmAccountMetrics, setCrmAccountMetrics] = useState(null)
  const [activity, setActivity] = useState([])
  const [activityPoll, setActivityPoll] = useState(0)

  // ── Data load ──────────────────────────────────────────────────────────────
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    async function load() {
      const now = new Date()
      const h = now.getHours()

      try {
        // Load prospects independently so a stats RPC error never zeroes out Sales
        const prospectsRes = await supabase.from('prospects').select('*').order('created_at', { ascending: false })

        // Stats + tenant overview — may throw; prospects already captured above
        const withTimeout = (promise, label, ms = 12000) => Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms)),
        ])
        const [statsRes, tenantsRes, storageRes, taxresDemoRes] = await Promise.all([
          withTimeout(supabase.rpc('admin_command_center_stats'), 'admin_command_center_stats'),
          withTimeout(supabase.rpc('admin_tenant_overview'), 'admin_tenant_overview'),
          withTimeout(supabase.rpc('admin_storage_stats'), 'admin_storage_stats'),
          withTimeout(supabase.rpc('admin_taxres_demo_stats'), 'admin_taxres_demo_stats'),
        ])

        const stats   = statsRes.data
        const tenants = tenantsRes.data || []

        if (statsRes.error) throw new Error('RPC error: ' + JSON.stringify(statsRes.error))
        if (storageRes.error) throw new Error('Storage RPC error: ' + JSON.stringify(storageRes.error))
        if (taxresDemoRes.error) throw new Error('TaxRes demo RPC error: ' + JSON.stringify(taxresDemoRes.error))
        if (!stats || stats.error) throw new Error('Stats unavailable: ' + JSON.stringify(stats))

      const activeTenants = (tenants||[]).filter(r=>r.status==='active')
      const totalMRR      = (tenants||[]).reduce((s,r)=>s+Number(r.effective_monthly||0),0)

      // Build what-changed list from yesterday stats
      const changes = []
      const yL = Number(stats.yesterday_new_leads||0)
      const yC = Number(stats.yesterday_new_clients||0)
      const yS = Number(stats.yesterday_signed||0)
      const yR = Number(stats.yesterday_revenue||0)
      const yD = Number(stats.yesterday_demos||0)
      if (yL>0) changes.push({ dir:'up',   label:`${yL} new lead${yL>1?'s':''} yesterday` })
      if (yC>0) changes.push({ dir:'up',   label:`${yC} new customer${yC>1?'s':''} signed` })
      if (yR>0) changes.push({ dir:'up',   label:`Revenue +$${yR.toLocaleString('en-US',{maximumFractionDigits:0})} yesterday` })
      if (yS>0) changes.push({ dir:'up',   label:`${yS} document${yS>1?'s':''} signed` })
      if (yD>0) changes.push({ dir:'up',   label:`${yD} demo${yD>1?'s':''} yesterday` })
      const pe = Number(stats.pending_esigns||0)
      if (pe>0) changes.push({ dir:'down', label:`${pe} e-sign${pe>1?'s':''} pending signature` })

      // Build activity feed by merging the separate recent_* arrays from RPC
      const feed = [
        ...(stats.recent_lead_notes||[]).map(n=>({ ts:n.ts, icon:'📝', text:`Note added by ${n.sub||'team'}`, sub:'Lead file' })),
        ...(stats.recent_client_notes||[]).map(n=>({ ts:n.ts, icon:'📋', text:`Note added by ${n.sub||'team'}`, sub:'Client file' })),
        ...(stats.recent_esigns||[]).map(e=>({ ts:e.ts, icon:'✍️', text:'Document signed', sub:e.sub||'E-Signature' })),
        ...(stats.recent_leads||[]).map(l=>({ ts:l.ts, icon:'👤', text:'Lead created', sub:l.sub||'Unassigned' })),
        ...(stats.recent_payments||[]).map(p=>({ ts:p.ts, icon:'💰', text:'Payment collected', sub:p.sub||'' })),
      ].sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,18)

      setActivity(feed)
      setData({
        greeting: h<12?'Good morning':h<17?'Good afternoon':'Good evening',
        todayDate: now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}),
        tenants,
        kpis: {
          activeTenants: activeTenants.length,
          totalTenants:  tenants.length,
          totalMRR,
          totalSeats:    tenants.reduce((s,r)=>s+Number(r.employee_count||0),0),
          totalClients:  tenants.reduce((s,r)=>s+Number(r.client_count||0),0),
          totalLeads:    tenants.reduce((s,r)=>s+Number(r.lead_count||0),0),
          totalStorage:  tenants.reduce((s,r)=>s+Number(r.storage_bytes||0),0),
          // Real Supabase File Storage from storage.objects metadata
          realStorageBytes:   Number(storageRes?.data?.total_bytes || 0),
          realStorageObjects: Number(storageRes?.data?.total_objects || 0),
          pendingEsigns: Number(stats.pending_esigns||0),
          todayDemos:    Number(taxresDemoRes?.data?.today_count || 0),
        },
        changes,
        upcomingDl:   (stats.upcoming_deadlines||[]).slice(0,5),
        todaySchedule:(stats.today_schedule||[]).slice(0,6),
        upcomingDemos:(taxresDemoRes?.data?.upcoming || []).slice(0,5),
        // Marketing mock data (live when GA4 is connected)
        marketing: {
          visitorsToday: 247,  visitorsChange: 18,
          sessions: 312,       sessionsChange: 14,
          bounceRate: 38.2,    bounceChange: -4,
          pagesPerSession: 3.1,
          topSources: [
            { label:'Organic Search', pct:62, color:'#6366f1' },
            { label:'Direct',         pct:21, color:'#0ea5e9' },
            { label:'Referral',       pct:11, color:'#10b981' },
            { label:'Social',         pct:6,  color:'#f59e0b' },
          ],
          topPages: [
            { path:'/features/irs-workflows', views:84, change:'+22%' },
            { path:'/',                         views:71, change:'+8%'  },
            { path:'/resources/transaction-codes', views:52, change:'+31%' },
            { path:'/about',                    views:38, change:'+5%'  },
          ],
        },
        // Search data — populated from gscData state after fetch
        search: {
          impressions: 0, impressionsChange: 0,
          clicks: 0, clicksChange: 0,
          ctr: 0, ctrChange: 0,
          avgPosition: 0, posChange: 0,
          indexedPages: 0,
          topQueries: [],
        },
        // Goals — real data where available
        goals: [
          { label:'Monthly Demos',    current: Number(stats.today_demos||0), target:50,  unit:'demos',   color:'#6366f1', note:'demos today' },
          { label:'Organic Visitors', current: ga4Data?.users ?? 0,          target:5000, unit:'visitors', color:'#0ea5e9', note: ga4Data ? null : 'connect GA4' },
          { label:'Platform MRR',     current: totalMRR||0,                  target:5000, unit:'$',       color:'#10b981' },
          { label:'Signed Offices',   current: activeTenants.length,         target:12,   unit:'firms',   color:'#f59e0b' },
        ],
        // Sales pipeline — real prospect data
        sales: (()=>{
          const pros = (prospectsRes && prospectsRes.data) || []
          // Use PIPELINE_STAGES as the canonical stage list (matches DB values)
          const STAGES = PIPELINE_STAGES
          const stageCounts = {}
          STAGES.forEach(s => { stageCounts[s] = 0 })
          pros.forEach(p => { stageCounts[p.stage] = (stageCounts[p.stage] || 0) + 1 })
          const won = pros.filter(p=>p.stage==='Won').length
          const lost = pros.filter(p=>p.stage==='Lost').length
          const winRate = (won+lost) > 0 ? Math.round((won/(won+lost))*100) : 0
          const pipeline = pros.filter(p=>!['Won','Lost'].includes(p.stage)).reduce((s,p)=>s+Number(p.mrr_potential||0),0)
          return {
            stages: STAGES.map((label,i) => ({
              label,
              count: stageCounts[label],
              color: ['#94a3b8','#6366f1','#8b5cf6','#0ea5e9','#a855f7','#f59e0b','#10b981','#ef4444'][i]
            })),
            winRate,
            pipeline,
            prospects: pros,
          }
        })(),
        systemStatus: [
          { label:'Supabase DB',         ok:true  },
          { label:'Email (Stalwart)',     ok:true  },
          { label:'taxrescrm.net',        ok:true  },
          { label:'taxrescrm.app',        ok:true  },
          { label:'GA4 Sync',            ok:true  },
          { label:'Search Console',      ok:null  },
          { label:'Bing',                ok:null  },
          { label:'Microsoft Clarity',   ok:null  },
        ],
      })
      } catch(err) {
        console.error('Command Center load error:', err)
        setLoadError(String(err))
      }
    }
    load()
  }, [])

  // ── Reporting registry — dynamic product list from romylabs_products ──
  React.useEffect(() => {
    supabase.from('product_traffic_channels').select('product_id,status').eq('channel_key','search_console').then(({ data, error }) => {
      if (error) { setGscLiveProducts([]); return }
      setGscLiveProducts((data || []).filter(r => r.status === 'live').map(r => r.product_id))
    })
    supabase.from('product_traffic_channels').select('product_id,status,tracking_id').eq('channel_key','ga4').then(({ data, error }) => {
      if (error) { setGa4EnabledProducts([]); setGa4LiveProducts([]); return }
      const rows = data || []
      setGa4EnabledProducts(rows.filter(r => r.tracking_id && ['configured','live'].includes(r.status)).map(r => r.product_id))
      setGa4LiveProducts(rows.filter(r => r.tracking_id && r.status === 'live').map(r => r.product_id))
    })
  }, [])

  const [reportingProducts, setReportingProducts] = React.useState([])
  const [ga4EnabledProducts, setGa4EnabledProducts] = React.useState([])
  const [ga4LiveProducts, setGa4LiveProducts] = React.useState([])
  const [gscLiveProducts, setGscLiveProducts] = React.useState([])
  React.useEffect(() => {
    supabase.from('romylabs_products')
      .select('product_id,name,accent_color,icon_ref,sort_order,lifecycle,app_url,marketing_url')
      .eq('active', true)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) console.error('CRM product registry:', error)
        if (data?.length) setReportingProducts(data.filter(p => String(p.lifecycle || '').toLowerCase() !== 'internal'))
      })
  }, [])

  const fetchCrmProductMetrics = React.useCallback(async (productKey) => {
    if (!productKey) return null
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) throw new Error('Admin session unavailable')
    const res = await fetch('https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product: productKey }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.ok === false) throw new Error(body?.error || `Metrics request failed (${res.status})`)
    return body
  }, [])

  React.useEffect(() => {
    setCrmAccount('all')
    setCrmAccountMetrics(null)
    setCrmRemoteError('')
    if (crmProduct === 'taxres_crm') { setCrmRemoteData(null); return }
    const product = PRODUCT_REGISTRY.find(p => p.key === crmProduct && !p.isTenant)
    if (!product?.metricsUrl) { setCrmRemoteData(null); return }
    let cancelled = false
    setCrmRemoteLoading(true)
    fetchCrmProductMetrics(crmProduct)
      .then(body => { if (!cancelled) setCrmRemoteData(body) })
      .catch(err => { if (!cancelled) { setCrmRemoteData(null); setCrmRemoteError(String(err?.message || err)) } })
      .finally(() => { if (!cancelled) setCrmRemoteLoading(false) })
    return () => { cancelled = true }
  }, [crmProduct, fetchCrmProductMetrics])

  React.useEffect(() => {
    setCrmAccountMetrics(null)
    if (crmProduct !== 'taxres_crm' || !String(crmAccount).startsWith('registry:')) return
    const key = String(crmAccount).slice('registry:'.length)
    const tenantProduct = PRODUCT_REGISTRY.find(p => p.isTenant && p.key === key)
    if (!tenantProduct?.metricsUrl) return
    let cancelled = false
    fetchCrmProductMetrics(key)
      .then(body => { if (!cancelled) setCrmAccountMetrics(body) })
      .catch(err => { if (!cancelled) setCrmRemoteError(String(err?.message || err)) })
    return () => { cancelled = true }
  }, [crmProduct, crmAccount, fetchCrmProductMetrics])

  // ── GSC state + fetch ──
  const [gscData, setGscData]         = useState(null)
  const [gscLoading, setGscLoading]   = useState(false)
  const [gscConnected, setGscConnected] = useState(false)

  // ── Bing state ──
  const [bingData, setBingData]           = useState(null)
  const [bingConnected, setBingConnected] = useState(false)

  // ── System live status ──
  const [sysStatus, setSysStatus] = useState(null)
  useEffect(()=>{
    async function checkSys(){
      let dbOk = false
      try { const r = await supabase.from('tenants').select('id').limit(1); dbOk = !r.error } catch(_){}
      let mailOk=false,netOk=false,appOk=false,romylabsOk=false,adminOk=false
      try{await fetch('https://webmail.taxrescrm.net:7443',{mode:'no-cors',signal:AbortSignal.timeout(4000)});mailOk=true}catch(_){}
      try{await fetch('https://taxrescrm.net',{mode:'no-cors',signal:AbortSignal.timeout(4000)});netOk=true}catch(_){}
      try{await fetch('https://taxrescrm.app',{mode:'no-cors',signal:AbortSignal.timeout(4000)});appOk=true}catch(_){}
      try{await fetch('https://romylabs.com',{mode:'no-cors',signal:AbortSignal.timeout(4000)});romylabsOk=true}catch(_){}
      try{await fetch('https://admin.romylabs.com',{mode:'no-cors',signal:AbortSignal.timeout(4000)});adminOk=true}catch(_){}
      setSysStatus({dbOk,mailOk,netOk,appOk,romylabsOk,adminOk})
    }
    checkSys()
  },[])

  useEffect(() => {
    // Handle GSC OAuth callback (?code= in URL after redirect)
    const urlParams = new URLSearchParams(window.location.search)
    const gscCode = urlParams.get('code')
    if (gscCode) {
      window.history.replaceState({}, '', window.location.pathname)
      const redirect = window.location.origin + '/crm-admin/command-center'
      supabase.functions.invoke('gsc-data', {
        body: { action: 'connect', code: gscCode, redirect_uri: redirect }
      }).then(({ data: r }) => {
        if (r?.success) fetchGSC()
      }).catch(e => console.error('GSC connect:', e))
    } else {
      fetchGSC()
    }
    fetchBing()
  }, [])

  async function fetchBing() {
    try {
      const { data: bing, error } = await supabase.functions.invoke('bing-data', { body: {} })
      if (error) throw error
      if (bing && !bing.error) { setBingData(bing); setBingConnected(true) }
      else { setBingConnected(false) }
    } catch(e) { console.error('Bing fetch:', e); setBingConnected(false) }
  }

  async function fetchGSC(productKey = 'taxres_crm') {
    setGscLoading(true)
    setGscConnected(false)
    setGscData(null)
    try {
      const { data: gsc, error } = await supabase.functions.invoke('gsc-data', { body: { product_key: productKey } })
      if (error) throw error
      if (gsc && !gsc.mock && !gsc.error) {
        setGscData(gsc)
        setGscConnected(true)
      }
    } catch(e) { console.error('GSC fetch:', e) } finally { setGscLoading(false) }
  }

  function handleGSCConnect() {
    const CLIENT_ID = '70057646964-vimoia1qkjtml9n3mplo0hme82m3t2qs.apps.googleusercontent.com'
    const redirect  = window.location.origin + '/crm-admin/command-center'
    const scope     = 'https://www.googleapis.com/auth/webmasters.readonly'
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`
  }

  // ── GA4 real data load ─────────────────────────────────────────────────────
  const [marketingProduct, setMarketingProduct] = useState('taxres_crm')
  const [seoProduct, setSeoProduct] = useState('taxres_crm')
  const [ga4Data, setGa4Data] = useState(null)
  const [ga4Loading, setGa4Loading] = useState(false)

  useEffect(() => {
    fetchGSC(seoProduct)
  }, [seoProduct])

  async function loadGA4() {
    setGa4Loading(true)
    try {
      // Trigger a fresh sync first (no-op if fn not yet deployed)
      await supabase.functions.invoke('ga4-sync', { body: { product_id: marketingProduct } }).catch(() => {})

      // Read results from cache tables
      const utcToday = new Date().toISOString().slice(0,10)
      const [{ data: traffic }, { data: pages }, { data: syncLog }] = await Promise.all([
        supabase.from('marketing_ga4_traffic').select('*').eq('product_id', marketingProduct).gte('date', new Date(Date.now()-7*86400000).toISOString().slice(0,10)).order('date',{ascending:false}),
        supabase.from('marketing_ga4_pages').select('*').eq('product_id', marketingProduct).gte('date', new Date(Date.now()-8*86400000).toISOString().slice(0,10)).order('date',{ascending:false}).order('sessions',{ascending:false}).limit(100),
        supabase.from('marketing_sync_log').select('*').eq('product_id', marketingProduct).eq('source','ga4').order('synced_at',{ascending:false}).limit(1),
      ])

      // GA4 report dates follow each property's configured timezone, which may differ from UTC.
      // Always use the latest date actually returned by GA4 instead of filtering against UTC "today".
      const reportingDate = (traffic || []).reduce((latest, r) => (!latest || r.date > latest ? r.date : latest), '') || utcToday
      const latestPageDate = (pages || []).reduce((latest, r) => (!latest || r.date > latest ? r.date : latest), '')
      const latestPages = (pages || []).filter(r => !latestPageDate || r.date === latestPageDate).slice(0, 10)
      const todayRows = (traffic||[]).filter(r=>r.date===reportingDate)
      const totalSessions   = todayRows.reduce((s,r)=>s+Number(r.sessions||0),0)
      const totalUsers      = todayRows.reduce((s,r)=>s+Number(r.users||0),0)
      const totalNewUsers   = todayRows.reduce((s,r)=>s+Number(r.new_users||0),0)
      const totalPageViews  = todayRows.reduce((s,r)=>s+Number(r.page_views||0),0)
      const avgBounce       = todayRows.length ? todayRows.reduce((s,r)=>s+Number(r.bounce_rate||0),0)/todayRows.length : 0
      const avgPages        = todayRows.length ? todayRows.reduce((s,r)=>s+Number(r.pages_per_session||0),0)/todayRows.length : 0

      // Yesterday comparison
      const yest = new Date(Date.now()-86400000).toISOString().slice(0,10)
      const yestRows = (traffic||[]).filter(r=>r.date===yest)
      const yestSessions = yestRows.reduce((s,r)=>s+Number(r.sessions||0),0)
      const sessionChange = yestSessions>0 ? Math.round(((totalSessions-yestSessions)/yestSessions)*100) : 0

      // Channel breakdown
      const channels = []
      const channelMap = {}
      for (const r of todayRows) {
        channelMap[r.channel||'Direct'] = (channelMap[r.channel||'Direct']||0) + Number(r.sessions||0)
      }
      const totalCh = Object.values(channelMap).reduce((s,v)=>s+v,0)||1
      const COLORS = {
        'Organic Search':'#6366f1','Direct':'#0ea5e9','Referral':'#10b981',
        'Organic Social':'#f59e0b','Email':'#ec4899','Paid Search':'#8b5cf6','Unassigned':'#64748b'
      }
      for (const [ch,count] of Object.entries(channelMap).sort((a,b)=>b[1]-a[1]).slice(0,6)) {
        channels.push({ label:ch, pct:Math.round((count/totalCh)*100), color:COLORS[ch]||'#64748b' })
      }

      const lastSync = syncLog?.[0]
      setGa4Data({
        sessions: totalSessions,
        users: totalUsers,
        newUsers: totalNewUsers,
        pageViews: totalPageViews,
        bounceRate: avgBounce.toFixed(1),
        pagesPerSession: avgPages.toFixed(1),
        sessionChange,
        channels: channels.length ? channels : [{ label:'No data yet', pct:100, color:'#334155' }],
        topPages: latestPages.map(p=>({ path:p.page_path, views:p.sessions, avgTime: Math.round(p.avg_time_sec||0)+'s' })),
        lastSync: lastSync ? new Date(lastSync.synced_at).toLocaleTimeString() : 'never',
        status: lastSync?.status || 'pending',
      })
    } catch(e) {
      console.error('GA4 load error:', e)
    }
    setGa4Loading(false)
  }

  useEffect(() => {
    setGa4Data(null)
    if (tab==='marketing' && ga4EnabledProducts.includes(marketingProduct)) loadGA4()
  }, [tab, marketingProduct, ga4EnabledProducts])

  // Poll activity every 30s
  useEffect(() => {
    const t = setInterval(() => setActivityPoll(p=>p+1), 30000)
    return () => clearInterval(t)
  }, [])

  if (loadError) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'80vh' }}>
      <div style={{ textAlign:'center', maxWidth:500 }}>
        <div style={{ fontSize:32, marginBottom:12 }}>⚠️</div>
        <div style={{ fontSize:16, color:'#ef4444', fontWeight:700, marginBottom:8 }}>Command Center failed to load</div>
        <div style={{ fontSize:12, color:'#475569', fontFamily:'monospace', background:'rgba(0,0,0,.3)', padding:12, borderRadius:8, textAlign:'left', wordBreak:'break-all' }}>{loadError}</div>
        <button onClick={() => { setLoadError(null); setData(null); }} style={{ ...S.btn('primary'), marginTop:16 }}>Retry</button>
      </div>
    </div>
  )

  if (!data) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'80vh' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>⚡</div>
        <div style={{ fontSize:14, color:'#475569' }}>Loading Command Center…</div>
      </div>
    </div>
  )

  const TABS = [
    { key:'overview',  label:'Overview'  },
    { key:'support',   label:'Support'   },
    { key:'products',  label:'Products'  },
    { key:'marketing', label:'Product Usage' },
    { key:'search',    label:'SEO'       },
    { key:'linkedin',  label:'LinkedIn'  },
    { key:'content',   label:'Content'   },
    { key:'sales',     label:'Sales'     },
    { key:'crm',       label:'CRM'       },
    { key:'goals',     label:'Goals'     },
    { key:'system',    label:'System'    },
  ]

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', background:'#0a0918' }}>

      {/* ── Main scroll area ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'28px 32px 48px' }}>

        {/* Header */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:26, fontWeight:900, color:'#fff', marginBottom:3 }}>
            {data.greeting}, Romy 👋
          </div>
          <div style={{ fontSize:13, color:'#475569' }}>{data.todayDate}</div>
        </div>

        {/* Tab bar */}
        <div style={{ display:'flex', gap:4, marginBottom:28, padding:'4px', background:'rgba(255,255,255,.04)',
          borderRadius:10, border:'1px solid rgba(99,102,241,.15)', width:'fit-content' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding:'7px 18px', borderRadius:7, border:'none', cursor:'pointer',
              fontWeight: tab===t.key ? 700 : 500, fontSize:13,
              background: tab===t.key ? 'rgba(99,102,241,.35)' : 'transparent',
              color: tab===t.key ? '#a5b4fc' : '#64748b',
              transition:'all .15s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ═══ OVERVIEW TAB — RomyLabs Portfolio Level ═══ */}
        {tab==='overview' && (<>

          {/* ── Portfolio Scorecard ───────────────────────────────────────── */}
          {(() => {
            const products   = PRODUCT_REGISTRY.filter(p => !p.isTenant)
            const liveN      = products.filter(p => ['live','available'].includes(p.lifecycleStage)).length
            const comingN    = products.filter(p => p.lifecycleStage === 'coming').length
            const buildN     = products.filter(p => p.lifecycleStage === 'building').length
            const researchN  = products.filter(p => p.lifecycleStage === 'research').length
            const internalN  = products.filter(p => p.lifecycleStage === 'internal').length
            const connectedN = products.filter(p => p.connection === 'connected').length
            const partialN   = products.filter(p => p.connection === 'partial').length
            const noConnN    = products.filter(p => p.connection === 'not_connected').length
            const attentionN = products.filter(p => p.connection === 'partial').length +
                               products.filter(p => p.lifecycleStage === 'coming' && !p.metricsUrl).length
            return (
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:12 }}>
                  RomyLabs Portfolio
                </div>
                {/* Row 1 — lifecycle */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:8, marginBottom:8 }}>
                  {[
                    { label:'Total Products',  val:products.length, color:'#6366f1', big:true, filter:'total' },
                    { label:'Live / Available', val:liveN,    color:'#10b981', filter:'live' },
                    { label:'Coming Soon',      val:comingN,  color:'#8b5cf6', filter:'coming' },
                    { label:'Building',         val:buildN,   color:'#f59e0b', filter:'building' },
                    { label:'Research',         val:researchN,color:'#64748b', filter:'research' },
                    { label:'Internal',         val:internalN,color:'#475569', filter:'internal' },
                    { label:'Need Attention',   val:attentionN, color:'#ef4444', filter:'attention' },
                  ].map(k => (
                    <div key={k.label} role="button" tabIndex={0}
                      onClick={()=>setSearchParams({tab:'products',portfolio:k.filter})}
                      onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSearchParams({tab:'products',portfolio:k.filter})}}}
                      style={{ background:`${k.color}10`, border:`1px solid ${k.color}20`,
                      borderRadius:10, padding:'10px 12px', textAlign:'center', cursor:'pointer' }}>
                      <div style={{ fontSize:9, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4, lineHeight:1.3 }}>{k.label}</div>
                      <div style={{ fontSize:k.big?26:20, fontWeight:900, color:k.color }}>{k.val}</div>
                    </div>
                  ))}
                </div>
                {/* Row 2 — connection */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                  {[
                    { label:'🟢 Connected', val:connectedN, color:'#10b981', note:'live metrics', filter:'connected' },
                    { label:'🟡 Partial',   val:partialN,   color:'#f59e0b', note:'metrics deploy pending', filter:'partial' },
                    { label:'⚪ Not Connected', val:noConnN, color:'#64748b', note:'planned / research', filter:'not_connected' },
                  ].map(k => (
                    <div key={k.label} role="button" tabIndex={0}
                      onClick={()=>setSearchParams({tab:'products',portfolio:k.filter})}
                      onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSearchParams({tab:'products',portfolio:k.filter})}}}
                      style={{ background:`${k.color}08`, border:`1px solid ${k.color}20`,
                      borderRadius:10, padding:'10px 16px', display:'flex', alignItems:'center', gap:12, cursor:'pointer' }}>
                      <div style={{ fontSize:24, fontWeight:900, color:k.color }}>{k.val}</div>
                      <div>
                        <div style={{ fontSize:11, fontWeight:700, color:k.color }}>{k.label}</div>
                        <div style={{ fontSize:10, color:'#334155' }}>{k.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* ── Portfolio Grid (compact — not a duplicate of Products tab) ── */}
          {(() => {
            const products = PRODUCT_REGISTRY.filter(p => !p.isTenant)
            const LIFECYCLE_COLOR = { live:'#10b981', available:'#10b981', coming:'#8b5cf6', building:'#f59e0b', research:'#64748b', internal:'#475569' }
            const LIFECYCLE_LABEL = { live:'✅ Live', available:'🟢 Available', coming:'🔜 Coming Soon', building:'🔨 Building', research:'🔬 Research', internal:'🔒 Internal' }
            const CONN_DOT = { connected:'🟢', partial:'🟡', not_connected:'⚪' }
            return (
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:10 }}>
                  Product Portfolio
                </div>
                <div style={{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(99,102,241,.1)', borderRadius:12, overflow:'hidden' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1fr .8fr .8fr .8fr 1.2fr', padding:'8px 16px',
                    borderBottom:'1px solid rgba(99,102,241,.1)', background:'rgba(99,102,241,.06)' }}>
                    {['Product','Lifecycle','Connection','Commercial','Public','Analytics','Next Milestone'].map(h => (
                      <div key={h} style={{ fontSize:9, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.07em' }}>{h}</div>
                    ))}
                  </div>
                  {products.map((p, i) => {
                    const lc = p.lifecycleStage
                    const lcColor = LIFECYCLE_COLOR[lc] || '#64748b'
                    const analyticsStatus = (p.ga4Connected || p.connection === 'connected')
                      ? '🟢 Connected'
                      : (p.publicOnRomyLabs ? '🟡 Pending' : 'N/A')
                    return (
                      <div key={p.key} style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1fr .8fr .8fr .8fr 1.2fr',
                        padding:'10px 16px', borderBottom: i < products.length-1 ? '1px solid rgba(99,102,241,.06)' : 'none',
                        background: i%2===0 ? 'transparent' : 'rgba(255,255,255,.01)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:14 }}>{p.icon}</span>
                          <div>
                            <div style={{ fontSize:12, fontWeight:700, color:'#e2e8f0' }}>{p.label}</div>
                            {p.nextToFinish && <div style={{ fontSize:8, fontWeight:800, color:'#F97316', marginTop:1 }}>⭐ NEXT CRM TO FINISH</div>}
                            <div style={{ fontSize:9, color:'#475569' }}>{p.industry}</div>
                          </div>
                        </div>
                        <div>
                          <span style={{ fontSize:10, fontWeight:700, color:lcColor,
                            background:`${lcColor}12`, padding:'2px 8px', borderRadius:20, whiteSpace:'nowrap' }}>
                            {LIFECYCLE_LABEL[lc] || lc}
                          </span>
                        </div>
                        <div style={{ fontSize:11, color: p.connection==='connected' ? '#10b981' : p.connection==='partial' ? '#f59e0b' : '#475569' }}>
                          {CONN_DOT[p.connection]} {p.connection === 'connected' ? 'Connected' : p.connection === 'partial' ? 'Partial' : 'Not Connected'}
                        </div>
                        <div style={{ fontSize:11, color: p.commerciallyAvailable ? '#10b981' : '#475569' }}>
                          {p.commerciallyAvailable ? 'Live' : '—'}
                        </div>
                        <div style={{ fontSize:11, color: p.publicOnRomyLabs ? '#10b981' : '#475569' }}>
                          {p.publicOnRomyLabs ? 'Yes' : 'No'}
                        </div>
                        <div style={{ fontSize:11, color:'#64748b' }}>{analyticsStatus}</div>
                        <div style={{ fontSize:10, color:'#6366f1', fontStyle:'italic', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {p.nextMilestone || '—'}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize:10, color:'#334155', marginTop:6 }}>
                  {PRODUCT_REGISTRY.filter(p=>p.isTenant).length} TaxRes tenants excluded from product count · view in Products → Tax Res CRM
                </div>
              </div>
            )
          })()}

          {/* ── Cross-Product SEO / Analytics Status ─────────────────────── */}
          {(() => {
            const SEO_STATUS = [
              { label:'RomyLabs',  ga4:'G-2MSNYF9XBE — Connected', gsc:'romylabs.com — Connected', clarity:'y54zqoj6c2 — Connected', sitemap:'https://romylabs.com/sitemap-index.xml', seoStatus:'Active' },
              { label:'TaxRes',    ga4:'G-M6J80B65LG — Connected', gsc:'taxrescrm.net — Connected', clarity:'xyck7g2mfl — Connected', sitemap:'https://taxrescrm.net/sitemap.xml', seoStatus:'Active' },
              { label:'Camvella',  ga4:'G-H1ZPCP2EE9 — Connected', gsc:'camvella.com — Active', clarity:'y62zna7yna — Connected', sitemap:'https://camvella.com/sitemap.xml ✓', seoStatus:'Active' },
              { label:'Arcvena',   ga4:'Connected', gsc:'arcvena.com — Active', clarity:'Connected', sitemap:'https://arcvena.com/sitemap.xml ✓', seoStatus:'Active' },
              { label:'BocaSync',  ga4:'—', gsc:'—', clarity:'—', sitemap:'—', seoStatus:'Not Started' },
            ]
            const COLOR = { 'Active':'#10b981', 'Pending Setup':'#f59e0b', 'Pending DNS':'#f59e0b', 'Not Started':'#64748b', 'Internal — N/A':'#475569' }
            return (
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:10 }}>
                  SEO & Analytics Status by Product
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                  {SEO_STATUS.map(p => (
                    <div key={p.label} style={{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(99,102,241,.1)', borderRadius:10, padding:'14px 16px' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                        <div style={{ fontSize:13, fontWeight:800, color:'#e2e8f0' }}>{p.label}</div>
                        <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:20,
                          background:`${COLOR[p.seoStatus]||'#64748b'}15`, color:COLOR[p.seoStatus]||'#64748b' }}>
                          {p.seoStatus}
                        </span>
                      </div>
                      {[['GA4', p.ga4], ['GSC', p.gsc], ['Clarity', p.clarity], ['Sitemap', p.sitemap]].map(([k,v]) => (
                        <div key={k} style={{ display:'flex', gap:6, marginBottom:4 }}>
                          <div style={{ fontSize:9, fontWeight:700, color:'#475569', width:44, flexShrink:0, textTransform:'uppercase', letterSpacing:'.05em', paddingTop:1 }}>{k}</div>
                          <div style={{ fontSize:10, color: v.includes('Connected') ? '#10b981' : v.includes('Pending') ? '#f59e0b' : '#475569', lineHeight:1.4 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:10, color:'#334155', marginTop:6 }}>
                  Detailed TaxRes analytics → Products → Tax Res CRM · TaxRes GSC queries/impressions → TaxRes — SEO tab
                </div>
              </div>
            )
          })()}

          {/* ── Needs Attention ─────────────────────────────────────────── */}
          {(() => {
            const products = PRODUCT_REGISTRY.filter(p => !p.isTenant)
            const attention = []
            // Partial connections — metrics not deployed
            products.filter(p => p.connection === 'partial').forEach(p => {
              attention.push({ product: p.label, icon: '🟡', item: 'Platform metrics deploy pending', priority: 'medium' })
            })
            // Coming Soon with no marketing domain
            products.filter(p => p.lifecycleStage === 'coming').forEach(p => {
              if (!p.url) attention.push({ product: p.label, icon: '🔴', item: 'Production marketing domain not configured', priority: 'high' })
              if (p.url && !p.metricsUrl) attention.push({ product: p.label, icon: '🟡', item: 'Metrics not connected', priority: 'medium' })
            })
            // Building products with no backend
            products.filter(p => p.lifecycleStage === 'building').forEach(p => {
              attention.push({ product: p.label, icon: '🟡', item: 'In active development — commercialization pending', priority: 'low' })
            })
            // Internal — needs decision
            products.filter(p => p.lifecycleStage === 'internal').forEach(p => {
              attention.push({ product: p.label, icon: '⚪', item: 'Rebrand/migration decision pending before public launch', priority: 'low' })
            })
            // Known external blockers from data state
            const externalBlockers = [
              { product: 'TaxRes', icon: '🔴', item: 'GSC deceptive pages review pending (taxrescrm.net)', priority: 'high' },
              { product: 'TaxRes', icon: '🟡', item: 'CloudCPA contract not yet signed', priority: 'medium' },
              { product: 'TaxRes', icon: '🟡', item: 'Nashville SignalWire credentials pending', priority: 'medium' },
              { product: 'Arcvena', icon: '🔴', item: 'arcvena.com DNS cutover not complete', priority: 'high' },
              { product: 'Arcvena', icon: '🟡', item: 'CRM UI polish — GH Actions minutes exhausted (Sept 1)', priority: 'medium' },
              { product: 'Camvella', icon: '🟡', item: 'GA4 Data API reporting not yet wired to RomyLabs hub', priority: 'medium' },
            ]
            const all = [...attention, ...externalBlockers]
              .sort((a,b) => { const p = {high:0,medium:1,low:2}; return p[a.priority]-p[b.priority] })
            return (
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:10 }}>
                  Needs Attention
                </div>
                <div style={{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(99,102,241,.1)', borderRadius:12, overflow:'hidden' }}>
                  {all.slice(0,10).map((item, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'10px 16px',
                      borderBottom: i < Math.min(all.length,10)-1 ? '1px solid rgba(99,102,241,.06)' : 'none' }}>
                      <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{item.icon}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:'#a5b4fc', marginBottom:2 }}>{item.product}</div>
                        <div style={{ fontSize:12, color:'#94a3b8' }}>{item.item}</div>
                      </div>
                      <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:20, flexShrink:0,
                        background: item.priority==='high' ? 'rgba(239,68,68,.15)' : item.priority==='medium' ? 'rgba(245,158,11,.15)' : 'rgba(100,116,139,.15)',
                        color: item.priority==='high' ? '#ef4444' : item.priority==='medium' ? '#f59e0b' : '#64748b' }}>
                        {item.priority.toUpperCase()}
                      </span>
                    </div>
                  ))}
                  {all.length === 0 && (
                    <div style={{ padding:'20px 16px', fontSize:13, color:'#10b981' }}>✅ No blockers — all products on track</div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── Bottom row: Schedule + Sales Pipeline + System Status ──── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 280px', gap:18 }}>

            {/* Romy's schedule — operator-level, not portfolio metric */}
            <div style={CC.card({padding:'22px 24px'})}>
              <div style={CC.sectionLabel}>Romy's schedule today</div>
              <div style={{ fontSize:9, color:'#334155', marginBottom:10 }}>RomyLabs platform calendar — all products</div>
              {data.todaySchedule.length===0
                ? <div style={{ fontSize:13, color:'#475569' }}>Nothing on the calendar today.</div>
                : data.todaySchedule.map((e,i) => (
                <div key={i} style={{ display:'flex', gap:12, padding:'9px 0',
                  borderBottom: i<data.todaySchedule.length-1?'1px solid rgba(99,102,241,.1)':'none' }}>
                  <div style={{ fontSize:11, color:'#6366f1', fontWeight:700, width:44, flexShrink:0, marginTop:1 }}>
                    {e.start ? new Date(e.start).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}) : '—'}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    {(() => { const badge = parseEventBadge(e.title); return badge ? (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, background:badge.bg, color:badge.text, fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:3, marginBottom:2, textTransform:'uppercase', letterSpacing:'.04em' }}>
                         {badge.logo && <img src={badge.logo} alt="" aria-hidden="true" style={{ width:14, height:14, objectFit:'contain', borderRadius:3 }} />}
                         {badge.label}
                       </span>
                    ) : null })()}
                    <div style={{ fontSize:13, color:'#e2e8f0', fontWeight:600 }}>{(e.title||'Meeting').replace(/^\[[^\]]+\]\s*/,'')}</div>
                    <div style={{ fontSize:10, color:'#475569' }}>{e.type||'Event'}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Sales Pipeline — company-level lead tracking */}
            <div style={CC.card({padding:'22px 24px'})}>
              <div style={CC.sectionLabel}>Sales Pipeline</div>
              <div style={{ fontSize:9, color:'#334155', marginBottom:10 }}>RomyLabs prospects · full detail → Sales tab</div>
              {data.sales?.stages ? (() => {
                const active = data.sales.stages.filter(s=>!['Won','Lost'].includes(s.label))
                const totalActive = active.reduce((s,r)=>s+r.count,0)
                const won   = data.sales.stages.find(s=>s.label==='Won')?.count || 0
                const lost  = data.sales.stages.find(s=>s.label==='Lost')?.count || 0
                return (<>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12 }}>
                    {[
                      { label:'Active',  val:totalActive, color:'#6366f1' },
                      { label:'Won',     val:won,         color:'#10b981' },
                      { label:'Pipeline',val:`$${(data.sales.pipeline||0).toLocaleString()}`, color:'#f59e0b' },
                    ].map(k => (
                      <div key={k.label} style={{ textAlign:'center', background:'rgba(255,255,255,.03)', borderRadius:8, padding:'8px' }}>
                        <div style={{ fontSize:9, color:'#475569', textTransform:'uppercase', letterSpacing:'.06em' }}>{k.label}</div>
                        <div style={{ fontSize:18, fontWeight:800, color:k.color, marginTop:2 }}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                  {active.filter(s=>s.count>0).map((s,i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0',
                      borderBottom: '1px solid rgba(99,102,241,.06)' }}>
                      <div style={{ fontSize:11, color:'#94a3b8' }}>{s.label}</div>
                      <div style={{ fontSize:12, fontWeight:700, color:s.color }}>{s.count}</div>
                    </div>
                  ))}
                </>)
              })() : <div style={{ fontSize:12, color:'#475569' }}>Loading…</div>}
            </div>

            {/* RomyLabs system status — multi-product */}
            <div style={CC.card({padding:'22px 20px'})}>
              <div style={CC.sectionLabel}>System Status</div>
              <div style={{ fontSize:9, color:'#334155', marginBottom:10 }}>RomyLabs infrastructure</div>
              {[
                { label:'romylabs.com',       ok: sysStatus?.romylabsOk ?? null },
                { label:'admin.romylabs.com', ok: sysStatus?.adminOk    ?? null },
                { label:'TaxRes (taxrescrm.app)', ok: sysStatus?.appOk ?? null },
                { label:'TaxRes (taxrescrm.net)', ok: sysStatus?.netOk ?? null },
                { label:'TaxRes Mail (Stalwart)', ok: sysStatus?.mailOk ?? null },
                { label:'Supabase (TaxRes DB)',   ok: sysStatus?.dbOk  ?? null },
              ].map((s,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'7px 0', borderBottom: i<5?'1px solid rgba(99,102,241,.08)':'none' }}>
                  <div style={{ fontSize:11, color:'#94a3b8' }}>{s.label}</div>
                  <StatusDot ok={s.ok} />
                </div>
              ))}
            </div>
          </div>

        </>)}

        {/* ═══ PRODUCT USAGE TAB ═══ */}
        {tab==='marketing' && (<>
          <div style={{ marginBottom:16, padding:'12px 16px', borderRadius:10, background:'rgba(14,165,233,.07)', border:'1px solid rgba(14,165,233,.18)' }}>
            <div style={{ fontSize:12, fontWeight:800, color:'#7dd3fc', marginBottom:4 }}>Product Usage · GA4 tracked activity</div>
            <div style={{ fontSize:11, color:'#64748b', lineHeight:1.5 }}>These metrics show tracked website/app sessions and route activity. They are not the same as marketing leads or SEO performance. Use SEO for organic search visibility and Sales for lead/demo conversion.</div>
          </div>
          <ProductReportingSelector value={marketingProduct} onChange={setMarketingProduct} channel="marketing"
            registryProducts={reportingProducts} marketingConnectedProducts={ga4LiveProducts} />
          {ga4EnabledProducts.includes(marketingProduct) ? <>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
            <div style={{ fontSize:11, color:'#475569' }}>
              {ga4Data ? `Last synced: ${ga4Data.lastSync}` : 'Loading GA4 data…'}
            </div>
            <button onClick={loadGA4} disabled={ga4Loading} style={{ ...S.btn('ghost'), fontSize:12, padding:'6px 16px' }}>
              {ga4Loading ? '⟳ Syncing…' : '⟳ Refresh'}
            </button>
          </div>

          {ga4Loading && !ga4Data ? (
            <div style={{ textAlign:'center', padding:60, color:'#475569' }}>
              <div style={{ fontSize:28, marginBottom:12 }}>📊</div>
              <div>Pulling data from Google Analytics…</div>
            </div>
          ) : ga4Data ? (<>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:24 }}>
              {[
                { label:'Tracked Sessions Today',    value: ga4Data.sessions.toLocaleString(), sub: ga4Data.sessionChange!==0 ? `${ga4Data.sessionChange>0?'↑':'↓'} ${Math.abs(ga4Data.sessionChange)}% vs yesterday` : 'vs yesterday', icon:'📊', color:'#6366f1' },
                { label:'Active Users Today',       value: ga4Data.users.toLocaleString(),    sub:`${ga4Data.newUsers.toLocaleString()} new`,   icon:'👥', color:'#0ea5e9' },
                { label:'Bounce Rate',       value:`${ga4Data.bounceRate}%`,            sub:'avg today',     icon:'↩️', color:'#10b981' },
                { label:'Pages / Session',   value: ga4Data.pagesPerSession,            sub:'avg today',     icon:'📄', color:'#f59e0b' },
              ].map(k => <KPICard key={k.label} {...k} />)}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18, marginBottom:24 }}>
              <div style={CC.card({padding:'22px 24px'})}>
                <div style={CC.sectionLabel}>Session sources — today</div>
                {ga4Data.channels.map((s,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
                    <div style={{ fontSize:12, color:'#94a3b8', width:130, flexShrink:0 }}>{s.label}</div>
                    <MiniBar pct={s.pct} color={s.color} />
                    <div style={{ fontSize:12, fontWeight:700, color:s.color, width:36, textAlign:'right' }}>{s.pct}%</div>
                  </div>
                ))}
              </div>

              <div style={CC.card({padding:'22px 24px'})}>
                <div style={CC.sectionLabel}>Most-used routes — last 7 days</div>
                {ga4Data.topPages.length===0
                  ? <div style={{ fontSize:13, color:'#475569' }}>No page data yet.</div>
                  : ga4Data.topPages.map((p,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                    padding:'9px 0', borderBottom: i<ga4Data.topPages.length-1?'1px solid rgba(99,102,241,.1)':'none' }}>
                    <div style={{ fontSize:12, color:'#e2e8f0', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:240 }}>{p.path}</div>
                    <div style={{ display:'flex', gap:12, flexShrink:0 }}>
                      <span style={{ fontSize:12, color:'#94a3b8' }}>{p.views} tracked sessions</span>
                      <span style={{ fontSize:11, color:'#475569' }}>{p.avgTime}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>) : (
            <div style={{ ...CC.card(), padding:'24px', textAlign:'center', color:'#475569' }}>
              GA4 sync failed. Check System tab for details.
            </div>
          )}
          </> : <ProductReportingSetup productKey={marketingProduct} channel="marketing" registryProduct={reportingProducts.find(r=>r.product_id===marketingProduct)} />}
        </>)}

        {/* ═══ SEARCH TAB ═══ */}
        {tab==='search' && (<>
          <ProductReportingSelector value={seoProduct} onChange={setSeoProduct} channel="seo"
            gscConnected={gscConnected} activeGscProduct={seoProduct}
            registryProducts={reportingProducts} seoConnectedProducts={gscLiveProducts} />
          <>

          {/* ── Google Search Console ── */}
          <div style={CC.card({padding:'22px 24px', marginBottom:18})}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
              <span style={{ fontSize:16 }}>🔵</span>
              <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>Google Search Console</div>
              {gscConnected
                ? <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'rgba(16,185,129,.15)', color:'#10b981', marginLeft:'auto' }}>✅ Connected</span>
                : <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'rgba(99,102,241,.15)', color:'#6366f1', marginLeft:'auto' }}>Not connected</span>
              }
            </div>
            {(()=>{ const sd = gscConnected && gscData ? gscData : null; return (<>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom: sd && gscData?.topQueries?.length > 0 ? 16 : 0 }}>
                {[
                  { label:'Impressions',  value: sd ? sd.impressions.toLocaleString() : '—', color:'#6366f1' },
                  { label:'Clicks',       value: sd ? sd.clicks.toLocaleString() : '—',       color:'#10b981' },
                  { label:'CTR',          value: sd ? `${sd.ctr}%` : '—',                     color:'#f59e0b' },
                  { label:'Avg Position', value: sd ? String(sd.avgPosition) : '—',           color:'#f97316' },
                ].map((m,i)=>(
                  <div key={i} style={{ background:'rgba(255,255,255,.03)', borderRadius:8, padding:'14px 16px', border:'1px solid rgba(255,255,255,.06)' }}>
                    <div style={{ fontSize:9, color:'#475569', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{m.label}</div>
                    <div style={{ fontSize:22, fontWeight:800, color:m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {sd && gscData?.topQueries?.length > 0 && (
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>{['Keyword','Position','Clicks','Impressions'].map(h=>(
                    <th key={h} style={{ padding:'6px 10px', textAlign:'left', fontSize:10, color:'#475569', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid rgba(255,255,255,.06)' }}>{h}</th>
                  ))}</tr></thead>
                  <tbody>{gscData.topQueries.map((q,i)=>(
                    <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                      <td style={{ padding:'8px 10px', fontSize:13, color:'#e2e8f0' }}>{q.query}</td>
                      <td style={{ padding:'8px 10px', fontSize:13, fontWeight:700, color: q.pos<=10?'#10b981':q.pos<=20?'#f59e0b':'#f97316' }}>{q.pos}</td>
                      <td style={{ padding:'8px 10px', fontSize:13, color:'#94a3b8' }}>{q.clicks}</td>
                      <td style={{ padding:'8px 10px', fontSize:13, color:'#6366f1' }}>{q.impressions}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              {!gscConnected && (
                <div style={{ marginTop:8 }}>
                  {gscLoading
                    ? <div style={{ fontSize:12, color:'#475569' }}>Checking connection…</div>
                    : <button onClick={handleGSCConnect} style={{ background:'#6366f1', color:'#fff', border:'none', borderRadius:6, padding:'7px 16px', fontSize:12, fontWeight:600, cursor:'pointer' }}>Connect Google Search Console</button>
                  }
                </div>
              )}
              {gscConnected && gscData?.siteUrl && <div style={{ fontSize:11, color:'#475569', marginTop:8 }}>Last 28 days · {gscData.siteUrl}</div>}
            </>)})()}
          </div>

          {/* Bing reporting is currently configured only for TaxRes. */}
          {seoProduct === 'taxres_crm' && (
          <div style={CC.card({padding:'22px 24px'})}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
              <span style={{ fontSize:16 }}>🟠</span>
              <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>Bing Webmaster Tools</div>
              {bingConnected
                ? <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'rgba(16,185,129,.15)', color:'#10b981', marginLeft:'auto' }}>✅ Connected</span>
                : <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'rgba(100,116,139,.15)', color:'#64748b', marginLeft:'auto' }}>Not connected</span>
              }
            </div>
            {bingConnected && bingData ? (<>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom: bingData.topKeywords?.length > 0 ? 16 : 0 }}>
                {[
                  { label:'Impressions',  value: bingData.impressions?.toLocaleString() || '0', color:'#6366f1' },
                  { label:'Clicks',       value: bingData.clicks?.toLocaleString() || '0',       color:'#10b981' },
                  { label:'CTR',          value: `${bingData.ctr || 0}%`,                        color:'#f59e0b' },
                  { label:'Avg Position', value: bingData.avgPosition || '—',                    color:'#f97316' },
                ].map((m,i)=>(
                  <div key={i} style={{ background:'rgba(255,255,255,.03)', borderRadius:8, padding:'14px 16px', border:'1px solid rgba(255,255,255,.06)' }}>
                    <div style={{ fontSize:9, color:'#475569', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{m.label}</div>
                    <div style={{ fontSize:22, fontWeight:800, color:m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {bingData.topKeywords?.length > 0 && (
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>{['Keyword','Position','Clicks','Impressions'].map(h=>(
                    <th key={h} style={{ padding:'6px 10px', textAlign:'left', fontSize:10, color:'#475569', textTransform:'uppercase', letterSpacing:'.06em', borderBottom:'1px solid rgba(255,255,255,.06)' }}>{h}</th>
                  ))}</tr></thead>
                  <tbody>{bingData.topKeywords.slice(0,8).map((k,i)=>(
                    <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                      <td style={{ padding:'8px 10px', fontSize:13, color:'#e2e8f0' }}>{k.query}</td>
                      <td style={{ padding:'8px 10px', fontSize:13, fontWeight:700, color: k.avgPosition<=10?'#10b981':k.avgPosition<=20?'#f59e0b':'#f97316' }}>{k.avgPosition}</td>
                      <td style={{ padding:'8px 10px', fontSize:13, color:'#94a3b8' }}>{k.clicks}</td>
                      <td style={{ padding:'8px 10px', fontSize:13, color:'#6366f1' }}>{k.impressions}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              <div style={{ fontSize:11, color:'#475569', marginTop:8 }}>Last 28 days · {bingData.siteUrl}</div>
            </>) : (
              <div style={{ fontSize:12, color:'#475569' }}>
                {bingData === null ? 'Checking connection…' : 'API key configured — no data yet or site not yet indexed by Bing.'}
              </div>
            )}
          </div>
          )}
          </>
        </>)}

        {/* ═══ SALES TAB ═══ */}
        {tab==='sales' && <SalesPipeline data={data} supabase={supabase} registryProducts={reportingProducts} />}

        {/* ═══ CRM TAB ═══ */}
        {tab==='crm' && (<>
          {/* ── CRM scope: TaxRes CRM offices only (TCR Supabase) ── */}
          {(()=>{
            // CRM account drilldown — TaxRes local tenants + product platform-metrics offices.
            const selectedProduct = PRODUCT_REGISTRY.find(p => p.key === crmProduct && !p.isTenant)
              || { key: crmProduct, label: reportingProducts.find(p=>p.product_id===crmProduct)?.name || crmProduct }
            const localTaxRes = data.tenants || []
            const taxResRegistryTenants = PRODUCT_REGISTRY.filter(p=>p.isTenant).map(p=>({
              id:`registry:${p.key}`, firm_name:p.label, status:'active', tenant_code:p.key.toUpperCase(), metricsUrl:p.metricsUrl, registryOnly:true,
            }))
            const seenNames = new Set(localTaxRes.map(t=>String(t.firm_name||'').trim().toLowerCase()))
            const mergedTaxRes = [...localTaxRes, ...taxResRegistryTenants.filter(t=>!seenNames.has(String(t.firm_name||'').trim().toLowerCase()))]
            const remoteOffices = (crmRemoteData?.offices || []).map(o=>({
              id:o.id, firm_name:o.name, status:o.is_active===false?'inactive':'active', tenant_code:o.subscription_status || '',
              client_count:o.active_clients ?? o.customer_count, lead_count:o.active_leads ?? o.lead_count, employee_count:o.active_staff ?? o.staff_count,
              cases_count:o.open_jobs ?? o.job_count, tasks_count:o.pending_tasks, transactions_count:o.outstanding_invoices, mrr:o.mrr, remote:true,
            }))
            const crmTenants = crmProduct === 'taxres_crm' ? mergedTaxRes : remoteOffices
            const activeTenant = crmAccount === 'all' ? null : crmTenants.find(t=>String(t.id)===String(crmAccount))
            const productMetrics = crmProduct === 'taxres_crm' ? null : (crmRemoteData?.metrics || {})
            const selectedMetrics = activeTenant?.registryOnly ? (crmAccountMetrics?.metrics || {}) : null
            const metricValue = (tenantKey, productKey, taxresFallback) => {
              if (selectedMetrics) return selectedMetrics[productKey] ?? '—'
              if (activeTenant) return activeTenant[tenantKey] ?? '—'
              if (crmProduct !== 'taxres_crm') return productMetrics[productKey] ?? '—'
              return taxresFallback
            }
            const realMB     = (data.kpis.realStorageBytes / 1048576).toFixed(2)
            const realObjs   = data.kpis.realStorageObjects
            return (<>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:18,
            background:'rgba(99,102,241,.06)', border:'1px solid rgba(99,102,241,.15)',
            borderRadius:10, padding:'10px 16px' }}>
            <span style={{ fontSize:11, fontWeight:700, color:'#475569' }}>Product:</span>
            <select value={crmProduct} onChange={e=>setCrmProduct(e.target.value)}
              style={{ fontSize:12, fontWeight:800, background:'rgba(99,102,241,.15)', border:'1px solid rgba(99,102,241,.3)', borderRadius:6, color:'#a5b4fc', padding:'4px 8px', cursor:'pointer' }}>
              {(reportingProducts.length ? reportingProducts.map(p=>({ key:p.product_id, label:p.name })) : PRODUCT_REGISTRY.filter(p=>!p.isTenant && ['live','available','building'].includes(p.lifecycleStage)).map(p=>({key:p.key,label:p.label})))
                .filter((p,i,a)=>a.findIndex(x=>x.key===p.key)===i)
                .map(p=><option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <span style={{ fontSize:11, fontWeight:700, color:'#475569', marginLeft:8 }}>Account:</span>
            <select value={crmAccount} onChange={e=>setCrmAccount(e.target.value)}
              style={{ fontSize:12, fontWeight:700, background:'rgba(99,102,241,.15)',
                border:'1px solid rgba(99,102,241,.3)', borderRadius:6, color:'#e2e8f0',
                padding:'4px 8px', cursor:'pointer' }}>
              <option value="all">All {selectedProduct.label} Offices</option>
              {crmTenants.map(t=>(
                <option key={t.id} value={t.id}>{t.firm_name}</option>
              ))}
            </select>
            {activeTenant && (
              <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20,
                background: activeTenant.status==='active'?'rgba(16,185,129,.15)':'rgba(245,158,11,.15)',
                color: activeTenant.status==='active'?'#10b981':'#f59e0b' }}>
                {activeTenant.status} · {activeTenant.tenant_code}
              </span>
            )}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:24 }}>
            {(activeTenant ? [
              { label:`Clients — ${activeTenant.firm_name}`, value:String(metricValue('client_count','active_clients','—')), icon:'🏢', color:'#10b981' },
              { label:`Leads — ${activeTenant.firm_name}`, value:String(metricValue('lead_count','active_leads','—')), icon:'👤', color:'#a855f7' },
              { label:`Seats — ${activeTenant.firm_name}`, value:String(metricValue('employee_count','active_staff','—')), icon:'👥', color:'#6366f1' },
              { label:`Jobs / Cases — ${activeTenant.firm_name}`, value:String(metricValue('cases_count','open_jobs','—')), icon:'📁', color:'#6366f1' },
              { label:`Pending Tasks — ${activeTenant.firm_name}`, value:String(metricValue('tasks_count','pending_tasks','—')), icon:'✅', color:'#0ea5e9' },
              { label:`Outstanding — ${activeTenant.firm_name}`, value:String(metricValue('transactions_count','outstanding_invoices','—')), icon:'💳', color:'#f59e0b' },
            ] : crmProduct !== 'taxres_crm' ? [
              { label:`Active Clients — ${selectedProduct.label}`, value:String(productMetrics.active_clients ?? '—'), icon:'🏢', color:'#10b981' },
              { label:`Active Leads — ${selectedProduct.label}`, value:String(productMetrics.active_leads ?? '—'), icon:'👤', color:'#a855f7' },
              { label:`Active Staff — ${selectedProduct.label}`, value:String(productMetrics.active_staff ?? '—'), icon:'👥', color:'#6366f1' },
              { label:`Active Offices — ${selectedProduct.label}`, value:String(productMetrics.active_offices ?? crmTenants.length), icon:'📁', color:'#6366f1' },
              { label:`Open Jobs — ${selectedProduct.label}`, value:String(productMetrics.open_jobs ?? productMetrics.pending_tasks ?? '—'), icon:'✅', color:'#0ea5e9' },
              { label:`MRR — ${selectedProduct.label}`, value:productMetrics.mrr != null ? `$${Number(productMetrics.mrr).toLocaleString()}` : '—', icon:'💳', color:'#f59e0b' },
            ] : [
              { label:'Total Clients — TaxRes Offices', value:data.kpis.totalClients.toLocaleString(), icon:'🏢', color:'#10b981' },
              { label:'Total Leads — TaxRes Offices', value:data.kpis.totalLeads.toLocaleString(), icon:'👤', color:'#a855f7' },
              { label:'Total Seats — TaxRes Offices', value:data.kpis.totalSeats, icon:'👥', color:'#6366f1' },
              { label:'Pending E-Signs', value:data.kpis.pendingEsigns, icon:'✍️', color:'#8b5cf6' },
              { label:'Demos Today', value:data.kpis.todayDemos, icon:'📅', color:'#0ea5e9' },
              { label:'File Storage', value:`${realMB} MB · ${realObjs} files`, icon:'💾', color:'#f59e0b' },
            ]).map(k => <KPICard key={k.label} {...k} />)}
            {crmRemoteLoading && <div style={{gridColumn:'1/-1',fontSize:12,color:'#64748b'}}>Loading {selectedProduct.label} offices…</div>}
            {crmRemoteError && <div style={{gridColumn:'1/-1',fontSize:12,color:'#fca5a5'}}>CRM metrics: {crmRemoteError}</div>}
          </div>
          </>)
          })()}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
            <div style={CC.card({padding:'22px 24px'})}>
              <div style={CC.sectionLabel}>Upcoming demos</div>
              {data.upcomingDemos.length===0
                ? <div style={{ fontSize:13, color:'#475569' }}>No TaxRes demos scheduled.</div>
                : data.upcomingDemos.map((e,i) => (
                <div key={i} style={{ display:'flex', gap:10, padding:'9px 0',
                  borderBottom: i<data.upcomingDemos.length-1?'1px solid rgba(99,102,241,.1)':'none' }}>
                  <div style={{ fontSize:11, color:'#6366f1', fontWeight:700, width:60, flexShrink:0 }}>
                    {new Date(e.start).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                  </div>
                  <div>
                    {(() => { const badge = parseEventBadge(e.title); return badge ? (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, background:badge.bg, color:badge.text, fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:3, marginBottom:2, textTransform:'uppercase', letterSpacing:'.04em' }}>
                         {badge.logo && <img src={badge.logo} alt="" aria-hidden="true" style={{ width:14, height:14, objectFit:'contain', borderRadius:3 }} />}
                         {badge.label}
                       </span>
                    ) : null })()}
                    <div style={{ fontSize:13, color:'#e2e8f0' }}>{(e.title||'Demo').replace(/^\[[^\]]+\]\s*/,'')}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={CC.card({padding:'22px 24px'})}>
              <div style={CC.sectionLabel}>IRS deadlines this week</div>
              {data.upcomingDl.length===0
                ? <div style={{ fontSize:13, color:'#10b981' }}>✅ No urgent deadlines</div>
                : data.upcomingDl.map((d,i) => {
                  const days = Math.ceil((new Date(d.dueDate)-new Date())/86400000)
                  return (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'9px 0',
                      borderBottom: i<data.upcomingDl.length-1?'1px solid rgba(99,102,241,.1)':'none' }}>
                      <div style={{ fontSize:13, color:'#e2e8f0' }}>{d.title}</div>
                      <span style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20,
                        background:days<=3?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)',
                        color:days<=3?'#ef4444':'#f59e0b' }}>
                        {days<=0?'TODAY':days===1?'TOMORROW':`${days}d`}
                      </span>
                    </div>
                  )
                })}
            </div>
          </div>
        </>)}

        {/* ═══ GOALS TAB ═══ */}
        {tab==='goals' && (<>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
            <div style={CC.card({padding:'26px 28px'})}>
              <div style={CC.sectionLabel}>2026 Business goals</div>
              {data.goals.map(g => <GoalBar key={g.label} {...g} />)}
            </div>
            <div style={CC.card({padding:'26px 28px'})}>
              <div style={CC.sectionLabel}>Pace check</div>
              {data.goals.map(g => {
                const pct = Math.min(100,Math.round((g.current/g.target)*100))
                const now = new Date()
                const dayOfYear = Math.floor((now-new Date(now.getFullYear(),0,0))/86400000)
                const yearPct = Math.round(dayOfYear/365*100)
                const ahead = pct >= yearPct
                return (
                  <div key={g.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'12px 0', borderBottom:'1px solid rgba(99,102,241,.1)' }}>
                    <div style={{ fontSize:13, color:'#e2e8f0', fontWeight:600 }}>{g.label}</div>
                    <span style={{ fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20,
                      background: ahead?'rgba(16,185,129,.15)':'rgba(245,158,11,.15)',
                      color: ahead?'#10b981':'#f59e0b' }}>
                      {ahead ? '✓ On pace' : '⚠ Behind pace'}
                    </span>
                  </div>
                )
              })}
              <div style={{ fontSize:11, color:'#475569', marginTop:16 }}>
                Pace based on {Math.round((new Date()-new Date(new Date().getFullYear(),0,0))/86400000)} days elapsed in 2026.
              </div>
            </div>
          </div>
        </>)}

        {/* ═══ SYSTEM TAB ═══ */}
        {tab==='system' && (<>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18, marginBottom:18 }}>
            <div style={CC.card({padding:'22px 24px'})}>
              <div style={CC.sectionLabel}>Service status</div>
              {(()=>{
                const checks = [
                  { label:'Supabase DB',          ok: sysStatus?.dbOk ?? null },
                  { label:'Email (Stalwart)',      ok: sysStatus?.mailOk ?? null },
                  { label:'taxrescrm.net',         ok: sysStatus?.netOk ?? null },
                  { label:'taxrescrm.app',         ok: sysStatus?.appOk ?? null },
                  { label:'GA4 · TaxRes (G-M6J80B65LG)',   ok: true },
                  { label:'GA4 · RomyLabs (G-2MSNYF9XBE)', ok: true },
                  { label:'Clarity · TaxRes (xyck7g2mfl)',  ok: true },
                  { label:'Clarity · RomyLabs (y54zqoj6c2)',ok: true },
                  { label:'Google Search Console', ok: gscConnected ? true : null },
                  { label:'Bing Webmaster',        ok: bingConnected ? true : null },
                ]
                return checks.map((s,i)=>(
                  <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                    padding:'11px 0', borderBottom: i<checks.length-1?'1px solid rgba(99,102,241,.1)':'none' }}>
                    <div style={{ fontSize:13, color:'#e2e8f0' }}>{s.label}</div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <StatusDot ok={s.ok} />
                      <span style={{ fontSize:11, fontWeight:600, color: s.ok===null?'#475569':s.ok?'#10b981':'#ef4444' }}>
                        {s.ok===null ? (sysStatus===null?'Checking…':'Not connected') : s.ok?'Operational':'Down'}
                      </span>
                    </div>
                  </div>
                ))
              })()}
            </div>

            <div style={CC.card({padding:'22px 24px'})}>
              <div style={CC.sectionLabel}>Connect APIs</div>
              {[
                { label:'GA4 · TaxRes',          key:'ga4',     status: 'connected · G-M6J80B65LG', color: '#10b981' },
                { label:'GA4 · RomyLabs',         key:'ga4rl',   status: 'connected · G-2MSNYF9XBE', color: '#10b981' },
                { label:'Google Search Console', key:'gsc',     status: gscConnected ? 'connected' : 'not connected', color: gscConnected ? '#10b981' : '#f59e0b' },
                { label:'Clarity · TaxRes',       key:'clarity', status:'connected · xyck7g2mfl', color:'#10b981' },
                { label:'Clarity · RomyLabs',     key:'claritrl',status:'connected · y54zqoj6c2', color:'#10b981' },
                { label:'Bing Webmaster',        key:'bing',    status: bingConnected ? 'connected' : 'not connected', color: bingConnected ? '#10b981' : '#64748b' },
              ].map((api,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'11px 0', borderBottom: i<3?'1px solid rgba(99,102,241,.1)':'none' }}>
                  <div>
                    <div style={{ fontSize:13, color:'#e2e8f0', fontWeight:600 }}>{api.label}</div>
                    <div style={{ fontSize:10, color:api.color, fontWeight:600, textTransform:'uppercase', marginTop:2 }}>{api.status}</div>
                  </div>
                  <button onClick={()=>{
                    if(api.key==='gsc') handleGSCConnect()
                    else if(api.key==='ga4') alert('GA4 TaxRes: G-M6J80B65LG — connected')
                    else if(api.key==='ga4rl') alert('GA4 RomyLabs: G-2MSNYF9XBE — connected')
                    else if(api.key==='bing') alert('Bing: Send your API key to connect')
                    else if(api.key==='clarity') alert('Clarity TaxRes: xyck7g2mfl — connected')
                    else if(api.key==='claritrl') alert('Clarity RomyLabs: y54zqoj6c2 — connected')
                  }} style={{ ...S.btn('ghost'), fontSize:11, padding:'5px 14px' }}>Connect</button>
                </div>
              ))}
              <div style={{ fontSize:11, color:'#475569', marginTop:14 }}>
                API keys are stored in Supabase Vault — never visible after saving.
              </div>
            </div>
          </div>

          <div style={{ ...CC.card(), padding:'20px 24px', background:'rgba(16,185,129,.04)', border:'1px solid rgba(16,185,129,.15)' }}>
            <div style={{ fontSize:13, color:'#10b981', fontWeight:700, marginBottom:6 }}>Daily Executive Email</div>
            <div style={{ fontSize:12, color:'#475569', marginBottom:14 }}>
              A morning briefing is sent to romy@taxrescrm.net every day at 7:00 AM ET with platform stats, upcoming calendar events, and MRR.
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:20,
                background:'rgba(16,185,129,.15)', color:'#10b981' }}>✅ Active</span>
              <button onClick={async()=>{
                const {error} = await supabase.functions.invoke('daily-briefing',{body:{}})
                alert(error ? 'Error: '+error.message : 'Test briefing sent to romy@taxrescrm.net')
              }} style={{ ...S.btn('ghost'), fontSize:11, padding:'4px 12px' }}>Send Test</button>
            </div>
          </div>
        </>)}

        {tab==='products' && <ProductsTab supabase={supabase} taxresActivity={activity} />}

        {tab==='linkedin' && (
          <div style={{ marginTop:0 }}>
            <LinkedInPublisher embeddedMode />
          </div>
        )}

        {tab==='support' && <SupportCenterTab supabase={supabase} />}

        {tab==='content' && (
          <div style={{ marginTop:0 }}>
            <ContentCenter embeddedMode />
          </div>
        )}

      </div>
    </div>
  )
}
const CONTENT_LABELS = {
  linkedin:     { label:'LinkedIn Post',      icon:'💼', color:'#0ea5e9' },
  article_idea: { label:'Article Idea',       icon:'📝', color:'#6366f1' },
  email:        { label:'Email Newsletter',   icon:'📧', color:'#10b981' },
  edu_tip:      { label:'Education Tip',      icon:'💡', color:'#f59e0b' },
  outreach:     { label:'Outreach Message',   icon:'📨', color:'#8b5cf6' },
}
const STATUS_COLORS = {
  draft:     '#475569',
  approved:  '#10b981',
  scheduled: '#6366f1',
  published: '#0ea5e9',
  archived:  '#334155',
}
const GENERATION_STEPS = [
  { key:'linkedin',     label:'LinkedIn Post',       icon:'💼' },
  { key:'article_idea', label:'Resource Article Idea',icon:'📝' },
  { key:'email',        label:'Email Newsletter',    icon:'📧' },
  { key:'edu_tip',      label:'Education Tip',       icon:'💡' },
  { key:'outreach_1',   label:'Outreach Message 1',  icon:'📨' },
  { key:'outreach_2',   label:'Outreach Message 2',  icon:'📨' },
  { key:'outreach_3',   label:'Outreach Message 3',  icon:'📨' },
]

// ── SupportCenterTab ──────────────────────────────────────────────────────────
// Registry-driven: reads product labels from list_all_product_tickets().
// Automatically shows new products without UI changes when they're support-enabled.
function SupportCenterTab({ supabase }) {
  const [tickets, setTickets]       = useState(null)
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('all')       // product_id or 'all'
  const [statusFilter, setStatus]   = useState('all')       // 'Open'|'In Progress'|'Resolved'|'all'
  const [selected, setSelected]     = useState(null)        // selected ticket id
  const [thread, setThread]         = useState(null)
  const [reply, setReply]           = useState('')
  const [replying, setReplying]     = useState(false)
  const [internalNote, setNote]     = useState('')
  const [addingNote, setAddingNote] = useState(false)

  // Badge colors — keyed to ticket_prefix for registry-agnostic rendering
  const PREFIX_COLORS = {
    TAX: { bg:'#1e3a5f', text:'#60a5fa' },
    CAM: { bg:'#0b2748', text:'#55B96A' },
    ARC: { bg:'#1a0a2e', text:'#a78bfa' },
    BOC: { bg:'#1a2e1a', text:'#34d399' },
  }
  function badgeStyle(ticketNumber) {
    const prefix = (ticketNumber || '').split('-')[0]
    const colors = PREFIX_COLORS[prefix] || { bg:'#1e293b', text:'#94a3b8' }
    return { display:'inline-block', background:colors.bg, color:colors.text,
             fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4,
             letterSpacing:'.05em', marginRight:6 }
  }

  async function load() {
    setLoading(true)
    const { data } = await supabase.rpc('list_all_product_tickets', {
      p_product_id: filter === 'all' ? null : filter,
      p_status: statusFilter === 'all' ? null : statusFilter,
      p_limit: 100,
    })
    setTickets(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter, statusFilter])

  async function openTicket(t) {
    setSelected(t)
    setThread(null)
    setReply('')
    setNote('')
    const { data } = await supabase.rpc('get_ticket_thread', { p_ticket_id: t.id })
    setThread(data || [])
  }

  async function sendReply() {
    if (!reply.trim() || !selected) return
    setReplying(true)
    await supabase.rpc('add_ticket_message_typed', {
      p_ticket_id: selected.id,
      p_sender: 'romy',
      p_message: reply.trim(),
      p_internal: false,
    })
    setReply('')
    setReplying(false)
    openTicket(selected)
    load()
  }

  async function sendInternalNote() {
    if (!internalNote.trim() || !selected) return
    setAddingNote(true)
    await supabase.rpc('add_ticket_message_typed', {
      p_ticket_id: selected.id,
      p_sender: 'romy',
      p_message: internalNote.trim(),
      p_internal: true,
    })
    setNote('')
    setAddingNote(false)
    openTicket(selected)
  }

  async function changeStatus(status) {
    if (!selected) return
    // update_ticket_status() is tenant-scoped and won't update non-TaxRes tickets
    // (those have tenant_id=NULL). Use direct table update with platform admin check.
    await supabase
      .from('support_tickets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', selected.id)
    setSelected(s => ({ ...s, status }))
    load()
  }

  // Derive unique products from loaded tickets for the filter bar
  const products = tickets
    ? [...new Map(tickets.map(t => [t.product_id, { id:t.product_id, label:t.product_label }])).values()]
    : []

  const STATUS_COLOR = { 'Open':'#ef4444', 'In Progress':'#f59e0b', 'Resolved':'#22c55e' }

  const S2 = {
    card:   { background:'#1e293b', border:'1px solid #334155', borderRadius:10 },
    input:  { background:'#0f172a', border:'1px solid #334155', borderRadius:8,
               color:'#f1f5f9', padding:'9px 12px', fontSize:13, width:'100%',
               boxSizing:'border-box' },
    btn: (v) => v === 'primary'
      ? { background:'#6366f1', color:'#fff', border:'none', borderRadius:8,
          padding:'9px 18px', fontSize:13, fontWeight:700, cursor:'pointer' }
      : { background:'transparent', color:'#94a3b8', border:'1px solid #334155',
          borderRadius:8, padding:'7px 14px', fontSize:12, cursor:'pointer' },
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 420px', gap:20, alignItems:'start' }}>

      {/* ── Ticket list ── */}
      <div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <div style={{ fontSize:17, fontWeight:800, color:'#fff' }}>🎫 Support Center</div>
          <div style={{ display:'flex', gap:8 }}>
            <select value={statusFilter} onChange={e=>setStatus(e.target.value)}
              style={{ ...S2.input, width:'auto', padding:'6px 10px', fontSize:12 }}>
              <option value="all">All Statuses</option>
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
            </select>
            <select value={filter} onChange={e=>setFilter(e.target.value)}
              style={{ ...S2.input, width:'auto', padding:'6px 10px', fontSize:12 }}>
              <option value="all">All Products</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <button onClick={load} style={S2.btn('ghost')}>↻</button>
          </div>
        </div>

        <div style={S2.card}>
          {loading ? (
            <div style={{ padding:24, textAlign:'center', color:'#475569' }}>Loading…</div>
          ) : !tickets || tickets.length === 0 ? (
            <div style={{ padding:24, textAlign:'center', color:'#475569', fontSize:13 }}>
              No tickets match these filters.
            </div>
          ) : tickets.map(t => (
            <div key={t.id}
              onClick={() => openTicket(t)}
              style={{ padding:'12px 18px', borderBottom:'1px solid #1e293b',
                cursor:'pointer', background: selected?.id === t.id ? 'rgba(99,102,241,.1)' : 'transparent',
                transition:'background .1s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                {t.ticket_number && (
                  <span style={badgeStyle(t.ticket_number)}>{t.ticket_number}</span>
                )}
                <span style={{ fontSize:11, padding:'2px 8px', borderRadius:12, fontWeight:700,
                  background: STATUS_COLOR[t.status] + '22',
                  color: STATUS_COLOR[t.status] || '#94a3b8' }}>{t.status}</span>
                {t.needs_reply && (
                  <span style={{ fontSize:10, padding:'2px 7px', borderRadius:12, fontWeight:700,
                    background:'#ef444422', color:'#ef4444' }}>Needs Reply</span>
                )}
                <span style={{ fontSize:11, color:'#475569', marginLeft:'auto' }}>
                  {t.product_label}
                </span>
              </div>
              <div style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{t.subject}</div>
              <div style={{ fontSize:11, color:'#475569', marginTop:2 }}>
                {t.display_customer || t.submitted_by_email}
                {' · '}
                {t.category} · {t.priority}
                {t.message_count > 0 && ` · ${t.message_count} message${t.message_count > 1 ? 's' : ''}`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Ticket thread ── */}
      {selected ? (
        <div style={{ position:'sticky', top:0 }}>
          <div style={{ ...S2.card, padding:20, marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
              {selected.ticket_number && <span style={badgeStyle(selected.ticket_number)}>{selected.ticket_number}</span>}
              <span style={{ fontSize:11, padding:'2px 8px', borderRadius:12, fontWeight:700,
                background: STATUS_COLOR[selected.status] + '22',
                color: STATUS_COLOR[selected.status] || '#94a3b8' }}>{selected.status}</span>
              <span style={{ fontSize:11, color:'#475569', marginLeft:'auto' }}>{selected.product_label}</span>
            </div>
            <div style={{ fontSize:14, fontWeight:700, color:'#f1f5f9', marginBottom:4 }}>{selected.subject}</div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:12 }}>
              {selected.display_customer || selected.submitted_by_email}
              {' · '}{selected.category}{' · '}{selected.priority}
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {['Open','In Progress','Resolved'].map(s => (
                <button key={s} onClick={() => changeStatus(s)} style={{
                  ...S2.btn(s === selected.status ? 'primary' : 'ghost'),
                  fontSize:11, padding:'5px 12px' }}>{s}</button>
              ))}
            </div>
          </div>

          {/* Thread */}
          <div style={{ ...S2.card, padding:0, marginBottom:12, maxHeight:320, overflowY:'auto' }}>
            {thread === null ? (
              <div style={{ padding:16, color:'#475569', fontSize:13 }}>Loading thread…</div>
            ) : thread.length === 0 ? (
              <div style={{ padding:16, color:'#475569', fontSize:13 }}>No messages yet.</div>
            ) : thread.filter(m => m.id).map(m => (
              <div key={m.id} style={{ padding:'10px 16px', borderBottom:'1px solid #1e293b' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  <span style={{ fontSize:11, fontWeight:700,
                    color: m.is_internal ? '#f59e0b'
                         : m.sender === 'customer' ? '#60a5fa' : '#a78bfa' }}>
                    {m.is_internal ? '🔒 Internal' : m.sender === 'customer' ? '👤 Customer' : '🛠 Staff'}
                  </span>
                  <span style={{ fontSize:10, color:'#475569', marginLeft:'auto' }}>
                    {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
                  </span>
                </div>
                {m.message ? (
                  <div style={{ fontSize:13, color: m.is_internal ? '#fbbf24' : '#e2e8f0',
                    fontStyle: m.is_internal ? 'italic' : 'normal', lineHeight:1.5 }}>
                    {m.message}
                  </div>
                ) : (
                  <div style={{ fontSize:12, color:'#475569', fontStyle:'italic' }}>
                    [internal note — not visible to customer]
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Reply */}
          <div style={{ ...S2.card, padding:14, marginBottom:8 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#6366f1', marginBottom:6 }}>Reply to Customer</div>
            <textarea style={{ ...S2.input, resize:'vertical' }} rows={3}
              placeholder="Type your reply…"
              value={reply} onChange={e => setReply(e.target.value)} />
            <button onClick={sendReply} disabled={replying || !reply.trim()}
              style={{ ...S2.btn('primary'), marginTop:8, width:'100%',
                opacity: replying || !reply.trim() ? 0.5 : 1 }}>
              {replying ? 'Sending…' : 'Send Reply'}
            </button>
          </div>

          {/* Internal Note */}
          <div style={{ ...S2.card, padding:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#f59e0b', marginBottom:6 }}>🔒 Internal Note</div>
            <textarea style={{ ...S2.input, resize:'vertical', borderColor:'#78350f' }} rows={2}
              placeholder="Private note — never visible to customer…"
              value={internalNote} onChange={e => setNote(e.target.value)} />
            <button onClick={sendInternalNote} disabled={addingNote || !internalNote.trim()}
              style={{ ...S2.btn('ghost'), marginTop:8, width:'100%', color:'#f59e0b',
                borderColor:'#78350f', opacity: addingNote || !internalNote.trim() ? 0.5 : 1 }}>
              {addingNote ? 'Saving…' : 'Save Internal Note'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ ...S2.card, padding:32, textAlign:'center', color:'#475569' }}>
          <div style={{ fontSize:28, marginBottom:8 }}>🎫</div>
          <div style={{ fontSize:13 }}>Select a ticket to view the thread.</div>
        </div>
      )}
    </div>
  )
}


function ContentCenter({ embeddedMode = false }) {
  const [drafts, setDrafts]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [genSteps, setGenSteps]       = useState(null)  // null=idle, array=generating
  const [filter, setFilter]           = useState('all')
  const [weekFilter, setWeekFilter]   = useState('all')
  const [selected, setSelected]       = useState(null)
  const [editing, setEditing]         = useState(false)
  const [editBody, setEditBody]       = useState('')
  const [saving, setSaving]           = useState(false)
  const [regenId, setRegenId]         = useState(null)
  const [toast, setToast]             = useState(null)
  const [useCrmData, setUseCrmData]   = useState(true)
  const [scores, setScores]           = useState({})

  function showToast(msg, ok=true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function loadDrafts() {
    setLoading(true)
    let data = []
    try { const r = await supabase.rpc('get_content_drafts', { p_limit: 200 }); data = r.data || [] } catch(_) { data = [] }
    setDrafts(data || [])
    setLoading(false)
  }

  useEffect(() => { loadDrafts() }, [])

  // Simulate step-by-step progress during generation
  async function generate(force=false) {
    // Start progress animation
    setGenSteps(GENERATION_STEPS.map(s => ({ ...s, status:'pending' })))
    let stepIdx = 0

    const timer = setInterval(() => {
      setGenSteps(prev => {
        if (!prev) return prev
        const next = [...prev]
        // Complete current, start next
        if (stepIdx > 0) next[stepIdx-1] = { ...next[stepIdx-1], status:'done' }
        if (stepIdx < next.length) next[stepIdx] = { ...next[stepIdx], status:'active' }
        stepIdx++
        if (stepIdx > next.length) clearInterval(timer)
        return next
      })
    }, 3500)

    try {
      const { data, error } = await supabase.functions.invoke('content-generator', {
        body: { useCrmData },
        headers: force ? { 'x-force-regenerate': 'true' } : {}
      })
      clearInterval(timer)
      // Mark all done
      setGenSteps(GENERATION_STEPS.map(s => ({ ...s, status:'done' })))
      await loadDrafts()
      setTimeout(() => setGenSteps(null), 1200)
      showToast(data?.message === 'Already generated this week'
        ? 'Already generated this week. Use ↺ to overwrite.'
        : `Content pack ready — ${data?.drafts || 7} drafts created`)
    } catch(e) {
      clearInterval(timer)
      setGenSteps(null)
      showToast('Generation failed: ' + String(e), false)
    }
  }

  // Regenerate a single draft
  async function regenerateOne(draft) {
    setRegenId(draft.id)
    try {
      const { data, error } = await supabase.functions.invoke('content-generator', {
        body: { useCrmData, regenerateType: draft.content_type, regenerateId: draft.id }
      })
      if (error) throw error
      await loadDrafts()
      showToast('Regenerated ✓')
    } catch(e) {
      showToast('Regeneration failed: ' + String(e), false)
    }
    setRegenId(null)
  }

  async function updateStatus(id, status) {
    await supabase.rpc('update_content_status', { p_id: id, p_status: status, p_actor: 'romy@taxrescrm.net' })
    setDrafts(prev => prev.map(d => d.id===id ? {...d, status} : d))
    if (selected?.id === id) setSelected(s => ({...s, status}))
    showToast(status==='approved'?'Approved ✓':status==='archived'?'Archived':status==='published'?'Marked published':'Updated')
  }

  async function deleteDraft(id) {
    await supabase.from('content_drafts').delete().eq('id', id)
    setDrafts(prev => prev.filter(d => d.id !== id))
    if (selected?.id === id) setSelected(null)
    showToast('Deleted')
  }

  async function saveEdit() {
    if (!selected) return
    setSaving(true)
    await supabase.rpc('save_content_draft', { p_id: selected.id, p_title: selected.title, p_body: editBody })
    setDrafts(prev => prev.map(d => d.id===selected.id ? {...d, body: editBody} : d))
    setSelected(s => ({...s, body: editBody}))
    setEditing(false)
    setSaving(false)
    showToast('Saved')
  }

  // Generate content score for a draft (once, cached)
  async function scoreContent(draft) {
    if (scores[draft.id]) return
    const { data } = await supabase.functions.invoke('content-generator', {
      body: { scoreOnly: true, body: draft.body, contentType: draft.content_type }
    })
    if (data?.scores) setScores(prev => ({ ...prev, [draft.id]: data.scores }))
  }

  useEffect(() => {
    if (selected && !scores[selected.id]) scoreContent(selected)
  }, [selected])

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'))
  }

  const filtered = drafts.filter(d => {
    if (filter !== 'all' && d.status !== filter) return false
    if (weekFilter !== 'all' && d.week_of !== weekFilter) return false
    return true
  })
  const weekGroups = filtered.reduce((acc, d) => {
    const w = d.week_of
    if (!acc[w]) acc[w] = []
    acc[w].push(d)
    return acc
  }, {})
  const allWeeks = [...new Set(drafts.map(d => d.week_of))].sort((a,b) => b.localeCompare(a))

  const CC = { card: { background:'rgba(255,255,255,.04)', border:'1px solid rgba(99,102,241,.18)', borderRadius:12 } }

  function StarRating({ n }) {
    return (
      <span>
        {[1,2,3,4,5].map(i => (
          <span key={i} style={{ color: i<=n ? '#f59e0b' : '#334155', fontSize:12 }}>★</span>
        ))}
      </span>
    )
  }

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', background:'#0a0918' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', top:20, right:20, zIndex:9999, padding:'10px 18px', borderRadius:8,
          background: toast.ok ? 'rgba(16,185,129,.9)' : 'rgba(239,68,68,.9)',
          color:'#fff', fontSize:13, fontWeight:600, boxShadow:'0 4px 20px rgba(0,0,0,.4)' }}>
          {toast.msg}
        </div>
      )}

      {/* Generation progress overlay */}
      {genSteps && (
        <div style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(10,9,24,.85)',
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ ...CC.card, padding:'32px 40px', minWidth:340 }}>
            <div style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:6 }}>Creating Content Pack</div>
            <div style={{ fontSize:12, color:'#475569', marginBottom:24 }}>Generating with TaxRes CRM brand voice…</div>
            {genSteps.map((step, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
                <div style={{ width:22, textAlign:'center', fontSize:14 }}>
                  {step.status==='done'   ? '✅' :
                   step.status==='active' ? <span style={{ animation:'spin 1s linear infinite', display:'inline-block' }}>⟳</span> :
                   '⏳'}
                </div>
                <div style={{ fontSize:13, color: step.status==='done'?'#10b981':step.status==='active'?'#e2e8f0':'#475569',
                  fontWeight: step.status==='active' ? 700 : 400 }}>
                  {step.icon} {step.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Left: list panel */}
      <div style={{ width:300, borderRight:'1px solid rgba(99,102,241,.15)', overflowY:'auto', padding:'24px 0', flexShrink:0 }}>

        <div style={{ padding:'0 20px 16px' }}>
          <div style={{ fontSize:18, fontWeight:900, color:'#fff', marginBottom:2 }}>✍️ Content Center</div>
          <div style={{ fontSize:11, color:'#475569' }}>Approve drafts before publishing</div>
        </div>

        {/* Generate button */}
        <div style={{ padding:'0 20px 12px', display:'flex', gap:8 }}>
          <button onClick={() => generate(false)} disabled={!!genSteps} style={{
            flex:1, padding:'9px 0', borderRadius:8, border:'none', cursor:'pointer',
            background: genSteps ? 'rgba(99,102,241,.3)' : 'rgba(99,102,241,.85)',
            color:'#fff', fontWeight:700, fontSize:12,
          }}>✨ Create Content Pack</button>
          <button onClick={() => generate(true)} disabled={!!genSteps} title="Force regenerate this week"
            style={{ padding:'9px 12px', borderRadius:8, border:'1px solid rgba(99,102,241,.3)',
              background:'transparent', color:'#6366f1', cursor:'pointer', fontSize:12 }}>↺</button>
        </div>

        {/* CRM data toggle */}
        <div style={{ padding:'0 20px 16px', display:'flex', alignItems:'center', gap:8 }}>
          <div onClick={() => setUseCrmData(v=>!v)} style={{ width:32, height:18, borderRadius:9, cursor:'pointer',
            background: useCrmData ? '#6366f1' : '#334155', position:'relative', transition:'background .2s', flexShrink:0 }}>
            <div style={{ position:'absolute', top:2, left: useCrmData?14:2, width:14, height:14,
              borderRadius:'50%', background:'#fff', transition:'left .2s' }} />
          </div>
          <span style={{ fontSize:11, color: useCrmData ? '#a5b4fc' : '#475569' }}>
            Use recent CRM activity
          </span>
        </div>

        {/* Filters */}
        <div style={{ padding:'0 20px 8px', display:'flex', gap:3, flexWrap:'wrap' }}>
          {['all','draft','approved','published','archived'].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding:'3px 9px', borderRadius:20, border:'none', cursor:'pointer', fontSize:11, fontWeight:600,
              background: filter===s ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.05)',
              color: filter===s ? '#a5b4fc' : '#64748b',
            }}>{s==='all'?'All':s.charAt(0).toUpperCase()+s.slice(1)}</button>
          ))}
        </div>

        {/* Week filter (content history) */}
        {allWeeks.length > 1 && (
          <div style={{ padding:'4px 20px 12px' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#334155', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>
              History
            </div>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
              <button onClick={() => setWeekFilter('all')} style={{
                padding:'3px 9px', borderRadius:20, border:'none', cursor:'pointer', fontSize:10, fontWeight:600,
                background: weekFilter==='all' ? 'rgba(99,102,241,.3)' : 'rgba(255,255,255,.04)',
                color: weekFilter==='all' ? '#a5b4fc' : '#475569',
              }}>All weeks</button>
              {allWeeks.map(w => (
                <button key={w} onClick={() => setWeekFilter(w)} style={{
                  padding:'3px 9px', borderRadius:20, border:'none', cursor:'pointer', fontSize:10, fontWeight:600,
                  background: weekFilter===w ? 'rgba(99,102,241,.3)' : 'rgba(255,255,255,.04)',
                  color: weekFilter===w ? '#a5b4fc' : '#475569',
                }}>{new Date(w+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</button>
              ))}
            </div>
          </div>
        )}

        {/* Draft list */}
        {loading ? (
          <div style={{ padding:'20px', color:'#475569', fontSize:13 }}>Loading…</div>
        ) : Object.keys(weekGroups).length === 0 ? (
          <div style={{ padding:'20px', color:'#475569', fontSize:13 }}>
            No drafts yet. Click "✨ Create Content Pack" to generate this week's content.
          </div>
        ) : Object.entries(weekGroups).sort((a,b) => b[0].localeCompare(a[0])).map(([week, items]) => (
          <div key={week}>
            <div style={{ padding:'6px 20px', fontSize:9, fontWeight:800, color:'#334155',
              textTransform:'uppercase', letterSpacing:'.08em', background:'rgba(255,255,255,.015)' }}>
              Week of {new Date(week+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
            </div>
            {items.map((d) => {
              const meta = CONTENT_LABELS[d.content_type] || { label:d.content_type, icon:'📄', color:'#64748b' }
              const isSel = selected?.id === d.id
              return (
                <div key={d.id} onClick={() => { setSelected(d); setEditing(false); setEditBody(d.body) }}
                  style={{ padding:'10px 20px', cursor:'pointer',
                    borderLeft: isSel ? '2px solid #6366f1' : '2px solid transparent',
                    background: isSel ? 'rgba(99,102,241,.1)' : 'transparent',
                    borderBottom:'1px solid rgba(99,102,241,.06)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                    <span style={{ fontSize:13 }}>{meta.icon}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:'#e2e8f0' }}>{meta.label}</span>
                    <span style={{ marginLeft:'auto', fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20,
                      background:`${STATUS_COLORS[d.status]}18`, color:STATUS_COLORS[d.status] }}>
                      {d.status}
                    </span>
                  </div>
                  <div style={{ fontSize:10, color:'#475569', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {d.title}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Right: detail panel */}
      <div style={{ flex:1, overflowY:'auto', padding:'28px 32px' }}>
        {!selected ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:12 }}>
            <div style={{ fontSize:40 }}>✍️</div>
            <div style={{ fontSize:15, color:'#475569' }}>Select a draft to review</div>
            <div style={{ fontSize:12, color:'#334155' }}>or click "✨ Create Content Pack" to generate</div>
          </div>
        ) : (
          <div style={{ maxWidth:780 }}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:16 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color: CONTENT_LABELS[selected.content_type]?.color || '#64748b',
                  textTransform:'uppercase', letterSpacing:'.08em', marginBottom:4 }}>
                  {CONTENT_LABELS[selected.content_type]?.icon} {CONTENT_LABELS[selected.content_type]?.label}
                </div>
                <div style={{ fontSize:20, fontWeight:800, color:'#fff', marginBottom:4 }}>{selected.title}</div>
                <div style={{ fontSize:11, color:'#475569' }}>
                  Status: <span style={{ color:STATUS_COLORS[selected.status], fontWeight:700 }}>{selected.status}</span>
                  {selected.approved_by && ` · Approved by ${selected.approved_by}`}
                  {selected.published_at && ` · Published ${new Date(selected.published_at).toLocaleDateString()}`}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display:'flex', gap:6, flexShrink:0, flexWrap:'wrap', justifyContent:'flex-end' }}>
                <button onClick={() => copyToClipboard(selected.body)} style={{ ...S.btn('ghost'), fontSize:11, padding:'6px 12px' }}>Copy</button>
                {!editing && <button onClick={() => { setEditing(true); setEditBody(selected.body) }} style={{ ...S.btn('ghost'), fontSize:11, padding:'6px 12px' }}>Edit</button>}
                {editing && <>
                  <button onClick={() => setEditing(false)} style={{ ...S.btn('ghost'), fontSize:11, padding:'6px 12px' }}>Cancel</button>
                  <button onClick={saveEdit} disabled={saving} style={{ ...S.btn('primary'), fontSize:11, padding:'6px 12px' }}>{saving?'Saving…':'Save'}</button>
                </>}
                <button onClick={() => regenerateOne(selected)} disabled={regenId===selected.id}
                  style={{ ...S.btn('ghost'), fontSize:11, padding:'6px 12px', color:'#6366f1', border:'1px solid rgba(99,102,241,.3)' }}>
                  {regenId===selected.id ? '⟳ Regenerating…' : '↺ Regenerate'}
                </button>
                {selected.status === 'draft' && (
                  <button onClick={() => updateStatus(selected.id,'approved')}
                    style={{ ...S.btn('primary'), fontSize:11, padding:'6px 12px', background:'rgba(16,185,129,.8)' }}>✓ Approve</button>
                )}
                {selected.status === 'approved' && (
                  <button onClick={() => updateStatus(selected.id,'published')}
                    style={{ ...S.btn('primary'), fontSize:11, padding:'6px 12px' }}>Mark Published</button>
                )}
                {selected.status !== 'archived' && (
                  <button onClick={() => updateStatus(selected.id,'archived')}
                    style={{ ...S.btn('ghost'), fontSize:11, padding:'6px 12px', color:'#475569' }}>Archive</button>
                )}
                <button onClick={() => deleteDraft(selected.id)}
                  style={{ ...S.btn('ghost'), fontSize:11, padding:'6px 12px', color:'#ef4444', border:'1px solid rgba(239,68,68,.2)' }}>Delete</button>
              </div>
            </div>

            {/* Content score */}
            {scores[selected.id] && (
              <div style={{ ...CC.card, padding:'16px 20px', marginBottom:16 }}>
                <div style={{ fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>
                  Content Score
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
                  {Object.entries(scores[selected.id]).map(([label, n]) => (
                    <div key={label}>
                      <div style={{ fontSize:10, color:'#64748b', marginBottom:3 }}>{label}</div>
                      <StarRating n={n} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Body */}
            <div style={{ ...CC.card, padding:'24px 28px', marginBottom:16 }}>
              {editing ? (
                <textarea value={editBody} onChange={e => setEditBody(e.target.value)}
                  style={{ width:'100%', minHeight:400, background:'transparent', border:'none', outline:'none',
                    color:'#e2e8f0', fontSize:14, lineHeight:1.7, resize:'vertical', fontFamily:'inherit' }} />
              ) : (
                <pre style={{ whiteSpace:'pre-wrap', wordBreak:'break-word', color:'#e2e8f0',
                  fontSize:14, lineHeight:1.7, fontFamily:'inherit', margin:0 }}>
                  {selected.body}
                </pre>
              )}
            </div>

            {/* Calendar + phase 2 */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'start' }}>
              <div style={{ ...CC.card, padding:'14px 18px' }}>
                <div style={{ fontSize:10, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>
                  Publishing Calendar
                </div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {['draft','approved','scheduled','published','archived'].map(s => (
                    <div key={s} style={{ padding:'5px 12px', borderRadius:20,
                      background:`${STATUS_COLORS[s]}12`, border:`1px solid ${STATUS_COLORS[s]}28` }}>
                      <span style={{ fontSize:11, fontWeight:700, color:STATUS_COLORS[s] }}>
                        {s.charAt(0).toUpperCase()+s.slice(1)} ({drafts.filter(d=>d.status===s).length})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding:'12px 16px', borderRadius:10, background:'rgba(99,102,241,.05)',
                border:'1px dashed rgba(99,102,241,.2)', fontSize:11, color:'#475569', maxWidth:220 }}>
                Phase 2: Scheduled publishing, queue management, analytics
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── LinkedIn Publisher ─────────────────────────────────────────────────────
const LI_STATUS_COLORS = {
  draft:'#475569', approved:'#f59e0b', scheduled:'#6366f1',
  publishing:'#8b5cf6', published:'#10b981', failed:'#ef4444', canceled:'#334155'
}
const LI_CATEGORIES = [
  { value:'educational',    label:'Educational' },
  { value:'pain_point',     label:'Pain Point' },
  { value:'feature_demo',   label:'Feature Demo' },
  { value:'before_after',   label:'Before / After' },
  { value:'founder_story',  label:'Founder Story' },
  { value:'workflow_tip',   label:'Workflow Tip' },
  { value:'product_update', label:'Product Update' },
  { value:'demo_invite',    label:'Demo Invite' },
  { value:'comparison',     label:'Comparison' },
  { value:'case_study',     label:'Case Study' },
]

function LinkedInPublisher({ embeddedMode = false }) {
  // ── Product selector state ─────────────────────────────────────────────
  const STORAGE_KEY = 'romylabs_li_product'
  const [products, setProducts]         = React.useState([])
  const [selectedPid, setSelectedPid]   = React.useState(() =>
    localStorage.getItem(STORAGE_KEY) || 'taxres_crm')
  const [productSearch, setProductSearch] = React.useState('')
  const [selectorOpen, setSelectorOpen] = React.useState(false)

  // ── LinkedIn workspace state ───────────────────────────────────────────
  const [liTab, setLiTab]             = React.useState('queue')
  const [connection, setConnection]   = React.useState(null)
  const [posts, setPosts]             = React.useState([])
  const [loading, setLoading]         = React.useState(true)
  const [selected, setSelected]       = React.useState(null)
  const [filter, setFilter]           = React.useState('all')
  const [composing, setComposing]     = React.useState(false)
  const [composeBody, setComposeBody] = React.useState('')
  const [composeTitle, setComposeTitle] = React.useState('')
  const [composeCategory, setComposeCategory] = React.useState('educational')
  const [scheduleDate, setScheduleDate] = React.useState('')
  const [publishing, setPublishing]   = React.useState(null)
  const [saving, setSaving]           = React.useState(false)
  const [toast, setToast]             = React.useState(null)
  const [settings, setSettings]       = React.useState(null)
  const [savingSettings, setSavingSettings] = React.useState(false)
  const [reports, setReports]         = React.useState([])
  const [selectedReport, setSelectedReport] = React.useState(null)
  const [nextSlots, setNextSlots]     = React.useState([])

  const LINKEDIN_CLIENT_ID = '788n5oz5zrmb1o'
  const LINKEDIN_REDIRECT_URI = 'https://taxrescrm.app/crm-admin/linkedin/callback'
  const ADMIN_LINKEDIN_CALLBACK = 'https://admin.romylabs.com/crm-admin/linkedin/callback'

  // Derived: the selected product object
  const selectedProduct = products.find(p => p.product_id === selectedPid) || null

  function showToast(msg, ok=true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  // Persist selected product
  function selectProduct(pid) {
    setSelectedPid(pid)
    localStorage.setItem(STORAGE_KEY, pid)
    setSelectorOpen(false)
    setProductSearch('')
    // Reset workspace
    setConnection(null); setPosts([]); setSettings(null)
    setSelected(null); setComposing(false); setLiTab('queue')
  }

  // Load active products from registry
  React.useEffect(() => {
    supabase.from('romylabs_products').select('product_id,name,active,lifecycle,public')
      .order('name').then(({ data }) => {
        const registryActive = (data || []).filter(p => p.active && p.product_id !== 'phl' && !/^PHL(?:\s|$)/i.test(p.name || '') && String(p.lifecycle || '').toLowerCase() !== 'internal')
        // RomyLabs is the corporate parent, not a romylabs_products row. Keep it
        // as a first-class LinkedIn workspace without polluting the product registry.
        const corporate = { product_id:'romylabs', name:'RomyLabs Corporate', active:true, lifecycle:'corporate', public:true }
        const active = [corporate, ...registryActive.filter(p => p.product_id !== 'romylabs')]
        setProducts(active)
        // Validate stored pid against active products
        if (active.length && !active.find(p => p.product_id === selectedPid)) {
          selectProduct(active[0].product_id)
        }
      })
  }, [])

  // Handle OAuth callback.
  // LinkedIn's trusted redirect remains on taxrescrm.app (the original OAuth host).
  // When LinkedIn returns there, bridge the code/state back to admin.romylabs.com
  // where the authenticated RomyLabs session and product selection live.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) return

    const returnedState = params.get('state') || ''

    if (window.location.hostname.toLowerCase() === 'taxrescrm.app') {
      const bridge = new URL(ADMIN_LINKEDIN_CALLBACK)
      bridge.searchParams.set('code', code)
      bridge.searchParams.set('state', returnedState)
      bridge.searchParams.set('oauth_redirect_uri', LINKEDIN_REDIRECT_URI)
      window.location.replace(bridge.toString())
      return
    }

    const expectedState = sessionStorage.getItem('linkedin_oauth_state') || ''
    const oauthProduct = sessionStorage.getItem('linkedin_oauth_product') || selectedPid
    const oauthRedirectUri = params.get('oauth_redirect_uri') || LINKEDIN_REDIRECT_URI
    sessionStorage.removeItem('linkedin_oauth_state')
    sessionStorage.removeItem('linkedin_oauth_product')
    window.history.replaceState({}, '', window.location.pathname)

    if (!expectedState || returnedState !== expectedState) {
      showToast('LinkedIn connection rejected — invalid OAuth state', false)
      return
    }
    if (oauthRedirectUri !== LINKEDIN_REDIRECT_URI) {
      showToast('LinkedIn connection rejected — invalid OAuth redirect', false)
      return
    }

    const attempt = async () => {
      let session = null
      for (let i = 0; i < 5; i++) {
        const { data } = await supabase.auth.getSession()
        if (data?.session) { session = data.session; break }
        await new Promise(r => setTimeout(r, 500))
      }
      if (!session) { showToast('Session expired — please log in again', false); return }

      const { data, error } = await supabase.functions.invoke('linkedin-publish', {
        body: {
          action: 'oauth_callback',
          code,
          redirect_uri: oauthRedirectUri,
          state: returnedState,
          product_id: oauthProduct,
        }
      })

      if (data?.ok) {
        if (oauthProduct !== selectedPid) selectProduct(oauthProduct)
        showToast(oauthProduct === 'arcvena'
          ? 'Arcvena LinkedIn company page connected ✓'
          : `Connected as ${data.name} ✓`)
        load()
      } else {
        showToast('LinkedIn connection failed — try again', false)
        console.error(error || data)
      }
    }
    attempt()
  }, [selectedPid])

  async function load() {
    setLoading(true)
    try {
      const [{ data: connData }, { data: postsData }] = await Promise.all([
        supabase.functions.invoke('linkedin-publish', {
          body: { action: 'status', product_id: selectedPid }
        }),
        supabase.functions.invoke('linkedin-publish', {
          body: { action: 'list_posts', limit: 200, product_id: selectedPid }
        }),
      ])
      setConnection(connData?.connected ? connData : false)
      setPosts(postsData?.posts || [])
    } catch (_) { setConnection(false); setPosts([]) }
    setLoading(false)
  }

  async function loadSettings() {
    const { data } = await supabase.functions.invoke('linkedin-scheduler', {
      body: { action: 'get_settings', product_id: selectedPid }
    })
    setSettings(data?.settings || { autopilot: false, timezone: 'America/New_York' })
    const { data: sd } = await supabase.functions.invoke('linkedin-scheduler', {
      body: { action: 'next_slots', product_id: selectedPid }
    })
    setNextSlots(sd?.slots || [])
  }

  async function loadReports() {
    const { data } = await supabase.functions.invoke('linkedin-scheduler', {
      body: { action: 'list_reports', product_id: selectedPid }
    })
    setReports(data?.reports || [])
  }

  // Reload when product or tab changes
  React.useEffect(() => { if (selectedPid) load() }, [selectedPid])

  React.useEffect(() => {
    if (!selectedPid) return
    if (liTab === 'settings' || liTab === 'calendar') { loadSettings(); loadReports() }
    if (liTab === 'reports') loadReports()
  }, [liTab, selectedPid])

  function connectLinkedIn() {
    const state = crypto.randomUUID() + crypto.randomUUID()
    sessionStorage.setItem('linkedin_oauth_state', state)
    sessionStorage.setItem('linkedin_oauth_product', selectedPid)
    const scope = selectedPid === 'arcvena'
      ? 'openid profile w_organization_social'
      : 'openid profile w_member_social'
    const params = new URLSearchParams({
      response_type: 'code', client_id: LINKEDIN_CLIENT_ID,
      redirect_uri: LINKEDIN_REDIRECT_URI, scope, state,
    })
    window.location.href = `https://www.linkedin.com/oauth/v2/authorization?${params}`
  }

  async function disconnect() {
    await supabase.functions.invoke('linkedin-publish', {
      body: { action: 'disconnect', product_id: selectedPid }
    })
    setConnection(false)
    showToast('LinkedIn disconnected')
  }

  async function savePost(status='draft') {
    if (!composeBody.trim()) { showToast('Post body is required', false); return }
    setSaving(true)
    const { data, error } = await supabase.functions.invoke('linkedin-publish', {
      body: {
        action: 'save_draft', body: composeBody, status,
        title: composeTitle || composeBody.slice(0, 60),
        category: composeCategory,
        scheduled_at: status==='scheduled' && scheduleDate ? new Date(scheduleDate).toISOString() : null,
        product_id: selectedPid,
      }
    })
    if (data?.ok && data?.post) {
      setPosts(prev => [data.post, ...prev])
      setSelected(data.post); setComposing(false)
      setComposeBody(''); setComposeTitle(''); setScheduleDate('')
      showToast(status==='scheduled' ? 'Scheduled ✓' : status==='approved' ? 'Approved ✓' : 'Saved as draft ✓')
    } else {
      showToast('Failed to save — try again', false)
      console.error(error || data)
    }
    setSaving(false)
  }

  async function approvePost(post) {
    const { data } = await supabase.functions.invoke('linkedin-publish', {
      body: { action: 'save_draft', id: post.id, body: post.body, status: 'approved',
        title: post.title, category: post.category, product_id: selectedPid }
    })
    if (data?.ok) {
      setPosts(prev => prev.map(p => p.id===post.id ? {...p, status:'approved'} : p))
      if (selected?.id===post.id) setSelected(s => ({...s, status:'approved'}))
      showToast('Approved — will publish on next scheduled slot ✓')
    }
  }

  async function publishNow(post) {
    if (!connection?.connected) { showToast('Connect LinkedIn first', false); return }
    setPublishing(post.id)
    const { data, error } = await supabase.functions.invoke('linkedin-publish', {
      body: { action: 'publish', post_id: post.id, product_id: selectedPid }
    })
    if (data?.ok) {
      setPosts(prev => prev.map(p => p.id===post.id ? {...p, status:'published', linkedin_url:data.url, published_at:new Date().toISOString()} : p))
      if (selected?.id===post.id) setSelected(s => ({...s, status:'published', linkedin_url:data.url}))
      showToast('Published to LinkedIn ✓')
    } else {
      setPosts(prev => prev.map(p => p.id===post.id ? {...p, status:'failed'} : p))
      showToast('Publish failed — check LinkedIn connection', false)
    }
    setPublishing(null)
  }

  async function deletePost(id) {
    await supabase.functions.invoke('linkedin-publish', {
      body: { action: 'delete_post', post_id: id, product_id: selectedPid }
    })
    setPosts(prev => prev.filter(p => p.id!==id))
    if (selected?.id===id) setSelected(null)
    showToast('Deleted')
  }

  async function saveSettings() {
    if (!settings) return
    setSavingSettings(true)
    await supabase.functions.invoke('linkedin-scheduler', {
      body: { action: 'save_settings', product_id: selectedPid, settings }
    })
    showToast('Settings saved ✓')
    setSavingSettings(false)
  }

  async function generateReport() {
    showToast('Generating report…')
    const { data } = await supabase.functions.invoke('linkedin-scheduler', {
      body: { action: 'generate_report', product_id: selectedPid }
    })
    if (data?.ok) { loadReports(); showToast('Report generated ✓') }
    else showToast('Report generation failed', false)
  }

  const filtered = filter==='all' ? posts : posts.filter(p => p.status===filter)
  const CC2 = { card: { background:'rgba(255,255,255,.04)', border:'1px solid rgba(99,102,241,.18)', borderRadius:8 } }
  const charCount = composeBody.length
  const charOk = charCount <= 3000

  const LI_TABS = [
    { key:'queue',     label:'Content Queue' },
    { key:'published', label:'Published' },
    { key:'calendar',  label:'Calendar' },
    { key:'reports',   label:'Reports' },
    { key:'settings',  label:'Settings' },
  ]

  // Status badges for selected product
  const autopilotOn = settings?.autopilot === true
  const liConnected = connection?.connected === true
  // Integration status: always 'pending' by default — live connections override in the integration layer
  const seoStatus = 'pending'
  const mktStatus = 'pending'

  // Filtered product list for selector
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.product_id.toLowerCase().includes(productSearch.toLowerCase())
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height: embeddedMode ? 'calc(100vh - 120px)' : '100vh', overflow:'hidden', background:'#0f172a' }}>

      {toast && (
        <div style={{ position:'fixed', top:20, right:20, zIndex:9999, padding:'10px 18px', borderRadius:8,
          background: toast.ok ? 'rgba(16,185,129,.9)' : 'rgba(239,68,68,.9)',
          color:'#fff', fontSize:13, fontWeight:600, boxShadow:'0 4px 20px rgba(0,0,0,.4)' }}>
          {toast.msg}
        </div>
      )}

      {/* ── Product selector bar ─────────────────────────────────────────── */}
      <div style={{ background:'rgba(99,102,241,.07)', borderBottom:'1px solid rgba(99,102,241,.15)',
        padding:'10px 20px', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>

        {/* Dropdown */}
        <div style={{ position:'relative' }}>
          <button onClick={() => setSelectorOpen(o => !o)} style={{
            display:'flex', alignItems:'center', gap:8,
            background:'rgba(255,255,255,.06)', border:'1px solid rgba(99,102,241,.3)',
            borderRadius:8, padding:'6px 12px', cursor:'pointer', color:'#e2e8f0', fontSize:13,
            fontWeight:600, minWidth:180,
          }}>
            <span style={{ fontSize:15 }}>📦</span>
            <span style={{ flex:1, textAlign:'left' }}>
              {selectedProduct?.name || selectedPid}
            </span>
            <span style={{ color:'#6366f1', fontSize:10 }}>▼</span>
          </button>

          {selectorOpen && (
            <div style={{
              position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:200,
              background:'#1e293b', border:'1px solid rgba(99,102,241,.3)',
              borderRadius:10, padding:8, minWidth:220, boxShadow:'0 8px 32px rgba(0,0,0,.5)',
            }}>
              <input
                autoFocus
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                placeholder="Search products…"
                style={{
                  width:'100%', boxSizing:'border-box',
                  background:'rgba(255,255,255,.06)', border:'1px solid rgba(99,102,241,.2)',
                  borderRadius:6, padding:'6px 10px', color:'#e2e8f0', fontSize:12, marginBottom:6,
                  outline:'none',
                }}
              />
              {filteredProducts.length === 0 && (
                <div style={{ fontSize:11, color:'#475569', padding:'4px 8px' }}>No products found</div>
              )}
              {filteredProducts.map(p => (
                <button key={p.product_id} onClick={() => selectProduct(p.product_id)} style={{
                  display:'flex', alignItems:'center', gap:8, width:'100%', textAlign:'left',
                  padding:'7px 10px', borderRadius:6, cursor:'pointer', fontSize:12,
                  background: p.product_id === selectedPid ? 'rgba(99,102,241,.2)' : 'transparent',
                  color: p.product_id === selectedPid ? '#a5b4fc' : '#cbd5e1',
                  border:'none', fontWeight: p.product_id === selectedPid ? 700 : 400,
                }}>
                  {p.name}
                  {p.product_id === selectedPid && <span style={{ marginLeft:'auto', fontSize:10, color:'#6366f1' }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status badges */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {settings !== null && (
            <span style={{
              fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20,
              background: autopilotOn ? 'rgba(16,185,129,.15)' : 'rgba(100,116,139,.15)',
              color: autopilotOn ? '#10b981' : '#64748b',
              border: `1px solid ${autopilotOn ? 'rgba(16,185,129,.3)' : 'rgba(100,116,139,.3)'}`,
            }}>Autopilot {autopilotOn ? 'On' : 'Off'}</span>
          )}
          {connection !== null && (
            <span style={{
              fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20,
              background: liConnected ? 'rgba(99,102,241,.15)' : 'rgba(239,68,68,.1)',
              color: liConnected ? '#a5b4fc' : '#94a3b8',
              border: `1px solid ${liConnected ? 'rgba(99,102,241,.3)' : 'rgba(239,68,68,.2)'}`,
            }}>
              LinkedIn {liConnected ? `Connected` : 'Not Connected'}
            </span>
          )}
          {seoStatus && seoStatus !== 'unknown' && (
            <span style={{
              fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20,
              background: seoStatus==='connected' ? 'rgba(16,185,129,.1)' : 'rgba(245,158,11,.1)',
              color: seoStatus==='connected' ? '#10b981' : '#f59e0b',
              border: `1px solid ${seoStatus==='connected' ? 'rgba(16,185,129,.25)' : 'rgba(245,158,11,.25)'}`,
            }}>SEO {seoStatus==='connected' ? 'Connected' : 'Pending'}</span>
          )}
          {mktStatus && mktStatus !== 'unknown' && (
            <span style={{
              fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20,
              background: mktStatus==='connected' ? 'rgba(99,102,241,.12)' : 'rgba(245,158,11,.1)',
              color: mktStatus==='connected' ? '#a5b4fc' : '#f59e0b',
              border: `1px solid ${mktStatus==='connected' ? 'rgba(99,102,241,.3)' : 'rgba(245,158,11,.25)'}`,
            }}>Mktg {mktStatus==='connected' ? 'Connected' : 'Pending'}</span>
          )}
        </div>

        {/* Click-outside close */}
        {selectorOpen && (
          <div style={{ position:'fixed', inset:0, zIndex:199 }}
            onClick={() => { setSelectorOpen(false); setProductSearch('') }} />
        )}
      </div>

      {/* ── LinkedIn workspace ───────────────────────────────────────────── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left panel */}
        <div style={{ width:280, borderRight:'1px solid rgba(99,102,241,.15)', overflowY:'auto', padding:'20px 0' }}>

          {/* Header + connection */}
          <div style={{ padding:'0 18px 14px' }}>
            <div style={{ fontSize:15, fontWeight:900, color:'#fff', marginBottom:2 }}>
              💼 LinkedIn
            </div>
            <div style={{ fontSize:11, color:'#475569', marginBottom:10 }}>
              {selectedProduct?.name || selectedPid}
            </div>

            {loading ? <div style={{ fontSize:12, color:'#475569' }}>Checking…</div>
            : connection?.connected ? (
              <div style={{ ...CC2.card, padding:'10px 14px', marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:'#10b981', display:'inline-block' }} />
                  <span style={{ fontSize:11, fontWeight:700, color:'#10b981' }}>{connection.display_name}</span>
                </div>
                <div style={{ fontSize:10, color:'#475569', marginBottom:8 }}>
                  Expires {new Date(connection.expires_at).toLocaleDateString()}
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={disconnect} style={{ ...S.btn('ghost'), fontSize:10, padding:'4px 10px', color:'#ef4444', borderColor:'rgba(239,68,68,.3)' }}>
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ ...CC2.card, padding:'12px', marginBottom:10 }}>
                <div style={{ fontSize:11, color:'#94a3b8', marginBottom:8 }}>
                  Connect LinkedIn to publish posts
                </div>
                <button onClick={connectLinkedIn} style={{ ...S.btn('primary'), fontSize:11, padding:'7px 14px', width:'100%' }}>
                  Connect LinkedIn
                </button>
              </div>
            )}

            <button onClick={() => { setComposing(true); setSelected(null); setLiTab('queue') }}
              style={{ ...S.btn('primary'), width:'100%', padding:'8px 0', fontSize:12 }}>
              + New Post
            </button>
          </div>

          {/* Sub-tabs */}
          <div style={{ padding:'0 18px 10px', display:'flex', gap:4, flexWrap:'wrap' }}>
            {LI_TABS.map(t => (
              <button key={t.key} onClick={() => { setLiTab(t.key); setComposing(false) }} style={{
                padding:'4px 10px', borderRadius:20, border:'none', cursor:'pointer', fontSize:10, fontWeight:700,
                background: liTab===t.key ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.05)',
                color: liTab===t.key ? '#a5b4fc' : '#64748b',
              }}>{t.label}</button>
            ))}
          </div>

          {/* Filter (queue/published tabs) */}
          {(liTab==='queue' || liTab==='published') && (
            <div style={{ padding:'0 18px 10px' }}>
              {['all','draft','approved','scheduled','published','failed'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  display:'block', width:'100%', textAlign:'left', padding:'5px 8px',
                  borderRadius:6, border:'none', cursor:'pointer', fontSize:11,
                  background: filter===f ? 'rgba(99,102,241,.15)' : 'transparent',
                  color: filter===f ? '#a5b4fc' : '#64748b', fontWeight: filter===f ? 700 : 400,
                  marginBottom:1, textTransform:'capitalize',
                }}>{f}</button>
              ))}
            </div>
          )}

          {/* Post list */}
          {(liTab==='queue' || liTab==='published') && (
            <div style={{ padding:'0 10px' }}>
              {loading ? <div style={{ padding:10, fontSize:11, color:'#475569' }}>Loading…</div>
              : filtered.length === 0 ? <div style={{ padding:10, fontSize:11, color:'#475569' }}>No posts</div>
              : filtered.map(post => (
                <button key={post.id} onClick={() => { setSelected(post); setComposing(false) }}
                  style={{
                    display:'block', width:'100%', textAlign:'left', padding:'8px 10px',
                    borderRadius:6, border:'none', cursor:'pointer', marginBottom:2,
                    background: selected?.id===post.id ? 'rgba(99,102,241,.2)' : 'rgba(255,255,255,.03)',
                  }}>
                  <div style={{ fontSize:11, fontWeight:600, color:'#cbd5e1', marginBottom:2,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {post.title || post.body?.slice(0, 50) || '(untitled)'}
                  </div>
                  <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                    <span style={{
                      fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:10,
                      background: post.status==='published' ? 'rgba(16,185,129,.15)'
                        : post.status==='approved' ? 'rgba(99,102,241,.15)'
                        : post.status==='scheduled' ? 'rgba(245,158,11,.15)'
                        : post.status==='failed' ? 'rgba(239,68,68,.15)'
                        : 'rgba(100,116,139,.15)',
                      color: post.status==='published' ? '#10b981'
                        : post.status==='approved' ? '#a5b4fc'
                        : post.status==='scheduled' ? '#f59e0b'
                        : post.status==='failed' ? '#ef4444' : '#64748b',
                    }}>{post.status}</span>
                    {post.scheduled_at && (
                      <span style={{ fontSize:9, color:'#475569' }}>
                        {new Date(post.scheduled_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main content area */}
        <div style={{ flex:1, overflowY:'auto', padding:24 }}>

          {/* Calendar tab */}
          {liTab === 'calendar' && (
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:16 }}>📅 Calendar</div>
              {settings ? (
                <div style={{ ...CC2.card, padding:20, marginBottom:16, maxWidth:500 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#a5b4fc', marginBottom:8 }}>
                    Schedule — {selectedProduct?.name}
                  </div>
                  <div style={{ fontSize:12, color:'#94a3b8', marginBottom:4 }}>
                    Autopilot: <strong style={{ color: settings.autopilot ? '#10b981' : '#64748b' }}>
                      {settings.autopilot ? 'On' : 'Off'}
                    </strong>
                  </div>
                  <div style={{ fontSize:12, color:'#94a3b8', marginBottom:12 }}>
                    Timezone: {settings.timezone || 'America/New_York'}
                  </div>
                  {nextSlots.length > 0 && (
                    <>
                      <div style={{ fontSize:11, fontWeight:700, color:'#64748b', marginBottom:6 }}>NEXT SLOTS</div>
                      {nextSlots.slice(0,5).map((s,i) => (
                        <div key={i} style={{ fontSize:11, color:'#94a3b8', marginBottom:3 }}>
                          {new Date(s).toLocaleString()}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ) : (
                <div style={{ fontSize:12, color:'#475569' }}>Loading schedule…</div>
              )}
            </div>
          )}

          {/* Reports tab */}
          {liTab === 'reports' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
                <div style={{ fontSize:16, fontWeight:800, color:'#fff' }}>📊 Reports</div>
                <button onClick={generateReport} style={{ ...S.btn('secondary'), fontSize:11, padding:'5px 12px' }}>
                  Generate Report
                </button>
              </div>
              {reports.length === 0 ? (
                <div style={{ fontSize:12, color:'#475569' }}>No reports yet for {selectedProduct?.name}.</div>
              ) : reports.map(r => (
                <div key={r.id} style={{ ...CC2.card, padding:14, marginBottom:8, cursor:'pointer',
                  background: selectedReport?.id===r.id ? 'rgba(99,102,241,.08)' : undefined }}
                  onClick={() => setSelectedReport(selectedReport?.id===r.id ? null : r)}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#a5b4fc', marginBottom:4 }}>
                    Week of {new Date(r.week_start).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize:11, color:'#64748b' }}>
                    Published: {r.published_count || 0} · Impressions: {r.total_impressions || 0}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Settings tab */}
          {liTab === 'settings' && (
            <div style={{ maxWidth:480 }}>
              <div style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:16 }}>⚙️ Settings</div>
              {settings ? (
                <div style={{ ...CC2.card, padding:20 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#a5b4fc', marginBottom:16 }}>
                    {selectedProduct?.name} — Autopilot Settings
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <label style={{ fontSize:12, color:'#94a3b8', display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                      <input type="checkbox" checked={settings.autopilot}
                        onChange={e => setSettings(s => ({...s, autopilot: e.target.checked}))} />
                      <span>Autopilot enabled</span>
                    </label>
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>TIMEZONE</div>
                    <select value={settings.timezone||'America/New_York'}
                      onChange={e => setSettings(s => ({...s, timezone:e.target.value}))}
                      style={{ background:'rgba(255,255,255,.06)', border:'1px solid rgba(99,102,241,.2)',
                        color:'#e2e8f0', borderRadius:6, padding:'5px 10px', fontSize:12, width:'100%' }}>
                      {['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','UTC'].map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={saveSettings} disabled={savingSettings}
                    style={{ ...S.btn('primary'), fontSize:12, padding:'8px 20px' }}>
                    {savingSettings ? 'Saving…' : 'Save Settings'}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize:12, color:'#475569' }}>Loading settings…</div>
              )}
            </div>
          )}

          {/* Queue / Published — compose or detail */}
          {(liTab==='queue' || liTab==='published') && (
            <>
              {composing ? (
                <div style={{ maxWidth:640 }}>
                  <div style={{ fontSize:15, fontWeight:800, color:'#fff', marginBottom:16 }}>✍️ New Post — {selectedProduct?.name}</div>
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>TITLE (OPTIONAL)</div>
                    <input value={composeTitle} onChange={e => setComposeTitle(e.target.value)}
                      placeholder="Post title…"
                      style={{ width:'100%', boxSizing:'border-box', background:'rgba(255,255,255,.05)',
                        border:'1px solid rgba(99,102,241,.2)', borderRadius:6,
                        padding:'8px 12px', color:'#e2e8f0', fontSize:12 }} />
                  </div>
                  <div style={{ marginBottom:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontSize:11, color:'#64748b' }}>POST BODY</span>
                      <span style={{ fontSize:10, color: charOk ? '#475569' : '#ef4444' }}>
                        {charCount}/3000
                      </span>
                    </div>
                    <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)}
                      rows={10} placeholder="Write your LinkedIn post…"
                      style={{ width:'100%', boxSizing:'border-box', background:'rgba(255,255,255,.05)',
                        border:`1px solid ${charOk ? 'rgba(99,102,241,.2)' : 'rgba(239,68,68,.4)'}`,
                        borderRadius:6, padding:'10px 12px', color:'#e2e8f0', fontSize:13,
                        resize:'vertical', fontFamily:'inherit' }} />
                  </div>
                  <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>CATEGORY</div>
                      <select value={composeCategory} onChange={e => setComposeCategory(e.target.value)}
                        style={{ width:'100%', background:'rgba(255,255,255,.06)', border:'1px solid rgba(99,102,241,.2)',
                          color:'#e2e8f0', borderRadius:6, padding:'5px 10px', fontSize:12 }}>
                        {['educational','product','founder_story','practitioner','general'].map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>SCHEDULE DATE (OPTIONAL)</div>
                      <input type="datetime-local" value={scheduleDate}
                        onChange={e => setScheduleDate(e.target.value)}
                        style={{ width:'100%', background:'rgba(255,255,255,.06)', border:'1px solid rgba(99,102,241,.2)',
                          color:'#e2e8f0', borderRadius:6, padding:'5px 10px', fontSize:12, boxSizing:'border-box' }} />
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={() => savePost('draft')} disabled={saving||!charOk}
                      style={{ ...S.btn('ghost'), fontSize:12, padding:'8px 16px' }}>Save Draft</button>
                    <button onClick={() => savePost('approved')} disabled={saving||!charOk}
                      style={{ ...S.btn('secondary'), fontSize:12, padding:'8px 16px' }}>Approve</button>
                    {scheduleDate && (
                      <button onClick={() => savePost('scheduled')} disabled={saving||!charOk}
                        style={{ ...S.btn('primary'), fontSize:12, padding:'8px 16px' }}>Schedule</button>
                    )}
                    <button onClick={() => { setComposing(false); setComposeBody(''); setComposeTitle('') }}
                      style={{ ...S.btn('ghost'), fontSize:12, padding:'8px 16px', marginLeft:'auto' }}>Cancel</button>
                  </div>
                </div>
              ) : selected ? (
                <div style={{ maxWidth:640 }}>
                  <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center' }}>
                    <button onClick={() => setSelected(null)} style={{ ...S.btn('ghost'), fontSize:11, padding:'4px 10px' }}>← Back</button>
                    <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10,
                      background: selected.status==='published' ? 'rgba(16,185,129,.15)'
                        : selected.status==='approved' ? 'rgba(99,102,241,.15)'
                        : selected.status==='scheduled' ? 'rgba(245,158,11,.15)'
                        : selected.status==='failed' ? 'rgba(239,68,68,.15)'
                        : 'rgba(100,116,139,.15)',
                      color: selected.status==='published' ? '#10b981'
                        : selected.status==='approved' ? '#a5b4fc'
                        : selected.status==='scheduled' ? '#f59e0b'
                        : selected.status==='failed' ? '#ef4444' : '#64748b',
                    }}>{selected.status}</span>
                  </div>
                  <div style={{ fontSize:16, fontWeight:700, color:'#fff', marginBottom:12 }}>
                    {selected.title || '(untitled)'}
                  </div>
                  <div style={{ fontSize:13, color:'#94a3b8', lineHeight:1.7, marginBottom:16,
                    whiteSpace:'pre-wrap', background:'rgba(255,255,255,.03)', borderRadius:8,
                    padding:16, border:'1px solid rgba(99,102,241,.1)' }}>
                    {selected.body}
                  </div>
                  {selected.linkedin_url && (
                    <a href={selected.linkedin_url} target="_blank" rel="noopener noreferrer"
                      style={{ display:'inline-block', fontSize:11, color:'#6366f1', marginBottom:12 }}>
                      View on LinkedIn →
                    </a>
                  )}
                  <div style={{ display:'flex', gap:8 }}>
                    {selected.status !== 'published' && selected.status !== 'approved' && (
                      <button onClick={() => approvePost(selected)} style={{ ...S.btn('secondary'), fontSize:12, padding:'7px 14px' }}>
                        Approve
                      </button>
                    )}
                    {selected.status === 'approved' && connection?.connected && (
                      <button onClick={() => publishNow(selected)} disabled={publishing===selected.id}
                        style={{ ...S.btn('primary'), fontSize:12, padding:'7px 14px' }}>
                        {publishing===selected.id ? 'Publishing…' : 'Publish Now'}
                      </button>
                    )}
                    <button onClick={() => { if (window.confirm('Delete this post?')) deletePost(selected.id) }}
                      style={{ ...S.btn('ghost'), fontSize:12, padding:'7px 14px', color:'#ef4444',
                        borderColor:'rgba(239,68,68,.3)', marginLeft:'auto' }}>
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ color:'#475569', fontSize:13, marginTop:40, textAlign:'center' }}>
                  Select a post from the list or create a new one<br/>
                  <span style={{ fontSize:11, color:'#334155', marginTop:6, display:'block' }}>
                    Showing {selectedProduct?.name || selectedPid} content only
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}


  // Parse product badge from calendar event title prefix [Product Name]
  function parseEventBadge(title) {
    const BADGE_COLORS = {
      'RomyLabs':   { bg:'#1a1a1a', text:'#C6FF00' },
      'TaxRes CRM': { bg:'#1e3a5f', text:'#60a5fa', logo:'/taxrescrm-favicon.png' },
      'Camvella':   { bg:'#0b2748', text:'#55B96A', logo:'/camvella-logo.svg' },
      'Arcvena':    { bg:'#1a0a2e', text:'#a78bfa', logo:'/arcvena-favicon-64.png' },
      'BocaSync':   { bg:'#1a2e1a', text:'#34d399', logo:'/bocasync-logo.svg' },
    }
    const m = (title||'').match(/^\[([^\]]+)\]/)
    if (!m) return null
    const label = m[1]
    const colors = BADGE_COLORS[label] || { bg:'#1e293b', text:'#94a3b8' }
    return { label, ...colors }
  }

export default function AdminPortal() {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useApp()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Swap favicon + title to RomyLabs brand while in the admin portal
  useEffect(() => {
    const prev = document.title
    document.title = 'RomyLabs — Command Center'
    const setFavicon = (href) => {
      document.querySelectorAll("link[rel*='icon']").forEach(el => el.remove())
      const link = document.createElement('link')
      link.rel = 'icon'
      link.type = 'image/png'
      link.href = href
      document.head.appendChild(link)
    }
    setFavicon('/romylabs-favicon.png')
    return () => {
      document.title = prev
      // Always restore RomyLabs favicon — never restore a tenant favicon
      setFavicon('/romylabs-favicon.png')
    }
  }, [])

  async function handleGSCConnect() {
    const CLIENT_ID = '70057646964-vimoia1qkjtml9n3mplo0hme82m3t2qs.apps.googleusercontent.com'
    const redirect  = window.location.origin + '/crm-admin/command-center'
    const scope     = 'https://www.googleapis.com/auth/webmasters.readonly'
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`
    window.location.href = url
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    logout?.()
    navigate('/login')
  }

  return (
    <ScreenShareProvider>
    <CallProvider phoneContext="romylabs">
    <div className="rl-admin-shell" style={{display:'flex',minHeight:'100vh',background:'#0d0c1a',fontFamily:'system-ui,Arial,sans-serif',width:'100%',overflowX:'hidden'}}>
      <style>{`
        .rl-admin-mobile-bar,.rl-admin-mobile-overlay{display:none}
        .rl-admin-desktop-sidebar{display:flex;flex-shrink:0}
        .rl-admin-main{min-width:0;width:100%}
        @media (max-width:768px){
          .rl-admin-shell{display:block!important;min-height:100dvh!important}
          .rl-admin-desktop-sidebar{display:none!important}
          .rl-admin-mobile-bar{display:flex!important;position:sticky;top:0;z-index:9000;min-height:58px;align-items:center;gap:12px;padding:env(safe-area-inset-top) 14px 0;background:#0f0e1a;border-bottom:1px solid rgba(99,102,241,.22)}
          .rl-admin-mobile-menu-btn{width:42px;height:42px;border-radius:10px;border:1px solid rgba(99,102,241,.28);background:rgba(99,102,241,.10);color:#e2e8f0;font-size:21px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
          .rl-admin-mobile-overlay{display:flex!important;position:fixed;inset:0;z-index:9500;background:rgba(2,6,23,.72);backdrop-filter:blur(3px)}
          .rl-admin-mobile-drawer{height:100%;overflow-y:auto;box-shadow:16px 0 40px rgba(0,0,0,.45);background:#0f0e1a}
          .rl-admin-mobile-scrim{flex:1;height:100%}
          .rl-admin-main{height:calc(100dvh - 58px)!important;overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch}
          .rl-admin-main>div:not([style*="position: absolute"]){max-width:100%;box-sizing:border-box}
          .rl-admin-main table{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap}
          .rl-admin-main input,.rl-admin-main select,.rl-admin-main textarea{max-width:100%;box-sizing:border-box}
          .rl-admin-main button,.rl-admin-main a{touch-action:manipulation}
          .rl-admin-main [style*="padding: 32px 36px"]{padding:18px 14px!important}
          .rl-admin-main [style*="padding: 28px 32px"]{padding:18px 14px!important}
          .rl-admin-main [style*="repeat(6, 1fr)"],.rl-admin-main [style*="repeat(6,1fr)"]{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .rl-admin-main [style*="repeat(4, 1fr)"],.rl-admin-main [style*="repeat(4,1fr)"]{grid-template-columns:repeat(2,minmax(0,1fr))!important}
          .rl-admin-main [style*="repeat(3, 1fr)"],.rl-admin-main [style*="repeat(3,1fr)"]{grid-template-columns:1fr!important}
        }
        /* MOBILE_POLISH_V1_20260830 */
        @media (max-width: 768px){
          .rl-admin-mobile-bar{height:60px!important;padding-left:12px!important;padding-right:12px!important;background:rgba(15,14,26,.96)!important;backdrop-filter:blur(14px);box-shadow:0 8px 24px rgba(0,0,0,.18)}
          .rl-admin-mobile-bar img{height:27px!important;max-width:138px!important}
          .rl-admin-mobile-menu-btn{width:42px!important;height:42px!important;border-radius:12px!important;font-size:20px!important}
          .rl-admin-mobile-drawer{width:min(88vw,310px)!important;border-radius:0 18px 18px 0;overflow:hidden;background:#0f0e1a}
          .rl-admin-main{background:linear-gradient(180deg,#0d0c1a 0%,#0b0a16 100%);padding-bottom:max(20px,env(safe-area-inset-bottom))}
          .rl-admin-main > div{max-width:100%!important;box-sizing:border-box}
          .rl-admin-main [style*="padding: 32px 36px"],
          .rl-admin-main [style*="padding: 28px 36px"],
          .rl-admin-main [style*="padding: 28px 32px"],
          .rl-admin-main [style*="padding: 32px 32px"],
          .rl-admin-main [style*="padding: 24px 32px"]{padding:18px 14px!important}
          .rl-admin-main [style*="grid-template-columns: 1fr 420px"],
          .rl-admin-main [style*="grid-template-columns: 420px 1fr"],
          .rl-admin-main [style*="grid-template-columns: 1fr 1fr"]{grid-template-columns:1fr!important}
          .rl-admin-main [style*="font-size: 28px"]{font-size:24px!important;line-height:1.1!important}
          .rl-admin-main [style*="font-size: 26px"]{font-size:22px!important;line-height:1.18!important}
          .rl-admin-main [style*="font-size: 24px"]{font-size:21px!important;line-height:1.2!important}
          .rl-admin-main [style*="font-size: 22px"]{font-size:20px!important;line-height:1.22!important}
          .rl-admin-main [style*="border-radius: 14px"]{border-radius:12px!important}
          .rl-admin-main button{min-height:40px;touch-action:manipulation}
          .rl-admin-main input,.rl-admin-main select,.rl-admin-main textarea{font-size:16px!important;min-height:42px}
          .rl-admin-main textarea{min-height:84px}
          .rl-admin-main table{font-size:12px!important;border-spacing:0}
          .rl-admin-main th,.rl-admin-main td{padding:9px 10px!important}
          .rl-admin-main [style*="margin-bottom: 32px"]{margin-bottom:22px!important}
          .rl-admin-main [style*="margin-bottom: 28px"]{margin-bottom:20px!important}
          .rl-admin-main [style*="gap: 20px"]{gap:14px!important}
          .rl-admin-main [style*="gap: 18px"]{gap:12px!important}
          .rl-admin-main [style*="gap: 16px"]{gap:12px!important}
          .rl-admin-main iframe{max-width:100vw!important}
        }
        @media (max-width:430px){
          .rl-admin-main [style*="repeat(2, 1fr)"],.rl-admin-main [style*="repeat(2,1fr)"]{grid-template-columns:1fr!important}
        }
      `}</style>
      <div className="rl-admin-desktop-sidebar"><Sidebar onSignOut={handleSignOut} /></div>
      <div className="rl-admin-mobile-bar">
        <button className="rl-admin-mobile-menu-btn" onClick={()=>setMobileMenuOpen(true)} aria-label="Open navigation">☰</button>
        <img src="/romylabs-logo.png" alt="RomyLabs" style={{height:30,maxWidth:150,objectFit:'contain'}} />
        <span style={{marginLeft:'auto',fontSize:10,fontWeight:800,color:'#C6FF00',letterSpacing:'.05em'}}>ADMIN</span>
      </div>
      {mobileMenuOpen && <div className="rl-admin-mobile-overlay">
        <div className="rl-admin-mobile-drawer"><Sidebar mobile onClose={()=>setMobileMenuOpen(false)} onSignOut={handleSignOut} /></div>
        <div className="rl-admin-mobile-scrim" onClick={()=>setMobileMenuOpen(false)} />
      </div>}
      <div className="rl-admin-main" style={{flex:1,position:'relative',height:'100vh',overflowY:'auto'}}>
        {/* Persistent SnappyMail iframe — always mounted so compose drafts survive tab switches.
            Hidden via CSS when not on /email; shown only when on /email route. */}
        <div style={{
          position:'absolute', inset:0, zIndex:1,
          display: location.pathname === '/crm-admin/email' ? 'flex' : 'none',
          flexDirection:'column'
        }}>
          <div style={{padding:'16px 28px 10px',borderBottom:'1px solid #1e293b',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            <span style={{fontSize:18,fontWeight:800,color:'#fff'}}>📧 Email</span>
            <span style={{fontSize:13,color:'#475569'}}>romy@taxrescrm.net — powered by Stalwart</span>
            <a href={WEBMAIL_URL} target="_blank" rel="noreferrer"
              style={{marginLeft:'auto',fontSize:12,color:'#6366f1',textDecoration:'none'}}>Open in new tab ↗</a>
          </div>
          <iframe src={WEBMAIL_URL} title="SnappyMail"
            style={{flex:1,border:'none',width:'100%',background:'#0f172a'}}
            allow="clipboard-read; clipboard-write" />
        </div>
        <Suspense fallback={<Spinner/>}>
          <Routes>
            <Route path="/command-center" element={<AdminRouteErrorBoundary><CommandCenter/></AdminRouteErrorBoundary>}/>
            <Route path="/traffic"        element={<AdminRouteErrorBoundary><TrafficCoverage/></AdminRouteErrorBoundary>}/>
            <Route path="/vault"          element={<AdminRouteErrorBoundary><CredentialVault/></AdminRouteErrorBoundary>}/>
            <Route path="/content"         element={<AdminRouteErrorBoundary><ContentCenter/></AdminRouteErrorBoundary>}/>
            <Route path="/linkedin"          element={<AdminRouteErrorBoundary><LinkedInPublisher/></AdminRouteErrorBoundary>}/>
            <Route path="/linkedin/callback" element={<AdminRouteErrorBoundary><LinkedInPublisher/></AdminRouteErrorBoundary>}/>
            <Route index                   element={<Overview key={window.location.pathname + window.location.search}/>}/>
            <Route path="/offices"        element={<OfficesList/>}/>
            <Route path="/esign"          element={<AdminRouteErrorBoundary><ESignaturesHub/></AdminRouteErrorBoundary>}/>
            <Route path="/offices/:id"    element={<OfficePageRouter/>}/>
            <Route path="/provision"      element={<div style={{padding:8}}><NewOffice/></div>}/>
            <Route path="/billing"        element={<AdminRouteErrorBoundary><RomyLabsBilling/></AdminRouteErrorBoundary>}/>
            <Route path="/search"         element={<Search/>}/>
            <Route path="/demo"           element={<AdminRouteErrorBoundary><DemoMgmt/></AdminRouteErrorBoundary>}/>
            <Route path="/demo-setup"     element={<AdminRouteErrorBoundary><DemoSetup/></AdminRouteErrorBoundary>}/>
            <Route path="/live-demo"      element={<AdminRouteErrorBoundary><LiveDemo/></AdminRouteErrorBoundary>}/>
            <Route path="/health"         element={<AdminRouteErrorBoundary><SystemHealth/></AdminRouteErrorBoundary>}/>
            <Route path="/employees"      element={<AdminRouteErrorBoundary><EmployeeLookup/></AdminRouteErrorBoundary>}/>
            <Route path="/audit"          element={<AdminRouteErrorBoundary><AuditLog/></AdminRouteErrorBoundary>}/>
            <Route path="/support"        element={<div style={{padding:8}}><Support/></div>}/>
            <Route path="/email"          element={<div/>}/>
            <Route path="/dialer"         element={<AdminRouteErrorBoundary><AdminDialer/></AdminRouteErrorBoundary>}/>
            <Route path="/calendar"       element={<AdminRouteErrorBoundary><AdminCalendar/></AdminRouteErrorBoundary>}/>
            <Route path="/meet"           element={<AdminRouteErrorBoundary><AdminTraining/></AdminRouteErrorBoundary>}/>
            <Route path="/training"       element={<AdminRouteErrorBoundary><AdminTraining/></AdminRouteErrorBoundary>}/>
            <Route path="/chat"           element={<AdminRouteErrorBoundary><AdminChatPage/></AdminRouteErrorBoundary>}/>
            <Route path="*"               element={<Overview key={window.location.pathname + window.location.search + "_fallback"}/>}/>
          </Routes>
        </Suspense>
      </div>
      <AIAssistant adminMode />
    </div>
    <ActiveCallBar />
    </CallProvider>
    </ScreenShareProvider>
  )
}
