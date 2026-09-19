import fs from 'node:fs'

const adminPath = 'src/pages/AdminPortal.jsx'
const s = fs.readFileSync(adminPath, 'utf8').replace(/\r\n/g, '\n')

for (const forbidden of [
  'fetchCrmMetricsUrl(product.metricsUrl)',
  'fetchCrmMetricsUrl(tenantProduct.metricsUrl)',
  "if (!product?.metricsUrl)",
  "if (!key || !tenantProduct?.metricsUrl)",
  "liveAggregate || normalizeTaxresMetrics(scopedFallback)",
  "const TAXRES_LIVE_KEYS = ['tax_case_review', 'nashville', 'cloudcpa']",
  "setTaxresLiveData(",
]) {
  if (s.includes(forbidden)) throw new Error(`Unsafe/stale Admin metrics path remains: ${forbidden}`)
}

for (const required of [
  'const fetchCrmProductMetrics = React.useCallback',
  "functions/v1/hub-proxy",
  'fetchCrmProductMetrics(crmProduct)',
  "supabase.rpc('admin_taxres_crm_scope_metrics'",
  "supabase.rpc('admin_taxres_live_kpis'",
  'const [taxresScopeData, setTaxresScopeData] = useState(null)',
  "metrics_source: liveRes.data.source || 'live_taxres_family'",
  'const taxresMetrics = taxresScopeData?.metrics || {}',
  "const hasLiveTaxresMetrics = taxresScopeData?.metrics_source === 'live_taxres_family'",
  'const taxresSeatCount = localTaxRes.reduce',
  'const selectedTaxresSeats = activeTenant',
  "const crmTenants = crmProduct === 'taxres_crm' ? localTaxRes : remoteOffices",
  "String(t.tenant_code || '').toUpperCase() !== 'DEMO'",
  "crmProduct==='taxres_crm' ? (taxresMetrics.clients ?? '—')",
  "crmProduct==='taxres_crm' && taxresScopeError",
]) {
  if (!s.includes(required)) throw new Error(`Admin metrics contract missing: ${required}`)
}

const metricsFn = fs.readFileSync('supabase/functions/platform-metrics/index.ts', 'utf8').replace(/\r\n/g, '\n')
for (const forbiddenMetricFragment of [
  ".eq('status','pending')",
  ".eq('is_active',true)",
]) {
  if (metricsFn.includes(forbiddenMetricFragment)) {
    throw new Error(`Stale TaxRes metrics schema reference remains: ${forbiddenMetricFragment}`)
  }
}
for (const requiredMetricFragment of [
  ".eq('done',false)",
  ".ilike('status','active')",
  "supabase.from('cases').select('*',{count:'exact',head:true})",
  "supabase.rpc('_admin_tenant_storage_bytes',{p_tenant_id:tenantId})",
  'const computedMrr=',
  'total_clients:totalClientCount||0',
  'active_clients:activeClientCount||0',
  'active_staff:staffCount',
  'open_jobs:caseCount||0',
  'outstanding_invoices:invoiceCount||0',
  'pending_esigns:esignCount||0',
  'demos_today:demoCount||0',
  ".is('deleted_at',null)",
]) {
  if (!metricsFn.includes(requiredMetricFragment)) {
    throw new Error(`TaxRes metrics accuracy verification failed: ${requiredMetricFragment}`)
  }
}

const scheduleMigration = fs.readFileSync('supabase/migrations/20260916193000_admin_taxres_crm_scope_metrics.sql', 'utf8')
for (const required of [
  'admin_taxres_crm_scope_metrics',
  "'pending_esigns'",
  "'demos_today'",
  "'storage_bytes'",
  "'upcoming_demos'",
  "'upcoming_deadlines'",
]) {
  if (!scheduleMigration.includes(required)) throw new Error(`TaxRes schedule migration verification failed: ${required}`)
}

const liveKpiMigration = fs.readFileSync('supabase/migrations/20260919053000_authoritative_taxres_live_kpis.sql', 'utf8')
for (const required of [
  'admin_taxres_live_kpis',
  "'live_taxres_family'",
  'x-internal-cron-token',
  'tax_case_review',
  'nashville',
  'cloudcpa',
  "'storage_files'",
  "'pending_esigns'",
  "'demos_today'",
  'billing_seats',
]) {
  if (!liveKpiMigration.includes(required)) throw new Error(`Authoritative TaxRes KPI migration verification failed: ${required}`)
}

console.log('Admin CRM server-authoritative metrics contracts verified without mutating source')
