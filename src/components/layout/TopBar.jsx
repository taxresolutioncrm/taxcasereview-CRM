import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { useFirm } from '../../lib/useFirm'
import { isSoundEnabled, setSoundEnabled, playSound } from '../../lib/notifySound'
import { applyDocumentLanguage, getStoredLanguage, storeLanguage } from '../../lib/i18n'
import GlobalSearch from '../GlobalSearch'

const PAGE_TITLES = {
  '/':             'Dashboard',      '/calendar':    'Calendar',
  '/leads':        'Leads',          '/clients':     'Clients',
  '/cases':        'Cases',          '/tasks':       'Tasks',
  '/transcripts':  'Transcripts',    '/irsforms':    'IRS Forms',
  '/deadlines':    'Deadlines',      '/invoices':    'Invoices',
  '/payments':     'Payments',       '/sms':         'SMS',
  '/email':        'Email',          '/documents':   'Documents',
  '/esign':        'E-Signatures',   '/timeclock':   'Time Clock',
  '/payroll':      'Payroll',        '/employees':   'Employees',
  '/reports':      'Reports',        '/settings':    'Settings',
  '/books':        'Books',          '/dialer':      'Dialer',
  '/chat':         'Team Chat',      '/taxreturns':  'Tax Returns',
  '/fax':          'Fax',            '/ar':          'Accounts Receivable',
  '/stateforms':   'State Forms',    '/irsreference':'IRS Reference',
  '/formacorp':    'FormaCorp',      '/timeoff':     'Time Off Requests',
  '/workflows':    'Workflows',      '/kiosk':       'Clock-In Kiosk',
}

const NEW_ITEMS = [
  { icon: '📋', label: 'New Case',       sub: 'Open a case',           path: '/cases',       color: '#f59e0b' },
  { icon: '👤', label: 'New Client',     sub: 'Add a client file',     path: '/clients',     color: '#3b82f6' },
  { icon: '🏢', label: 'New Corp',       sub: 'Formation case',        path: '/formacorp',   color: '#6366f1' },
  { icon: '📁', label: 'New Document',   sub: 'Upload document',       path: '/documents',   color: '#f97316' },
  { icon: '✍️', label: 'New E-Sign',     sub: 'Request signature',     path: '/esign',       color: '#7c3aed' },
  { icon: '📧', label: 'New Email',      sub: 'Compose email',         path: '/email',       color: '#0ea5e9' },
  { icon: '📊', label: 'New Entry',      sub: 'Books & Ledger',        path: '/books',       color: '#10b981' },
  { icon: '📅', label: 'New Event',      sub: 'Add to calendar',       path: '/calendar',    color: '#8b5cf6' },
  { icon: '📠', label: 'New Fax',        sub: 'Send a fax',            path: '/fax',         color: '#dc2626' },
  { icon: '🧾', label: 'New Invoice',    sub: 'Bill a client',         path: '/invoices',    color: '#ef4444' },
  { icon: '👥', label: 'New Lead',       sub: 'Add a prospect',        path: '/leads',       color: '#a855f7' },
  { icon: '💳', label: 'New Payment',    sub: 'Record a payment',      path: '/payments',    color: '#22c55e' },
  { icon: '✅', label: 'New Task',       sub: 'Assign work',           path: '/tasks',       color: '#06b6d4' },
  { icon: '📝', label: 'New Transcript', sub: 'Pull or add transcript', path: '/irsportal',   color: '#14b8a6' },
]

function formatUsPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (d.length !== 10) return value || ''
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
}

export default function TopBar({ onNew }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { searchQ, setSearchQ, mobileNavOpen, setMobileNavOpen } = useApp()
  const [clock, setClock] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [open, setOpen] = useState(false)
  const [language, setLanguageState] = useState(getStoredLanguage)
  const { firm } = useFirm()
  const [soundOn, setSoundOnState] = useState(isSoundEnabled())
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('tcr-theme')
    if (saved) return saved === 'dark'
    return true
  })

  useEffect(() => {
    document.documentElement.classList.toggle('light', !dark)
    localStorage.setItem('tcr-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    applyDocumentLanguage(language)
  }, [language, location.pathname])

  const panelRef = useRef(null)
  const btnRef = useRef(null)
  const title = PAGE_TITLES[location.pathname] || 'Tax Resolution CRM'

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      const locale = language === 'es' ? 'es-US' : 'en-US'
      setClock(d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: language !== 'es' }))
      setDateStr(d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [language])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!panelRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => { setOpen(false) }, [location.pathname])

  const MODAL_PATHS = new Set(['/leads','/clients','/cases','/tasks','/invoices','/payments','/documents','/calendar','/email','/esign','/fax','/formacorp','/books','/transcripts','/irsportal'])
  function go(path) {
    setOpen(false)
    navigate(MODAL_PATHS.has(path) ? path + '?new=1' : path)
  }

  function setLanguage(next) {
    const stored = storeLanguage(next)
    setLanguageState(stored)
    applyDocumentLanguage(stored)
  }

  const newDrawer = open && typeof document !== 'undefined'
    ? createPortal(
      <>
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10040,
            background: 'rgba(0,0,0,.36)'
          }}
        />
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Create New"
          style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(92vw, 340px)',
            background: '#0F2033',
            color: '#E8EEF4',
            borderLeft: '1px solid rgba(255,255,255,.12)',
            zIndex: 10050,
            display: 'flex', flexDirection: 'column',
            boxShadow: '-12px 0 40px rgba(0,0,0,.55)',
            overflow: 'hidden'
          }}
        >
          <div style={{
            minHeight: 64, padding: '14px 16px',
            borderBottom: '1px solid rgba(255,255,255,.10)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            flexShrink: 0
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#E8EEF4' }}>Create New</div>
              <div style={{ fontSize: 11, color: '#99AABB', marginTop: 2 }}>What would you like to add?</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close create menu"
              style={{
                width: 34, height: 34, borderRadius: 8,
                border: '1px solid rgba(255,255,255,.12)',
                background: '#152840', color: '#E8EEF4', cursor: 'pointer',
                fontSize: 18, lineHeight: 1
              }}
            >×</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {NEW_ITEMS.map(item => (
              <button
                key={item.path}
                onClick={() => go(item.path)}
                style={{
                  width: '100%', minHeight: 58,
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 10px', borderRadius: 9,
                  border: '1px solid transparent', background: 'transparent',
                  color: '#E8EEF4', cursor: 'pointer', textAlign: 'left',
                  marginBottom: 4, fontFamily: 'inherit'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#152840'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.borderColor = 'transparent'
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                  background: item.color + '22', border: `1px solid ${item.color}55`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17
                }}>{item.icon}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#E8EEF4' }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: '#99AABB' }}>{item.sub}</div>
                </div>
                <svg style={{ marginLeft: 'auto', flexShrink: 0, color: '#667788' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ))}
          </div>
        </aside>
      </>,
      document.body
    )
    : null

  return (
    <div className="topbar" style={{ position: 'relative' }}>
      <button
        className="hamburger-btn"
        onClick={() => setMobileNavOpen(o => !o)}
        aria-label="Open menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
        <span className="page-title" style={{ flexShrink: 0 }}>{title}</span>
        <GlobalSearch value={searchQ} onChange={setSearchQ} />
      </div>

      <div style={{display:'flex',alignItems:'center',gap:14,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--t2)',whiteSpace:'nowrap'}}>
          <span style={{fontSize:13}}>📞</span>
          <span style={{fontWeight:700,letterSpacing:'.02em'}}>{formatUsPhone(firm?.phone || firm?.firmphone || '') || '—'}</span>
        </div>
        <div style={{width:1,height:14,background:'var(--br)'}}/>
        <div style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--t2)',whiteSpace:'nowrap'}}>
          <span style={{fontSize:13}}>📠</span>
          <span style={{fontWeight:700,letterSpacing:'.02em'}}>{formatUsPhone(firm?.firm_fax_number || firm?.fax_number || '') || '—'}</span>
        </div>
      </div>
      <div role="group" aria-label="Language" style={{display:'flex',gap:2,padding:2,border:'1px solid var(--br)',borderRadius:7,background:'var(--s2)'}}>
        <button type="button" onClick={() => setLanguage('en')} aria-pressed={language === 'en'} title="English" style={{border:0,borderRadius:5,padding:'3px 6px',fontSize:10,fontWeight:800,cursor:'pointer',background:language==='en'?'var(--blue)':'transparent',color:language==='en'?'#fff':'var(--t3)'}}>EN</button>
        <button type="button" onClick={() => setLanguage('es')} aria-pressed={language === 'es'} title="Español" style={{border:0,borderRadius:5,padding:'3px 6px',fontSize:10,fontWeight:800,cursor:'pointer',background:language==='es'?'var(--blue)':'transparent',color:language==='es'?'#fff':'var(--t3)'}}>ES</button>
      </div>
      <button
        onClick={() => {
          const next = !soundOn
          setSoundOnState(next)
          setSoundEnabled(next)
          if (next) playSound('message')
        }}
        title={soundOn ? 'Notification sounds on — click to mute | right-click to test' : 'Notification sounds muted — click to unmute'}
        onContextMenu={e => { e.preventDefault(); playSound('sms'); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: soundOn ? 'var(--t2)' : 'var(--t3)', padding: '0 4px', lineHeight: 1 }}
      >
        {soundOn ? '🔔' : '🔇'}
      </button>
      <button
        onClick={() => setDark(d => !d)}
        title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--t2)', padding: '0 4px', lineHeight: 1 }}
      >
        {dark ? '☀️' : '🌙'}
      </button>
      <span className="topbar-datestr" style={{ fontSize: 12, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{dateStr}</span>
      <span className="topbar-clock">{clock}</span>

      <button ref={btnRef} className="btn pri" onClick={() => setOpen(o => !o)} style={{ position: 'relative', minWidth: 72 }}>
        {open ? '✕ Close' : '+ New'}
      </button>

      {newDrawer}
    </div>
  )
}
