// Start fetching a lazy page chunk when the user shows intent (hover/focus/touch),
// so navigation usually completes from cache without bloating the initial bundle.
const loaders = {
  '/': () => import('../pages/Dashboard'),
  '/leads': () => import('../pages/Leads'),
  '/clients': () => import('../pages/Clients'),
  '/cases': () => import('../pages/Cases'),
  '/tasks': () => import('../pages/Tasks'),
  '/calendar': () => import('../pages/Calendar'),
  '/irsportal': () => import('../pages/IRSPortal'),
  '/irsforms': () => import('../pages/IrsForms'),
  '/stateforms': () => import('../pages/StateForms'),
  '/irsreference': () => import('../pages/IrsReference'),
  '/taxreturns': () => import('../pages/TaxReturns'),
  '/deadlines': () => import('../pages/Deadlines'),
  '/estimates': () => import('../pages/Estimates'),
  '/invoices': () => import('../pages/Invoices'),
  '/payments': () => import('../pages/Payments'),
  '/ar': () => import('../pages/AccountsReceivable'),
  '/transactions': () => import('../pages/Transactions'),
  '/sms': () => import('../pages/Sms'),
  '/email': () => import('../pages/Email'),
  '/documents': () => import('../pages/Documents'),
  '/esign': () => import('../pages/TaxOfficeEsign'),
  '/timeclock': () => import('../pages/TimeClock'),
  '/payroll': () => import('../pages/Payroll'),
  '/timeoff': () => import('../pages/TimeOff'),
  '/employees': () => import('../pages/Employees'),
  '/activity-report': () => import('../pages/ActivityReport'),
  '/reports': () => import('../pages/Reports'),
  '/settings': () => import('../pages/Settings'),
  '/dialer': () => import('../pages/Dialer'),
  '/chat': () => import('../pages/Chat'),
  '/books': () => import('../pages/Books'),
  '/formacorp': () => import('../pages/FormaCorp'),
  '/fax': () => import('../pages/Fax'),
  '/workflows': () => import('../pages/Workflows'),
  '/timeentry': () => import('../pages/TimeEntry'),
  '/training': () => import('../pages/Training'),
  '/manual': () => import('../pages/Manual'),
  '/support': () => import('../pages/Support'),
}

const started = new Set()
function basePath(href) {
  try {
    const url = new URL(href, window.location.origin)
    const parts = url.pathname.split('/').filter(Boolean)
    if (!parts.length) return '/'
    const p = '/' + parts[0]
    return p === '/transcripts' ? '/irsportal' : p
  } catch { return null }
}

function prefetch(target) {
  const anchor = target?.closest?.('a[href]')
  if (!anchor) return
  const p = basePath(anchor.href)
  const load = p && loaders[p]
  if (!load || started.has(p)) return
  started.add(p)
  load().catch(() => started.delete(p))
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerover', e => prefetch(e.target), { passive: true })
  document.addEventListener('focusin', e => prefetch(e.target), { passive: true })
  document.addEventListener('touchstart', e => prefetch(e.target), { passive: true })
}
