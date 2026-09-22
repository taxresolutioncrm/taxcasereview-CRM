import fs from 'node:fs'

const source = fs.readFileSync('src/pages/AdminPortal.jsx', 'utf8')
const failures = []

const requireMarker = (marker, label) => {
  if (!source.includes(marker)) failures.push(label)
}
const forbidMarker = (marker, label) => {
  if (source.includes(marker)) failures.push(label)
}

requireMarker('const PLATFORM_OFFICE_CACHE_MS = 20000', 'Overview office data cache is missing')
requireMarker("const metricsTimeout = (promise, label, ms = 4000)", 'Remote metrics timeout is missing')
requireMarker('void Promise.allSettled(registrySyncJobs.map(job => job.promise))', 'Registry synchronization still blocks Overview rendering')
requireMarker("const prospectsPromise = supabase.from('prospects')", 'Command Center prospect query is not started in parallel')
requireMarker("withTimeout(prospectsPromise, 'prospects')", 'Command Center prospect query is not part of the parallel load')
requireMarker("const [emailMounted, setEmailMounted]", 'Lazy SnappyMail mount state is missing')
requireMarker("const RomyLabsBilling = lazy(() => import('../components/admin/RomyLabsBilling'))", 'Billing route must stay lazy-loaded')
requireMarker("const TrafficCoverage = lazy(() => import('../components/admin/TrafficCoverage'))", 'Traffic route must stay lazy-loaded')
requireMarker("const CredentialVault = lazy(() => import('../components/admin/CredentialVault'))", 'Credential Vault route must stay lazy-loaded')
requireMarker("const UniversalOfficeESign = lazy(() => import('../components/admin/UniversalOfficeESign'))", 'E-sign/PDF module must stay off the initial Admin Portal bundle')
forbidMarker("import UniversalOfficeESign from '../components/admin/UniversalOfficeESign'", 'E-sign/PDF module is eagerly loaded')
requireMarker('{emailMounted && <div style={{', 'SnappyMail iframe is not lazy-mounted')
requireMarker("client_count:null", 'Registry fallback must not fabricate client counts when live usage is unavailable')
requireMarker("lead_count:null", 'Registry fallback must not fabricate lead counts when live usage is unavailable')
requireMarker("storage_bytes:null", 'Registry fallback must not fabricate storage usage when live usage is unavailable')
requireMarker("r.storage_bytes == null ? '—' : fmtBytes(r.storage_bytes)", 'Overview must render unknown storage as unavailable, not zero')
requireMarker("const [sortConfig, setSortConfig] = useState({ key:'portfolio_order', direction:'asc' })", 'Overview sortable column state is missing')
requireMarker("const SORT_COLUMNS = [", 'Overview sortable column registry is missing')
requireMarker("const toggleSort = key =>", 'Overview sort toggle is missing')
requireMarker("sortedStats.map(r => (", 'Overview rows are not rendered from sorted data')
requireMarker("current.key === key && current.direction === 'asc' ? 'desc' : 'asc'", 'Overview headers do not toggle ascending/descending')
forbidMarker("const prospectsRes = await supabase.from('prospects')", 'Command Center prospects are still serial')
forbidMarker('const registrySyncResults = await Promise.all(registrySyncJobs.map(job => job.promise))', 'Registry writes are still on the Overview critical path')
requireMarker(".select('product_id,name,accent_color,app_url,lifecycle,active,sort_order')", 'Overview must reuse the existing product query for portfolio ordering')
requireMarker("registry_seat_hint:office.seats == null ? null : Number(office.seats)", 'Legacy registry seats must stay separate from paid billing seats')
requireMarker("/\\bdemo\\b/i.test", 'Demo classification regex is missing')
requireMarker("employee_count:null", 'Registry fallback must not fabricate active staff from seat allocation')
requireMarker("const totalSeats   = operatingStats.reduce((s,r) => s+Number(r.billing_seats ?? 0), 0)", 'Total Seats must use only authoritative paid billing seats')
requireMarker("p_seats:null", 'Live staff counts must not be written back into registry seats')
requireMarker("is_product_main:true", 'Every active CRM product must receive a main CRM row')
requireMarker("row_kind:'main'", 'Main CRM hierarchy classification is missing')
requireMarker("effective_monthly:null", 'Main CRM structural rows must not fabricate zero-dollar MRR')
requireMarker("row_kind:row.is_demo ? 'demo' : 'customer'", 'Demo/customer hierarchy classification is missing')
requireMarker("counts_as_office:false", 'Synthetic main CRM rows must stay out of office KPIs')
requireMarker("const operatingStats = (stats||[]).filter(r => r.counts_as_office !== false)", 'Overview KPI scope must exclude synthetic main CRM rows')
requireMarker("const familyOrder =", 'Column sorting must preserve CRM family grouping')
requireMarker("if (familyOrder !== 0) return familyOrder", 'Column sorting must never break portfolio family ordering')
requireMarker("if (row.is_product_main) {", 'Main CRM rows must never fall through to an office-detail route')
requireMarker("Seats / Staff:", 'Office directory must label seat allocation separately from active staff')

if (failures.length) {
  console.error('Admin Portal performance guard FAILED')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

console.log('PASS Admin Portal performance guard')
