import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { Suspense, lazy, useEffect } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { CallProvider } from './context/CallContext'
import { GmailSyncProvider } from './context/GmailSyncContext'
import { ScreenShareProvider } from './context/ScreenShareContext'
import Sidebar  from './components/layout/Sidebar'
import AIAssistant from './components/AIAssistant'
import TopBar   from './components/layout/TopBar'
import { Modal, Toast } from './components/ui'
import ActiveCallBar from './components/calling/ActiveCallBar'
import ImpersonationBanner from './components/ImpersonationBanner'
import { ROUTE_PLAN_MINIMUM, planAtLeast, planLabel } from './lib/planTiers'


class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('[PageErrorBoundary] Page crash:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
          justifyContent:'center', height:'60vh', gap:16, color:'var(--t3)',
          textAlign:'center', padding:32 }}>
          <div style={{ fontSize:36 }}>⚠️</div>
          <div style={{ fontWeight:800, fontSize:18, color:'var(--tx)' }}>Something went wrong</div>
          <div style={{ fontSize:13, color:'var(--t2)', maxWidth:340, lineHeight:1.6 }}>
            {String(this.state.error?.message || this.state.error || 'Unknown error')}
          </div>
          <button className="btn pri" onClick={() => { this.setState({ hasError:false, error:null }); window.location.reload() }}
            style={{ padding:'8px 20px', marginTop:8 }}>Reload page</button>
        </div>
      )
    }
    return this.props.children
  }
}

// Public, unauthenticated entry points stay eager — loaded immediately on
// first paint with no extra network round-trip, since these are the very
// first thing a visitor (employee or client) sees.
import Login      from './pages/Login'
const Kiosk = lazy(() => import('./pages/Kiosk'))
const BookAppointment = lazy(() => import('./pages/BookAppointment'))
const ManageBooking = lazy(() => import('./pages/ManageBooking'))
const SignPage = lazy(() => import('./pages/SignPage'))
const RomyLabsAgreementSign = lazy(() => import('./pages/RomyLabsAgreementSign'))
const OfficeDocumentSign = lazy(() => import('./pages/OfficeDocumentSign'))
const MeetingRoom = lazy(() => import('./pages/MeetingRoom'))
const ScreenShareJoin = lazy(() => import('./pages/ScreenShareJoin'))
const ScreenShareHost = lazy(() => import('./pages/ScreenShareHost'))
const ClockIn = lazy(() => import('./pages/ClockIn'))
const EmployeePortal = lazy(() => import('./pages/EmployeePortal'))
const ClientPortal = lazy(() => import('./pages/ClientPortal'))
const OrganizerPage = lazy(() => import('./pages/OrganizerPage'))
const FinancialIntakePage = lazy(() => import('./pages/FinancialIntakePage'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))
const QuickBooksCallback  = lazy(() => import('./pages/QuickBooksCallback'))
const XeroCallback = lazy(() => import('./pages/XeroCallback'))
const NewOffice = lazy(() => import('./pages/NewOffice'))
const AdminConsole = lazy(() => import('./pages/AdminConsole'))
const ImpersonateGate = lazy(() => import('./pages/ImpersonateGate'))
const AdminPortalGuard = lazy(() => import('./pages/AdminPortalGuard'))
const Training = lazy(() => import('./pages/Training'))
const Manual   = lazy(() => import('./pages/Manual'))
const Support = lazy(() => import('./pages/Support'))

// Everything behind login is lazy-loaded — each page's code only downloads
// when you actually navigate to it, instead of all ~30 pages loading upfront
// in one giant bundle. This is what was making the whole CRM feel slow.
const Dashboard     = lazy(() => import('./pages/Dashboard'))
const TimeOff       = lazy(() => import('./pages/TimeOff'))
const Leads         = lazy(() => import('./pages/Leads'))
const Clients       = lazy(() => import('./pages/Clients'))
const Cases         = lazy(() => import('./pages/Cases'))
const Tasks         = lazy(() => import('./pages/Tasks'))
const Calendar      = lazy(() => import('./pages/Calendar'))
const Transcripts   = lazy(() => import('./pages/Transcripts'))
const IRSPortal     = lazy(() => import('./pages/IRSPortal'))
const IrsForms      = lazy(() => import('./pages/IrsForms'))
const StateForms    = lazy(() => import('./pages/StateForms'))
const IrsReference  = lazy(() => import('./pages/IrsReference'))
const TaxReturns    = lazy(() => import('./pages/TaxReturns'))
const Deadlines     = lazy(() => import('./pages/Deadlines'))
const Estimates     = lazy(() => import('./pages/Estimates'))
const Invoices      = lazy(() => import('./pages/Invoices'))
const Payments      = lazy(() => import('./pages/Payments'))
const AccountsReceivable = lazy(() => import('./pages/AccountsReceivable'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Sms           = lazy(() => import('./pages/Sms'))
const Email         = lazy(() => import('./pages/Email'))
const Documents     = lazy(() => import('./pages/Documents'))
const Esign         = lazy(() => import('./pages/TaxOfficeEsign'))
const TimeClock     = lazy(() => import('./pages/TimeClock'))
const Payroll       = lazy(() => import('./pages/Payroll'))
const Employees     = lazy(() => import('./pages/Employees'))
const ActivityReport= lazy(() => import('./pages/ActivityReport'))
const Reports       = lazy(() => import('./pages/Reports'))
const Settings      = lazy(() => import('./pages/Settings'))
const Dialer        = lazy(() => import('./pages/Dialer'))
const Chat          = lazy(() => import('./pages/Chat'))
const Books         = lazy(() => import('./pages/Books'))
const FormaCorp     = lazy(() => import('./pages/FormaCorp'))
const Fax           = lazy(() => import('./pages/Fax'))
const Workflows     = lazy(() => import('./pages/Workflows'))
const TimeEntry     = lazy(() => import('./pages/TimeEntry'))

const style = document.createElement('style')
style.textContent = `@keyframes spin { to { transform: rotate(360deg) } }`
document.head.appendChild(style)

function RequireAuth({ children }) {
  const { user, checking } = useApp()
  if (checking) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Blocks a route by role permission OR plan tier
function Guard({ section, children }) {
  const { can, planTier } = useApp()
  const requiredTier = ROUTE_PLAN_MINIMUM[section]
  const tierBlocked = requiredTier && !planAtLeast(planTier, requiredTier)
  if (tierBlocked) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '60vh', gap: 16, color: 'var(--t3)', textAlign: 'center', padding: 32
      }}>
        <div style={{ fontSize: 48 }}>⭐</div>
        <div style={{ fontWeight: 800, fontSize: 20, color:'var(--tx)' }}>
          {planLabel(requiredTier)} Plan Required
        </div>
        <div style={{ fontSize:14, color:'var(--t2)', maxWidth:340, lineHeight:1.6 }}>
          This feature requires the <strong>{planLabel(requiredTier)}</strong> plan.
          Contact <strong>romy@taxrescrm.net</strong> to upgrade.
        </div>
      </div>
    )
  }
  if (!can('view', section)) {
    return (
      <div style={{
        display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        height:'60vh', gap:12, color:'var(--t3)'
      }}>
        <div style={{ fontSize:40 }}>🔒</div>
        <div style={{ fontWeight:700, fontSize:16, color:'var(--tx)' }}>Access Restricted</div>
        <div style={{ fontSize:13 }}>You don't have permission to view this page.</div>
        <div style={{ fontSize:12 }}>Contact Romy Cruz to request access.</div>
      </div>
    )
  }
  return children
}

function Shell() {
  const { openModal, closeModal, realtimeOk } = useApp()
  const navigate = useNavigate()

  function handleNew() {
    openModal('Quick Add', (
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {[
          ['👤 Lead',    '/leads'],
          ['🏢 Client',  '/clients'],
          ['📁 Case',    '/cases'],
          ['✅ Task',    '/tasks'],
          ['📄 Invoice', '/invoices'],
          ['💰 Payment', '/payments'],
        ].map(([label, path]) => (
          <button key={label} onClick={() => { closeModal(); navigate(path) }} className="btn lg full" style={{ justifyContent:'flex-start', gap:10 }}>
            {label}
          </button>
        ))}
      </div>
    ))
  }

  return (
    <ScreenShareProvider>
    <CallProvider>
    <GmailSyncProvider>
    <div className="app-shell">
      <Sidebar />
      <div className="main-area">
        <TopBar onNew={handleNew} />
        <div className="page-content">
          <PageErrorBoundary>
          <Suspense fallback={
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'40vh', color:'var(--t3)', fontSize:13 }}>
              Loading…
            </div>
          }>
          <Routes>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/leads/:id"    element={<Guard section="leads"><Leads /></Guard>} />
            <Route path="/leads"       element={<Guard section="leads"><Leads /></Guard>} />
            <Route path="/clients"     element={<Guard section="clients"><Clients /></Guard>} />
            <Route path="/clients/:id" element={<Guard section="clients"><Clients /></Guard>} />
            <Route path="/cases"       element={<Guard section="cases"><Cases /></Guard>} />
            <Route path="/cases/:id"   element={<Guard section="cases"><Cases /></Guard>} />
            <Route path="/tasks"       element={<Guard section="tasks"><Tasks /></Guard>} />
            <Route path="/calendar"    element={<Guard section="calendar"><Calendar /></Guard>} />
            <Route path="/transcripts" element={<Navigate to="/irsportal" replace />} />
            <Route path="/irsportal" element={<Guard section="transcripts"><IRSPortal /></Guard>} />
            <Route path="/irsforms"    element={<Guard section="irsforms"><IrsForms /></Guard>} />
            <Route path="/stateforms"  element={<Guard section="stateforms"><StateForms /></Guard>} />
            <Route path="/irsreference" element={<Guard section="irsreference"><IrsReference /></Guard>} />
            <Route path="/taxreturns"  element={<Guard section="taxreturns"><TaxReturns /></Guard>} />
            <Route path="/taxreturns/:id" element={<Guard section="taxreturns"><TaxReturns /></Guard>} />
            <Route path="/deadlines"   element={<Guard section="deadlines"><Deadlines /></Guard>} />
            <Route path="/estimates"   element={<Guard section="estimates"><Estimates /></Guard>} />
            <Route path="/invoices"    element={<Guard section="invoices"><Invoices /></Guard>} />
            <Route path="/payments"    element={<Guard section="payments"><Payments /></Guard>} />
            <Route path="/ar"          element={<Guard section="payments"><AccountsReceivable /></Guard>} />
            <Route path="/transactions" element={<Guard section="payments"><Transactions /></Guard>} />
            <Route path="/sms"         element={<Guard section="sms"><Sms /></Guard>} />
            <Route path="/email"       element={<Guard section="email"><Email /></Guard>} />
            <Route path="/documents"   element={<Guard section="documents"><Documents /></Guard>} />
            <Route path="/esign"       element={<Guard section="esign"><Esign /></Guard>} />
            <Route path="/kiosk"       element={<Kiosk />} />
            <Route path="/employee"    element={<EmployeePortal />} />
            <Route path="/timeclock"   element={<TimeClock />} />
            <Route path="/payroll"     element={<Guard section="payroll"><Payroll /></Guard>} />
            <Route path="/timeoff"     element={<Guard section="timeoff"><TimeOff /></Guard>} />
            <Route path="/employees"   element={<Guard section="employees"><Employees /></Guard>} />
            <Route path="/activity-report" element={<Guard section="employees"><ActivityReport /></Guard>} />
            <Route path="/reports"     element={<Guard section="reports"><Reports /></Guard>} />
            <Route path="/settings"    element={<Guard section="settings"><Settings /></Guard>} />
            <Route path="/dialer"      element={<Guard section="dialer"><Dialer /></Guard>} />
            <Route path="/chat"        element={<Guard section="chat"><Chat /></Guard>} />
            <Route path="/books"       element={<Guard section="books"><Books /></Guard>} />
            <Route path="/formacorp"   element={<Guard section="formacorp"><FormaCorp /></Guard>} />
            <Route path="/fax"         element={<Guard section="fax"><Fax /></Guard>} />
            <Route path="/workflows"   element={<Guard section="workflows"><Workflows /></Guard>} />
            <Route path="/timeentry"   element={<Guard section="payments"><TimeEntry /></Guard>} />
            <Route path="/new-office"  element={<NewOffice />} />
            <Route path="/admin"       element={<AdminConsole />} />
            <Route path="/training"    element={<Training />} />
            <Route path="/manual"      element={<Manual />} />
            <Route path="/support"     element={<Support />} />
            <Route path="*"            element={<Navigate to="/" />} />
          </Routes>
          </Suspense>
          </PageErrorBoundary>
        </div>
      </div>
      {!realtimeOk && (
        <div style={{
          position:'fixed', bottom:0, left:0, right:0, zIndex:9999,
          background:'#f59e0b', color:'#1c1917', padding:'8px 16px',
          fontSize:12, fontWeight:700, textAlign:'center', display:'flex',
          alignItems:'center', justifyContent:'center', gap:8,
        }}>
          ⚠️ Connection interrupted — real-time updates paused. Reconnecting...
        </div>
      )}
      <ActiveCallBar />
      <Modal />
      <Toast />
    </div>
    </GmailSyncProvider>
    </CallProvider>
      <AIAssistant />
    </ScreenShareProvider>
  )
}

const ADMIN_EMAILS = new Set(['info@romylabs.com','romy@romylabs.com','romy@taxrescrm.net','romy@taxcasereview.org'])
const isPlatformOwner = (email) => ADMIN_EMAILS.has((email || '').toLowerCase())

// Renders the admin portal for the product owner, regular CRM for everyone else.
// When ?imp=1 is in the URL, we're in an impersonation session — skip the
// redirect to /crm-admin and render the CRM shell with the tenant override.
function AdminGate() {
  const { user } = useApp()
  const navigate = useNavigate()
  const isAdminHost = window.location.hostname.toLowerCase() === 'admin.romylabs.com'

  // Impersonation is intentional only when the current URL explicitly carries
  // the impersonation marker. A stale sessionStorage flag from a prior Jump In
  // must never strand a platform owner in the tenant CRM on admin.romylabs.com.
  const impParam = new URLSearchParams(window.location.search).get('imp')
  const hasExplicitImpersonationIntent = impParam === '1' || impParam === 'true'
  const storedImpersonation = !!sessionStorage.getItem('admin_impersonation')
  const isImpersonating = hasExplicitImpersonationIntent && storedImpersonation

  useEffect(() => {
    // Admin routing is host-scoped. Product hosts always remain normal CRMs.
    if (!isAdminHost) return

    // SECURITY BOUNDARY: admin.romylabs.com must never render a tenant/demo CRM
    // merely because the browser still has a valid non-owner Supabase session.
    // Purge that stale session and force the dedicated admin login instead.
    if (user && !isPlatformOwner(user.email)) {
      try { sessionStorage.removeItem('admin_impersonation') } catch (_) {}
      supabase.auth.signOut().finally(() => navigate('/login', { replace: true }))
      return
    }

    if (!isPlatformOwner(user?.email)) return

    // Clear stale Jump In state when the owner arrives normally at the admin host.
    if (!hasExplicitImpersonationIntent && storedImpersonation) {
      sessionStorage.removeItem('admin_impersonation')
      supabase.rpc('set_admin_tenant_override', { p_tenant_id: null }).catch(() => {})
    }

    if (!hasExplicitImpersonationIntent) {
      navigate('/crm-admin', { replace: true })
    }
  }, [user, isAdminHost, hasExplicitImpersonationIntent, storedImpersonation, navigate])

  // Product hosts always render their CRM, including for RomyLabs owners.
  if (!isAdminHost) return <Shell />
  if (isImpersonating) return <Shell />
  if (isPlatformOwner(user?.email)) return null
  // Never expose a tenant/demo shell on the RomyLabs admin hostname.
  return null
}

function AuthRouter() {
  const { user, checking } = useApp()
  const path = window.location.pathname

  // HARD PUBLIC BOUNDARY: meeting tabs on admin.romylabs.com must never enter
  // AdminGate/RequireAuth. Render the meeting room immediately from the URL,
  // regardless of the owner's existing admin session.
  if (/^\/meet\/[^/]+/.test(path)) {
    return (
      <Suspense fallback={<div style={{minHeight:'100vh',background:'#080b14'}} />}>
        <MeetingRoom />
      </Suspense>
    )
  }

  // Public routes must render immediately — never block them on the auth check.
  // /book, /sign, /portal etc are anonymous; showing a spinner loses prospects.
  const publicPaths = ['/book', '/sign', '/agreement', '/office-sign', '/portal', '/clockin', '/kiosk',
    '/employee', '/meet', '/screenshare', '/screenshare-host', '/financial-intake', '/organizer']
  const isPublicPath = publicPaths.some(p => path.startsWith(p))

  if (checking && !isPublicPath) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div style={{ color:'var(--t3)', fontSize:13 }}>Loading…</div>
    </div>
  )

  // Kiosk and Employee Portal are public when opened directly without a CRM
  // session, but when an authenticated user clicks them in the sidebar they
  // must remain on the SAME outer wildcard route as every other CRM page.
  // Keeping all authenticated sidebar navigation on one route branch prevents
  // Shell/contexts from unmounting and remounting (the residual "almost like a
  // refresh" behavior users could still see after the earlier routing fix).
  const publicHrPage = !user && path === '/kiosk'
    ? <Kiosk />
    : !user && path === '/employee'
      ? <EmployeePortal />
      : null

  return (
    <Routes>
      <Route path="/impersonate" element={<ImpersonateGate />} />
      <Route path="/login" element={
        user &&
        new URLSearchParams(window.location.search).get('switch') !== '1' &&
        (window.location.hostname.toLowerCase() !== 'admin.romylabs.com' || isPlatformOwner(user?.email))
          ? <Navigate to="/" replace />
          : <Login />
      } />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/auth/quickbooks-callback" element={<QuickBooksCallback />} />
      <Route path="/auth/xero-callback" element={<XeroCallback />} />
      <Route path="/book" element={<BookAppointment />} />
      <Route path="/book/manage/:token" element={<ManageBooking />} />
      <Route path="/clockin" element={<ClockIn />} />
      <Route path="/sign/:id" element={<SignPage />} />
      <Route path="/agreement/:token" element={<RomyLabsAgreementSign />} />
      <Route path="/office-sign/:token" element={<OfficeDocumentSign />} />
      <Route path="/meet/:id"          element={<MeetingRoom />} />
      <Route path="/screenshare"       element={<ScreenShareJoin />} />
      <Route path="/screenshare-host"  element={<ScreenShareHost />} />
      <Route path="/portal/:id" element={<ClientPortal />} />
      <Route path="/organizer/:id" element={<OrganizerPage />} />
      <Route path="/financial-intake/:id" element={<FinancialIntakePage />} />
      <Route path="/crm-admin/*" element={
        window.location.hostname.toLowerCase() === 'admin.romylabs.com' ? (
          <RequireAuth>
            <Suspense fallback={<div style={{minHeight:'100vh',background:'#0d0c1a'}}/>}>
              <AdminPortalGuard />
            </Suspense>
          </RequireAuth>
        ) : <Navigate to="/" replace />
      } />
      <Route path="*" element={publicHrPage || (
        <RequireAuth>
          {/* Owner routing is host-scoped: product hosts remain in CRM. */}
          <AdminGate />
        </RequireAuth>
      )} />
    </Routes>
  )
}

export default function App() {
  // Auto-logout after 3.5 hours of inactivity — all employees
  useEffect(() => {
    const IDLE_MS = 3.5 * 60 * 60 * 1000
    let timer = null
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        await supabase.auth.signOut()
        window.location.href = '/'
      }, IDLE_MS)
    }
    const events = ['mousedown','mousemove','keydown','scroll','touchstart','click']
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach(e => window.removeEventListener(e, reset))
    }
  }, [])

  return (
    <AppProvider>
      <BrowserRouter basename="/">
        <AuthRouter />
      </BrowserRouter>
    </AppProvider>
  )
}