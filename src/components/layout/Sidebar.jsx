import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { FIRM } from '../../lib/firmBranding'
import { OPEN_STATUSES } from '../../lib/caseStatuses'
import { ROUTE_PLAN_MINIMUM, planAtLeast } from '../../lib/planTiers'

const LOGO = '/logo.png'

// Karbon-style accordion sections
const SECTIONS = [
  {
    key: 'overview',
    label: 'Overview',
    always: true,
    items: [
      { path: '/',          icon: GridIcon,    label: 'Home',     section: null },
      { path: '/email',     icon: EmailIcon,   label: 'Email',         badge: 'email',    section: 'email' },
      { path: '/chat',      icon: ChatIcon,    label: 'Team Chat',     badge: 'chat',     section: 'chat' },
      { path: '/calendar',  icon: CalIcon,     label: 'Calendar',      badge: 'calendar', section: 'calendar' },
      { path: '/tasks',     icon: TaskIcon,    label: 'Tasks',         badge: 'tasks',    section: 'tasks' },
      { path: '/dialer',    icon: DialIcon,    label: 'Dialer',        badge: 'voicemails', section: 'dialer' },
    ]
  },
  {
    key: 'clientwork',
    label: 'Client Work',
    items: [
      { path: '/leads',     icon: LeadIcon,    label: 'Leads',         badge: 'leads',     section: 'leads' },
      { path: '/clients',   icon: ClientIcon,  label: 'Clients',       badge: 'clients',   section: 'clients' },
      { path: '/cases',     icon: CaseIcon,    label: 'Cases',         badge: 'cases',     section: 'cases' },
      { path: '/deadlines', icon: ClockIcon,   label: 'Deadlines',     badge: 'deadlines', badgeWarn: true, section: 'deadlines' },
    ]
  },
  {
    key: 'comms',
    label: 'Communications',
    items: [
      { path: '/sms',       icon: SmsIcon,     label: 'SMS',           badge: 'sms',    section: 'sms' },
      { path: '/fax',       icon: FaxIcon,     label: 'Fax',           badge: 'fax',    section: 'fax' },
      { path: '/documents', icon: FolderIcon,  label: 'Documents',     section: 'documents' },
      { path: '/esign',     icon: SignIcon,    label: 'E-Signatures',  badge: 'esign',  section: 'esign' },
    ]
  },
  {
    key: 'billing',
    label: 'Billing',
    items: [
      { path: '/invoices',  icon: InvIcon,     label: 'Invoices',              section: 'invoices' },
      { path: '/payments',  icon: PayIcon,     label: 'Payments',              section: 'payments' },
      { path: '/ar',        icon: ARIcon,      label: 'Accounts Receivable',   section: 'payments' },
      { path: '/transactions', icon: PayIcon,  label: 'Transactions',          section: 'payments' },
      { path: '/timeentry',  icon: ClockIcon,   label: 'Time & Billing',        section: 'payments' },
      { path: '/books',     icon: BooksIcon,   label: 'Books & Ledger',        section: 'books' },
    ]
  },
  {
    key: 'irs',
    label: 'IRS & State Resolution',
    items: [
      { path: '/irsforms',    icon: FormIcon,      label: 'IRS Forms & Docs',      section: 'irsforms' },
      { path: '/stateforms',  icon: FormIcon,      label: 'State Forms & Docs',    section: 'stateforms' },
      { path: '/irsreference', icon: PhoneBookIcon, label: 'IRS & State Reference', section: 'irsreference' },
      { path: '/irsportal',   icon: FormIcon,      label: 'IRS Portal',            section: 'transcripts' },
    ]
  },
  {
    key: 'taxreturns',
    label: 'Tax Returns & Entities',
    items: [
      { path: '/taxreturns',  icon: ReturnIcon, label: 'Tax Returns',   section: 'taxreturns' },
      { path: '/formacorp',   icon: CorpIcon,   label: 'FormaCorp',     section: 'formacorp' },
    ]
  },
  {
    key: 'hr',
    label: 'HR & Payroll',
    items: [
      { path: '/kiosk',     icon: KioskIcon,   label: 'Time Kiosk',    section: null },
      { path: '/employee',  icon: PortalIcon,  label: 'Employee Portal', section: null },
      { path: '/timeclock',       icon: ClockIcon,    label: 'Time Clock',       section: null },
      { path: '/timeoff',         icon: TimeOffIcon,  label: 'Time Off',         badge: 'timeoff', section: 'timeoff' },
      { path: '/payroll',         icon: PayrollIcon,  label: 'Payroll',          section: 'payroll' },
      { path: '/activity-report', icon: ActivityIcon, label: 'Activity Report',  section: 'employees' },
    ]
  },
  {
    key: 'firm',
    label: 'Firm',
    items: [
      { path: '/employees', icon: EmpIcon,     label: 'Employees',     section: 'employees' },
      { path: '/reports',   icon: BarIcon,     label: 'Reports',       section: 'reports' },
      { path: '/workflows', icon: GearIcon,    label: 'Workflows',     section: 'workflows' },
      { path: '/settings',  icon: GearIcon,    label: 'Settings',      section: 'settings' },
    ]
  },
  {
    key: 'training',
    label: 'Training',
    items: [
      { path: '/training', icon: ScreenIcon, label: 'Training', section: null },
      { path: '/manual',   icon: BookIcon,   label: 'CRM Manual',  section: null },
    ]
  },
  // Platform Admin and Support removed from TCR — they live in the TaxRes CRM admin build
]

export default function Sidebar() {
  const { user, logout, can, role, mobileNavOpen, setMobileNavOpen, employeeName, planTier } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [logoUrl, setLogoUrl] = useState(() => FIRM.logoUrl || null)

  // Determine which section contains the active route
  function activeSection() {
    const p = location.pathname
    for (const s of SECTIONS) {
      if (s.always) continue
      if (s.items.some(i => i.path !== '/' && (p === i.path || p.startsWith(i.path + '/')))) return s.key
    }
    return null
  }

  const [openKey, setOpenKey] = useState('clientwork')

  // Auto-open the section that contains the active page on navigation
  useEffect(() => {
    const active = activeSection()
    if (active) setOpenKey(active)
  }, [location.pathname])

  // On mobile the sidebar renders as a slide-in drawer (toggled by the
  // hamburger button in TopBar) instead of always-visible -- close it
  // automatically once a destination is picked, same as any standard
  // mobile nav drawer.
  useEffect(() => { setMobileNavOpen(false) }, [location.pathname])

  const [firmName, setFirmName] = useState(() => FIRM.name || 'Tax Case Review')
  // Gates the CRM Companies link — Romy specifically, not any Super Admin
  // anywhere (he was explicit: no one else should ever see this, even another
  // Super Admin on TCR or any other tenant). A plain email match is simpler
  // and stricter than the previous role+tenant lookup, and needs no query.
  const [pendingTimeOff, setPendingTimeOff] = useState(0)
  const [newLeads, setNewLeads] = useState(0)
  const [newClients, setNewClients] = useState(0)
  const [openCases, setOpenCases] = useState(0)
  const [dueSoonDeadlines, setDueSoonDeadlines] = useState(0)
  const [upcomingEvents, setUpcomingEvents] = useState(0)
  const [unreadFax, setUnreadFax] = useState(0)
  const [unreadSms, setUnreadSms] = useState(0)
  const [unreadVoicemails, setUnreadVoicemails] = useState(0)
  const [pendingEsign, setPendingEsign] = useState(0)
  const [emailActionNeeded, setEmailActionNeeded] = useState(0)
  const [emailWaiting, setEmailWaiting] = useState(0)
  const [unreadInbox, setUnreadInbox] = useState(0)
  const [openTasks, setOpenTasks] = useState(0)
  const [unreadChat, setUnreadChat] = useState(0)

  useEffect(() => {
    async function loadPendingTimeOff() {
      const { count } = await supabase.from('time_off_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      setPendingTimeOff(count || 0)
    }
    loadPendingTimeOff()
    const poll = setInterval(loadPendingTimeOff, 180000)
    function onVisible() { if (document.visibilityState === 'visible') loadPendingTimeOff() }
    document.addEventListener('visibilitychange', onVisible)
    const ch = supabase.channel('sidebar-timeoff-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_off_requests' }, loadPendingTimeOff)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  // Leads/Clients/Cases/Deadlines badges used to be hardcoded to "0" here,
  // with other pages (Leads.jsx, Cases.jsx, Deadlines.jsx) trying to patch
  // the number in via document.getElementById — which only worked while
  // that specific page happened to be mounted, and got wiped back to "0"
  // the moment Sidebar re-rendered for any other reason. Computing the
  // real counts here, the same way pendingTimeOff already does, fixes that
  // for good regardless of which page you're on.
  useEffect(() => {
    async function loadCounts() {
      const seenAt = section => localStorage.getItem(`tcr_sidebar_seen_${section}`) || new Date(0).toISOString()
      const [summaryRes, leadsRes, clientsRes, casesRes] = await Promise.all([
        supabase.rpc('get_sidebar_badge_counts'),
        supabase.from('leads').select('id', { count: 'exact', head: true }).gt('created_at', seenAt('leads')),
        supabase.from('clients').select('id', { count: 'exact', head: true }).gt('created_at', seenAt('clients')),
        supabase.from('cases').select('id', { count: 'exact', head: true }).gt('created_at', seenAt('cases')),
      ])

      if (summaryRes.error) console.warn('[badge] sidebar summary refresh skipped:', summaryRes.error.message)
      if (leadsRes.error) console.warn('[badge] unseen leads refresh skipped:', leadsRes.error.message)
      if (clientsRes.error) console.warn('[badge] unseen clients refresh skipped:', clientsRes.error.message)
      if (casesRes.error) console.warn('[badge] unseen cases refresh skipped:', casesRes.error.message)

      const path = window.location.pathname
      const viewing = section => path === `/${section}` || path.startsWith(`/${section}/`)

      // Entity badges are notifications, not KPIs: only records created since
      // that user last opened the section should light up the sidebar.
      setNewLeads(viewing('leads') ? 0 : (leadsRes.count || 0))
      setNewClients(viewing('clients') ? 0 : (clientsRes.count || 0))
      setOpenCases(viewing('cases') ? 0 : (casesRes.count || 0))

      const b = summaryRes.data || {}
      // Deadlines remain an action alert because an older deadline can become
      // urgent as its due date approaches; it is intentionally not a record total.
      setDueSoonDeadlines(Number(b.deadlines) || 0)
    }
    if (!user) return
    loadCounts()
    const poll = setInterval(loadCounts, 180000)
    function onVisible() { if (document.visibilityState === 'visible') loadCounts() }
    document.addEventListener('visibilitychange', onVisible)
    const ch = supabase.channel('sidebar-counts-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, loadCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, loadCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, loadCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deadlines' }, loadCounts)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible) }
  }, [user])

  const BADGE_COUNTS = { leads: newLeads, clients: newClients, cases: openCases, deadlines: dueSoonDeadlines, fax: unreadFax, sms: unreadSms, voicemails: unreadVoicemails, esign: pendingEsign, email: unreadInbox, tasks: openTasks, chat: unreadChat, calendar: upcomingEvents }

  // SIDEBAR_UNSEEN_ACK_V1
  useEffect(() => {
    const path = location.pathname
    const section = path === '/leads' || path.startsWith('/leads/') ? 'leads'
      : path === '/clients' || path.startsWith('/clients/') ? 'clients'
      : path === '/cases' || path.startsWith('/cases/') ? 'cases'
      : null
    if (!section) return

    localStorage.setItem(`tcr_sidebar_seen_${section}`, new Date().toISOString())
    if (section === 'leads') setNewLeads(0)
    if (section === 'clients') setNewClients(0)
    if (section === 'cases') setOpenCases(0)
  }, [location.pathname])

  useEffect(() => {
    async function loadCommsCounts() {
      const smsLastSeen = localStorage.getItem('tcr_sms_last_seen') || new Date(0).toISOString()
      const [vmRes, esignRes, faxRes, smsRes] = await Promise.all([
        supabase.from('voicemails').select('id,is_read'),
        supabase.from('esigns').select('id,status'),
        supabase.from('fax_logs').select('id,is_read,direction'),
        supabase.from('sms_messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').gt('created_at', smsLastSeen),
      ])
      // These used to fail completely silently — a schema-cache or RLS error
      // on any one of them would just default the badge to 0 with zero
      // indication anything was wrong. Logging now so a broken badge shows
      // up in the browser console instead of just looking like "no new items".
      if (vmRes.error)    console.error('[badge] voicemails query failed:', vmRes.error.message)
      if (esignRes.error) console.error('[badge] esigns query failed:', esignRes.error.message)
      if (faxRes.error)   console.error('[badge] fax_logs query failed:', faxRes.error.message)
      if (smsRes.error)   console.error('[badge] sms_messages query failed:', smsRes.error.message)
      setUnreadVoicemails((vmRes.data || []).filter(v => !v.is_read).length)
      setPendingEsign((esignRes.data || []).filter(e => e.status === 'Awaiting').length)
      setUnreadFax((faxRes.data || []).filter(f => f.direction === 'inbound' && !f.is_read).length)
      setUnreadSms(smsRes.count || 0)
    }
    if (!user) return
    loadCommsCounts()
    // Realtime is the primary path, but its websocket can silently die after
    // the tab sits idle/backgrounded for a while with no automatic recovery —
    // so two safety nets: a periodic fallback poll, and an immediate reload
    // the moment the tab becomes visible again (covers the common "left it
    // open overnight, came back, nothing updated" case instantly instead of
    // waiting for the next poll).
    const poll = setInterval(loadCommsCounts, 180000)
    function onVisible() { if (document.visibilityState === 'visible') loadCommsCounts() }
    document.addEventListener('visibilitychange', onVisible)
    const ch = supabase.channel('sidebar-comms-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voicemails' }, loadCommsCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'esigns' }, loadCommsCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fax_logs' }, loadCommsCounts)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_messages' }, loadCommsCounts)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible) }
  }, [user])

  // Calendar badge — events starting today or in the next 24 hours
  useEffect(() => {
    async function loadCalendarBadge() {
      const now = new Date().toISOString()
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const { count } = await supabase.from('calevents').select('id', { count: 'exact', head: true })
        .gte('date', now).lte('date', tomorrow)
      setUpcomingEvents(count || 0)
    }
    if (!user) return
    loadCalendarBadge()
    const poll = setInterval(loadCalendarBadge, 180000)
    function onVisible() { if (document.visibilityState === 'visible') loadCalendarBadge() }
    document.addEventListener('visibilitychange', onVisible)
    const ch = supabase.channel('sidebar-calendar-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calevents' }, loadCalendarBadge)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible) }
  }, [user])

  // Clear badges when user visits those pages (instant — no refresh needed)
  useEffect(() => {
    if (location.pathname.startsWith('/sms')) {
      localStorage.setItem('tcr_sms_last_seen', new Date().toISOString())
      setUnreadSms(0)
    }
    if (location.pathname.startsWith('/email')) {
      setUnreadInbox(0)
    }
    if (location.pathname.startsWith('/tasks')) {
      setOpenTasks(0)
    }
    if (location.pathname.startsWith('/esign')) {
      setPendingEsign(0)
    }
    if (location.pathname.startsWith('/voicemail') || location.pathname.startsWith('/dialer')) {
      setUnreadVoicemails(0)
    }
    if (location.pathname.startsWith('/calendar')) {
      setUpcomingEvents(0)
    }
  }, [location.pathname])

  useEffect(() => {
    async function loadEmailTaskCounts() {
      if (!user?.email) return
      const { data, error } = await supabase.rpc('get_sidebar_badge_counts')
      if (error) {
        // A navigation-aborted fetch is not an application error. Keep the last
        // successful badge values and let the next realtime/poll/visibility pass retry.
        console.warn('[badge] email/task count refresh skipped:', error.message)
        return
      }
      const b = data || {}
      setUnreadInbox(Number(b.email) || 0)
      setOpenTasks(Number(b.tasks) || 0)
      setEmailActionNeeded(0)
      setEmailWaiting(0)
    }
    if (!user) return
    loadEmailTaskCounts()
    // Realtime channel below does the actual live updating. This poll is
    // only a safety net for the rare case realtime misses an event — 5min
    // is plenty for a fallback; it doesn't need to run every 30s when the
    // channel already covers normal operation, and the previous 30s
    // interval was fetching the full emails table for every logged-in
    // user constantly, which adds up over a full day across a team.
    const poll = setInterval(loadEmailTaskCounts, 300000)
    function onVisible() { if (document.visibilityState === 'visible') loadEmailTaskCounts() }
    document.addEventListener('visibilitychange', onVisible)
    const ch = supabase.channel('sidebar-email-tasks-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emails' }, loadEmailTaskCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, loadEmailTaskCounts)
      .subscribe()
    return () => { supabase.removeChannel(ch); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible) }
  }, [user])

  // Chat badge — count messages (rebuild) newer than when this user last had /chat open
  useEffect(() => {
    const storageKey = `tcr_chat_last_seen_${user?.email || 'anon'}`
    async function countUnreadChat() {
      const lastSeen = localStorage.getItem(storageKey)
      if (!lastSeen) { setUnreadChat(0); return }
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', lastSeen)
        .neq('sender', employeeName || user?.email || '')
      setUnreadChat(count || 0)
    }
    countUnreadChat()
    // Clear badge when user navigates to /chat
    if (location.pathname.includes('/chat')) {
      localStorage.setItem(storageKey, new Date().toISOString())
      setUnreadChat(0)
    }
    const poll = setInterval(countUnreadChat, 180000)
    function onVisible() { if (document.visibilityState === 'visible') countUnreadChat() }
    document.addEventListener('visibilitychange', onVisible)
    // Realtime — new chat message arrives
    const ch = supabase.channel('sidebar-chat-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        if (payload.new?.sender !== (employeeName || user?.email || '')) {
          const isOnChat = window.location.pathname.includes('/chat')
          if (isOnChat) {
            localStorage.setItem(storageKey, new Date().toISOString())
          } else {
            setUnreadChat(n => n + 1)
          }
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible) }
  }, [user?.email, employeeName, location.pathname])

  const [tagline,  setTagline]  = useState('IRS Resolution Services')

  useEffect(() => {
    async function loadBranding() {
      // During admin impersonation, RLS scopes settings to TCR (romy's JWT) so
      // a DB query always returns TCR's row regardless of any .eq() filter.
      // The token was validated and tenant branding stored in sessionStorage by
      // ImpersonateGate — read it directly, no DB call needed.
      try {
        const imp = sessionStorage.getItem('admin_impersonation')
        if (imp) {
          const { firm_name, logo_url } = JSON.parse(imp)
          if (firm_name) setFirmName(firm_name)
          if (logo_url) {
            const img = new Image()
            img.onload = () => setLogoUrl(logo_url)
            img.onerror = () => setLogoUrl('')
            img.src = logo_url
          } else { setLogoUrl('') }
          return
        }
      } catch (_) {}
      // Normal path — RLS scopes to the logged-in tenant automatically.
      const { data: s } = await supabase.from('settings').select('name,tagline,logourl').limit(1).maybeSingle()
      if (s?.name) {
        setFirmName(s.name)
        FIRM.name = s.name
      }
      if (s?.tagline) setTagline(s.tagline)
      if (s?.logourl) {
        FIRM.logoUrl = s.logourl
        // Only update state if different from what's already showing (avoid re-render flicker)
        if (s.logourl !== logoUrl) {
          const img = new Image()
          img.onload = () => setLogoUrl(s.logourl)
          img.src = s.logourl
        }
      } else {
        setLogoUrl('')
      }
    }
    loadBranding()
  }, [])

  function toggle(key) {
    setOpenKey(prev => prev === key ? null : key)
  }

  return (
    <>
      {mobileNavOpen && <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar${mobileNavOpen ? ' mobile-open' : ''}`}>
      <div className="brand" onClick={() => navigate('/')} style={{flexDirection:'column',alignItems:'center',padding: logoUrl ? 0 : '8px 12px',gap:4,position:'relative',background:'#0C1F35'}}>
        <button className="sidebar-close-btn" onClick={(e)=>{e.stopPropagation();setMobileNavOpen(false)}} aria-label="Close menu">×</button>
        {logoUrl
          ? <img src={logoUrl} alt={firmName}
                  style={{ display:'block', width:'100%', padding:'6px 10px',
                           boxSizing:'border-box' }} />
          : <>
              <div style={{fontWeight:900,fontSize:18,color:'var(--blue)',textAlign:'center',lineHeight:1.2}}>{firmName}</div>
              <div style={{textAlign:'center'}}>
                <div className="brand-name" style={{fontSize:13}}>{firmName}</div>
                <div className="brand-sub" style={{fontSize:10}}>{tagline || 'IRS Resolution Services'}</div>
              </div>
            </>
        }
      </div>

      {SECTIONS.map(section => {
        const isOpen = section.always || openKey === section.key
        const hasActive = !section.always && section.items.some(i => i.path !== '/' && location.pathname.startsWith(i.path))

        const sectionAlertCount = section.items.reduce((sum, item) => {
          if (!item.badge) return sum
          if (item.badge === 'timeoff') return sum + Number(pendingTimeOff || 0)
          return sum + Number(BADGE_COUNTS[item.badge] || 0)
        }, 0)
        const sectionNeedsAttention = !section.always && !isOpen && sectionAlertCount > 0

        return (
          <div key={section.key}>
            {/* Section header — clickable for non-always sections */}
            {section.always ? (
              <div className="nav-group">{section.label}</div>
            ) : (
              <div
                className="nav-group"
                onClick={() => toggle(section.key)}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingRight: 10,
                  color: sectionNeedsAttention ? 'var(--bad)' : (hasActive ? 'var(--blue)' : 'var(--t2)'),
                  userSelect: 'none',
                  fontSize: 12,
                }}
              >
                <span>{section.label}</span>
                <span style={{display:'flex',alignItems:'center',gap:7}}>
                  {sectionNeedsAttention && <span className="nav-badge">{sectionAlertCount}</span>}
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s', flexShrink: 0 }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                </span>
              </div>
            )}

            {/* Items — only show when open */}
            {isOpen && section.items.map(item => {
              const requiredPlan = item.section && ROUTE_PLAN_MINIMUM[item.section]
              const tierLocked = requiredPlan && !planAtLeast(planTier, requiredPlan)
              if (item.section && !can('view', item.section) && !tierLocked) return null
              const Icon = item.icon
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}${tierLocked ? ' tier-locked' : ''}`}
                  onClick={e => {
                    if (tierLocked) { e.preventDefault(); return }
                    if (item.path === '/email') setUnreadInbox(0)
                    if (item.path === '/tasks') setOpenTasks(0)
                    if (item.path === '/esign') setPendingEsign(0)
                    if (item.path === '/sms') { localStorage.setItem('tcr_sms_last_seen', new Date().toISOString()); setUnreadSms(0) }
                    if (item.path === '/dialer') setUnreadVoicemails(0)
                    if (item.path === '/calendar') setUpcomingEvents(0)
                  }}
                >
                  <Icon />
                  {item.label}
                  {tierLocked && <span style={{marginLeft:'auto',fontSize:10,opacity:.5}}>🔒</span>}
                  {item.badge === 'email' ? (
                    unreadInbox > 0 && <span className="nav-badge">{unreadInbox}</span>
                  ) : item.badge && (
                    item.badge === 'timeoff'
                      ? (pendingTimeOff > 0 && <span className="nav-badge">{pendingTimeOff}</span>)
                      : (BADGE_COUNTS[item.badge] > 0 && <span className={`nav-badge${item.badgeWarn ? ' warn' : ''}`}>{BADGE_COUNTS[item.badge]}</span>)
                  )}
                </NavLink>
              )
            })}
          </div>
        )
      })}

      <div style={{ flex: 1 }} />

      {user && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--br)', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>Signed in as</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)', marginBottom: 2 }}>{user.email?.startsWith('admin@') ? 'Administrator' : (employeeName || user.user_metadata?.name || user.email)}</div>
          <div style={{ fontSize: 10, color: 'var(--blue)', marginBottom: 8 }}>{role}</div>
          <button className="btn sm full" onClick={logout}>Sign Out</button>
        </div>
      )}
    </aside>
    </>
  )
}

/* ── SVG Icons ── */
function BooksIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="12" y1="7" x2="16" y2="7"/><line x1="12" y1="11" x2="16" y2="11"/></svg> }
function DialIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.39 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.69a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16z"/></svg> }
function GridIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> }
function CalIcon()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> }
function LeadIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> }
function ClientIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> }
function CaseIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> }
function TaskIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> }
function DocIcon()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg> }
function FormIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg> }
function ReturnIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg> }
function PhoneBookIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h13a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4z"/><path d="M4 7h2"/><path d="M4 12h2"/><path d="M4 17h2"/></svg> }
function ClockIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> }
function TimeOffIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v7"/><path d="M4.93 13a8 8 0 0 1 14.14 0"/><path d="M2 13h20"/><path d="M12 13v8"/><path d="M9 21h6"/></svg> }
function EstIcon()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg> }
function InvIcon()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg> }
function PayIcon()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> }
function SmsIcon()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> }
function EmailIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> }
function FolderIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> }
function SignIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> }
function ChatIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/></svg> }
function PayrollIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> }
function ActivityIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> }
function EmpIcon()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> }
function KioskIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18.01"/><rect x="8" y="6" width="8" height="8" rx="1"/></svg> }
function PortalIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg> }
function BarIcon()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> }
function GearIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> }
function ScreenIcon()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> }
function BookIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> }
function FaxIcon()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="4" height="16"/><path d="M22 7H6V3a1 1 0 011-1h14a1 1 0 011 1v4z"/><rect x="6" y="11" width="16" height="12"/></svg> }
function ARIcon()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="7" y1="15" x2="10" y2="15"/><line x1="14" y1="15" x2="17" y2="15"/></svg> }
function CorpIcon()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> }


