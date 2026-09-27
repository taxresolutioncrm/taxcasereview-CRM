// AdminConsole — the full platform super-admin surface. Gated identically to
// the existing CRM Companies page: Romy's email specifically, checked here
// for UI purposes and re-checked independently by every RPC underneath.
//
// Wraps the existing, working NewOffice page unchanged as the "Companies"
// tab (zero risk to what already works) and adds two new read-only tabs:
// Overview (cross-tenant KPIs) and Search (find any client/lead across
// every office). Visually distinct dark-purple header so it's unmistakably
// "admin mode," not just another CRM page in the regular sidebar.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import NewOffice from './NewOffice'
import Support from './Support'

const PLATFORM_ADMIN_EMAILS = ['romy@taxcasereview.org', 'romy@taxrescrm.net', 'romy@romylabs.com', 'info@romylabs.com']
const isTaxResCRM = (email) => (email||'').toLowerCase() === 'romy@taxrescrm.net'
const STATUS_COLORS = { active:'#10b981', trial:'#f59e0b', past_due:'#f97316', cancelled:'#ef4444' }

function fmtBytes(n) {
  if (!n) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024*1024) return (n/1024).toFixed(0) + ' KB'
  if (n < 1024*1024*1024) return (n/1024/1024).toFixed(1) + ' MB'
  return (n/1024/1024/1024).toFixed(2) + ' GB'
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—' }
function timeAgo(d) {
  if (!d) return 'No activity yet'
  const ms = Date.now() - new Date(d).getTime()
  const days = Math.floor(ms / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return fmtDate(d)
}

export default function AdminConsole() {
  const { user } = useApp()
  const navigate = useNavigate()
  const allowed = PLATFORM_ADMIN_EMAILS.includes((user?.email || '').toLowerCase())
  const asProduct = isTaxResCRM(user?.email) // logged in as TaxRes CRM identity
  const [tab, setTab] = useState('overview') // overview | companies | search

  if (!allowed) return (
    <div style={{padding:40,maxWidth:520}}>
      <div style={{fontSize:18,fontWeight:700,marginBottom:8,color:'var(--tx)'}}>Not available</div>
      <div style={{color:'var(--t3)',fontSize:13.5,lineHeight:1.6}}>This page is a platform-level tool and isn't available from this account.</div>
    </div>
  )

  return (
    <div>
      {/* Distinct admin-mode header — deliberately not the regular page style */}
      <div style={{
        background: 'linear-gradient(135deg,#1e1b4b,#312e81)',
        padding: '18px 28px', borderBottom: '2px solid #4c1d95',
        display: 'flex', alignItems: 'center', gap: 14
      }}>
        <span style={{fontSize:22}}>🛡️</span>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:'#fff'}}>{asProduct ? 'TaxRes CRM' : 'Platform Admin'}</div>
          <div style={{fontSize:11.5,color:'#c4b5fd'}}>{asProduct ? 'TaxRes CRM — Admin Console' : 'Visible only to romy@taxcasereview.org — every office, one place'}</div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          {[
            {key:'overview',  label:'📊 Overview'},
            {key:'companies', label:'🏢 Companies'},
            {key:'search',    label:'🔍 Search'},
            {key:'support',   label:'🎫 Support'},
          ].map(t => (
            <button key={t.key} onClick={()=>setTab(t.key)}
              style={{
                padding:'8px 16px', borderRadius:8, border:'1px solid rgba(255,255,255,.15)',
                background: tab===t.key ? '#fff' : 'rgba(255,255,255,.08)',
                color: tab===t.key ? '#312e81' : '#e0e7ff',
                fontWeight:700, fontSize:12.5, cursor:'pointer'
              }}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === 'overview'  && <AdminOverview />}
      {tab === 'companies' && <NewOffice />}
      {tab === 'search'    && <AdminSearch />}
      {tab === 'support'   && <Support />}
    </div>
  )
}

// ── Overview: cross-tenant KPIs ──────────────────────────────────────────
function AdminOverview() {
  const [rows, setRows] = useState(null)

  useEffect(() => { load() }, [])
  async function load() {
    const { data, error } = await supabase.rpc('admin_tenant_overview')
    if (!error) setRows(data || [])
  }

  if (rows === null) return <div style={{padding:40,color:'var(--t3)'}}>Loading…</div>

  const totalTenants   = rows.length
  const activeTenants  = rows.filter(r => r.status === 'active').length
  const totalSeats     = rows.reduce((s,r) => s + (Number(r.billing_seats||0)>0 ? Number(r.billing_seats) : Number(r.employee_count||0)), 0)
  const totalClients   = rows.reduce((s,r) => s + (r.client_count||0), 0)
  const totalLeads     = rows.reduce((s,r) => s + (r.lead_count||0), 0)
  const totalStorage   = rows.reduce((s,r) => s + (r.storage_bytes||0), 0)
  const totalMRR       = rows.reduce((s,r) => s + (Number(r.effective_monthly)||0), 0)

  return (
    <div style={{padding:'28px 32px',maxWidth:1100}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:14,marginBottom:28}}>
        {[
          {label:'Offices', val: totalTenants, sub: `${activeTenants} active`, color:'#6366f1'},
          {label:'Total Seats', val: totalSeats, sub: 'across all offices', color:'#2563eb'},
          {label:'MRR', val: `$${totalMRR.toLocaleString('en-US',{maximumFractionDigits:0})}`, sub: 'effective monthly', color:'#10b981'},
          {label:'Clients', val: totalClients.toLocaleString(), sub: 'platform-wide', color:'#f59e0b'},
          {label:'Leads', val: totalLeads.toLocaleString(), sub: 'platform-wide', color:'#f97316'},
          {label:'Storage', val: fmtBytes(totalStorage), sub: 'documents total', color:'#8b5cf6'},
        ].map(s => (
          <div key={s.label} style={{background:'var(--s1)',border:'1px solid var(--br)',borderRadius:12,padding:'14px 16px'}}>
            <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em'}}>{s.label}</div>
            <div style={{fontSize:24,fontWeight:800,color:s.color,margin:'2px 0'}}>{s.val}</div>
            <div style={{fontSize:11,color:'var(--t3)'}}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{fontSize:13,fontWeight:700,color:'var(--tx)',marginBottom:12}}>Per-Office Breakdown</div>
      <div style={{border:'1px solid var(--br)',borderRadius:10,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
          <thead>
            <tr style={{background:'var(--s2)',textAlign:'left'}}>
              {['Firm','Status','Seats / Staff','Clients','Leads','Storage','MRR','Last Activity'].map(h=>(
                <th key={h} style={{padding:'9px 12px',fontSize:10.5,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.04em'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{borderTop:'1px solid var(--br)'}}>
                <td style={{padding:'9px 12px',color:'var(--tx)',fontWeight:600}}>
                  {r.brand_color && <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:r.brand_color,marginRight:7}}/>}
                  {r.firm_name}
                </td>
                <td style={{padding:'9px 12px'}}>
                  <span style={{fontSize:10.5,fontWeight:700,padding:'2px 9px',borderRadius:20,textTransform:'capitalize',
                    background:(STATUS_COLORS[r.status]||'#94a3b8')+'22',color:STATUS_COLORS[r.status]||'#94a3b8'}}>{r.status}</span>
                </td>
                <td style={{padding:'9px 12px',color:'var(--t2)'}}>{Number(r.billing_seats||0)>0 ? `${r.billing_seats} / ${r.employee_count||0}` : `${r.employee_count||0} / ${r.employee_count||0}`}</td>
                <td style={{padding:'9px 12px',color:'var(--t2)'}}>{r.client_count}</td>
                <td style={{padding:'9px 12px',color:'var(--t2)'}}>{r.lead_count}</td>
                <td style={{padding:'9px 12px',color:'var(--t2)'}}>{fmtBytes(r.storage_bytes)}</td>
                <td style={{padding:'9px 12px',color:'var(--t2)'}}>{r.effective_monthly != null ? `$${Number(r.effective_monthly).toFixed(0)}/mo` : '—'}</td>
                <td style={{padding:'9px 12px',color:'var(--t3)'}}>{timeAgo(r.last_activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Search: find any client/lead across every office ────────────────────
function AdminSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)

  async function runSearch() {
    if (!q.trim()) { setResults(null); return }
    setSearching(true)
    const { data, error } = await supabase.rpc('admin_search_all', { p_query: q.trim() })
    setSearching(false)
    if (!error) setResults(data || [])
  }

  return (
    <div style={{padding:'28px 32px',maxWidth:820}}>
      <div style={{fontSize:20,fontWeight:800,color:'var(--tx)',marginBottom:4}}>🔍 Cross-Office Search</div>
      <div style={{color:'var(--t3)',fontSize:13,marginBottom:20}}>
        Find any client or lead by name, email, or phone — across every office on the platform.
      </div>
      <div style={{display:'flex',gap:10,marginBottom:20}}>
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter' && runSearch()}
          placeholder="Search name, email, or phone…" autoFocus
          style={{flex:1,padding:'10px 14px',borderRadius:8,border:'1px solid var(--br)',background:'var(--s2)',color:'var(--tx)',fontSize:14}}/>
        <button className="btn pri" onClick={runSearch} disabled={searching || !q.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {results !== null && (
        results.length === 0 ? (
          <div style={{color:'var(--t3)',fontSize:13,padding:'20px 0'}}>No matches found.</div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {results.map(r => (
              <div key={`${r.record_type}-${r.id}`} style={{background:'var(--s1)',border:'1px solid var(--br)',borderRadius:10,padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
                <span style={{fontSize:10.5,fontWeight:700,padding:'3px 9px',borderRadius:6,
                  background: r.record_type==='client' ? '#10b98122' : '#f59e0b22',
                  color: r.record_type==='client' ? '#10b981' : '#f59e0b',textTransform:'uppercase'}}>{r.record_type}</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,color:'var(--tx)',fontSize:13.5}}>{r.name}</div>
                  <div style={{fontSize:12,color:'var(--t3)'}}>{[r.email,r.phone].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div style={{fontSize:12,color:'var(--t2)',fontWeight:600}}>{r.tenant_name}</div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
