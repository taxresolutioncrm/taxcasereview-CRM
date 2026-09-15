import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { OPEN_STATUSES } from '../lib/caseStatuses'
import { FIRM } from '../lib/firmBranding'

// When Romy is impersonating a tenant via the admin portal, his auth email
// (romy@taxrescrm.net) has no employee row in that tenant, so current_tenant_id()
// returns NULL and RLS returns 0 rows. Fix: scope every data query explicitly
// to FIRM.tenantId when it's available — safe for all sessions since FIRM is
// always loaded with the correct tenant before Dashboard mounts.
function tf(q) {
  return FIRM.tenantId ? q.eq('tenant_id', FIRM.tenantId) : q
}

const CARD_COLORS = {
    'Active Cases':        '#f59e0b',
    'Open Leads':          '#a855f7',
    'Clients':             '#3b82f6',
    'MTD 1st Trades':      '#22c55e',
    'MTD 2nd Trades':      '#22c55e',
    'AR Outstanding':      '#ef4444',
    'Unpaid Invoices':     '#a855f7',
    'Open Tasks':          '#1A7FD4',
    'Upcoming DL':         '#f59e0b',
    'Overdue DL':          '#ef4444',
    'Closed Leads':        '#a855f7',
    'Team MTD 1st Trades': '#3b82f6',
  }

// Hoisted to module scope: defining this inside Dashboard created a new
// component type on every render (the clock re-renders every second), so React
// remounted every card each tick. A remount mid-drag swallowed dragend, left
// dragIdx stuck non-null, and the stuck guard silently killed tile clicks.
function StatCard({ card, idx, onDragStart, onDragOver, onDrop, onDragEnd, onCardClick }) {
  const { label, val, sub, color, to, icon } = card
  const borderColor = CARD_COLORS[label] || 'var(--blue)'
  return (
    <div
      draggable
      data-card-idx={idx}
      onDragStart={e => { e.currentTarget.style.opacity = '0.4'; onDragStart(e, idx) }}
      onDragOver={e => onDragOver(e, idx)}
      onDrop={e => { e.currentTarget.style.opacity = '1'; onDrop(e, idx) }}
      onDragEnd={e => { e.currentTarget.style.opacity = '1'; onDragEnd() }}
      onClick={() => onCardClick(to)}
      title="Drag to rearrange"
      style={{
        background: '#10283f',
        border: '1px solid #24435f',
        borderTop: 'none',
        borderRadius: '0 0 12px 12px',
        padding: '16px 14px',
        cursor: 'grab',
        transition: 'transform .15s, box-shadow .15s',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 100,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        userSelect: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 24px ${borderColor}40` }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: borderColor, boxShadow: `0 0 16px ${borderColor}, 0 3px 14px ${borderColor}66` }}/>
      <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, color: 'var(--t3)', opacity: 0.5, lineHeight: 1, letterSpacing: 1 }}>⠿</div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '.06em', marginBottom: 8, lineHeight: 1.25,
            minHeight: 25, maxWidth: 'calc(100% - 10px)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', overflowWrap: 'anywhere'
          }}>{label}</div>
          <div style={{
            fontSize: 'clamp(22px, 1.55vw, 28px)', fontWeight: 900, color: color || 'var(--tx)', lineHeight: 1,
            minHeight: 30, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'clip', letterSpacing: '-.02em'
          }}>{val ?? '—'}</div>
          {sub && <div style={{
            fontSize: 11, color: 'var(--t3)', marginTop: 6, lineHeight: 1.35,
            minHeight: 15, maxWidth: '100%', overflowWrap: 'anywhere'
          }}>{sub}</div>}
        </div>
        {icon && <div style={{ fontSize: 28, opacity: .15, flexShrink: 0, marginLeft: 10 }}>{icon}</div>}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, role, employeeName, can } = useApp()
  const [metrics, setMetrics] = useState({})
  const [recentCases, setRecentCases] = useState([])
  const [tasks, setTasks] = useState([])
  const [deadlines, setDeadlines] = useState([])
  const [recentClients, setRecentClients] = useState([])
  const [recentLeads, setRecentLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [time, setTime] = useState(new Date())
  const [tasFeeds, setTasFeeds] = useState([])

  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  async function load() {
    const [
      { data: leads }, { data: clients }, { data: cases },
      { data: tasks }, { data: invoices }, { data: payments },
      { data: deadlines }, { data: arScheduled },
    ] = await Promise.all([
      tf(supabase.from('leads').select('*')).order('created_at', { ascending: false }),
      tf(supabase.from('clients').select('*').is('deleted_at', null)).order('created_at', { ascending: false }),
      tf(supabase.from('cases').select('*')).order('created_at', { ascending: false }),
      tf(supabase.from('tasks').select('*').not('deleted','is',true)).order('created_at', { ascending: false }),
      tf(supabase.from('invoices').select('id,total,status,clientName')),
      tf(supabase.from('payments').select('id,amount,status,created_at,source,enrolled_by')),
      tf(supabase.from('deadlines').select('*')).order('dueDate', { ascending: true }),
      tf(supabase.from('payments').select('amount,payment_status,scheduled_date').eq('payment_status', 'Scheduled')),
    ])

    const now = new Date()
    const thisMonth = now.toISOString().slice(0, 7)

    // 1st trade = the Tax Investigation Fee. This is collected externally via
    // LeadFlow before a lead ever reaches the CRM, so it's never written to
    // the payments table — leads.taxFee (set when the lead is qualified) is
    // the only record of it we have. MTD = leads created this month.
    // 2nd trade = the Resolution Fee, charged in-app once IRS results are
    // back and the addendum is signed — these DO hit payments, tagged
    // source:'resolution_fee' by stripe-resolution-fee-confirm.
    const mtd1stTrades   = (leads || [])
      .filter(l => l.created_at?.startsWith(thisMonth))
      .reduce((s, l) => s + parseFloat(l.taxFee || 0), 0)
    const total1stTrades = (leads || []).reduce((s, l) => s + parseFloat(l.taxFee || 0), 0)
    const mtd2ndTrades   = (payments || [])
      .filter(p => p.source === 'resolution_fee' && p.created_at?.startsWith(thisMonth))
      .reduce((s, p) => s + parseFloat(p.amount || 0), 0)
    const total2ndTrades = (payments || [])
      .filter(p => p.source === 'resolution_fee')
      .reduce((s, p) => s + parseFloat(p.amount || 0), 0)

    // Role-scoped numbers — Tax Advisor (sales rep) only sees their own
    // leads/1st-trade, Tax Associate/Manager only sees their own 2nd-trade
    // (commission credit, via enrolled_by — see ChargeResolutionFeeModal /
    // stripe-resolution-fee-confirm). "Closed" = no longer open, matching
    // Open Leads' own status list, just inverted.
    const CLOSED_STATUSES = ['Converted to Client', 'Dead', 'Do Not Contact']
    const myLeads = (leads || []).filter(l => l.assignedTo === employeeName)
    const myOpenLeads   = myLeads.filter(l => !CLOSED_STATUSES.includes(l.status)).length
    const myClosedLeads = myLeads.filter(l => CLOSED_STATUSES.includes(l.status)).length
    const closedLeads   = (leads || []).filter(l => CLOSED_STATUSES.includes(l.status)).length
    const my1stTradeMtd = myLeads
      .filter(l => l.created_at?.startsWith(thisMonth))
      .reduce((s, l) => s + parseFloat(l.taxFee || 0), 0)
    const my2ndTradeMtd = (payments || [])
      .filter(p => p.source === 'resolution_fee' && p.enrolled_by === employeeName && p.created_at?.startsWith(thisMonth))
      .reduce((s, p) => s + parseFloat(p.amount || 0), 0)

    const arOutstanding = (arScheduled || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0)

    setMetrics({
      activeCases: (cases || []).filter(c => OPEN_STATUSES.includes(c.status)).length,
      openLeads: (leads || []).filter(l => !['Converted to Client', 'Dead', 'Do Not Contact'].includes(l.status)).length,
      totalClients: (clients || []).length,
      mtd1stTrades, total1stTrades, mtd2ndTrades, total2ndTrades,
      closedLeads, myOpenLeads, myClosedLeads, my1stTradeMtd, my2ndTradeMtd,
      arOutstanding,
      unpaidInvoices: (invoices || []).filter(i => i.status === 'Unpaid' || i.status === 'Overdue').length,
      unpaidAmt: (invoices || []).filter(i => i.status === 'Unpaid' || i.status === 'Overdue').reduce((s, i) => s + parseFloat(i.total || 0), 0),
      openTasks: (tasks || []).filter(t => !t.done).length,
      overdueTasks: (tasks || []).filter(t => !t.done && t.dueDate && new Date(t.dueDate) < now).length,
      upcomingDl: (deadlines || []).filter(d => new Date(d.dueDate) >= now && d.status !== 'Completed').length,
      overdueDl: (deadlines || []).filter(d => new Date(d.dueDate) < now && d.status !== 'Completed').length,
    })

    setRecentCases((cases || []).slice(0, 6))
    setTasks((tasks || []).filter(t => !t.done).slice(0, 8))
    setDeadlines((deadlines || []).filter(d => d.status !== 'Completed').slice(0, 8))
    setRecentClients((clients || []).slice(0, 5))
    setRecentLeads((leads || []).filter(l => !['Converted to Client', 'Dead'].includes(l.status)).slice(0, 5))
    setLoading(false)
  }

  // Fetch TAS blog feed — localStorage cache for instant load, refresh every 4hrs
  useEffect(() => {
    const CACHE_KEY = 'tcr_tas_feed', CACHE_TTL = 4*60*60*1000
    const TAS_FALLBACK = [
      { title: 'NTA Blog: Understanding Your Rights as a Taxpayer', link: 'https://www.taxpayeradvocate.irs.gov/blog/', pubDate: new Date().toISOString() },
      { title: 'TAS Tax Tips: What to Do When the IRS Contacts You', link: 'https://www.taxpayeradvocate.irs.gov/blog/', pubDate: new Date(Date.now()-86400000*3).toISOString() },
      { title: 'Know Your Rights: Free Tax Help Available Nationwide', link: 'https://www.taxpayeradvocate.irs.gov/blog/', pubDate: new Date(Date.now()-86400000*7).toISOString() },
    ]
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      if (cached?.items?.length && Date.now() - cached.ts < CACHE_TTL) { setTasFeeds(cached.items); return }
    } catch(_) {}
    async function fetchFeed() {
      const TAS_RSS = encodeURIComponent('https://www.taxpayeradvocate.irs.gov/feed/')
      const proxies = [`https://api.rss2json.com/v1/api.json?rss_url=${TAS_RSS}&count=3`, `https://api.allorigins.win/get?url=${TAS_RSS}`]
      for (const url of proxies) {
        try {
          const r = await fetch(url), d = await r.json()
          if (d.status === 'ok' && d.items?.length) { const items = d.items.slice(0,3); setTasFeeds(items); localStorage.setItem(CACHE_KEY, JSON.stringify({items, ts: Date.now()})); return }
          if (d.contents) {
            const xml = new DOMParser().parseFromString(d.contents, 'text/xml')
            const items = [...xml.querySelectorAll('item')].slice(0,3).map(el => ({ title: el.querySelector('title')?.textContent||'', link: el.querySelector('link')?.textContent||'https://www.taxpayeradvocate.irs.gov/blog/', pubDate: el.querySelector('pubDate')?.textContent||'' }))
            if (items.length) { setTasFeeds(items); localStorage.setItem(CACHE_KEY, JSON.stringify({items, ts: Date.now()})); return }
          }
        } catch(_) {}
      }
      setTasFeeds(TAS_FALLBACK); localStorage.setItem(CACHE_KEY, JSON.stringify({items: TAS_FALLBACK, ts: Date.now()}))
    }
    fetchFeed()
  }, [])

  // Drag state — use refs for drag tracking (not state) to avoid re-render freeze
  const [cardOrder, setCardOrder]       = useState(null)
  const CRM_TIPS = [
    { icon: '🖱️', tip: 'Drag any dashboard card to rearrange your layout — it saves automatically per employee.' },
    { icon: '👤', tip: 'Add a new lead with the + New button in the top bar from any page.' },
    { icon: '📋', tip: 'Log a note on a lead by opening their file and scrolling to the Notes section.' },
    { icon: '📅', tip: 'Book an appointment from a lead file — it logs a note with the date, time, and event type automatically.' },
    { icon: '🔄', tip: 'Convert a lead to a client in one click — all notes, documents, and history carry over.' },
    { icon: '👥', tip: 'Assign a lead to a specific rep using the Assigned To field in their detail view.' },
    { icon: '🗄️', tip: 'Archive a lead to hide it from the active list — restore it anytime from the Archived view.' },
    { icon: '📞', tip: 'Click a lead phone number to dial them instantly through the built-in SignalWire dialer.' },
    { icon: '🏢', tip: 'The Client Portal lets clients view documents, make payments, and sign forms — no app needed.' },
    { icon: '🔐', tip: 'Clients log into their portal with just their email and last 4 digits of their SSN.' },
    { icon: '💳', tip: 'Send a payment link via SMS or email from the Payments tab on any client file.' },
    { icon: '📊', tip: 'The Financial Profile tab builds a full TO Worksheet with all six 433 forms and an OIC calculator.' },
    { icon: '📝', tip: 'The Filing Requirements section tracks which returns a client still needs to file.' },
    { icon: '✍️', tip: 'Send a 2848, 8821, CC Auth, State POA, or Service Addendum for e-signature in one click.' },
    { icon: '📄', tip: 'State POA forms auto-match to the client state — just select the client and hit Send.' },
    { icon: '🗂️', tip: 'Signed documents are auto-saved to the client Documents tab under E-Signatures.' },
    { icon: '📦', tip: 'The Full Investigation Package sends the 2848, 8821, and CC Auth together in one e-sign flow.' },
    { icon: '🔍', tip: 'Use Pre-fill IRS Forms to auto-populate 2848, 8821, and 433 forms with client data.' },
    { icon: '📞', tip: 'Press 1 on any inbound call to connect it to the first available agent automatically.' },
    { icon: '🎙️', tip: 'Every outbound call is recorded automatically — find recordings in the Dialer page.' },
    { icon: '📝', tip: 'Call transcriptions are generated after each call — review them in the Dialer under Transcriptions.' },
    { icon: '📬', tip: 'Missed calls go straight to voicemail — listen and delete them from the Dialer voicemail tab.' },
    { icon: '📲', tip: 'You can send an SMS to any lead or client directly from their file or from the SMS page.' },
    { icon: '📧', tip: 'Gmail is synced — incoming emails from clients appear automatically in the Email tab.' },
    { icon: '🔴', tip: 'Mark an email Action Needed to flag it for follow-up — it moves to its own triage bucket.' },
    { icon: '📤', tip: 'Reply to any email directly from the CRM — it sends from your connected Gmail account.' },
    { icon: '📅', tip: 'The Calendar shows all scheduled appointments across the whole team.' },
    { icon: '✅', tip: 'Create tasks with due dates and assign them to team members — track them on the Tasks page.' },
    { icon: '⏰', tip: 'Set deadlines on cases to get reminders and track upcoming IRS response windows.' },
    { icon: '📋', tip: 'The IRS Form Tracker lets you log when forms like 2848 or 9465 were filed and their status.' },
    { icon: '🏛️', tip: 'Download official IRS PDFs directly from the IRS Forms & Docs page.' },
    { icon: '📜', tip: 'Request IRS transcripts directly from the Transcripts page and track their status.' },
    { icon: '🗺️', tip: 'State Forms & Docs has POA forms for every state — download or send for e-sign.' },
    { icon: '💰', tip: 'Record a payment and it automatically updates the balance in Accounts Receivable.' },
    { icon: '🧾', tip: 'Create and send invoices from the Invoices page — clients can pay online via the portal.' },
    { icon: '📈', tip: 'The AR page tracks all scheduled installment payments and outstanding balances.' },
    { icon: '📚', tip: 'Books & Ledger tracks firm income and expenses — export to Excel for your accountant.' },
    { icon: '⚡', tip: 'Workflows can auto-send an SMS or email the moment a lead is created — set it and forget it.' },
    { icon: '🔁', tip: 'Create a workflow to notify the team via email when a client signs their agreement.' },
    { icon: '📋', tip: 'Workflows support 10+ entity types — leads, clients, cases, payments, deadlines, and more.' },
    { icon: '🕐', tip: 'Employees clock in and out from the Kiosk page — accessible via QR code on any device.' },
    { icon: '🏖️', tip: 'Employees can request time off from the Employee Portal — managers approve or deny it.' },
    { icon: '💵', tip: 'Run payroll from the Payroll page — it calculates net pay based on clock-in hours.' },
    { icon: '💬', tip: 'Use Team Chat to message the whole team or start a direct conversation.' },
    { icon: '🎥', tip: 'Start a video huddle from Team Chat — click the camera icon to go live with your team.' },
    { icon: '🖼️', tip: 'Virtual backgrounds are available in meetings — choose TCR Brand, Office, Blur, and more.' },
    { icon: '📑', tip: 'Track all client tax returns in the Tax Returns page — log status from In Progress to Filed.' },
    { icon: '🏛️', tip: 'The FormaCorp section handles entity formation documents for business clients.' },
    { icon: '🔒', tip: 'Role-based access controls what each employee can see — Tax Advisors only see their leads.' },
    { icon: '📱', tip: 'The CRM is fully mobile responsive — access it from your phone or tablet on the go.' },
  ]

  const [tipIdx, setTipIdx]             = useState(0)
  useEffect(() => { const t = setInterval(() => setTipIdx(i => (i + 1) % CRM_TIPS.length), 5000); return () => clearInterval(t) }, [])
  const [saveIndicator, setSaveIndicator] = useState(false)
  const dragIdx  = useRef(null)
  const dragOver = useRef(null)

  // Load saved layout from employees table on mount
  useEffect(() => {
    if (!user?.email) return
    supabase.from('employees').select('dashboard_layout').eq('email', user.email).maybeSingle()
      .then(({ data }) => {
        if (data?.dashboard_layout?.length) setCardOrder(data.dashboard_layout)
      })
  }, [user?.email])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--t3)', fontSize: 14 }}>
      Loading dashboard…
    </div>
  )

  const greeting = () => {
    const h = time.getHours()
    const rawName = user?.user_metadata?.name?.split(' ')[0] || user?.email?.split('@')[0]?.split('.')[0] || 'there'
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1)
    return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${name} 👋`
  }

  const fmtTime = t => t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  const fmtDate = t => t.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const daysLeft = d => Math.ceil((new Date(d.dueDate) - new Date()) / 86400000)

  // US time zones shown on the dashboard clock -- continental US plus
  // Alaska and Hawaii. Each computed independently via Intl with an
  // explicit IANA zone (not a manual UTC offset), so DST is handled
  // automatically for the zones that observe it, same approach as the
  // business-hours check in receive-call.
  const US_TIMEZONES = [
    { label: 'Eastern',  zone: 'America/New_York' },
    { label: 'Central',  zone: 'America/Chicago' },
    { label: 'Mountain', zone: 'America/Denver' },
    { label: 'Pacific',  zone: 'America/Los_Angeles' },
    { label: 'Alaska',   zone: 'America/Anchorage' },
    { label: 'Hawaii',   zone: 'Pacific/Honolulu' },
  ]
  const fmtZoneTime = (t, zone) => t.toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true })

  const isTaxAdvisor  = role === 'Tax Advisor'
  const isTaxAssociate = role === 'Tax Associate'
  const isManager     = role === 'Manager'
  // Tax Associate/Manager work client files day-to-day, so "recent" should
  // surface clients, not leads. Tax Advisor never sees Clients at all.
  const showRecentClients = isTaxAssociate || isManager

  // ── Drag-and-drop dashboard layout ──────────────────────────────────────────



  // All cards available per role — label is the unique key
  const ALL_ROLE_CARDS = isTaxAdvisor ? [
    { label: 'Open Leads',           val: metrics.myOpenLeads,   color: 'var(--warn)', to: '/leads',     icon: '👤', sub: 'Assigned to you' },
    { label: 'Closed Leads',         val: metrics.myClosedLeads, color: 'var(--ok)',   to: '/leads',     icon: '🏁', sub: 'Assigned to you' },
    { label: 'MTD 1st Trades',       val: '$' + Math.round(metrics.my1stTradeMtd || 0).toLocaleString(), color: 'var(--ok)', to: '/leads', icon: '💰', sub: 'Inv. fees sold · your leads' },
    { label: 'Team MTD 1st Trades',  val: '$' + Math.round(metrics.mtd1stTrades  || 0).toLocaleString(), color: 'var(--blue)', icon: '👥', sub: 'Whole sales team' },
  ] : isTaxAssociate ? [
    { label: 'Active Cases',   val: metrics.activeCases,   color: 'var(--blue)', to: '/cases',     icon: '📁' },
    { label: 'Open Leads',     val: metrics.openLeads,     color: 'var(--warn)', to: '/leads',     icon: '👤' },
    { label: 'Clients',        val: metrics.totalClients,  color: 'var(--ok)',   to: '/clients',   icon: '🏢' },
    { label: 'MTD 2nd Trades', val: '$' + Math.round(metrics.my2ndTradeMtd || 0).toLocaleString(), color: 'var(--ok)', to: '/payments', icon: '💵', sub: 'Your enrollments' },
    { label: 'AR Outstanding', val: '$' + Math.round(metrics.arOutstanding  || 0).toLocaleString(), color: '#ef4444', to: '/ar', icon: '💳', sub: 'Scheduled installments' },
    { label: 'Unpaid Invoices',val: metrics.unpaidInvoices, color: '#a855f7', to: '/invoices', icon: '🧾', sub: metrics.unpaidAmt > 0 ? '$' + Math.round(metrics.unpaidAmt).toLocaleString() + ' outstanding' : 'All paid' },
    { label: 'Open Tasks',     val: metrics.openTasks,     color: '#1A7FD4',  to: '/tasks',     icon: '✅', sub: metrics.overdueTasks > 0 ? `${metrics.overdueTasks} overdue` : 'On track' },
    { label: 'Upcoming DL',   val: metrics.upcomingDl,    color: 'var(--warn)', to: '/deadlines', icon: '⏰' },
    { label: 'Overdue DL',    val: metrics.overdueDl,     color: metrics.overdueDl > 0 ? 'var(--bad)' : 'var(--ok)', to: '/deadlines', icon: '🚨' },
  ] : isManager ? [
    { label: 'Active Cases',   val: metrics.activeCases,   color: 'var(--blue)', to: '/cases',     icon: '📁' },
    { label: 'Open Leads',     val: metrics.openLeads,     color: 'var(--warn)', to: '/leads',     icon: '👤' },
    { label: 'Closed Leads',   val: metrics.closedLeads,   color: 'var(--ok)',   to: '/leads',     icon: '🏁' },
    { label: 'Clients',        val: metrics.totalClients,  color: 'var(--ok)',   to: '/clients',   icon: '🏢' },
    { label: 'MTD 1st Trades', val: '$' + Math.round(metrics.my1stTradeMtd || 0).toLocaleString(), color: 'var(--ok)', to: '/leads', icon: '💰', sub: 'Inv. fees sold · Team: $' + Math.round(metrics.mtd1stTrades || 0).toLocaleString() },
    { label: 'MTD 2nd Trades', val: '$' + Math.round(metrics.my2ndTradeMtd || 0).toLocaleString(), color: 'var(--ok)', to: '/payments', icon: '💵', sub: 'Team: $' + Math.round(metrics.mtd2ndTrades || 0).toLocaleString() },
    { label: 'AR Outstanding', val: '$' + Math.round(metrics.arOutstanding  || 0).toLocaleString(), color: '#ef4444', to: '/ar', icon: '💳', sub: 'Scheduled installments' },
    { label: 'Unpaid Invoices',val: metrics.unpaidInvoices, color: '#a855f7', to: '/invoices', icon: '🧾', sub: metrics.unpaidAmt > 0 ? '$' + Math.round(metrics.unpaidAmt).toLocaleString() + ' outstanding' : 'All paid' },
    { label: 'Open Tasks',     val: metrics.openTasks,     color: '#1A7FD4',  to: '/tasks',     icon: '✅', sub: metrics.overdueTasks > 0 ? `${metrics.overdueTasks} overdue` : 'On track' },
    { label: 'Upcoming DL',   val: metrics.upcomingDl,    color: 'var(--warn)', to: '/deadlines', icon: '⏰' },
    { label: 'Overdue DL',    val: metrics.overdueDl,     color: metrics.overdueDl > 0 ? 'var(--bad)' : 'var(--ok)', to: '/deadlines', icon: '🚨' },
  ] : [
    { label: 'Open Leads',     val: metrics.openLeads,     color: 'var(--warn)', to: '/leads',     icon: '👤' },
    { label: 'Clients',        val: metrics.totalClients,  color: 'var(--ok)',   to: '/clients',   icon: '🏢' },
    { label: 'Active Cases',   val: metrics.activeCases,   color: 'var(--blue)', to: '/cases',     icon: '📁' },
    { label: 'MTD 1st Trades', val: '$' + Math.round(metrics.mtd1stTrades  || 0).toLocaleString(), color: 'var(--ok)', to: '/leads', icon: '💰', sub: 'Inv. fees sold · Total: $' + Math.round(metrics.total1stTrades || 0).toLocaleString() },
    { label: 'MTD 2nd Trades', val: '$' + Math.round(metrics.mtd2ndTrades  || 0).toLocaleString(), color: 'var(--ok)', to: '/payments', icon: '💵', sub: 'Total: $' + Math.round(metrics.total2ndTrades || 0).toLocaleString() },
    { label: 'Unpaid Invoices',val: metrics.unpaidInvoices, color: '#a855f7', to: '/invoices', icon: '🧾', sub: metrics.unpaidAmt > 0 ? '$' + Math.round(metrics.unpaidAmt).toLocaleString() + ' outstanding' : 'All paid' },
    { label: 'Open Tasks',     val: metrics.openTasks,     color: '#1A7FD4',  to: '/tasks',     icon: '✅', sub: metrics.overdueTasks > 0 ? `${metrics.overdueTasks} overdue` : 'On track' },
    { label: 'Upcoming DL',   val: metrics.upcomingDl,    color: 'var(--warn)', to: '/deadlines', icon: '⏰' },
    { label: 'Overdue DL',    val: metrics.overdueDl,     color: metrics.overdueDl > 0 ? 'var(--bad)' : 'var(--ok)', to: '/deadlines', icon: '🚨' },
    { label: 'AR Outstanding', val: '$' + Math.round(metrics.arOutstanding || 0).toLocaleString(), color: '#ef4444', to: '/ar', icon: '💳', sub: 'Scheduled installments' },
  ]

  // Ordered cards: apply saved order or use default
  const defaultOrder = ALL_ROLE_CARDS.map(c => c.label)
  const orderedLabels = cardOrder
    ? cardOrder.filter(l => defaultOrder.includes(l)).concat(defaultOrder.filter(l => !cardOrder.includes(l)))
    : defaultOrder
  const orderedCards = orderedLabels.map(l => ALL_ROLE_CARDS.find(c => c.label === l)).filter(Boolean)

  async function saveLayout(newOrder) {
    if (!user?.email) return
    await supabase.from('employees').update({ dashboard_layout: newOrder }).eq('email', user.email)
    setSaveIndicator(true)
    setTimeout(() => setSaveIndicator(false), 1500)
  }

  function onDragStart(e, idx) {
    dragIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(e, idx) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dragOver.current = idx
    // Highlight drop target visually via DOM directly (no state re-render)
    document.querySelectorAll('[data-card-idx]').forEach(el => {
      el.style.outline = el.dataset.cardIdx === String(idx) && idx !== dragIdx.current
        ? '2px dashed var(--blue)' : ''
    })
  }
  function onDrop(e, idx) {
    e.preventDefault()
    document.querySelectorAll('[data-card-idx]').forEach(el => { el.style.outline = '' })
    if (dragIdx.current === null || dragIdx.current === idx) { dragIdx.current = null; dragOver.current = null; return }
    const next = [...orderedLabels]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(idx, 0, moved)
    dragIdx.current = null
    dragOver.current = null
    setCardOrder(next)
    saveLayout(next)
  }
  function onDragEnd() {
    document.querySelectorAll('[data-card-idx]').forEach(el => { el.style.outline = '' })
    dragIdx.current = null
    dragOver.current = null
  }



  // TAS widget (extracted so it renders in sidebar)
  const TASWidget = () => (
    <div style={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header — name only, no box */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#1A7FD4,#0ea5e9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>⚖️</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9' }}>Taxpayer Advocate</div>
          <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>● IRS.gov Updates</div>
        </div>
      </div>
      {/* Bubbles — no container, just flowing */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tasFeeds.length === 0 ? (
          [1,2,3].map(i => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div style={{ background: '#1e293b', borderRadius: '4px 14px 14px 14px', padding: '10px 13px', width: '88%' }}>
                <div style={{ width: '80%', height: 10, background: 'var(--br)', borderRadius: 4, marginBottom: 6 }}/>
                <div style={{ width: '55%', height: 8, background: 'var(--br)', borderRadius: 4 }}/>
              </div>
            </div>
          ))
        ) : tasFeeds.map((item, i) => {
          const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
              <a href={item.link || '#'} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', maxWidth: '92%' }}>
                <div style={{ background: '#1e3a5f', borderRadius: '4px 14px 14px 14px', padding: '10px 13px', cursor: 'pointer', transition: 'background .15s' }}
                  onMouseEnter={e => e.currentTarget.style.background='#1e3a6e'}
                  onMouseLeave={e => e.currentTarget.style.background='#1e3a5f'}
                >
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.45, marginBottom: 5 }}>{item.title}</div>
                  <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700 }}>Read more →</div>
                </div>
              </a>
              <div style={{ fontSize: 10, color: 'var(--t3)', paddingLeft: 2 }}>{date}</div>
            </div>
          )
        })}
        <a href="https://www.taxpayeradvocate.irs.gov/blog/" target="_blank" rel="noreferrer"
          style={{ fontSize: 10, color: 'var(--t3)', textDecoration: 'none', fontWeight: 600, paddingLeft: 2 }}>
          taxpayeradvocate.irs.gov →
        </a>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', padding: '20px 24px' }}>
      {/* Main dashboard content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Greeting + clock */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx)' }}>{greeting()}</div>
          <div style={{ fontSize: 13, color: 'var(--t3)', marginTop: 2 }}>{fmtDate(time)}</div>
        </div>
        <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {US_TIMEZONES.map(z => (
              <div key={z.zone} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{z.label}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 12.5, fontWeight: 600, color: 'var(--t2)', marginTop: 2 }}>{fmtZoneTime(time, z.zone)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards — drag to rearrange, auto-saves per employee */}
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 14 }}>
          {orderedCards.map((card, idx) => (
            <StatCard key={card.label} card={card} idx={idx}
              onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}
              onCardClick={to => { if (to && dragIdx.current === null) navigate(to) }} />
          ))}
        </div>
        {saveIndicator && (
          <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ok)', marginTop: 6, fontWeight: 600 }}>
            ✅ Layout saved
          </div>
        )}
      </div>

      {/* Main grid */}
      <div className="detail-2col" style={{ display: 'grid', gridTemplateColumns: isTaxAdvisor ? '1fr' : '1fr 1fr', gap: 14 }}>


        {!isTaxAdvisor && (
        <>
        {/* Active Cases */}
        <div className="card">
          <div className="ch">
            <span className="ct">🗂 Active Cases</span>
            <button className="btn sm" onClick={() => navigate('/cases')}>View All →</button>
          </div>
          {recentCases.length === 0
            ? <div style={{ color: 'var(--t3)', fontSize: 13, padding: '8px 0' }}>No cases yet</div>
            : recentCases.map(c => (
              <div key={c.id} onClick={() => navigate('/cases')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--br)', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.clientName}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.caseType} {c.irsBalance ? '· $' + Number(c.irsBalance).toLocaleString() : ''}</div>
                </div>
                <span className={`bdg ${c.status === 'Open' ? 'bb' : c.status === 'Resolved' ? 'bg' : 'ba'}`} style={{ fontSize: 10, flexShrink: 0 }}>{c.status}</span>
              </div>
            ))
          }
        </div>

        {/* Open Tasks */}
        <div className="card">
          <div className="ch">
            <span className="ct">✅ Open Tasks</span>
            <button className="btn sm" onClick={() => navigate('/tasks')}>All Tasks →</button>
          </div>
          {tasks.length === 0
            ? <div style={{ color: 'var(--t3)', fontSize: 13, padding: '8px 0' }}>No open tasks</div>
            : tasks.map(t => {
              const overdue = t.dueDate && new Date(t.dueDate) < new Date()
              return (
                <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--br)' }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--blue)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: overdue ? 'var(--bad)' : 'var(--t3)' }}>
                      {t.clientName && `${t.clientName} · `}{t.dueDate ? (overdue ? '⚠ ' : '') + t.dueDate : ''}
                    </div>
                  </div>
                  <span className={`bdg ${t.priority === 'High' ? 'br' : t.priority === 'Low' ? 'bn' : 'ba'}`} style={{ fontSize: 10, flexShrink: 0 }}>{t.priority || 'Normal'}</span>
                </div>
              )
            })
          }
        </div>

        {/* IRS Deadlines */}
        <div className="card">
          <div className="ch">
            <span className="ct">⏰ IRS Deadlines</span>
            <button className="btn sm" onClick={() => navigate('/deadlines')}>All →</button>
          </div>
          {deadlines.length === 0
            ? <div style={{ color: 'var(--t3)', fontSize: 13, padding: '8px 0' }}>No upcoming deadlines</div>
            : deadlines.map(d => {
              const dl = daysLeft(d)
              const overdue = dl < 0, urgent = dl >= 0 && dl <= 7
              return (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--br)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || d.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{d.clientName || d.client || ''} · {d.dueDate}</div>
                  </div>
                  <span className={`bdg ${overdue ? 'br' : urgent ? 'ba' : 'bg'}`} style={{ fontSize: 10, flexShrink: 0, marginLeft: 8 }}>
                    {overdue ? 'OVERDUE' : dl === 0 ? 'TODAY' : dl + 'd'}
                  </span>
                </div>
              )
            })
          }
        </div>
        </>
        )}

        {showRecentClients ? (
          /* Recent Clients — Tax Associate / Manager work client files day-to-day */
          <div className="card">
            <div className="ch">
              <span className="ct">🏢 Recent Clients</span>
              <button className="btn sm" onClick={() => navigate('/clients')}>All Clients →</button>
            </div>
            {recentClients.length === 0
              ? <div style={{ color: 'var(--t3)', fontSize: 13, padding: '8px 0' }}>No clients yet</div>
              : recentClients.map(c => (
                <div key={c.id} onClick={() => navigate('/clients')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--br)', cursor: 'pointer' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                    {(c.name || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.issueType || ''} {c.irsBalance ? '· $' + Number(c.irsBalance).toLocaleString() : ''}</div>
                  </div>
                </div>
              ))
            }
          </div>
        ) : (
          /* Recent Leads — Tax Advisor sees only their own assigned leads */
          <div className="card">
            <div className="ch">
              <span className="ct">👤 Recent Leads{isTaxAdvisor ? ' — Yours' : ''}</span>
              <button className="btn sm" onClick={() => navigate('/leads')}>All Leads →</button>
            </div>
            {(isTaxAdvisor ? recentLeads.filter(l => l.assignedTo === employeeName) : recentLeads).length === 0
              ? <div style={{ color: 'var(--t3)', fontSize: 13, padding: '8px 0' }}>No leads yet</div>
              : (isTaxAdvisor ? recentLeads.filter(l => l.assignedTo === employeeName) : recentLeads).map(l => (
                <div key={l.id} onClick={() => navigate('/leads')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--br)', cursor: 'pointer' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                    {(l.name || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{l.issueType || l.source || ''} {l.irsBalance ? '· ~' + l.irsBalance : ''}</div>
                  </div>
                  <span className="bdg bb" style={{ fontSize: 10, flexShrink: 0 }}>{l.status}</span>
                </div>
              ))
            }
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="ch"><span className="ct">⚡ Quick Actions</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {[
            ['👤 New Lead', '/leads', 'leads'], ['🏢 New Client', '/clients', 'clients'],
            ['📁 New Case', '/cases', 'cases'], ['✅ New Task', '/tasks', 'tasks'],
            ['🧾 New Invoice', '/invoices', 'invoices'], ['⏰ Add Deadline', '/deadlines', 'deadlines'],
            ['📅 Schedule', '/calendar', 'calendar'], ['💬 Team Chat', '/chat', 'chat'],
          ].filter(([, , section]) => can('edit', section)).map(([label, to]) => (
            <button key={label} className="btn" style={{ justifyContent: 'flex-start', fontSize: 13, padding: '9px 12px' }} onClick={() => navigate(to)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      </div>

      {/* TAS Sidebar — right side, all roles */}
      {(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 230, flexShrink: 0 }}>
          <TASWidget />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#f59e0b,#d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>💡</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9' }}>CRM Tips</div>
                <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>● Daily Hint</div>
              </div>
            </div>
            <div>
              <div style={{ background: 'linear-gradient(135deg,#1c2a1c,#1a2e1a)', border: '1px solid rgba(34,197,94,.2)', borderRadius: '4px 14px 14px 14px', padding: '12px 14px' }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{CRM_TIPS[tipIdx].icon}</div>
                <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.55, fontWeight: 500 }}>{CRM_TIPS[tipIdx].tip}</div>
              </div>
              <div style={{ marginTop: 6, paddingLeft: 2 }}>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 4 }}>
                  {CRM_TIPS.map((_, i) => (
                    <div key={i} style={{ width: i === tipIdx ? 14 : 5, height: 5, borderRadius: 3, background: i === tipIdx ? '#93c5fd' : 'rgba(255,255,255,.2)', transition: 'all .3s', cursor: 'pointer' }} onClick={() => setTipIdx(i)} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

